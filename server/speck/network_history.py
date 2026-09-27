"""Bounded observation history. No provider configuration or client traffic content.

Viewed observations and opt-in five-minute collections share seven-day retention.
Continuous collection is limited to 20 explicitly enabled network devices.
"""

import asyncio
import json
import math
import logging
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from speck.config import seal, unseal
from speck.db import audit, db
from speck.security import require_admin, require_user

router = APIRouter(prefix="/api/unifi")
RETENTION = 7 * 86400
INTERVAL = 300


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS network_samples(console_id TEXT,site_id TEXT,device_id TEXT,at REAL,payload TEXT NOT NULL,PRIMARY KEY(console_id,site_id,device_id,at));
    CREATE INDEX IF NOT EXISTS network_samples_time ON network_samples(at);
    CREATE TABLE IF NOT EXISTS network_collection(console_id TEXT,site_id TEXT,device_id TEXT,enabled INTEGER NOT NULL DEFAULT 0,last_attempt REAL,last_error TEXT,PRIMARY KEY(console_id,site_id,device_id));
    CREATE TABLE IF NOT EXISTS network_equipment_index(console_id TEXT,site_id TEXT,device_id TEXT,seen REAL,payload TEXT NOT NULL,PRIMARY KEY(console_id,site_id,device_id));
    CREATE TABLE IF NOT EXISTS network_client_history(console_id TEXT,site_id TEXT,mac TEXT,at REAL,payload TEXT NOT NULL,PRIMARY KEY(console_id,site_id,mac,at));
    """)


def numeric(value):
    return (
        value
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
        else None
    )


def index_equipment(console, site, rows):
    now = time.time()
    with db(write=True) as conn:
        for row in rows[:5000]:
            if not row.get("id"):
                continue
            metadata = {
                key: row[key] for key in ("id", "name", "model", "macAddress", "ipAddress", "state") if key in row
            }
            conn.execute(
                "INSERT OR REPLACE INTO network_equipment_index VALUES(?,?,?,?,?)",
                (console, site, row["id"], now, seal(json.dumps(metadata))),
            )
        conn.execute("DELETE FROM network_equipment_index WHERE seen<?", (now - RETENTION,))
        conn.execute(
            "DELETE FROM network_equipment_index WHERE rowid IN (SELECT rowid FROM network_equipment_index ORDER BY seen DESC LIMIT -1 OFFSET 10000)"
        )


def record(data):
    console, site, device = data["site"]["console_id"], data["site"]["id"], data["device"]["id"]
    index_equipment(console, site, [data["device"]])
    ports = []
    for p in data.get("ports", [])[:256]:
        o = p.get("observation") or {}
        ports.append(
            {
                "port": p.get("idx"),
                "state": p.get("state"),
                "speed_mbps": numeric(p.get("speedMbps")),
                **{
                    key: numeric(o.get(key))
                    for key in (
                        "rx_bytes",
                        "tx_bytes",
                        "rx_errors",
                        "tx_errors",
                        "rx_dropped",
                        "tx_dropped",
                        "poe_power",
                    )
                },
            }
        )
    sample = {
        "ports": ports,
        "power_budget": numeric(data.get("power_budget")),
        "cpu_percent": numeric((data.get("statistics") or {}).get("cpuUtilizationPct")),
        "memory_percent": numeric((data.get("statistics") or {}).get("memoryUtilizationPct")),
    }
    now = data.get("checked_at") or time.time()
    with db(write=True) as conn:
        prior = conn.execute(
            "SELECT max(at) FROM network_samples WHERE console_id=? AND site_id=? AND device_id=?",
            (console, site, device),
        ).fetchone()[0]
        if prior is None or now - prior >= 60:
            conn.execute(
                "INSERT OR IGNORE INTO network_samples VALUES(?,?,?,?,?)",
                (console, site, device, now, seal(json.dumps(sample))),
            )
        conn.execute("DELETE FROM network_samples WHERE at<?", (time.time() - RETENTION,))
        conn.execute(
            "DELETE FROM network_samples WHERE rowid IN (SELECT rowid FROM network_samples ORDER BY at DESC LIMIT -1 OFFSET 50000)"
        )
        for client in data.get("clients", [])[:2000]:
            mac = str(client.get("mac", "")).lower()
            if not re.fullmatch(r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}", mac) or client.get("state") != "online":
                continue
            item = {
                key: client.get(key)
                for key in ("uplink_id", "uplink_name", "port", "type", "radio", "channel", "signal_dbm")
            }
            prior = conn.execute(
                "SELECT at,payload FROM network_client_history WHERE console_id=? AND site_id=? AND mac=? ORDER BY at DESC LIMIT 1",
                (console, site, mac),
            ).fetchone()
            if prior is None or (now - prior["at"] >= 60 and json.loads(unseal(prior["payload"])) != item):
                conn.execute(
                    "INSERT OR IGNORE INTO network_client_history VALUES(?,?,?,?,?)",
                    (console, site, mac, now, seal(json.dumps(item))),
                )
        conn.execute("DELETE FROM network_client_history WHERE at<?", (time.time() - RETENTION,))
        conn.execute(
            "DELETE FROM network_client_history WHERE rowid IN (SELECT rowid FROM network_client_history ORDER BY at DESC LIMIT -1 OFFSET 50000)"
        )


async def check_scope(console, site):
    from speck.unifi_observability import cloud_sites

    if not any(s.get("hostId") == console and s.get("siteId") == site for s in await cloud_sites()):
        raise HTTPException(404, "Site is not in the connected UniFi account")


@router.get("/equipment/index")
async def equipment_index(user=Depends(require_user)):
    from speck.unifi_observability import cloud_sites

    allowed = {(s.get("hostId"), s.get("siteId")) for s in await cloud_sites()}
    with db() as conn:
        return [
            json.loads(unseal(r["payload"]))
            | {"console_id": r["console_id"], "site_id": r["site_id"], "observed_at": r["seen"]}
            for r in conn.execute(
                "SELECT * FROM network_equipment_index WHERE seen>? ORDER BY seen DESC LIMIT 5000",
                (time.time() - RETENTION,),
            )
            if (r["console_id"], r["site_id"]) in allowed
        ]


@router.get("/sites/{console_id}/{site_id}/devices/{device_id}/history")
async def history(
    console_id: str,
    site_id: str,
    device_id: str,
    hours: int = Query(default=24, ge=1, le=168),
    user=Depends(require_user),
):
    await check_scope(console_id, site_id)
    with db() as conn:
        rows = conn.execute(
            "SELECT at,payload FROM network_samples WHERE console_id=? AND site_id=? AND device_id=? AND at>? ORDER BY at",
            (console_id, site_id, device_id, time.time() - hours * 3600),
        ).fetchall()
        policy = conn.execute(
            "SELECT enabled,last_attempt,last_error FROM network_collection WHERE console_id=? AND site_id=? AND device_id=?",
            (console_id, site_id, device_id),
        ).fetchone()
    return {
        "samples": [{"at": r["at"], **json.loads(unseal(r["payload"]))} for r in rows],
        "collection": dict(policy) if policy else {"enabled": False},
        "interval": INTERVAL,
        "retention_days": 7,
        "note": "Snapshots observed while inspecting equipment or through enabled five-minute collection. Gaps and counter resets are not interpolated. Link changes are observed transitions, not a count of every physical flap.",
    }


class Collection(BaseModel):
    enabled: bool


@router.get("/sites/{console_id}/{site_id}/clients/{mac}/history")
async def client_history(console_id: str, site_id: str, mac: str, user=Depends(require_user)):
    await check_scope(console_id, site_id)
    with db() as conn:
        rows = conn.execute(
            "SELECT at,payload FROM network_client_history WHERE console_id=? AND site_id=? AND mac=? AND at>? ORDER BY at DESC LIMIT 100",
            (console_id, site_id, mac.lower(), time.time() - RETENTION),
        ).fetchall()
    return {
        "observations": [{"at": r["at"], **json.loads(unseal(r["payload"]))} for r in rows],
        "note": "Seven-day record of changes observed while inspecting or sampling adopted equipment. Observations are not a complete roaming log; transitions between reads may be missed.",
    }


@router.put("/sites/{console_id}/{site_id}/devices/{device_id}/history")
async def configure(console_id: str, site_id: str, device_id: str, body: Collection, user=Depends(require_admin)):
    from speck.network_equipment import inspect

    # Exact site/device validation; a setting must not enroll an arbitrary URL.
    if body.enabled:
        await inspect(console_id, site_id, device_id)
    else:
        await check_scope(console_id, site_id)
    with db(write=True) as conn:
        if (
            body.enabled
            and conn.execute(
                "SELECT count(*) FROM network_collection WHERE enabled=1 AND NOT(console_id=? AND site_id=? AND device_id=?)",
                (console_id, site_id, device_id),
            ).fetchone()[0]
            >= 20
        ):
            raise HTTPException(409, "History collection is limited to 20 devices. Pause another collection first.")
        conn.execute(
            "INSERT INTO network_collection(console_id,site_id,device_id,enabled) VALUES(?,?,?,?) ON CONFLICT(console_id,site_id,device_id) DO UPDATE SET enabled=excluded.enabled,last_error=NULL",
            (console_id, site_id, device_id, body.enabled),
        )
        audit(
            conn,
            user["username"],
            "network.history.configured",
            detail={"console_id": console_id, "site_id": site_id, "device_id": device_id, "enabled": body.enabled},
        )
    return {"enabled": body.enabled, "interval": INTERVAL, "retention_days": 7}


def prune_history():
    # Expire observations even when every collection is paused.
    with db(write=True) as conn:
        cutoff = time.time() - RETENTION
        for table, column in (
            ("network_samples", "at"),
            ("network_client_history", "at"),
            ("network_equipment_index", "seen"),
        ):
            conn.execute(f"DELETE FROM {table} WHERE {column}<?", (cutoff,))


async def collect_due():
    from speck.network_equipment import inspect

    prune_history()
    with db() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM network_collection WHERE enabled=1 AND coalesce(last_attempt,0)<? ORDER BY coalesce(last_attempt,0) LIMIT 20",
                (time.time() - INTERVAL,),
            )
        ]
    for row in rows:
        key = (row["console_id"], row["site_id"], row["device_id"])
        with db(write=True) as conn:
            claimed = conn.execute(
                "UPDATE network_collection SET last_attempt=? WHERE console_id=? AND site_id=? AND device_id=? AND enabled=1 AND coalesce(last_attempt,0)<?",
                (time.time(), *key, time.time() - INTERVAL),
            ).rowcount
        if not claimed:
            continue
        error = None
        try:
            await asyncio.wait_for(inspect(*key), 90)
        except Exception:
            error = "Collection failed. Inspect connection health and read permissions."
        with db(write=True) as conn:
            conn.execute(
                "UPDATE network_collection SET last_error=? WHERE console_id=? AND site_id=? AND device_id=?",
                (error, *key),
            )


async def worker():
    while True:
        await asyncio.sleep(30)
        try:
            await collect_due()
        except Exception:
            logging.getLogger(__name__).exception("Network history collection cycle failed")
