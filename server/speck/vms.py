"""Launch template VMs for projects and follow them until they are reachable.

Provisioning runs through the AustinLand bridge operation ``proxmox-create``
(clone the Debian 13 cloud-init or Windows 11 template, place it on the least
pressured node, resize, start and finish first-boot setup), using the same
durable, audited infrastructure action as the console. This module adds the
parts an agent needs around it: Speck SSH key names, a generated administrator
password saved to the vault, and a status view that joins the new guest to its
LAN IP, public IP mapping and DNS names.
"""

import re
import secrets
import string
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from speck import infrastructure as infra
from speck.db import db
from speck.security import require_admin, require_user

router = APIRouter(prefix="/api/vms")
PRESETS = {
    "small": {"cores": 1, "memory_mb": 1024, "disk_gb": 10},
    "medium": {"cores": 2, "memory_mb": 4096, "disk_gb": 40},
    "large": {"cores": 4, "memory_mb": 8192, "disk_gb": 80},
    "xlarge": {"cores": 8, "memory_mb": 16384, "disk_gb": 160},
}
USERS = {"debian13": "root", "win11": "Administrator"}


def bridge():
    with db() as conn:
        row = conn.execute("SELECT id FROM infrastructure_connections WHERE provider='austinland' ORDER BY name LIMIT 1").fetchone()
    if not row:
        raise HTTPException(409, "VM provisioning uses the AustinLand bridge; add it under Infrastructure → Connections")
    return infra.get_connection(row["id"])


def password():
    """A password that satisfies Windows complexity and never starts with a dash."""
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(20))
    return "Sp" + core + secrets.choice("!#%+=") + secrets.choice(string.digits)


@router.get("/options")
async def options(user=Depends(require_user)):
    """Operating systems, size presets, nodes with capacity and the recommended node."""
    cfg = bridge()
    meta = await infra.read_operation(cfg["id"], "proxmox-meta", user=user)
    meta["presets"] = [{"id": k} | v for k, v in PRESETS.items()]
    meta["bridge"] = infra.public_connection(cfg)
    return meta


class Launch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
    os: str = Field(default="debian13", pattern=r"^(debian13|win11)$")
    preset: str | None = Field(default=None, pattern=r"^(small|medium|large|xlarge)$")
    cores: int | None = Field(default=None, ge=1, le=64)
    memory_mb: int | None = Field(default=None, ge=512, le=262144)
    disk_gb: int | None = Field(default=None, ge=3, le=4096)
    node: str = Field(default="auto", pattern=r"^[A-Za-z0-9_-]{1,64}$")
    ssh_keys: list[str] = Field(default_factory=list, max_length=20)
    authorized_keys: list[str] = Field(default_factory=list, max_length=20)
    password: str | None = Field(default=None, min_length=12, max_length=128)
    save_password: bool = True
    project: str = Field(default="", max_length=100)
    request_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{32,36}$")


@router.post("")
async def launch(body: Launch, user=Depends(require_admin)):
    """Create a VM from a template. Returns its VMID, node and the vault entry holding its password."""
    size = PRESETS[body.preset or "medium"] | {k: v for k, v in {"cores": body.cores, "memory_mb": body.memory_mb, "disk_gb": body.disk_gb}.items() if v}
    if body.os == "win11" and (size["memory_mb"] < 4096 or size["disk_gb"] < 64):
        raise HTTPException(422, "Windows 11 needs at least 4096 MB of memory and 64 GB of disk")
    keys = list(body.authorized_keys)
    if body.ssh_keys:
        with db() as conn:
            rows = {r["name"]: r["public_key"] for r in conn.execute("SELECT name,public_key FROM ssh_keys")}
        missing = [k for k in body.ssh_keys if k not in rows]
        if missing:
            raise HTTPException(422, "Unknown SSH keys: " + ", ".join(missing))
        keys += [rows[k] for k in body.ssh_keys]
    if body.os == "win11" and keys:
        raise HTTPException(422, "SSH keys apply to Debian only; Windows uses the Administrator password")
    secret = body.password or password()
    if secret.startswith("-") or any(c in secret for c in "\r\n\0"):
        raise HTTPException(422, "Use a password without line breaks that does not start with a dash")
    cfg = bridge()
    entry = None
    if body.save_password:
        from speck import vault

        entry = vault.slug(body.name + "-admin")
        with db() as conn:
            if vault.load(conn, entry):
                entry = vault.slug(f"{body.name}-admin-{int(time.time())}")
    action = infra.Action(
        request_id=body.request_id or str(uuid.uuid4()),
        kind="connection",
        operation="proxmox-create",
        confirmation=cfg["name"],
        args={"name": body.name, "os": body.os, "node": body.node, "root_pass": secret, "authorized_keys": keys} | size,
    )
    receipt = await infra.action(cfg["id"], action, user)
    result = receipt.get("result") or {}
    if receipt["status"] != "submitted":
        raise HTTPException(502 if receipt["status"] == "unknown" else 422, (result.get("message") or "VM creation failed") +
                            f" (request {receipt['id']}; inspect Infrastructure → Activity before retrying)")
    if entry:
        from speck import vault

        with db(write=True) as conn:
            vault.store(conn, {
                "name": entry,
                "service": "proxmox",
                "kind": "static",
                "project": vault.slug(body.project) if body.project.strip() else None,
                "notes": f"Administrator login for VM {body.name} (VMID {result.get('vmid')}, {body.os}) created {time.strftime('%Y-%m-%d')}.",
                "meta": {"vmid": result.get("vmid"), "node": result.get("node"), "os": body.os},
                "secrets": {"USERNAME": USERS[body.os], "PASSWORD": secret},
            }, user["username"])
            from speck.db import audit

            audit(conn, user["username"], "vault.stored", detail={"name": entry, "secrets": ["PASSWORD", "USERNAME"]})
    return {
        "request_id": receipt["id"],
        "status": result.get("status", "starting"),
        "vmid": result.get("vmid"),
        "node": result.get("node"),
        "name": body.name,
        "os": body.os,
        "size": size,
        "user": USERS[body.os],
        "password_entry": entry,
        "password": None if entry else secret,
        "next": [
            f"GET /api/vms/{body.name} until lan is non-empty (Debian ~1 min, Windows 3-5 min)",
            "GET /api/unifi/pool, then POST /api/unifi/expose with a free public IP and the LAN IP",
            "POST /api/dns/domains/{domain}/point with the public IP",
        ],
    }


