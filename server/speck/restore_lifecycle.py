"""Track provider-backed clones; archive only after confirmed restore removal.

This integration never deletes a Slide resource or revokes shared agent credentials.
"""

import asyncio
import hashlib
import json
import logging
import re
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from speck.config import unseal
from speck.db import audit, db
from speck.management import close_devices, stop_management
from speck.security import require_admin, require_user
from speck.slide import Slide, SlideProviderError, settings

router = APIRouter(prefix="/api/slide/restored-devices")
log = logging.getLogger(__name__)
lock = asyncio.Lock()
INTERVAL = 300
GRACE = 300


def migrate(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS slide_restore_instances(
        device_id TEXT PRIMARY KEY REFERENCES devices(id),
        source_device_id TEXT NOT NULL REFERENCES devices(id),
        hardware_id TEXT NOT NULL, provider_url TEXT NOT NULL, scope TEXT NOT NULL,
        virt_id TEXT NOT NULL, agent_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
        mac_address TEXT NOT NULL, first_seen REAL NOT NULL, last_seen REAL NOT NULL,
        missing_since REAL, missing_count INTEGER NOT NULL DEFAULT 0, archived_at REAL)""")


def scope(config):
    return hashlib.sha256((config["url"] + "\0" + config["token"]).encode()).hexdigest()


def enabled(conn):
    row = conn.execute("SELECT value FROM settings WHERE key='slide_restore_cleanup'").fetchone()
    return json.loads(row[0]).get("enabled", True) if row else True


def mac(value):
    value = re.sub("[:-]", "", str(value)).lower()
    return value if re.fullmatch("[a-f0-9]{12}", value) and value != "0" * 12 else ""


def macs(device):
    data = json.loads(device["telemetry"])
    return {m for interface in data.get("network", {}).get("interfaces", []) if (m := mac(interface.get("mac", "")))}


def same_vm(binding, vm):
    return all(binding[key] == vm.get(key) for key in ("virt_id", "agent_id", "snapshot_id")) and (
        binding["mac_address"] == mac(vm.get("mac_address")) and vm.get("purpose") in ("test", "disaster")
    )


def valid_clone(conn, binding):
    device = conn.execute("SELECT * FROM devices WHERE id=?", (binding["device_id"],)).fetchone()
    source = conn.execute("SELECT * FROM devices WHERE id=?", (binding["source_device_id"],)).fetchone()
    return bool(
        device
        and source
        and not device["archived"]
        and not source["archived"]
        and device["id"] != source["id"]
        and not device["slide_agent_id"]
        and source["slide_agent_id"] == binding["agent_id"]
        and device["installation_id"] == source["installation_id"]
        and device["hardware_id"] == binding["hardware_id"]
        and device["hardware_id"] != source["hardware_id"]
        and source["created"] < device["created"]
        and binding["mac_address"] in macs(device)
    )


def current_scope(conn, expected):
    row = conn.execute("SELECT value FROM settings WHERE key='slide'").fetchone()
    return bool(row and scope(json.loads(unseal(row[0]))) == expected)


def reset_missing(conn, device_id):
    conn.execute(
        "UPDATE slide_restore_instances SET missing_since=NULL,missing_count=0 WHERE device_id=?", (device_id,)
    )


async def sync(slide=None, now=None, actor="slide-sync"):
    if lock.locked():
        raise HTTPException(409, "Slide restore synchronization is already running")
    async with lock:
        slide = slide or Slide()
        config, checked = slide.config, time.time() if now is None else now
        fingerprint = scope(config)
        # Complete inventory must succeed before any missing-resource inference.
        vms = await slide.listing("restore/virt")
        if any(
            not isinstance(v, dict) or not re.fullmatch(r"virt_[a-z0-9]{12}", str(v.get("virt_id", ""))) for v in vms
        ):
            raise HTTPException(502, "Slide returned invalid restore identities")
        if len({v["virt_id"] for v in vms}) != len(vms):
            raise HTTPException(502, "Slide returned duplicate restore identities")
        by_id = {v["virt_id"]: v for v in vms}
        linked, archived, pending, errors = [], [], [], []
        with db(write=True) as conn:
            if not current_scope(conn, fingerprint):
                raise HTTPException(409, "Slide connection changed; no devices were archived")
            devices = [dict(r) for r in conn.execute("SELECT * FROM devices WHERE archived=0")]
            for device in devices:
                if device["slide_agent_id"]:
                    continue
                candidates = [
                    v
                    for v in vms
                    if v.get("purpose") in ("test", "disaster") and mac(v.get("mac_address")) in macs(device)
                ]
                if len(candidates) != 1:
                    continue
                vm = candidates[0]
                sources = [
                    s
                    for s in devices
                    if s["id"] != device["id"]
                    and s["slide_agent_id"] == vm.get("agent_id")
                    and s["installation_id"] == device["installation_id"]
                    and s["created"] < device["created"]
                    and s["hardware_id"] != device["hardware_id"]
                ]
                # Ambiguous endpoint telemetry is never sufficient to select a clone.
                matches = [d for d in devices if mac(vm.get("mac_address")) in macs(d)]
                if len(sources) != 1 or len(matches) != 1 or not vm.get("snapshot_id"):
                    continue
                previous = conn.execute(
                    "SELECT * FROM slide_restore_instances WHERE device_id=?", (device["id"],)
                ).fetchone()
                if previous and (
                    previous["provider_url"] != config["url"]
                    or not same_vm(previous, vm)
                    or previous["source_device_id"] != sources[0]["id"]
                    or previous["hardware_id"] != device["hardware_id"]
                ):
                    continue
                if not previous:
                    conn.execute(
                        """INSERT INTO slide_restore_instances
                        (device_id,source_device_id,hardware_id,provider_url,scope,virt_id,agent_id,snapshot_id,
                         mac_address,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            device["id"],
                            sources[0]["id"],
                            device["hardware_id"],
                            config["url"],
                            fingerprint,
                            vm["virt_id"],
                            vm["agent_id"],
                            vm["snapshot_id"],
                            mac(vm["mac_address"]),
                            checked,
                            checked,
                        ),
                    )
                    audit(
                        conn,
                        actor,
                        "slide.restore_linked",
                        device["id"],
                        {"virt_id": vm["virt_id"], "source_device_id": sources[0]["id"]},
                    )
                    linked.append(device["id"])
                else:
                    conn.execute(
                        "UPDATE slide_restore_instances SET scope=?,last_seen=?,archived_at=NULL WHERE device_id=?",
                        (fingerprint, checked, device["id"]),
                    )
                reset_missing(conn, device["id"])
            bindings = [
                dict(r)
                for r in conn.execute(
                    """SELECT r.* FROM slide_restore_instances r
                JOIN devices d ON d.id=r.device_id WHERE r.scope=? AND d.archived=0""",
                    (fingerprint,),
                )
            ]
        for binding in bindings:
            if binding["virt_id"] in by_id:
                # Presence, even with unexpected metadata, breaks deletion confirmation.
                with db(write=True) as conn:
                    reset_missing(conn, binding["device_id"])
                continue
            missing = False
            try:
                await slide.request("GET", "restore/virt/" + binding["virt_id"])
            except SlideProviderError as exc:
                missing = exc.provider_status == 404
                if not missing:
                    errors.append({"device_id": binding["device_id"], "provider_status": exc.provider_status})
            except HTTPException:
                errors.append({"device_id": binding["device_id"], "error": "Provider read unavailable"})
            with db(write=True) as conn:
                if not current_scope(conn, fingerprint):
                    raise HTTPException(409, "Slide connection changed; remaining cleanup cancelled")
                if not missing or not valid_clone(conn, binding):
                    reset_missing(conn, binding["device_id"])
                    continue
                row = conn.execute(
                    "SELECT * FROM slide_restore_instances WHERE device_id=?", (binding["device_id"],)
                ).fetchone()
                first = row["missing_since"] if row["missing_since"] is not None else checked
                count = row["missing_count"] + 1
                conn.execute(
                    "UPDATE slide_restore_instances SET missing_since=?,missing_count=? WHERE device_id=?",
                    (first, count, binding["device_id"]),
                )
                device = conn.execute("SELECT * FROM devices WHERE id=?", (binding["device_id"],)).fetchone()
                if not enabled(conn) or count < 2 or checked - first < GRACE or checked - device["last_seen"] < 75:
                    pending.append(binding["device_id"])
                    continue
                conn.execute("UPDATE devices SET archived=1 WHERE id=?", (binding["device_id"],))
                stop_management(conn, binding["device_id"], actor)
                conn.execute(
                    "UPDATE slide_restore_instances SET archived_at=? WHERE device_id=?",
                    (checked, binding["device_id"]),
                )
                audit(
                    conn,
                    actor,
                    "slide.restore_archived",
                    binding["device_id"],
                    {
                        "virt_id": binding["virt_id"],
                        "source_device_id": binding["source_device_id"],
                        "provider_url": config["url"],
                        "reason": "Repeated provider 404 after grace period; restored endpoint offline",
                    },
                )
                archived.append(binding["device_id"])
        await close_devices(archived)
        result = {"checked_at": checked, "linked": linked, "archived": archived, "pending": pending, "errors": errors}
        with db(write=True) as conn:
            conn.execute("INSERT OR REPLACE INTO settings VALUES('slide_restore_sync',?)", (json.dumps(result),))
        return result


