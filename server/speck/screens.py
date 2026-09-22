"""Opt-in live frames with one encrypted, five-minute checkpoint per device."""

import base64
import binascii
import time
from threading import RLock
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from speck.config import seal, unseal
from speck.db import audit, db
from speck.jobs import get_device
from speck.security import require_agent, require_user

router = APIRouter(prefix="/api")
frames = {}
reports = {}
lock = RLock()
LIVE_SECONDS = 45
SAVE_SECONDS = 300


def policy(device_id, conn=None):
    if conn is None:
        with db() as conn:
            return policy(device_id, conn)
    row = conn.execute(
        "SELECT p.preview_enabled FROM device_policies p JOIN devices d ON d.id=p.device_id "
        "JOIN installations i ON i.id=d.installation_id "
        "WHERE d.id=? AND d.approved=1 AND d.archived=0 AND i.revoked=0", (device_id,),
    ).fetchone()
    return bool(row and row["preview_enabled"])


def current_frame(device_id):
    frame = frames.get(device_id)
    if frame and time.time() - frame["captured_at"] <= LIVE_SECONDS:
        return frame, "live"
    frames.pop(device_id, None)
    with db() as conn:
        row = conn.execute(
            "SELECT captured_at,saved_at,width,height FROM preview_snapshots WHERE device_id=?", (device_id,)
        ).fetchone()
    return (dict(row), "saved") if row else (None, None)


def screen_info(device):
    with lock:
        enabled = policy(device["id"])
        frame, source = current_frame(device["id"]) if enabled else (None, None)
        report = reports.get(device["id"], {})
        state = report.get("state") if time.time() - report.get("received", 0) <= LIVE_SECONDS else None
        if not enabled:
            state = "disabled"
        elif time.time() - device["last_seen"] > 75:
            state = "offline"
        elif source == "live":
            state = "live"
        elif not state or state == "live":
            state = "no_desktop"
        return {
            "enabled": enabled,
            "available": bool(frame),
            "source": source,
            "state": state,
            "captured_at": frame["captured_at"] if frame else None,
            "width": frame["width"] if frame else None,
            "height": frame["height"] if frame else None,
            "saved_interval_seconds": SAVE_SECONDS,
        }


class ScreenPolicy(BaseModel):
    enabled: bool


@router.put("/devices/{device_id}/preview-policy")
def update_policy(device_id: str, body: ScreenPolicy, user=Depends(require_user)):
    get_device(device_id, approved=True)
    with lock:
        with db(write=True) as conn:
            conn.execute("INSERT OR REPLACE INTO device_policies VALUES(?,?)", (device_id, int(body.enabled)))
            if not body.enabled:
                conn.execute("DELETE FROM preview_snapshots WHERE device_id=?", (device_id,))
            audit(conn, user["username"], "preview.enabled" if body.enabled else "preview.disabled", device_id)
        if not body.enabled:
            frames.pop(device_id, None)
            reports.pop(device_id, None)
    return {"enabled": body.enabled}


@router.get("/agent/preview-policy")
def agent_policy(device=Depends(require_agent)):
    return {"enabled": policy(device["id"]), "expires": time.time() + 30, "interval_seconds": 10}


class PreviewReport(BaseModel):
    state: Literal["live", "no_desktop", "helper_unavailable", "capture_failed", "capture_timeout", "unsupported"]


@router.put("/agent/preview-status")
def report_status(body: PreviewReport, device=Depends(require_agent)):
    with lock:
        if not policy(device["id"]):
            raise HTTPException(403, "Screen previews are disabled for this machine")
        for key, report in list(reports.items()):
            if time.time() - report["received"] > LIVE_SECONDS:
                reports.pop(key, None)
        reports[device["id"]] = {"state": body.state, "received": time.time()}
    return {"ok": True}


class Frame(BaseModel):
    jpeg: str = Field(max_length=280000)
    captured_at: float = Field(allow_inf_nan=False)
    width: int = Field(ge=1, le=800)
    height: int = Field(ge=1, le=800)


@router.put("/agent/preview")
def upload_frame(body: Frame, device=Depends(require_agent)):
    now = time.time()
    if abs(now - body.captured_at) > LIVE_SECONDS:
        raise HTTPException(422, "Screen preview is too old")
    try:
        data = base64.b64decode(body.jpeg, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "Invalid preview encoding") from None
    if len(data) > 200000 or not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
        raise HTTPException(422, "Provide a bounded JPEG preview")
    with lock:
        # Check current authorization inside the write transaction, including a
        # retirement/revocation that raced the request's authentication dependency.
        with db(write=True) as conn:
            if not policy(device["id"], conn):
                raise HTTPException(403, "Screen previews are disabled for this machine")
            for key, frame in list(frames.items()):
                if now - frame["captured_at"] > LIVE_SECONDS:
                    frames.pop(key, None)
            if device["id"] not in frames and len(frames) >= 500:
                raise HTTPException(429, "Preview capacity reached")
            saved = conn.execute(
                "SELECT captured_at,saved_at FROM preview_snapshots WHERE device_id=?", (device["id"],)
            ).fetchone()
            latest = max(frames.get(device["id"], {}).get("captured_at", 0), saved["captured_at"] if saved else 0)
            if body.captured_at <= latest:
                return {"ok": True}
            if not saved or now - saved["saved_at"] >= SAVE_SECONDS:
                conn.execute(
                    "INSERT OR REPLACE INTO preview_snapshots VALUES(?,?,?,?,?,?)",
                    (device["id"], body.captured_at, now, body.width, body.height, seal(body.jpeg)),
                )
        frames[device["id"]] = body.model_dump(exclude={"jpeg"}) | {"data": data, "received": now}
    return {"ok": True}


@router.get("/devices/{device_id}/preview")
def get_preview(device_id: str, user=Depends(require_user)):
    get_device(device_id, approved=True)
    with lock:
        if not policy(device_id):
            raise HTTPException(404, "Screen preview is off")
        frame, source = current_frame(device_id)
        if not frame:
            raise HTTPException(404, "No preview captured yet; a signed-in desktop helper is required")
        if source == "live":
            data = frame["data"]
        else:
            with db() as conn:
                row = conn.execute("SELECT jpeg FROM preview_snapshots WHERE device_id=?", (device_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Saved preview was removed")
            data = base64.b64decode(unseal(row["jpeg"]))
        return Response(data, media_type="image/jpeg", headers={
            "Cache-Control": "no-store", "X-Speck-Captured-At": str(frame["captured_at"]),
            "X-Speck-Preview-Source": source,
        })


@router.get("/devices/{device_id}/preview-status")
def preview_status(device_id: str, user=Depends(require_user)):
    return screen_info(get_device(device_id, approved=True))
