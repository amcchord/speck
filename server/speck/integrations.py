"""Site-scoped, read-only integration credentials, separate from operator sessions."""

import json
import re
import secrets
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from speck.db import audit, db, ident
from speck.security import digest, require_admin

router = APIRouter(prefix="/api")
SECRET = re.compile(r"password|passphrase|secret|token|authorization|private.?key|credential", re.I)


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS integration_tokens(
      id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,site TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),created REAL NOT NULL,expires REAL NOT NULL,
      revoked REAL,last_used REAL,rate_minute INTEGER NOT NULL DEFAULT 0,rate_count INTEGER NOT NULL DEFAULT 0);
    """)


def public_token(row):
    return {key: row[key] for key in ("id", "name", "site", "created", "expires", "revoked", "last_used")}


@router.get("/integrations/tokens")
def list_tokens(user=Depends(require_admin)):
    with db() as conn:
        return {
            "tokens": [
                public_token(r)
                for r in conn.execute("SELECT * FROM integration_tokens ORDER BY created DESC LIMIT 200")
            ],
            "sites": [
                r[0]
                for r in conn.execute("SELECT DISTINCT site FROM devices WHERE archived=0 AND site<>'' ORDER BY site")
            ],
        }


class NewToken(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    site: str = Field(min_length=1, max_length=80)
    expires_days: int = Field(default=30, ge=1, le=365)

    @field_validator("name", "site")
    @classmethod
    def printable(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError("Use a nonempty printable name and site")
        return value


@router.post("/integrations/tokens")
def create_token(body: NewToken, user=Depends(require_admin)):
    token = "speck_ro_" + secrets.token_urlsafe(32)
    token_id, now = ident(), time.time()
    with db(write=True) as conn:
        if not conn.execute("SELECT 1 FROM devices WHERE site=? AND archived=0 LIMIT 1", (body.site,)).fetchone():
            raise HTTPException(422, "Choose an existing site with active fleet devices")
        if (
            conn.execute(
                "SELECT count(*) FROM integration_tokens WHERE revoked IS NULL AND expires>?", (now,)
            ).fetchone()[0]
            >= 100
        ):
            raise HTTPException(409, "Revoke an existing integration token before creating another")
        conn.execute(
            "INSERT INTO integration_tokens(id,token_hash,name,site,owner_id,created,expires) VALUES(?,?,?,?,?,?,?)",
            (token_id, digest(token), body.name, body.site, user["user_id"], now, now + body.expires_days * 86400),
        )
        row = conn.execute("SELECT * FROM integration_tokens WHERE id=?", (token_id,)).fetchone()
        audit(
            conn, user["username"], "integration.created", detail={"id": token_id, "name": body.name, "site": body.site}
        )
    return public_token(row) | {"token": token, "scope": "inventory:read"}


@router.delete("/integrations/tokens/{token_id}")
def revoke_token(token_id: str, user=Depends(require_admin)):
    with db(write=True) as conn:
        row = conn.execute("SELECT id FROM integration_tokens WHERE id=?", (token_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Integration token not found")
        conn.execute("UPDATE integration_tokens SET revoked=coalesce(revoked,?) WHERE id=?", (time.time(), token_id))
        audit(conn, user["username"], "integration.revoked", detail={"id": token_id})
    return {"ok": True}


def require_integration(request: Request):
    auth = request.headers.get("authorization", "")
    if not re.fullmatch(r"Bearer speck_ro_[A-Za-z0-9_-]{43}", auth):
        raise HTTPException(401, "Read-only integration token required")
    now = time.time()
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT t.* FROM integration_tokens t JOIN users u ON u.id=t.owner_id "
            "WHERE t.token_hash=? AND t.revoked IS NULL AND t.expires>? AND u.disabled=0 AND u.role='admin'",
            (digest(auth[7:]), now),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Integration token is expired or revoked")
        minute = int(now // 60)
        count = row["rate_count"] if row["rate_minute"] == minute else 0
        if count >= 120:
            raise HTTPException(429, "Integration request limit reached", headers={"Retry-After": "60"})
        conn.execute(
            "UPDATE integration_tokens SET last_used=?,rate_minute=?,rate_count=? WHERE id=?",
            (now, minute, count + 1, row["id"]),
        )
    return dict(row)


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if not SECRET.search(k)}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, str):
        return re.sub(r"\bspeck_ro_[A-Za-z0-9_-]{43}\b", "[credential removed]", value)[:4000]
    return value


def fields(value, names):
    return {k: clean(value[k]) for k in names if k in value} if isinstance(value, dict) else {}


def public_device(row, detail=False):
    obj = {
        k: row[k]
        for k in (
            "id",
            "hostname",
            "label",
            "platform",
            "arch",
            "site",
            "last_seen",
            "slide_agent_id",
            "maintenance_until",
        )
    }
    telemetry = json.loads(row["telemetry"])
    obj.update(
        online=time.time() - row["last_seen"] < 75,
        approved=bool(row["approved"]),
        manageable=bool(row["approved"] and not row["revoked"]),
        tags=json.loads(row["tags"]),
    )
    obj["reported"] = {k: isinstance(telemetry.get(k), list) for k in ("services", "disks")}
    obj["telemetry"] = fields(telemetry, ("version", "collected_at", "cpu_percent"))
    obj["telemetry"]["host"] = fields(
        telemetry.get("host"),
        ("hostname", "uptime", "os", "platform", "platformVersion", "kernelVersion", "kernelArch"),
    )
    obj["telemetry"]["memory"] = fields(telemetry.get("memory"), ("total", "available", "used", "usedPercent"))
    obj["telemetry"]["disks"] = [
        fields(d, ("path", "fstype", "total", "free", "used", "usedPercent")) for d in telemetry.get("disks", []) or []
    ]
    network = telemetry.get("network") or {}
    obj["telemetry"]["interfaces"] = [fields(i, ("name", "mac", "addrs")) for i in network.get("interfaces", []) or []]
    if detail:
        obj["telemetry"]["services"] = [
            fields(s, ("name", "display_name", "displayName", "state", "status", "startup", "start_type"))
            for s in telemetry.get("services", []) or []
        ]
    return clean(obj)


@router.get("/integrations/v1/devices")
def inventory(
    limit: int = Query(100, ge=1, le=100), after: str = Query("", max_length=32), token=Depends(require_integration)
):
    with db() as conn:
        rows = conn.execute(
            "SELECT d.*,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id "
            "WHERE d.site=? AND d.archived=0 AND d.id>? ORDER BY d.id LIMIT ?",
            (token["site"], after, limit + 1),
        ).fetchall()
    page = rows[:limit]
    return {
        "site": token["site"],
        "scope": "inventory:read",
        "devices": [public_device(r) for r in page],
        "next_cursor": page[-1]["id"] if len(rows) > limit else None,
        "note": "Latest agent-reported telemetry; last_seen and collected_at describe freshness. No endpoint scans are triggered.",
    }


@router.get("/integrations/v1/devices/{device_id}")
def device(
    device_id: str,
    category: Literal["detail", "volumes", "services", "patches"] = "detail",
    token=Depends(require_integration),
):
    with db() as conn:
        row = conn.execute(
            "SELECT d.*,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id "
            "WHERE d.id=? AND d.site=? AND d.archived=0",
            (device_id, token["site"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Device not found in this integration site")
        result = public_device(row, detail=category in ("detail", "services"))
        if category == "patches":
            report = conn.execute("SELECT scanned,report FROM patch_reports WHERE device_id=?", (device_id,)).fetchone()
            return {
                "site": token["site"],
                "device_id": device_id,
                "available": report is not None,
                "scanned": report["scanned"] if report else None,
                "report": clean(json.loads(report["report"])) if report else None,
            }
    if category != "detail":
        return {
            "site": token["site"],
            "device_id": device_id,
            "last_seen": row["last_seen"],
            "collected_at": result["telemetry"].get("collected_at"),
            "available": result["reported"]["disks" if category == "volumes" else category],
            category: result["telemetry"].get("disks" if category == "volumes" else category, []),
        }
    return {"site": token["site"], "device": result}


@router.get("/integrations/v1/alerts")
def alerts(
    limit: int = Query(100, ge=1, le=100), after: str = Query("", max_length=32), token=Depends(require_integration)
):
    with db() as conn:
        rows = conn.execute(
            "SELECT a.id,a.device_id,a.key,a.title,a.severity,a.opened,a.updated,a.acknowledged,d.label,d.hostname "
            "FROM alerts a JOIN devices d ON d.id=a.device_id WHERE d.site=? AND d.archived=0 AND a.resolved IS NULL "
            "AND a.id>? ORDER BY a.id LIMIT ?",
            (token["site"], after, limit + 1),
        ).fetchall()
    page = rows[:limit]
    return {
        "site": token["site"],
        "scope": "inventory:read",
        "alerts": clean([dict(r) for r in page]),
        "next_cursor": page[-1]["id"] if len(rows) > limit else None,
        "state": "active",
    }
