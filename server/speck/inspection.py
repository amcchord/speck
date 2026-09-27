"""Reviewed, bounded read-only inventories through the existing agent command protocol.

Only the last successful software/process/disk report is retained per machine.
Service diagnostics remain in the normal job receipt and are never indexed.
"""

import json
import re
import shlex
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from speck.config import seal, unseal
from speck.db import db
from speck.jobs import create_job, get_device
from speck.security import require_user

router = APIRouter(prefix="/api")


def migrate(conn):
    conn.execute(
        "CREATE TABLE IF NOT EXISTS inspection_reports(device_id TEXT NOT NULL,kind TEXT NOT NULL,job_id TEXT NOT NULL,collected REAL NOT NULL,report TEXT NOT NULL,PRIMARY KEY(device_id,kind))"
    )


class Inspection(BaseModel):
    kind: Literal["software", "processes", "disks", "service"]
    service: str = Field(default="", max_length=160)
    confirmed: bool = False


def script_for(platform, body):
    if platform not in ("windows", "linux"):
        raise HTTPException(409, "Inspection supports Windows and Linux endpoint agents")
    if body.kind == "service" and (not body.service or not re.fullmatch(r"[A-Za-z0-9_.:@ /-]{1,160}", body.service)):
        raise HTTPException(422, "Choose an exact service name from the reported inventory")
    if platform == "windows":
        scripts = {
            "software": r"$paths=@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'); @(Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object DisplayName | Select-Object -First 2000 @{n='name';e={$_.DisplayName}},@{n='version';e={$_.DisplayVersion}},@{n='publisher';e={$_.Publisher}}) | ConvertTo-Json -Depth 5 -Compress",
            "processes": "@(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 250 @{n='pid';e={$_.Id}},@{n='name';e={$_.ProcessName}},@{n='memory_bytes';e={$_.WorkingSet64}},@{n='cpu_seconds';e={$_.CPU}}) | ConvertTo-Json -Depth 5 -Compress",
            "disks": "@(Get-CimInstance Win32_LogicalDisk | Select-Object @{n='name';e={$_.DeviceID}},@{n='filesystem';e={$_.FileSystem}},@{n='size_bytes';e={$_.Size}},@{n='free_bytes';e={$_.FreeSpace}},@{n='type';e={$_.DriveType}}) | ConvertTo-Json -Depth 5 -Compress",
        }
        if body.kind == "service":
            name = body.service.replace("'", "''")
            scripts["service"] = (
                "$name='"
                + name
                + "'; $s=Get-Service -Name $name -ErrorAction Stop; $c=Get-CimInstance Win32_Service | Where-Object Name -eq $name; [ordered]@{name=$s.Name;display_name=$s.DisplayName;status=[string]$s.Status;startup=[string]$s.StartType;pid=$c.ProcessId;account=$c.StartName;dependencies=@($s.ServicesDependedOn.Name);dependents=@($s.DependentServices.Name);events=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Service Control Manager';StartTime=(Get-Date).AddDays(-1)} -MaxEvents 200 -ErrorAction SilentlyContinue | Where-Object {$_.Message -like ('*'+$s.DisplayName+'*')} | Select-Object -First 20 TimeCreated,Id,LevelDisplayName,Message)} | ConvertTo-Json -Depth 6 -Compress"
            )
        return "$ErrorActionPreference='Stop'; " + scripts[body.kind]
    scripts = {
        "software": "if command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f='${Package}\\t${Version}\\t${Architecture}\\n' | head -n 2000; elif command -v rpm >/dev/null 2>&1; then rpm -qa --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{ARCH}\\n' | head -n 2000; else echo 'No supported package inventory tool' >&2; exit 2; fi",
        "processes": "ps -eo pid=,ppid=,pcpu=,pmem=,comm= --sort=-pcpu | head -n 250",
        "disks": "lsblk -J -b -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,MODEL",
        "service": "systemctl show --no-pager --property=Id,Description,ActiveState,SubState,UnitFileState,MainPID,User,Requires,Wants,After,Result,ExecMainStatus,MemoryCurrent,CPUUsageNSec -- "
        + shlex.quote(body.service)
        + '\nprintf "\\nRECENT JOURNAL (last day, at most 20 entries)\\n"\njournalctl --no-pager -n 20 --since "1 day ago" -u '
        + shlex.quote(body.service),
    }
    return scripts[body.kind]


