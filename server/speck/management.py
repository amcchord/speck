"""Device lifecycle and a searchable, paginated audit ledger."""

import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from speck.db import audit, db
from speck.jobs import get_device
from speck.security import require_admin, require_user

router = APIRouter(prefix="/api")


class Organization(BaseModel):
    site: str = Field(default="", max_length=80)
    tags: list[str] = Field(default_factory=list, max_length=20)
    maintenance_until: float = Field(default=0, ge=0, allow_inf_nan=False)

    @field_validator("tags")
    @classmethod
    def normalize(cls, values):
        values = sorted(set(v.strip().lower() for v in values))
        if any(not v or len(v) > 40 or any(ord(c) < 32 for c in v) for v in values):
            raise ValueError("Tags must be 1–40 printable characters")
        return values


@router.put("/devices/{device_id}/organization")
def organize(device_id: str, body: Organization, user=Depends(require_user)):
    get_device(device_id)
    if body.maintenance_until > time.time() + 31 * 86400:
        raise HTTPException(422, "Maintenance can last up to 31 days")
    with db(write=True) as conn:
        conn.execute(
            "UPDATE devices SET site=?,tags=?,maintenance_until=? WHERE id=?",
            (body.site.strip(), json.dumps(body.tags), body.maintenance_until, device_id),
        )
        audit(conn, user["username"], "device.organization_changed", device_id, body.model_dump())
    return {"ok": True}


async def close_devices(device_ids):
    from speck.remote import close_session, sessions
    from speck.screens import frames, lock, reports

    with lock:
        for device_id in device_ids:
            frames.pop(device_id, None)
            reports.pop(device_id, None)
    for session_id, session in list(sessions.items()):
        if session.device_id in device_ids:
            await close_session(session_id)


def stop_management(conn, device_id, actor):
    # Running endpoint processes cannot be killed by a database update. Mark them
    # unknown and never replay; queued commands have definitely not started.
    conn.execute(
        "UPDATE jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'unknown' END,finished=? WHERE device_id=? AND status IN ('queued','leased','running')",
        (time.time(), device_id),
    )
    conn.execute("UPDATE device_policies SET preview_enabled=0 WHERE device_id=?", (device_id,))
    conn.execute("DELETE FROM preview_snapshots WHERE device_id=?", (device_id,))
    conn.execute("DELETE FROM monitor_states WHERE device_id=?", (device_id,))
    conn.execute(
        "UPDATE alerts SET resolved=?,resolve_actor=? WHERE device_id=? AND resolved IS NULL",
        (time.time(), actor, device_id),
    )


class Archive(BaseModel):
    archived: bool


@router.put("/devices/{device_id}/archive")
async def archive(device_id: str, body: Archive, user=Depends(require_user)):
    get_device(device_id)
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.id=?", (device_id,)
        ).fetchone()
        if not body.archived and row["revoked"]:
            raise HTTPException(
                409, "The installation credential was revoked. Re-enroll this machine to manage it again."
            )
        conn.execute("UPDATE devices SET archived=? WHERE id=?", (body.archived, device_id))
        if body.archived:
            stop_management(conn, device_id, user["username"])
        audit(conn, user["username"], "device.archived" if body.archived else "device.unarchived", device_id)
    if body.archived:
        await close_devices([device_id])
    return {"ok": True}


@router.get("/devices/{device_id}/installation")
def installation(device_id: str, user=Depends(require_admin)):
    device = get_device(device_id)
    with db() as conn:
        row = conn.execute(
            "SELECT id,created,revoked FROM installations WHERE id=?", (device["installation_id"],)
        ).fetchone()
        affected = [
            dict(r)
            for r in conn.execute(
                "SELECT id,label,hostname,approved,archived FROM devices WHERE installation_id=? ORDER BY label",
                (device["installation_id"],),
            )
        ]
    return dict(row) | {"devices": affected}


class Revoke(BaseModel):
    affected_device_ids: list[str] = Field(min_length=1, max_length=5000)
    confirmed: Literal[True]


@router.post("/devices/{device_id}/installation/revoke")
async def revoke(device_id: str, body: Revoke, user=Depends(require_admin)):
    device = get_device(device_id)
    with db(write=True) as conn:
        affected = [
            r[0] for r in conn.execute("SELECT id FROM devices WHERE installation_id=?", (device["installation_id"],))
        ]
        if set(affected) != set(body.affected_device_ids):
            raise HTTPException(409, "The affected instances changed. Review the installation again.")
        conn.execute("UPDATE installations SET revoked=1 WHERE id=?", (device["installation_id"],))
        for target in affected:
            conn.execute("UPDATE devices SET archived=1 WHERE id=?", (target,))
            stop_management(conn, target, user["username"])
        audit(conn, user["username"], "installation.revoked", device_id, {"affected_device_ids": affected})
    await close_devices(affected)
    return {"ok": True, "affected_device_ids": affected}


@router.get("/audit/events")
def events(
    actor: str = Query(default="", max_length=100),
    action: str = Query(default="", max_length=100),
    device_id: str = Query(default="", max_length=128),
    since: float = 0,
    until: float | None = None,
    before_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    user=Depends(require_user),
):
    with db() as conn:
        rows = conn.execute(
            "SELECT a.*,d.label FROM audit a LEFT JOIN devices d ON d.id=a.device_id WHERE (?='' OR actor=?) AND (?='' OR instr(action,?)>0) AND (?='' OR device_id=?) AND at>=? AND (? IS NULL OR at<=?) AND (? IS NULL OR a.id<?) ORDER BY a.id DESC LIMIT ?",
            (actor, actor, action, action, device_id, device_id, since, until, until, before_id, before_id, limit + 1),
        ).fetchall()
    return {
        "items": [dict(r) | {"detail": json.loads(r["detail"])} for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }
