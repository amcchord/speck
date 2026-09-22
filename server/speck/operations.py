"""Audited templates, bounded bulk execution and native patch inventory."""

import hashlib
import json
import shlex
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.jobs import public_job
from speck.patching import LINUX_SCAN, WINDOWS_SCAN, install_script
from speck.security import require_user

router = APIRouter(prefix="/api")


class Parameter(BaseModel):
    name: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,39}$")
    label: str = Field(min_length=1, max_length=100)
    default: str = Field(default="", max_length=2000)
    required: bool = True


class Template(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    platform: Literal["windows", "linux"]
    category: Literal["script", "software"] = "script"
    script: str = Field(min_length=1, max_length=60000)
    parameters: list[Parameter] = Field(default_factory=list, max_length=12)
    timeout: int = Field(default=300, ge=10, le=7200)

    @model_validator(mode="after")
    def unique_parameters(self):
        if len({p.name for p in self.parameters}) != len(self.parameters) or "\0" in self.script:
            raise ValueError("Parameter names must be distinct and script must not contain NUL")
        return self


STARTERS = [
    dict(
        id="starter-windows-health",
        name="Windows health check",
        platform="windows",
        category="script",
        description="Uptime, free space and failed services.",
        timeout=60,
        parameters=[],
        script="Get-CimInstance Win32_OperatingSystem | Select-Object Caption,LastBootUpTime,FreePhysicalMemory\nGet-Volume | Select-Object DriveLetter,SizeRemaining,Size\nGet-Service | Where-Object {$_.StartType -eq 'Automatic' -and $_.Status -ne 'Running'} | Select-Object Name,Status",
    ),
    dict(
        id="starter-linux-health",
        name="Linux health check",
        platform="linux",
        category="script",
        description="Uptime, storage and failed systemd services.",
        timeout=60,
        parameters=[],
        script="set -eu\nuptime\ndf -h\nsystemctl --failed --no-pager\n",
    ),
    dict(
        id="starter-windows-msi",
        name="Deploy a Windows MSI",
        platform="windows",
        category="software",
        description="Download over HTTPS, verify SHA-256, install silently without rebooting.",
        timeout=1800,
        parameters=[
            dict(name="URL", label="HTTPS installer URL", default="", required=True),
            dict(name="SHA256", label="Installer SHA-256", default="", required=True),
        ],
        script=r"""$url=$env:SPECK_PARAM_URL
if(-not $url.StartsWith('https://')){throw 'Use an HTTPS installer URL'}
if($env:SPECK_PARAM_SHA256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'Provide the installer SHA-256'}
$file=Join-Path $env:TEMP ('speck-'+[Guid]::NewGuid()+'.msi')
try {
 Invoke-WebRequest -UseBasicParsing $url -OutFile $file
 if((Get-FileHash $file -Algorithm SHA256).Hash -ne $env:SPECK_PARAM_SHA256){throw 'Installer checksum mismatch'}
 $p=Start-Process msiexec.exe -ArgumentList "/i `"$file`" /qn /norestart" -Wait -PassThru
 if($p.ExitCode -notin @(0,3010)){throw "Installer failed: $($p.ExitCode)"}
 @{installed=$true;reboot_required=($p.ExitCode -eq 3010)} | ConvertTo-Json -Compress
} finally {Remove-Item $file -ErrorAction SilentlyContinue}""",
    ),
    dict(
        id="starter-linux-package",
        name="Install a Linux package",
        platform="linux",
        category="software",
        description="Install a named package from the configured apt or dnf repositories.",
        timeout=1800,
        parameters=[dict(name="PACKAGE", label="Package name", default="", required=True)],
        script=r"""set -eu
case "$SPECK_PARAM_PACKAGE" in ''|*[!a-zA-Z0-9+_.:-]*) echo 'Invalid package name' >&2; exit 1;; esac
case "$SPECK_PARAM_PACKAGE" in -*) exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null; then
 apt-get update -qq
 apt-get install -y --no-remove -- "$SPECK_PARAM_PACKAGE"
elif command -v dnf >/dev/null; then
 dnf install -y -- "$SPECK_PARAM_PACKAGE"
else echo 'This template requires apt or dnf' >&2; exit 1; fi""",
    ),
]


def all_templates(conn):
    custom = [
        dict(json.loads(unseal(r["spec"])), id=r["id"], revision=r["revision"], updated=r["updated"], builtin=False)
        for r in conn.execute("SELECT * FROM templates ORDER BY name")
    ]
    return [dict(s, revision=1, builtin=True) for s in STARTERS] + custom


@router.get("/templates")
def templates(user=Depends(require_user)):
    with db() as conn:
        return all_templates(conn)


@router.post("/templates")
def save_template(body: Template, user=Depends(require_user)):
    template_id = ident()
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO templates VALUES(?,?,?,?,?,?,?)",
            (template_id, body.name, body.platform, body.category, seal(body.model_dump_json()), 1, time.time()),
        )
        audit(conn, user["username"], "template.created", detail={"template_id": template_id, "name": body.name})
    return {"id": template_id, "revision": 1}