@router.get("")
def status(user=Depends(require_user)):
    with db() as conn:
        state = conn.execute("SELECT value FROM settings WHERE key='slide_restore_sync'").fetchone()
        rows = [
            dict(r)
            for r in conn.execute("""SELECT r.device_id,d.label,r.source_device_id,r.provider_url,
            r.virt_id,r.first_seen,r.last_seen,r.missing_since,r.archived_at,d.archived
            FROM slide_restore_instances r JOIN devices d ON d.id=r.device_id ORDER BY r.first_seen""")
        ]
        return {
            "enabled": enabled(conn),
            "interval_seconds": INTERVAL,
            "grace_seconds": GRACE,
            "last_sync": json.loads(state[0]) if state else None,
            "instances": rows,
        }


class Policy(BaseModel):
    enabled: bool


@router.put("/settings")
def set_policy(body: Policy, user=Depends(require_admin)):
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES('slide_restore_cleanup',?)", (body.model_dump_json(),))
        audit(conn, user["username"], "slide.restore_cleanup_policy", detail=body.model_dump())
    return {"enabled": body.enabled}


@router.post("/sync")
async def synchronize(user=Depends(require_user)):
    return await sync(actor=user["username"])


async def worker():
    await asyncio.sleep(10)
    while True:
        try:
            settings()
        except HTTPException:
            pass  # Not connected yet.
        else:
            try:
                await sync()
            except Exception:
                # Never expose provider response bodies or credentials in status/logs.
                log.warning("Slide restore synchronization failed; no deletion inferred from this error")
                with db(write=True) as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO settings VALUES('slide_restore_sync',?)",
                        (
                            json.dumps(
                                {
                                    "checked_at": time.time(),
                                    "error": "Slide restore synchronization failed; retrying automatically",
                                }
                            ),
                        ),
                    )
        await asyncio.sleep(INTERVAL)
