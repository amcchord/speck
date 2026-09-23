"""Encrypted multi-provider infrastructure management with durable write receipts."""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.infrastructure_catalog import BRIDGE_OPERATIONS, KEYS, LABEL, PASSWORD, field, operation, validate_args
from speck.security import require_admin, require_user
from speck.slide import Slide, safe_provider

router = APIRouter(prefix="/api/infrastructure")
SLIDE_SETTINGS_ID = "slide-settings"


def public_data(value):
    value = safe_provider(value)
    if isinstance(value, dict):
        return {k: public_data(v) for k, v in value.items() if k not in ("websocket_uri", "ticket")}
    if isinstance(value, list):
        return [public_data(v) for v in value]
    return value


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS infrastructure_connections(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,provider TEXT NOT NULL,config TEXT NOT NULL,updated REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS infrastructure_operations(
      id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,connection_id TEXT NOT NULL,actor TEXT NOT NULL,
      operation TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
    """)


class Connection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    provider: Literal["proxmox", "linode", "slide", "austinland"]
    url: str = Field(default="", max_length=256)
    connector: bool = False
    token: str = Field(default="", max_length=8192)
    token_id: str = Field(default="", max_length=128)
    verify_tls: bool = True

    @model_validator(mode="after")
    def validate_url(self):
        if self.connector:
            if self.provider not in ("proxmox", "austinland"):
                raise ValueError("Only Proxmox and AustinLand support outbound connections")
            self.url = ""
            self.token = ""
            self.token_id = ""
            return self
        p = urlsplit(self.url)
        local_bridge = self.provider == "austinland" and p.scheme == "http" and p.hostname in ("127.0.0.1", "::1")
        if (
            (p.scheme != "https" and not local_bridge)
            or not p.hostname
            or p.username
            or p.password
            or p.path not in ("", "/")
            or p.query
            or p.fragment
        ):
            raise ValueError("Use an HTTPS origin (an AustinLand SSH bridge may use loopback HTTP)")
        if self.provider == "linode" and self.url.rstrip("/") != "https://api.linode.com":
            raise ValueError("Linode uses https://api.linode.com")
        if not self.verify_tls and self.provider != "proxmox":
            raise ValueError("Certificate exceptions are supported only for private Proxmox connections")
        self.url = self.url.rstrip("/")
        return self


def slide_settings_connection():
    """Use the existing Slide account without copying or migrating its credential."""
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='slide'").fetchone()
    if not row:
        return None
    return json.loads(unseal(row["value"])) | {
        "id": SLIDE_SETTINGS_ID,
        "name": "Slide (Settings)",
        "provider": "slide",
        "verify_tls": True,
        "updated": None,
        "connector": False,
        "managed_in_settings": True,
    }


def get_connection(connection_id):
    if connection_id == SLIDE_SETTINGS_ID:
        cfg = slide_settings_connection()
        if cfg:
            return cfg
        raise HTTPException(404, "Slide is no longer connected in Settings")
    with db() as conn:
        row = conn.execute("SELECT * FROM infrastructure_connections WHERE id=?", (connection_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Infrastructure connection not found")
    return dict(row) | json.loads(unseal(row["config"]))


def public_connection(row):
    return {k: row[k] for k in ("id", "name", "provider", "url", "verify_tls", "updated", "connector")} | {
        "managed_in_settings": row.get("managed_in_settings", False)
    }


async def provider_request(cfg, method, path, body=None, params=None):
    if cfg.get("connector"):
        from speck.proxmox_connector import request

        return await request(cfg, method, path, body, params)
    headers = {"Authorization": "Bearer " + cfg["token"]}
    prefix = "/v4"
    if cfg["provider"] == "proxmox":
        prefix = "/api2/json"
        headers = {"Authorization": "PVEAPIToken=" + cfg["token_id"] + "=" + cfg["token"]}
    elif cfg["provider"] == "austinland":
        prefix = ""
    try:
        async with httpx.AsyncClient(
            timeout=620 if cfg["provider"] == "austinland" else 45,
            verify=cfg["verify_tls"],
            follow_redirects=False,
            trust_env=False,
        ) as client:
            kwargs = {"params": params, "headers": headers}
            if body is not None:
                kwargs["data" if cfg["provider"] == "proxmox" else "json"] = body
            response = await client.request(method, cfg["url"] + prefix + path, **kwargs)
        if response.status_code >= 300:
            raise HTTPException(
                502,
                f"{cfg['provider']} returned HTTP {response.status_code}. Inspect provider activity before retrying a write.",
            )
        result = response.json() if response.content else {}
        if cfg["provider"] == "proxmox":
            if not isinstance(result, dict) or "data" not in result:
                raise ValueError("Missing data")
            return result["data"]
        return result
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            502, "Provider unavailable or invalid response. A write may have completed; inspect before retrying."
        ) from None


async def linode_list(cfg, path):
    rows = []
    for page in range(1, 101):
        result = await provider_request(cfg, "GET", path, params={"page": page, "page_size": 100})
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("data"), list)
            or not all(isinstance(r, dict) for r in result["data"])
        ):
            raise HTTPException(502, "Invalid Linode inventory")
        pages = result.get("pages")
        if not isinstance(pages, int) or pages < 1 or pages > 100:
            raise HTTPException(502, "Invalid Linode pagination")
        rows.extend(result["data"])
        if page >= pages:
            return rows
    raise HTTPException(502, "Inventory page limit exceeded")


async def raw_inventory(cfg):
    if cfg["provider"] == "proxmox":
        rows = await provider_request(cfg, "GET", "/speck/inventory" if cfg.get("connector") else "/cluster/resources")
        if not isinstance(rows, list) or not all(isinstance(r, dict) and r.get("type") for r in rows):
            raise HTTPException(502, "Invalid Proxmox inventory")
        return rows
    if cfg["provider"] == "linode":
        return await linode_list(cfg, "/linode/instances")
    if cfg["provider"] == "slide":
        slide = Slide(cfg)
        boxes, agents, vms, clients = await asyncio.gather(
            slide.listing("device"), slide.listing("agent"), slide.listing("restore/virt"), slide.listing("client"))
        by_box = {b["device_id"]: b for b in boxes}
        by_agent = {a["agent_id"]: a for a in agents}
        by_client = {c["client_id"]: c.get("name") or c["client_id"] for c in clients}
        for row in boxes + agents + vms:
            source = by_agent.get(row.get("agent_id"), {}) if row.get("virt_id") else row
            box = by_box.get(source.get("device_id"), {})
            client_id = source.get("client_id") or box.get("client_id")
            row["speck_client"] = {"id": client_id, "key": cfg["url"] + ":" + client_id, "name": by_client.get(client_id, client_id)} if client_id else None
            row["speck_parent_name"] = box.get("display_name") or box.get("hostname") or source.get("device_id", "")
            if row.get("virt_id"):
                row["speck_name"] = (source.get("display_name") or source.get("hostname") or row["virt_id"]) + " · VM"
        return boxes + agents + vms
    return []


def resources(cfg, rows):
    result = []
    for r in rows:
        if cfg["provider"] == "proxmox":
            kind = r["type"]
            if kind not in ("node", "qemu", "lxc"):
                continue
            rid = str(r.get("vmid") if kind != "node" else r["node"])
            name = r.get("name") or rid
            item = dict(
                id=rid,
                kind=kind,
                name=name,
                status=r.get("status", "unknown"),
                node=r.get("node", ""),
                cpu=r.get("cpu"),
                memory=r.get("mem"),
                max_memory=r.get("maxmem"),
                disk=r.get("disk"),
                max_disk=r.get("maxdisk"),
                template=bool(r.get("template")),
                identity=r.get("speck_identity", {}),
                guest_agent=bool(r.get("speck_identity", {}).get("guest_agent")),
                identity_available=r.get("identity_available", False),
                addresses=[],
                pool=r.get("pool", ""),
            )
        elif cfg["provider"] == "linode":
            item = dict(
                id=str(r["id"]),
                kind="instance",
                name=r["label"],
                status=r["status"],
                node=r.get("region", ""),
                cpu=None,
                memory=None,
                max_memory=r.get("specs", {}).get("memory", 0) * 1048576,
                max_disk=r.get("specs", {}).get("disk", 0) * 1048576,
                addresses=r.get("ipv4", []),
                plan=r.get("type", ""),
            )
        elif r.get("virt_id"):
            item = dict(
                id=r["virt_id"],
                kind="virt",
                name=r.get("speck_name") or r.get("display_name") or r["virt_id"],
                status=r.get("state", "unknown"),
                node=r.get("speck_parent_name") or r.get("device_id", ""),
                addresses=[r["ip_address"]] if r.get("ip_address") else [],
                max_memory=(r.get("memory_in_mb") or 0) * 1048576,
                console_enabled=bool(r.get("vnc_enabled")),
                source_agent_id=r.get("agent_id"),
            )
        else:
            try:
                seen = datetime.fromisoformat((r.get("last_seen_at") or "").replace("Z", "+00:00")).timestamp()
            except (ValueError, TypeError):
                seen = 0
            item = dict(
                id=r.get("agent_id") or r["device_id"],
                kind="protected" if r.get("agent_id") else "box",
                name=r.get("display_name") or r.get("hostname") or r.get("agent_id") or r["device_id"],
                status="online" if seen > time.time() - 300 else "offline" if seen else "unknown",
                max_disk=r.get("storage_total_bytes"),
                disk=r.get("storage_used_bytes"),
                node=r.get("speck_parent_name", "") if r.get("agent_id") else r.get("serial_number", ""),
                addresses=[a for a in (r.get("ip_addresses") or []) if isinstance(a, str)],
            )
        if cfg["provider"] == "slide":
            item.update(client=r.get("speck_client"), platform=r.get("platform", "unknown"),
                        identity={"macs": [r["mac_address"]] if r.get("virt_id") and r.get("mac_address") else [a["mac"] for a in (r.get("addresses") or []) if a.get("mac")]},
                        device_id=r.get("device_id"))
        item.update(connection_id=cfg["id"], connection_name=cfg["name"], provider=cfg["provider"])
        result.append(item)
    return result


@router.get("/connections")
def connections(user=Depends(require_user)):
    with db() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM infrastructure_connections ORDER BY name")]
    cfgs = [get_connection(i) for i in ids]
    primary = slide_settings_connection()
    # An identical credential is already represented. Origin alone is insufficient:
    # different accounts on the same Slide API expose different clients and agents.
    if primary and not any(
        c["provider"] == "slide" and c["url"] == primary["url"] and c["token"] == primary["token"] for c in cfgs
    ):
        cfgs.insert(0, primary)
    return [public_connection(c) for c in cfgs]


async def save_connection(connection_id, body, user, old=None):
    config = body.model_dump()
    if old:
        if old["provider"] != body.provider:
            raise HTTPException(409, "Create a separate connection to change provider")
        if not config["token"]:
            config["token"] = old["token"]
    if not body.connector and (
        len(config["token"]) < 10
        or (body.provider == "proxmox" and not re.fullmatch(r"[^\s=!]+@[^\s=!]+![^\s=!]+", body.token_id))
    ):
        raise HTTPException(422, "A provider credential and Proxmox token ID (when applicable) are required")
    if body.connector:
        pass
    elif body.provider == "austinland":
        await provider_request(config, "POST", "/operations/unifi-status", {"args": {}})
    else:
        await raw_inventory(config)
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO infrastructure_connections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,config=excluded.config,updated=excluded.updated",
            (connection_id, body.name, body.provider, seal(json.dumps(config)), time.time()),
        )
        audit(
            conn,
            user["username"],
            "infrastructure.connection.saved",
            detail={"connection_id": connection_id, "provider": body.provider},
        )
    return public_connection(get_connection(connection_id))


@router.post("/connections")
async def add_connection(body: Connection, user=Depends(require_admin)):
    return await save_connection(ident(), body, user)


@router.put("/connections/{connection_id}")
async def update_connection(connection_id: str, body: Connection, user=Depends(require_admin)):
    if connection_id == SLIDE_SETTINGS_ID:
        raise HTTPException(409, "Manage this Slide connection in Settings")
    return await save_connection(connection_id, body, user, get_connection(connection_id))


@router.delete("/connections/{connection_id}")
async def remove_connection(connection_id: str, user=Depends(require_admin)):
    if connection_id == SLIDE_SETTINGS_ID:
        raise HTTPException(409, "Manage this Slide connection in Settings")
    with db(write=True) as conn:
        conn.execute("DELETE FROM infrastructure_connections WHERE id=?", (connection_id,))
        audit(conn, user["username"], "infrastructure.connection.removed", detail={"connection_id": connection_id})
    from speck.remote import sessions, close_session

    for session_id, session in list(sessions.items()):
        if session.config.get("infra_target", (None,))[0] == connection_id:
            await close_session(session_id)
    return {"ok": True}


@router.get("/inventory")
async def inventory(user=Depends(require_user)):
    cfgs = [get_connection(c["id"]) for c in connections(user)]

    async def fetch(cfg):
        try:
            if cfg["provider"] == "austinland":
                await provider_request(cfg, "POST", "/operations/unifi-status", {"args": {}})
                rows = []
            else:
                rows = resources(cfg, await raw_inventory(cfg))
            return public_connection(cfg) | {"status": "connected", "resources": rows}
        except HTTPException as exc:
            return public_connection(cfg) | {"status": "unavailable", "error": str(exc.detail), "resources": []}

    groups = await asyncio.gather(*(fetch(c) for c in cfgs))
    correlate_agents(groups)
    return {"connections": groups, "checked_at": time.time()}


def segment(value):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value) or value in (".", ".."):
        raise HTTPException(422, "Invalid resource ID")
    return quote(value, safe="")


async def resolve(cfg, kind, rid):
    for row in await raw_inventory(cfg):
        if (
            cfg["provider"] == "proxmox"
            and row.get("type") == kind
            and str(row.get("node") if kind == "node" else row.get("vmid")) == rid
        ):
            return row
        if cfg["provider"] == "linode" and kind == "instance" and str(row["id"]) == rid:
            return row
        if cfg["provider"] == "slide" and kind == "box" and row.get("device_id") == rid and not row.get("virt_id") and not row.get("agent_id"):
            return row
        if cfg["provider"] == "slide" and kind == "protected" and row.get("agent_id") == rid and not row.get("virt_id"):
            return row
        if cfg["provider"] == "slide" and kind == "virt" and row.get("virt_id") == rid:
            return row
    raise HTTPException(404, "Resource no longer exists in this connection. Refresh inventory.")


def pve_path(row):
    path = "/nodes/" + segment(row["node"])
    if row["type"] != "node":
        path += "/" + row["type"] + "/" + str(int(row["vmid"]))
    return path


@router.get("/connections/{connection_id}/resources/{kind}/{rid}")
async def detail(connection_id: str, kind: str, rid: str, user=Depends(require_user)):
    cfg = get_connection(connection_id)
    row = await resolve(cfg, kind, rid)
    result = {"resource": resources(cfg, [row])[0]}
    if cfg["provider"] == "proxmox":
        from speck.proxmox_details import machine_detail

        return public_data(await machine_detail(cfg, row))
    elif cfg["provider"] == "linode":
        result["configuration"] = row
        result["backups"] = await provider_request(cfg, "GET", "/linode/instances/" + segment(rid) + "/backups")
    elif kind == "protected":
        result["configuration"] = {k: row[k] for k in ("agent_id", "device_id", "hostname", "display_name", "platform", "os", "os_version", "last_seen_at", "ip_addresses", "speck_client") if k in row}
    elif kind == "virt":
        result["configuration"] = public_data(await Slide(cfg).request("GET", "restore/virt/" + segment(rid)))
    else:
        slide = Slide(cfg)
        result["configuration"] = await slide.request("GET", "device/" + segment(rid))
        result["agents"] = await slide.listing("agent", {"device_id": rid})
        result["network"] = await slide.request("GET", "device/" + segment(rid) + "/network")
    return public_data(result)


@router.get("/connections/{connection_id}/resources/{kind}/{rid}/guest")
async def guest_detail(connection_id: str, kind: str, rid: str, user=Depends(require_user)):
    from speck.proxmox_details import guest_details

    cfg = get_connection(connection_id)
    if cfg["provider"] != "proxmox" or kind != "qemu":
        raise HTTPException(404, "Guest information is available for Proxmox VMs")
    return public_data(await guest_details(cfg, await resolve(cfg, kind, rid)))


POWER = {
    a: operation(label, danger=a != "start")
    for a, label in [("start", "Start"), ("shutdown", "Shut down"), ("reboot", "Reboot"), ("stop", "Force stop")]
}
PROXMOX_OPS = {
    **POWER,
    "configure": operation(
        "Edit guest resources",
        [
            field("cores", "CPU cores", "number", minimum=1, maximum=128),
            field("memory", "Memory (MiB)", "number", minimum=128, maximum=4194304),
        ],
        danger=True,
    ),
    "migrate": operation("Migrate guest", [field("target", "Destination node")], danger=True),
    "clone": operation(
        "Clone VM",
        [
            field("newid", "New VM ID", "number", minimum=100),
            field("name", "New VM name"),
            field("target", "Destination node", required=False),
            field("storage", "Destination storage", required=False),
        ],
    ),
    "delete": operation("Delete guest", danger=True),
}
PROXMOX_READS = {
    "metrics": operation(
        "Performance history",
        [field("timeframe", "Time range", options=["hour", "day", "week", "month", "year"])],
        method="GET",
    ),
    "snapshots": operation("Snapshots", method="GET"),
    "guest-network": operation("Guest network interfaces", method="GET"),
    "guest-os": operation("Guest operating system", method="GET"),
    "guest-filesystems": operation("Guest filesystems", method="GET"),
    "guest-command-result": operation(
        "Read guest command result", [field("pid", "Process ID", "number", minimum=1)], method="GET"
    ),
    "guest-file-read": operation("Read guest text file", [field("file", "File path")], method="GET"),
}
PROXMOX_OPS.update(
    {
        "snapshot-create": operation("Create snapshot", [field("snapname", "Snapshot name")]),
        "snapshot-rollback": operation("Roll back to snapshot", [field("snapname", "Snapshot name")], danger=True),
        "snapshot-delete": operation("Delete snapshot", [field("snapname", "Snapshot name")], danger=True),
        "guest-command": operation(
            "Run guest command",
            [field("shell", "Shell", options=["sh", "powershell"]), field("script", "Command", "textarea")],
            danger=True,
        ),
        "guest-file-write": operation(
            "Write guest text file",
            [field("file", "File path"), field("content", "File contents", "textarea")],
            danger=True,
        ),
        **PROXMOX_READS,
    }
)

LINODE_CREATE = operation(
    "Create Linode", [LABEL, field("type", "Plan"), field("region", "Region"), field("image", "Image"), PASSWORD, KEYS]
)
SLIDE_OPS = {
    "rename": operation("Edit box name", [field("display_name", "Display name")]),
    "reboot": operation("Reboot box", danger=True),
    "shutdown": operation("Power off box", danger=True),
    "network": operation(
        "Configure box network",
        [
            field("network_mode", "Network mode", options=["dhcp", "static"]),
            field("network_address", "IP address / prefix", required=False),
            field("network_gateway", "Gateway", required=False),
            field("dns_server_primary", "Primary DNS", required=False),
            field("dns_server_secondary", "Secondary DNS", required=False),
        ],
        danger=True,
    ),
    "backup": operation("Back up protected agent", [field("agent_id", "Slide agent ID")]),
}


def catalog(cfg, kind):
    if cfg["provider"] == "austinland":
        return BRIDGE_OPERATIONS
    if cfg["provider"] == "proxmox":
        if kind == "node":
            return {k: v for k, v in POWER.items() if k in ("reboot", "shutdown")} | {
                "metrics": PROXMOX_READS["metrics"]
            }
        return (
            {k: v for k, v in PROXMOX_OPS.items() if kind == "qemu" or (k != "clone" and not k.startswith("guest-"))}
            if kind in ("qemu", "lxc")
            else {}
        )
    if cfg["provider"] == "linode":
        if kind == "connection":
            return {"create": LINODE_CREATE}
        return {k: v for k, v in POWER.items() if k != "stop"} | {
            "rename": operation("Rename instance", [LABEL]),
            "delete": operation("Delete instance", danger=True),
        }
    if kind == "virt":
        return {
            "start": operation("Start VM"),
            "stop": operation("Stop VM", danger=True),
            "console-enable": operation("Enable console"),
            "console-disable": operation("Disable console"),
            "configure": operation(
                "Edit VM resources",
                [
                    field("cpu_count", "CPU cores", "number", minimum=1, maximum=128),
                    field("memory_in_mb", "Memory (MiB)", "number", minimum=512),
                ],
                danger=True,
            ),
        }
    if kind == "protected":
        return {"backup": operation("Back up machine") | {"requires_confirmation": False}}
    return SLIDE_OPS if kind == "box" else {}


@router.get("/connections/{connection_id}/catalog")
def get_catalog(connection_id: str, kind: str = "connection", user=Depends(require_user)):
    cfg = get_connection(connection_id)
    return {key: {k: v for k, v in spec.items() if k != "path"} for key, spec in catalog(cfg, kind).items()}


@router.get("/connections/{connection_id}/read/{operation_id}")
async def read_operation(
    connection_id: str,
    operation_id: str,
    args: str = "{}",
    kind: str = "connection",
    resource_id: str = "",
    user=Depends(require_user),
):
    cfg = get_connection(connection_id)
    if cfg["provider"] == "proxmox" and kind != "connection":
        spec = catalog(cfg, kind).get(operation_id)
        if not spec or spec["method"] != "GET":
            raise HTTPException(404, "Read operation not found")
        try:
            arguments = validate_args(spec, json.loads(args))
        except ValueError:
            raise HTTPException(422, "Invalid arguments") from None
        row = await resolve(cfg, kind, resource_id)
        suffix = {
            "metrics": "/rrddata",
            "snapshots": "/snapshot",
            "guest-network": "/agent/network-get-interfaces",
            "guest-os": "/agent/get-osinfo",
            "guest-filesystems": "/agent/get-fsinfo",
            "guest-command-result": "/agent/exec-status",
            "guest-file-read": "/agent/file-read",
        }[operation_id]
        if operation_id == "guest-file-read":
            arguments.update(count=65536)
        return public_data(await provider_request(cfg, "GET", pve_path(row) + suffix, params=arguments))
    if cfg["provider"] == "linode" and operation_id == "meta":
        return {
            key: await linode_list(cfg, path)
            for key, path in [
                ("types", "/linode/types"),
                ("regions", "/regions"),
                ("images", "/images"),
                ("ssh_keys", "/profile/sshkeys"),
            ]
        }
    spec = catalog(cfg, "connection").get(operation_id)
    if cfg["provider"] != "austinland" or not spec or spec["method"] != "GET":
        raise HTTPException(404, "Read operation not found")
    try:
        arguments = json.loads(args)
    except ValueError:
        raise HTTPException(422, "Invalid operation arguments") from None
    arguments = validate_args(spec, arguments)
    return public_data(await provider_request(cfg, "POST", "/operations/" + operation_id, {"args": arguments}))


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{32,36}$")
    kind: Literal["connection", "node", "qemu", "lxc", "instance", "box", "virt", "protected"]
    resource_id: str = Field(default="", max_length=128)
    operation: str = Field(max_length=64)
    args: dict = Field(default_factory=dict)
    confirmation: str = Field(default="", max_length=100)


async def execute(cfg, row, body, args):
    op = body.operation
    if cfg["provider"] == "austinland":
        return await provider_request(cfg, "POST", "/operations/" + op, {"args": args})
    if cfg["provider"] == "proxmox":
        path = pve_path(row)
        if body.kind == "node":
            guests = [
                r
                for r in await raw_inventory(cfg)
                if r.get("node") == row["node"] and r.get("type") in ("qemu", "lxc") and r.get("status") == "running"
            ]
            if guests:
                raise HTTPException(409, "Move or shut down running guests before a host power operation")
            return await provider_request(cfg, "POST", path + "/status", {"command": op})
        if op == "clone":
            args["full"] = 1
            return await provider_request(cfg, "POST", path + "/clone", args)
        if row.get("template") or int(row["vmid"]) in (9000, 9001):
            raise HTTPException(409, "Templates are protected; clone them to create a guest")
        if op.startswith("snapshot-"):
            name = args["snapname"]
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", name) or name == "current":
                raise HTTPException(422, "Use a valid named snapshot")
            if op == "snapshot-create":
                return await provider_request(cfg, "POST", path + "/snapshot", args)
            if op == "snapshot-rollback":
                if row.get("status") != "stopped":
                    raise HTTPException(409, "Stop the guest before rolling back")
                return await provider_request(cfg, "POST", path + "/snapshot/" + name + "/rollback")
            return await provider_request(cfg, "DELETE", path + "/snapshot/" + name)
        if op == "guest-command":
            if args["shell"] == "powershell":
                command = [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-EncodedCommand",
                    base64.b64encode(args["script"].encode("utf-16le")).decode(),
                ]
            else:
                command = ["/bin/sh", "-c", args["script"]]
            return await provider_request(cfg, "POST", path + "/agent/exec", {"command": command})
        if op == "guest-file-write":
            return await provider_request(cfg, "POST", path + "/agent/file-write", args)
        if op == "configure":
            return await provider_request(cfg, "PUT", path + "/config", args)
        if op == "migrate":
            nodes = [
                r["node"] for r in await raw_inventory(cfg) if r.get("type") == "node" and r.get("status") == "online"
            ]
            if args["target"] not in nodes or args["target"] == row["node"]:
                raise HTTPException(422, "Choose a different online node")
            args["online" if body.kind == "qemu" else "restart"] = int(row.get("status") == "running")
            if body.kind == "qemu":
                args["with-local-disks"] = 1
            return await provider_request(cfg, "POST", path + "/migrate", args)
        if op == "delete":
            if row.get("status") != "stopped":
                raise HTTPException(409, "Stop the guest before deleting it")
            return await provider_request(cfg, "DELETE", path)
        return await provider_request(cfg, "POST", path + "/status/" + op)
    if cfg["provider"] == "linode":
        if op == "create":
            return await provider_request(cfg, "POST", "/linode/instances", args)
        path = "/linode/instances/" + segment(body.resource_id)
        if op == "rename":
            return await provider_request(cfg, "PUT", path, args)
        if op == "delete":
            return await provider_request(cfg, "DELETE", path)
        return await provider_request(cfg, "POST", path + "/" + ("boot" if op == "start" else op))
    slide = Slide(cfg)
    if body.kind == "virt":
        payload = (
            args
            if op == "configure"
            else {"vnc_enabled": op == "console-enable"}
            if op.startswith("console-")
            else {"state": "running" if op == "start" else "stopped"}
        )
        return await slide.request("PATCH", "restore/virt/" + segment(body.resource_id), payload)
    if body.kind == "protected" and op == "backup":
        return await slide.request("POST", "backup", {"agent_id": body.resource_id})
    path = "device/" + segment(body.resource_id)
    if op == "rename":
        return await slide.request("PATCH", path, args)
    if op == "network":
        return await slide.request("PATCH", path + "/network", args)
    if op == "backup":
        if not re.fullmatch(r"a_[a-z0-9]{12}", args["agent_id"]):
            raise HTTPException(422, "Invalid agent ID")
        agent = await slide.request("GET", "agent/" + args["agent_id"])
        if agent.get("device_id") != body.resource_id:
            raise HTTPException(409, "Agent does not belong to this box")
        return await slide.request("POST", "backup", args)
    return await slide.request("POST", path + "/shutdown/" + ("poweroff" if op == "shutdown" else op))


@router.get("/operations")
def operations(user=Depends(require_user)):
    with db() as conn:
        return [
            dict(r) | {"result": json.loads(r["result"])}
            for r in conn.execute(
                "SELECT id,connection_id,actor,operation,target,status,result,created,updated FROM infrastructure_operations ORDER BY created DESC LIMIT 50"
            )
        ]


@router.post("/connections/{connection_id}/actions")
async def action(connection_id: str, body: Action, user=Depends(require_admin)):
    cfg = get_connection(connection_id)
    spec = catalog(cfg, body.kind).get(body.operation)
    if not spec or spec["method"] == "GET":
        raise HTTPException(422, "Unsupported management action")
    args = validate_args(spec, body.args)
    # Claim before provider resolution as well: reconnect/retry never repeats a write.
    payload = json.dumps({"connection": connection_id, **body.model_dump(exclude={"request_id"})}, sort_keys=True)
    fingerprint = hmac.new(os.environ["SPECK_ENCRYPTION_KEY"].encode(), payload.encode(), hashlib.sha256).hexdigest()
    with db() as conn:
        previous = conn.execute("SELECT * FROM infrastructure_operations WHERE id=?", (body.request_id,)).fetchone()
    if previous:
        if previous["fingerprint"] != fingerprint:
            raise HTTPException(409, "Request ID already used for a different operation")
        return {"id": previous["id"], "status": previous["status"], "result": json.loads(previous["result"])}
    row = None if body.kind == "connection" else await resolve(cfg, body.kind, body.resource_id)
    target = cfg["name"] if row is None else resources(cfg, [row])[0]["name"]
    if spec.get("requires_confirmation", True) and body.confirmation != target:
        raise HTTPException(422, "Type the exact target name to confirm this change")
    if cfg["provider"] == "austinland" and body.kind != "connection":
        raise HTTPException(422, "Invalid bridge target")
    if (
        cfg["provider"] == "austinland"
        and body.operation in ("proxmox-delete", "proxmox-migrate")
        and args["vmid"] in (9000, 9001)
    ):
        raise HTTPException(409, "Protected template")
    now = time.time()
    with db(write=True) as conn:
        if conn.execute("SELECT 1 FROM infrastructure_operations WHERE id=?", (body.request_id,)).fetchone():
            raise HTTPException(409, "Request is already in progress; inspect Activity")
        conn.execute(
            "INSERT INTO infrastructure_operations VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                body.request_id,
                fingerprint,
                connection_id,
                user["username"],
                body.operation,
                target,
                "pending",
                "{}",
                now,
                now,
            ),
        )
        audit(
            conn,
            user["username"],
            "infrastructure.requested",
            detail={
                "id": body.request_id,
                "connection_id": connection_id,
                "operation": body.operation,
                "resource_id": body.resource_id,
            },
        )
    try:
        result = public_data(await execute(cfg, row, body, args))
        status = "submitted"
    except HTTPException as exc:
        status = "unknown" if exc.status_code >= 500 else "rejected"
        result = {"message": str(exc.detail)}
    except Exception:
        status = "unknown"
        result = {"message": "Outcome unknown. Inspect provider activity before retrying."}
    with db(write=True) as conn:
        conn.execute(
            "UPDATE infrastructure_operations SET status=?,result=?,updated=? WHERE id=?",
            (status, json.dumps(result), time.time(), body.request_id),
        )
        audit(
            conn,
            user["username"],
            "infrastructure." + status,
            detail={"id": body.request_id, "connection_id": connection_id, "operation": body.operation},
        )
    return {"id": body.request_id, "status": status, "result": result}


def correlate_agents(groups):
    """Correlate exact hardware UUIDs; names/IPs never imply an installed agent.

    A duplicated provider identity or ambiguous enrollment is deliberately unlinked.
    """
    with db() as conn:
        devices = [
            dict(r)
            for r in conn.execute(
                "SELECT d.id,d.hardware_id,d.label,d.platform,d.last_seen,d.approved,d.telemetry,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.archived=0"
            )
        ]
        host_agents = [
            dict(r)
            for r in conn.execute("SELECT connection_id,hostname,last_seen FROM proxmox_connectors WHERE revoked=0")
        ]
    guests = [r for g in groups for r in g["resources"] if r["kind"] in ("qemu", "lxc")]
    identities = {}
    for guest in guests:
        uuid = guest.get("identity", {}).get("uuid", "").lower()
        if uuid:
            identities.setdefault(uuid, []).append(guest)
    for group in groups:
        for row in group["resources"]:
            row["management"] = "provider_only"
            row["agent"] = None
            if row["kind"] == "node":
                installed = [
                    a
                    for a in host_agents
                    if a["connection_id"] == row["connection_id"]
                    and a["hostname"].split(".")[0].lower() == row["node"].lower()
                ]
                if installed:
                    row["management"] = "host_agent"
                    row["connector_online"] = any(a["last_seen"] > time.time() - 50 for a in installed)
                continue
            uuid = row.get("identity", {}).get("uuid", "")
            if not uuid:
                continue
            hashes = {
                hashlib.sha256((platform + ":" + value).encode()).hexdigest()
                for platform in ("linux", "windows")
                for value in (uuid, uuid.lower(), uuid.upper())
            }
            matches = [d for d in devices if d["hardware_id"] in hashes]
            if len(matches) > 1 or len(identities.get(uuid.lower(), [])) > 1:
                row["management"] = "ambiguous"
            elif len(matches) == 1:
                d = matches[0]
                row["management"] = "speck_agent"
                row["agent"] = {k: d[k] for k in ("id", "label", "platform", "last_seen", "approved", "revoked")}
                row["agent"]["online"] = d["last_seen"] > time.time() - 75 and not d["revoked"]
                row["agent"]["match"] = "hardware_uuid"
                telemetry = json.loads(d["telemetry"])
                row["addresses"] = [
                    a["address"].split("/")[0]
                    for interface in telemetry.get("network", {}).get("interfaces", [])
                    for a in interface.get("addrs", [])
                    if a.get("address") and not a["address"].startswith(("127.", "::1/", "fe80:"))
                ]
