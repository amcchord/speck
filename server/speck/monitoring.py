"""Persistent health conditions; missing telemetry never means healthy."""

import json
import math
import time
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from speck.db import audit, db, ident
from speck.alert_context import alert_detail, present_alert
from speck.jobs import get_device
from speck.security import require_admin, require_user

router = APIRouter(prefix="/api")


class MonitorPolicy(BaseModel):
    enabled: bool = True
    offline_seconds: int = Field(default=180, ge=90, le=86400)
    hold_seconds: int = Field(default=120, ge=30, le=3600)
    cpu_percent: int = Field(default=95, ge=50, le=100)
    memory_percent: int = Field(default=95, ge=50, le=100)
    disk_percent: int = Field(default=90, ge=50, le=100)
    services: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("services")
    @classmethod
    def names(cls, values):
        values = sorted(set(v.strip() for v in values))
        if any(not v or len(v) > 150 or any(ord(c) < 32 for c in v) for v in values):
            raise ValueError("Use exact service names, one per line")
        return values


def policy_for(conn, device_id=None):
    row = (
        conn.execute("SELECT policy FROM monitor_overrides WHERE device_id=?", (device_id,)).fetchone()
        if device_id
        else None
    )
    if not row:
        row = conn.execute("SELECT value FROM settings WHERE key='monitor_policy'").fetchone()
    return MonitorPolicy.model_validate_json(row[0]) if row else MonitorPolicy()


@router.get("/monitoring")
def policies(user=Depends(require_user)):
    with db() as conn:
        tick = conn.execute("SELECT value FROM settings WHERE key='management_tick'").fetchone()
        last_tick = json.loads(tick[0])["at"] if tick else None
        return {
            "last_evaluation": last_tick,
            "healthy": bool(last_tick and time.time() - last_tick < 60),
            "default": policy_for(conn).model_dump(),
            "overrides": {
                r["device_id"]: json.loads(r["policy"]) for r in conn.execute("SELECT * FROM monitor_overrides")
            },
        }


@router.put("/monitoring")
def set_default(body: MonitorPolicy, user=Depends(require_admin)):
    if body.services:
        raise HTTPException(422, "Choose watched services on each device; service names differ by platform")
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES('monitor_policy',?)", (body.model_dump_json(),))
        conn.execute("DELETE FROM monitor_states")
        audit(conn, user["username"], "monitoring.defaults_changed", detail=body.model_dump())
    return {"ok": True}


@router.put("/devices/{device_id}/monitoring")
def set_device_policy(device_id: str, body: MonitorPolicy, user=Depends(require_user)):
    get_device(device_id, approved=True)
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO monitor_overrides VALUES(?,?)", (device_id, body.model_dump_json()))
        conn.execute("DELETE FROM monitor_states WHERE device_id=?", (device_id,))
        audit(conn, user["username"], "monitoring.device_changed", device_id, body.model_dump())
    return {"ok": True}


@router.delete("/devices/{device_id}/monitoring")
def reset_device_policy(device_id: str, user=Depends(require_user)):
    get_device(device_id)
    with db(write=True) as conn:
        conn.execute("DELETE FROM monitor_overrides WHERE device_id=?", (device_id,))
        conn.execute("DELETE FROM monitor_states WHERE device_id=?", (device_id,))
        audit(conn, user["username"], "monitoring.device_reset", device_id)
    return {"ok": True}


def open_alert(conn, device_id, key, title, severity, now):
    existing = conn.execute(
        "SELECT id FROM alerts WHERE device_id=? AND key=? AND resolved IS NULL", (device_id, key)
    ).fetchone()
    if existing:
        conn.execute("UPDATE alerts SET updated=?,title=? WHERE id=?", (now, title, existing["id"]))
        return existing["id"]
    alert_id = ident()
    conn.execute(
        "INSERT INTO alerts(id,device_id,key,title,severity,opened,updated) VALUES(?,?,?,?,?,?,?)",
        (alert_id, device_id, key, title, severity, now, now),
    )
    audit(conn, "monitor", "alert.opened", device_id, {"alert_id": alert_id, "condition": key})
    return alert_id


def observe(conn, device_id, key, title, bad, hold, now, severity="warning"):
    if bad is None:
        # An unknown sample breaks a pending sustained threshold, but cannot clear
        # an existing alert. Recovery requires a valid fresh observation.
        conn.execute("DELETE FROM monitor_states WHERE device_id=? AND key=?", (device_id, key))
        return
    if not bad:
        conn.execute("DELETE FROM monitor_states WHERE device_id=? AND key=?", (device_id, key))
        active = conn.execute(
            "SELECT id FROM alerts WHERE device_id=? AND key=? AND resolved IS NULL", (device_id, key)
        ).fetchone()
        if active:
            conn.execute(
                "UPDATE alerts SET resolved=?,updated=?,resolve_actor='monitor' WHERE id=?", (now, now, active["id"])
            )
            audit(conn, "monitor", "alert.resolved", device_id, {"alert_id": active["id"]})
        return
    conn.execute("INSERT OR IGNORE INTO monitor_states VALUES(?,?,?)", (device_id, key, now))
    since = conn.execute("SELECT since FROM monitor_states WHERE device_id=? AND key=?", (device_id, key)).fetchone()[0]
    if now - since >= hold:
        open_alert(conn, device_id, key, title, severity, now)


def numeric(value):
    return (
        isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100
    )


