"""Opt-in live previews: newest frame only, memory-only, 45-second TTL."""

import base64
import binascii
import time
from threading import RLock

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from speck.db import audit, db
from speck.jobs import get_device
from speck.security import require_agent, require_user

router = APIRouter(prefix="/api")
frames = {}
lock = RLock()


def policy(device_id):
    with db() as conn:
        row = conn.execute("SELECT preview_enabled FROM device_policies WHERE device_id=?", (device_id,)).fetchone()
    return bool(row and row["preview_enabled"])


def screen_info(device):
    enabled = bool(device["approved"] and policy(device["id"]))
    with lock:
        frame = frames.get(device["id"])
        if frame and (not enabled or time.time() - frame["received"] > 45):
            frames.pop(device["id"], None)
            frame = None
    return {
        "enabled": enabled,
        "available": bool(frame),
        "captured_at": frame["captured_at"] if frame else None,
        "width": frame["width"] if frame else None,
        "height": frame["height"] if frame else None,
    }


class ScreenPolicy(BaseModel):
    enabled: bool


@router.put("/devices/{device_id}/preview-policy")
def update_policy(device_id: str, body: ScreenPolicy, user=Depends(require_user)):
    get_device(device_id, approved=True)
    with lock:
        with db(write=True) as conn:
            conn.execute("INSERT OR REPLACE INTO device_policies VALUES(?,?)", (device_id, int(body.enabled)))
            audit(conn, user["username"], "preview.enabled" if body.enabled else "preview.disabled", device_id)
        if not body.enabled:
            frames.pop(device_id, None)
    return {"enabled": body.enabled}


@router.get("/agent/preview-policy")
def agent_policy(device=Depends(require_agent)):
    return {
        "enabled": bool(device["approved"] and policy(device["id"])),
        "expires": time.time() + 30,
        "interval_seconds": 10,
    }


class Frame(BaseModel):
    jpeg: str = Field(max_length=280000)
    captured_at: float
    width: int = Field(ge=1, le=800)
    height: int = Field(ge=1, le=800)


@router.put("/agent/preview")
def upload_frame(body: Frame, device=Depends(require_agent)):
    with lock:
        if not device["approved"] or not policy(device["id"]):
            raise HTTPException(403, "Screen previews are disabled for this machine")
        if abs(time.time() - body.captured_at) > 45:
            raise HTTPException(422, "Screen preview is too old")
        try:
            data = base64.b64decode(body.jpeg, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(422, "Invalid preview encoding") from None
        if len(data) > 200000 or not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
            raise HTTPException(422, "Provide a bounded JPEG preview")
        # Discard expired frames, even if their devices are no longer viewed.
        for key, frame in list(frames.items()):
            if time.time() - frame["received"] > 45:
                frames.pop(key, None)
        if device["id"] not in frames and len(frames) >= 500:
            raise HTTPException(429, "Preview capacity reached")
        frames[device["id"]] = body.model_dump(exclude={"jpeg"}) | {"data": data, "received": time.time()}
    return {"ok": True}


@router.get("/devices/{device_id}/preview")
def get_preview(device_id: str, user=Depends(require_user)):
    device = get_device(device_id, approved=True)
    with lock:
        info = screen_info(device)
        if not info["available"]:
            raise HTTPException(404, "No recent preview; check the desktop helper and per-machine switch")
        frame = frames[device_id]
        return Response(
            frame["data"],
            media_type="image/jpeg",
            headers={"Cache-Control": "no-store", "X-Speck-Captured-At": str(frame["captured_at"])},
        )


@router.get("/devices/{device_id}/preview-status")
def preview_status(device_id: str, user=Depends(require_user)):
    return screen_info(get_device(device_id, approved=True))