@router.put("/templates/{template_id}")
def update_template(template_id: str, body: Template, user=Depends(require_user)):
    with db(write=True) as conn:
        row = conn.execute("SELECT revision FROM templates WHERE id=?", (template_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Save a copy of a starter template to edit it")
        revision = row["revision"] + 1
        conn.execute(
            "UPDATE templates SET name=?,platform=?,category=?,spec=?,revision=?,updated=? WHERE id=?",
            (body.name, body.platform, body.category, seal(body.model_dump_json()), revision, time.time(), template_id),
        )
        audit(conn, user["username"], "template.updated", detail={"template_id": template_id, "revision": revision})
    return {"id": template_id, "revision": revision}


def render_script(template, parameters):
    spec = Template.model_validate(template)
    allowed = {p.name for p in spec.parameters}
    if set(parameters) - allowed:
        raise HTTPException(422, "Unknown template parameter")
    prefix = []
    for param in spec.parameters:
        value = parameters.get(param.name, param.default)
        if not isinstance(value, str) or len(value) > 2000 or "\0" in value or (param.required and not value.strip()):
            raise HTTPException(422, f"Provide a valid value for {param.label}")
        name = "SPECK_PARAM_" + param.name
        if spec.platform == "windows":
            prefix.append(f"$env:{name}='" + value.replace("'", "''") + "'")
        else:
            prefix.append("export " + name + "=" + shlex.quote(value))
    script = "\n".join(prefix + [spec.script])
    if len(script) > 65536:
        raise HTTPException(422, "Rendered script exceeds the job limit")
    return script


class Batch(BaseModel):
    request_id: str = Field(min_length=16, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["template", "patch.scan", "patch.install"]
    device_ids: list[str] = Field(min_length=1, max_length=500)
    template_id: str | None = None
    template_revision: int | None = None
    parameters: dict[str, str] = Field(default_factory=dict)
    updates: dict[str, list[str]] = Field(default_factory=dict)
    confirmed: bool = False


def prepare_batch(conn, body):
    if len(set(body.device_ids)) != len(body.device_ids):
        raise HTTPException(422, "Device selection contains duplicates")
    template = None
    if body.kind == "template":
        template = next((t for t in all_templates(conn) if t["id"] == body.template_id), None)
        if not template:
            raise HTTPException(404, "Template not found")
        if body.template_revision != template["revision"]:
            raise HTTPException(409, "Template changed. Review its current revision.")
    prepared = []
    for device_id in body.device_ids:
        row = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
        if not row or not row["approved"]:
            raise HTTPException(409, "Every target must be an approved managed device")
        telemetry = json.loads(row["telemetry"])
        if not telemetry.get("capabilities", {}).get("managed_operations"):
            raise HTTPException(409, f"Update Speck Agent on {row['label']} before using fleet operations")
        if time.time() - row["last_seen"] > 75:
            raise HTTPException(409, f"{row['label']} is offline. Refresh the target selection.")
        busy = conn.execute(
            "SELECT 1 FROM batch_jobs bj JOIN jobs j ON j.id=bj.job_id WHERE bj.device_id=? AND j.status IN ('queued','leased','running') AND j.deadline>?",
            (device_id, time.time()),
        ).fetchone()
        if busy:
            raise HTTPException(409, f"{row['label']} already has an active fleet operation")
        if template:
            if row["platform"] != template["platform"]:
                raise HTTPException(422, "The selected template and target operating systems must match")
            script = render_script(template, body.parameters)
            timeout = template["timeout"]
        elif body.kind == "patch.scan":
            script = WINDOWS_SCAN if row["platform"] == "windows" else LINUX_SCAN
            timeout = 900
        else:
            saved = conn.execute("SELECT * FROM patch_reports WHERE device_id=?", (device_id,)).fetchone()
            if not saved or time.time() - saved["scanned"] > 86400:
                raise HTTPException(409, "Scan every target within 24 hours before installing patches")
            report = json.loads(saved["report"])
            ids = body.updates.get(device_id, [])
            if not set(ids).issubset({u["id"] for u in report.get("updates", [])}):
                raise HTTPException(422, "Select updates from the most recent scan")
            script = install_script(row["platform"], ids, report["manager"])
            timeout = 7200
        prepared.append((dict(row), {"script": script, "shell": "auto", "timeout": timeout}, timeout))
    return prepared


@router.post("/batches/preview")
def preview_batch(body: Batch, user=Depends(require_user)):
    with db() as conn:
        prepared = prepare_batch(conn, body)
    return {
        "name": body.name,
        "kind": body.kind,
        "targets": [
            {"id": d["id"], "label": d["label"], "platform": d["platform"], "script": p["script"], "timeout": t}
            for d, p, t in prepared
        ],
    }


@router.post("/batches")
def create_batch(body: Batch, user=Depends(require_user)):
    if not body.confirmed:
        raise HTTPException(422, "Review and confirm the exact targets and operation")
    fingerprint = hashlib.sha256(body.model_dump_json(exclude={"confirmed"}).encode()).hexdigest()
    with db(write=True) as conn:
        existing = conn.execute("SELECT * FROM batches WHERE request_id=?", (body.request_id,)).fetchone()
        if existing:
            if existing["fingerprint"] != fingerprint:
                raise HTTPException(409, "This request ID belongs to a different operation")
            return {"id": existing["id"], "existing": True}
        prepared = prepare_batch(conn, body)
        batch_id, now = ident(), time.time()
        conn.execute(
            "INSERT INTO batches VALUES(?,?,?,?,?,?,?)",
            (batch_id, body.request_id, fingerprint, body.name, body.kind, user["username"], now),
        )
        for d, payload, timeout in prepared:
            job_id = ident()
            conn.execute(
                "INSERT INTO jobs(id,device_id,kind,payload,status,created,deadline,actor) VALUES(?,?,?,?,?,?,?,?)",
                (
                    job_id,
                    d["id"],
                    "command",
                    seal(json.dumps(payload)),
                    "queued",
                    now,
                    now + timeout + 120,
                    user["username"],
                ),
            )
            conn.execute("INSERT INTO batch_jobs VALUES(?,?,?)", (batch_id, job_id, d["id"]))
        audit(
            conn,
            user["username"],
            "batch.created",
            detail={
                "batch_id": batch_id,
                "kind": body.kind,
                "targets": body.device_ids,
                "template_id": body.template_id,
                "template_revision": body.template_revision,
            },
        )
    return {"id": batch_id, "existing": False}


@router.get("/batches")
def list_batches(user=Depends(require_user)):
    with db(write=True) as conn:
        conn.execute(
            "UPDATE jobs SET status=CASE WHEN status='queued' THEN 'expired' ELSE 'unknown' END,finished=? WHERE deadline<? AND status IN ('queued','leased','running') AND id IN (SELECT job_id FROM batch_jobs)",
            (time.time(), time.time()),
        )
        result = []
        for row in conn.execute("SELECT * FROM batches ORDER BY created DESC LIMIT 50"):
            jobs = [
                public_job(j) | {"label": j["label"]}
                for j in conn.execute(
                    "SELECT j.*,d.label FROM batch_jobs bj JOIN jobs j ON j.id=bj.job_id JOIN devices d ON d.id=bj.device_id WHERE bj.batch_id=? ORDER BY d.label",
                    (row["id"],),
                )
            ]
            result.append(
                {"id": row["id"], "name": row["name"], "kind": row["kind"], "created": row["created"], "jobs": jobs}
            )
    return result


@router.post("/batches/{batch_id}/cancel")
def cancel_batch(batch_id: str, user=Depends(require_user)):
    with db(write=True) as conn:
        if not conn.execute("SELECT 1 FROM batches WHERE id=?", (batch_id,)).fetchone():
            raise HTTPException(404, "Operation not found")
        changed = conn.execute(
            "UPDATE jobs SET status='cancelled',finished=? WHERE status='queued' AND id IN (SELECT job_id FROM batch_jobs WHERE batch_id=?)",
            (time.time(), batch_id),
        ).rowcount
        audit(
            conn, user["username"], "batch.cancelled", detail={"batch_id": batch_id, "queued_jobs_cancelled": changed}
        )
    return {"cancelled": changed, "note": "Running jobs were not interrupted"}


@router.get("/patches")
def patch_inventory(user=Depends(require_user)):
    with db() as conn:
        return [dict(r) | {"report": json.loads(r["report"])} for r in conn.execute("SELECT * FROM patch_reports")]


def record_patch_result(conn, job, result):
    operation = conn.execute(
        "SELECT b.kind FROM batch_jobs bj JOIN batches b ON b.id=bj.batch_id WHERE bj.job_id=?", (job["id"],)
    ).fetchone()
    if not operation:
        return
    if operation["kind"] == "patch.install":
        conn.execute("DELETE FROM patch_reports WHERE device_id=?", (job["device_id"],))
    if operation["kind"] != "patch.scan" or result.get("exit_code") != 0 or result.get("truncated"):
        return
    try:
        report = json.loads(result["stdout"].lstrip("\ufeff").strip())
        assert report["manager"] in ("apt", "dnf", "windows-update")
        assert isinstance(report["updates"], list) and len(report["updates"]) <= 150
        assert all(isinstance(u.get("id"), str) and isinstance(u.get("title"), str) for u in report["updates"])
    except (ValueError, KeyError, TypeError, AssertionError):
        return
    conn.execute(
        "INSERT OR REPLACE INTO patch_reports VALUES(?,?,?,?)",
        (job["device_id"], job["id"], time.time(), json.dumps(report)),
    )