def evaluate(conn, now):
    for row in conn.execute(
        "SELECT d.*,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id"
    ).fetchall():
        device_id = row["id"]
        policy = policy_for(conn, device_id)
        if not row["approved"] or row["archived"] or row["revoked"] or not policy.enabled:
            conn.execute("DELETE FROM monitor_states WHERE device_id=?", (device_id,))
            conn.execute(
                "UPDATE alerts SET resolved=?,updated=?,resolve_actor='policy' WHERE device_id=? AND resolved IS NULL",
                (now, now, device_id),
            )
            continue
        if row["maintenance_until"] > now:
            conn.execute("DELETE FROM monitor_states WHERE device_id=?", (device_id,))
            continue
        offline = now - row["last_seen"] >= policy.offline_seconds
        observe(conn, device_id, "offline", "Agent is offline", offline, 0, now, "critical")
        data = json.loads(row["telemetry"])
        try:
            age = now - datetime.fromisoformat(data.get("collected_at", "").replace("Z", "+00:00")).timestamp()
            fresh = -60 <= age <= 120 and now - row["last_seen"] < 75
        except (ValueError, TypeError, AttributeError):
            fresh = False
        observe(
            conn,
            device_id,
            "telemetry",
            "Inventory is stale or unavailable",
            not fresh if not offline else None,
            policy.hold_seconds,
            now,
        )
        active_keys = {
            r[0] for r in conn.execute("SELECT key FROM alerts WHERE device_id=? AND resolved IS NULL", (device_id,))
        }
        readings = [
            ("cpu", "CPU", data.get("cpu_percent"), policy.cpu_percent),
            (
                "memory",
                "Memory",
                data.get("memory", {}).get("usedPercent") if isinstance(data.get("memory"), dict) else None,
                policy.memory_percent,
            ),
        ]
        disks = data.get("disks")
        if isinstance(disks, list):
            readings += [
                ("disk:" + d["path"][:500], "Disk " + d["path"][:500], d.get("usedPercent"), policy.disk_percent)
                for d in disks[:100]
                if isinstance(d, dict) and isinstance(d.get("path"), str)
            ]
        for key, label, value, threshold in readings:
            bad = value >= threshold - (5 if key in active_keys else 0) if fresh and numeric(value) else None
            observe(
                conn,
                device_id,
                key,
                label + (f" is {value:.0f}% used" if numeric(value) else " unavailable"),
                bad,
                policy.hold_seconds,
                now,
            )
        services = data.get("services")
        available = (
            fresh
            and isinstance(services, list)
            and not any(isinstance(s, dict) and s.get("status") == "unavailable" for s in services)
        )
        index = (
            {s.get("name"): s.get("status") for s in services if isinstance(s, dict) and isinstance(s.get("name"), str)}
            if available
            else {}
        )
        for service in policy.services:
            observe(
                conn,
                device_id,
                "service:" + service,
                "Service " + service + " is not running",
                index.get(service) not in ("active", "running") if available else None,
                policy.hold_seconds,
                now,
                "critical",
            )
        # Removing a service from the watch list explicitly clears its policy alert.
        for key in active_keys:
            if key.startswith("service:") and key[8:] not in policy.services:
                observe(conn, device_id, key, "", False, 0, now)
        for job in conn.execute(
            "SELECT id,status FROM jobs WHERE device_id=? AND status IN ('failed','unknown','expired') AND finished>? ORDER BY finished DESC LIMIT 200",
            (device_id, now - 86400),
        ):
            key = "job:" + job["id"]
            if not conn.execute("SELECT 1 FROM alerts WHERE device_id=? AND key=?", (device_id, key)).fetchone():
                open_alert(conn, device_id, key, f"Job {job['id'][:8]} {job['status']}", "warning", now)


@router.get("/alerts")
def alerts(
    state: Literal["active", "unacknowledged", "resolved", "all"] = "active",
    device_id: str | None = None,
    before_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(require_user),
):
    device_id = device_id or None
    clause = {
        "active": "a.resolved IS NULL",
        "unacknowledged": "a.resolved IS NULL AND a.acknowledged IS NULL",
        "resolved": "a.resolved IS NOT NULL",
        "all": "1=1",
    }[state]
    with db() as conn:
        rows = conn.execute(
            f"SELECT a.*,d.label,d.maintenance_until FROM alerts a LEFT JOIN devices d ON d.id=a.device_id WHERE {clause} AND (? IS NULL OR a.device_id=?) AND (? IS NULL OR a.rowid<(SELECT rowid FROM alerts WHERE id=?)) ORDER BY a.rowid DESC LIMIT ?",
            (device_id, device_id, before_id, before_id, limit + 1),
        ).fetchall()
        items = [present_alert(conn, r) for r in rows[:limit]]
        counts = dict(
            conn.execute(
                "SELECT count(*) AS active,sum(acknowledged IS NULL) AS unacknowledged FROM alerts WHERE resolved IS NULL"
            ).fetchone()
        )
    return {
        "items": items,
        "counts": counts,
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


@router.get("/alerts/{alert_id}")
def detail(alert_id: str, user=Depends(require_user)):
    with db() as conn:
        return alert_detail(conn, alert_id)


class AlertAction(BaseModel):
    action: Literal["acknowledge", "resolve"]


@router.post("/alerts/{alert_id}")
def action(alert_id: str, body: AlertAction, user=Depends(require_user)):
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Alert not found")
        if row["resolved"]:
            return {"ok": True}
        if body.action == "resolve" and not row["key"].startswith("job:"):
            raise HTTPException(
                409,
                "Health alerts resolve when the condition recovers. Acknowledge or use device maintenance while working.",
            )
        column, actor = ("acknowledged", "ack_actor") if body.action == "acknowledge" else ("resolved", "resolve_actor")
        conn.execute(f"UPDATE alerts SET {column}=?,{actor}=? WHERE id=?", (time.time(), user["username"], alert_id))
        audit(conn, user["username"], "alert." + body.action, row["device_id"], {"alert_id": alert_id})
    return {"ok": True}