@router.post("/devices/{device_id}/inspection/preview")
def preview(device_id: str, body: Inspection, user=Depends(require_user)):
    device = get_device(device_id, approved=True)
    return {
        "kind": body.kind,
        "script": script_for(device["platform"], body),
        "timeout": 60,
        "note": "Read-only inspection under the agent service account. Output is recorded in the job receipt.",
    }


@router.post("/devices/{device_id}/inspection")
def collect(device_id: str, body: Inspection, user=Depends(require_user)):
    if not body.confirmed:
        raise HTTPException(422, "Review and confirm the inspection")
    device = get_device(device_id, approved=True)
    if time.time() - device["last_seen"] > 90:
        raise HTTPException(409, "The endpoint is offline")
    script = script_for(device["platform"], body)
    with db() as conn:
        if conn.execute(
            "SELECT 1 FROM jobs WHERE device_id=? AND status IN ('queued','leased','running') AND deadline>?",
            (device_id, time.time()),
        ).fetchone():
            raise HTTPException(
                409, "A job is already pending on this endpoint. Inspect its result before collecting again."
            )
    return {
        "id": create_job(
            device_id,
            "command",
            {
                "script": script,
                "shell": "powershell" if device["platform"] == "windows" else "sh",
                "inspection": body.kind,
                "inspection_platform": device["platform"],
            },
            user["username"],
            60,
        )
    }


def normalize(kind, platform, output):
    if platform == "windows" or kind == "disks":
        value = json.loads(output.lstrip("\ufeff").strip())
        if kind == "disks" and platform == "linux":
            value = value.get("blockdevices", [])
        return value if isinstance(value, list) else [value]
    if kind == "software":
        return [
            dict(zip(("name", "version", "architecture"), line.split("\t")[:3]))
            for line in output.splitlines()
            if "\t" in line
        ]
    rows = []
    for line in output.splitlines():
        parts = line.split(None, 4)
        if len(parts) == 5:
            rows.append(dict(zip(("pid", "parent_pid", "cpu_percent", "memory_percent", "name"), parts)))
    return rows


def record_result(conn, job, result):
    if job["kind"] != "command" or result.get("exit_code") != 0 or result.get("truncated"):
        return
    payload = json.loads(unseal(job["payload"]))
    kind = payload.get("inspection")
    if kind not in ("software", "processes", "disks"):
        return
    try:
        rows = normalize(kind, payload["inspection_platform"], result["stdout"])
        if len(rows) > 2000 or any(not isinstance(row, dict) for row in rows):
            return
    except (KeyError, TypeError, ValueError):
        return
    report = {
        "rows": rows,
        "platform": payload["inspection_platform"],
        "limit": 2000 if kind == "software" else 250,
        "scope": "Windows installed applications from machine registry; per-user and Store applications excluded"
        if kind == "software" and payload["inspection_platform"] == "windows"
        else "Read-only endpoint inventory; bounded to the documented row limit",
    }
    conn.execute(
        "INSERT OR REPLACE INTO inspection_reports VALUES(?,?,?,?,?)",
        (job["device_id"], kind, job["id"], time.time(), seal(json.dumps(report))),
    )


@router.get("/devices/{device_id}/inspections")
def reports(device_id: str, user=Depends(require_user)):
    get_device(device_id)
    with db() as conn:
        return [
            dict(r) | {"report": json.loads(unseal(r["report"]))}
            for r in conn.execute("SELECT * FROM inspection_reports WHERE device_id=?", (device_id,))
        ]


@router.get("/software/inventory")
def software_inventory(user=Depends(require_user)):
    with db() as conn:
        return [
            dict(r) | {"report": json.loads(unseal(r["report"]))}
            for r in conn.execute(
                "SELECT r.*,d.label,d.platform FROM inspection_reports r JOIN devices d ON d.id=r.device_id WHERE r.kind='software' AND d.archived=0 ORDER BY d.label LIMIT 500"
            )
        ]