@router.get("/{name}")
async def status(name: str, user=Depends(require_user)):
    """Where a VM stands: provider state plus LAN IP (exact MAC match), public mapping and DNS names."""
    if not re.fullmatch(r"[A-Za-z0-9-]{1,63}", name):
        raise HTTPException(422, "Invalid VM name")
    from speck.network import build_map
    from speck import fleet

    machines = [m for m in (await fleet.inventory(refresh=True, user=user))["machines"] if m["label"].lower() == name.lower()]
    if not machines:
        return {"name": name, "found": False, "hint": "Not in inventory yet; provisioning may still be cloning. Retry in 15 seconds."}
    machine = machines[0]
    reach = next((m for m in (await build_map(user))["machines"] if m["id"] == machine["id"]), {"lan": [], "public": [], "dns": []})
    resource = machine.get("resource") or {}
    return {
        "name": name,
        "found": True,
        "state": machine.get("state"),
        "provider": machine.get("provider"),
        "node": resource.get("node"),
        "vmid": resource.get("id"),
        "connection_id": resource.get("connection_id"),
        "lan": reach["lan"],
        "public": reach["public"],
        "dns": reach["dns"],
        "ready": bool(reach["lan"]),
        "duplicates": len(machines) - 1,
    }


@router.get("/{name}/handoff", response_class=PlainTextResponse)
async def handoff(name: str, user=Depends(require_user)):
    """Markdown for another agent: how to reach this VM and where its credentials live (by vault name, never value)."""
    from speck.config import origin

    state = await status(name, user)
    if not state["found"]:
        raise HTTPException(404, "VM not found in inventory")
    with db() as conn:
        entries = [r["name"] for r in conn.execute(
            "SELECT name FROM vault_entries WHERE name=? OR name LIKE ? ORDER BY created DESC", (name + "-admin", name + "-admin-%"))]
        keys = [r["name"] for r in conn.execute("SELECT name FROM ssh_keys ORDER BY name")]
    lan = [item["ip"] for item in state["lan"]]
    public = [item["ip"] + (f" (NAT to {item['lan_ip']}, mapping {item.get('mapping')})" if item.get("via") == "unifi_nat" else "") for item in state["public"]]
    lines = [
        f"# {name}",
        "",
        f"Generated by Speck ({origin()}) on {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}.",
        "",
        "| Field | Value |",
        "| --- | --- |",
        f"| Provider | {state['provider']} · node {state.get('node') or '—'} · VMID {state.get('vmid') or '—'} |",
        f"| State | {state['state']} |",
        f"| LAN IP | {', '.join(lan) or 'not yet known'} |",
        f"| Public IP | {'; '.join(public) or 'none (LAN only)'} |",
        f"| DNS names | {', '.join(d['fqdn'] for d in state['dns']) or 'none'} |",
        "",
        "## Sign in",
        "",
    ]
    if entries:
        lines += [f"The administrator username and password are in Speck vault entry `{entries[0]}`:", "",
                  "```bash", f'curl -s {origin()}/api/keys/{entries[0]} -H "Authorization: Bearer $SPECK_TOKEN"', "```", ""]
    else:
        lines += ["No generated password is stored in Speck for this VM; ask the human for credentials.", ""]
    target = public[0].split(" ")[0] if public else lan[0] if lan else "<ip>"
    lines += [f"SSH (Debian): `ssh root@{target}` with one of the Speck SSH keys installed at creation "
              f"(available keys: {', '.join(keys) or 'none'}; private halves are fetched with `GET /api/ssh/keys/<name>/private`).", "",
              "## Next steps", "",
              "- Not public yet? `GET /api/unifi/pool`, then `POST /api/unifi/expose` with a free IP and the LAN IP.",
              "- Point a hostname: `POST /api/dns/domains/{domain}/point` with the public IP.",
              "- Store credentials you create with `POST /api/keys/static` under this project's name.", ""]
    return PlainTextResponse("\n".join(lines), media_type="text/markdown")
