"""Exact-site network exploration and reviewed, at-most-once UniFi operations."""

import asyncio
import hashlib
import json
import math
import time
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from speck import unifi, unifi_observability as observations
from speck.db import audit, db, ident
from speck.security import require_admin, require_user

router = APIRouter(prefix="/api/unifi")


def migrate(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS network_operations(
      id TEXT PRIMARY KEY,actor TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,
      console_id TEXT NOT NULL,site_id TEXT NOT NULL,device_id TEXT NOT NULL,
      operation TEXT NOT NULL,port INTEGER,target TEXT NOT NULL,fingerprint TEXT NOT NULL,
      review TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL)""")


async def scope(console_id, site_id):
    candidates = [
        s for s in await observations.cloud_sites() if s.get("hostId") == console_id and s.get("siteId") == site_id
    ]
    if len(candidates) != 1:
        raise HTTPException(404, "Site is not present in the connected UniFi account")
    base = unifi.CLOUD + "/connector/consoles/" + quote(console_id, safe="") + "/proxy/network"
    listing = await unifi.call("GET", base + "/integration/v1/sites", params={"limit": 200}) or {}
    short = (candidates[0].get("meta") or {}).get("name")
    matched = [s for s in listing.get("data", []) if short and s.get("internalReference") == short]
    if len(matched) != 1:
        raise HTTPException(409, "The Network application did not return this site's exact reference")
    return base, "/integration/v1/sites/" + quote(matched[0]["id"], safe=""), short


async def pages(base, path):
    rows = []
    while len(rows) < 5000:
        result = await unifi.call("GET", base + path, params={"limit": 200, "offset": len(rows)}) or {}
        batch = result.get("data") or []
        rows.extend(batch)
        if not batch or len(rows) >= result.get("totalCount", len(rows)):
            return rows, False
    return rows, True


async def optional(base, path):
    try:
        return await asyncio.wait_for(unifi.call("GET", base + path), 20)
    except (HTTPException, TimeoutError):
        return None


def pick(row, keys):
    return {k: row[k] for k in keys.split() if k in row}


def summary(row):
    return pick(
        row, "id name model macAddress ipAddress state supported firmwareVersion firmwareUpdatable features interfaces"
    )


def legacy_map(rows):
    return {str(r.get("mac", "")).lower(): r for r in rows or []}


async def inventory(console_id, site_id):
    base, path, short = await scope(console_id, site_id)
    rows, truncated = await pages(base, path + "/devices")
    from speck.network_history import index_equipment
    index_equipment(console_id, site_id, rows)
    return {"devices": [summary(r) for r in rows], "truncated": truncated, "checked_at": time.time()}


@router.get("/sites/{console_id}/{site_id}/devices")
async def devices(console_id: str, site_id: str, user=Depends(require_user)):
    return await observations.cached("equipment:" + console_id + ":" + site_id, lambda: inventory(console_id, site_id))


async def inspect(console_id, site_id, device_id):
    base, path, short = await scope(console_id, site_id)
    rows, truncated = await pages(base, path + "/devices")
    if sum(r.get("id") == device_id for r in rows) != 1:
        raise HTTPException(404, "Device is not present in this site's inventory")
    device_path = path + "/devices/" + quote(device_id, safe="")
    detail, stats, legacy, clients_result = await asyncio.gather(
        unifi.call("GET", base + device_path),
        optional(base, device_path + "/statistics/latest"),
        optional(base, "/api/s/" + quote(short, safe="") + "/stat/device"),
        optional(base, "/api/s/" + quote(short, safe="") + "/stat/sta"),
    )
    if detail.get("id") != device_id:
        raise HTTPException(502, "The provider returned a different device identity")
    legacy_by_mac = legacy_map((legacy or {}).get("data"))
    by_mac = {str(r.get("macAddress", "")).lower(): r for r in rows}
    lookup = {key: r for r in rows for key in (r["id"], str(r.get("macAddress", "")).lower()) if key}
    this_legacy = legacy_by_mac.get(str(detail.get("macAddress", "")).lower(), {})
    # Project telemetry only. Legacy device documents can contain management credentials.
    safe = pick(
        detail,
        "id name model macAddress ipAddress state supported firmwareVersion firmwareUpdatable adoptedAt provisionedAt configurationId uplink features interfaces",
    )
    ports = (safe.get("interfaces") or {}).get("ports") or []
    legacy_ports = {p.get("port_idx"): p for p in this_legacy.get("port_table", [])}
    for port in ports:
        source = legacy_ports.get(port.get("idx"), {})
        port["observation"] = pick(
            source,
            "name poe_power poe_voltage poe_current rx_bytes tx_bytes rx_errors tx_errors rx_dropped tx_dropped full_duplex is_uplink satisfaction stp_state",
        )
        for field in ("poe_power", "poe_voltage", "poe_current"):
            value = port["observation"].get(field)
            if isinstance(value, str):
                try:
                    parsed = float(value)
                    port["observation"][field] = parsed if math.isfinite(parsed) else None
                except ValueError:
                    port["observation"][field] = None
    normalized = []
    for c in (clients_result or {}).get("data", []):
        n = observations.normalize_client({}, c, lookup)
        n.update(console_id=console_id, site_id=site_id, is_managed_gateway=False)
        normalized.append(n)
    topology = []
    for row in rows:
        observed = legacy_by_mac.get(str(row.get("macAddress", "")).lower(), {})
        uplink = observed.get("uplink") or {}
        parent = by_mac.get(str(uplink.get("uplink_mac", "")).lower(), {})
        topology.append(summary(row) | {"parent_id": parent.get("id"), "parent_port": uplink.get("uplink_remote_port")})
    children = [r for r in topology if r["parent_id"] == device_id and r["id"] != device_id]
    descendants, frontier = set(), {device_id}
    while frontier:
        found = {r["id"] for r in topology if r["parent_id"] in frontier} - descendants - {device_id}
        descendants |= found
        frontier = found
    attached = [c for c in normalized if c.get("uplink_id") == device_id]
    downstream = [c for c in normalized if c.get("uplink_id") in descendants]
    upstream_id = (safe.get("uplink") or {}).get("deviceId")
    upstream = next((r for r in topology if r["id"] == upstream_id), None)
    result = {
        "power_budget": this_legacy.get("total_max_power"),
        "site": {"console_id": console_id, "id": site_id, "reference": short},
        "device": safe,
        "statistics": stats,
        "ports": ports,
        "clients": attached,
        "children": children,
        "downstream_clients": downstream,
        "descendants": [r for r in topology if r["id"] in descendants],
        "upstream": upstream,
        "upstream_port": (this_legacy.get("uplink") or {}).get("uplink_remote_port"),
        "observations_available": isinstance((legacy or {}).get("data"), list) and bool(this_legacy),
        "clients_available": isinstance((clients_result or {}).get("data"), list),
        "truncated": truncated,
        "checked_at": time.time(),
    }

    from speck.network_history import record
    record(result)
    return result


@router.get("/sites/{console_id}/{site_id}/devices/{device_id}")
async def device(console_id: str, site_id: str, device_id: str, user=Depends(require_user)):
    return await observations.cached(
        "equipment:" + console_id + ":" + site_id + ":" + device_id,
        lambda: inspect(console_id, site_id, device_id),
        age=20,
    )


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["POWER_CYCLE", "RESTART"]
    port: int | None = Field(default=None, ge=1, le=65535)


class Confirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: str = Field(max_length=256)


def impact(detail, operation, port):
    d = detail["device"]
    if d.get("state") != "ONLINE" or d.get("supported") is not True:
        raise HTTPException(409, "This operation requires an online, supported device")
    if detail["truncated"] or not detail["clients_available"] or not detail["observations_available"]:
        raise HTTPException(409, "Connection evidence is unavailable. Reload before reviewing a disruptive action.")
    selected = None
    if operation == "POWER_CYCLE":
        selected = next((p for p in detail["ports"] if p.get("idx") == port), None)
        poe = (selected or {}).get("poe") or {}
        if not selected or poe.get("enabled") is not True or poe.get("state") != "UP":
            raise HTTPException(409, "This port is not reported as supplying PoE power")
    elif port is not None:
        raise HTTPException(422, "Device restart does not accept a port")
    children = detail["children"] if port is None else [r for r in detail["children"] if r.get("parent_port") == port]
    affected = {r["id"] for r in children}
    while True:
        found = {r["id"] for r in detail["descendants"] if r["parent_id"] in affected} - affected
        if not found:
            break
        affected |= found
    clients = [c for c in detail["clients"] if port is None or c.get("port") == port]
    clients += [c for c in detail["downstream_clients"] if port is None or c.get("uplink_id") in affected]
    clients = [c for c in clients if c.get("state") == "online"]
    data = {
        "target": d.get("name") or d["id"],
        "operation": operation,
        "port": port,
        "site": detail["site"],
        "model": d.get("model"),
        "mac": d.get("macAddress"),
        "clients": [pick(c, "name mac ip uplink_name port") for c in clients],
        "devices": [pick(r, "id name model state") for r in detail["descendants"] if r["id"] in affected],
        "warning": "Known connections only. Unmanaged equipment and clients missing from provider observations may also lose connectivity.",
    }
    # Traffic counters change continuously and must not invalidate a review.
    stable = {
        "device": pick(d, "id name macAddress configurationId state supported"),
        "port": pick(selected or {}, "idx state poe"),
        "clients": sorted(c["mac"] for c in clients),
        "devices": sorted(affected),
    }
    fingerprint = hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()
    return data, fingerprint


@router.post("/sites/{console_id}/{site_id}/devices/{device_id}/review")
async def review(console_id: str, site_id: str, device_id: str, body: Review, user=Depends(require_admin)):
    detail = await inspect(console_id, site_id, device_id)  # Always fresh, independent of UI caches.
    data, fingerprint = impact(detail, body.operation, body.port)
    request_id, now = ident(), time.time()
    with db(write=True) as conn:
        conn.execute("DELETE FROM network_operations WHERE status='review' AND created<?", (now - 3600,))
        conn.execute(
            "INSERT INTO network_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                request_id,
                user["username"],
                now,
                now,
                console_id,
                site_id,
                device_id,
                body.operation,
                body.port,
                data["target"],
                fingerprint,
                json.dumps(data),
                "review",
                "{}",
            ),
        )
    return data | {"id": request_id, "expires_at": now + 120}


def receipt(row):
    return {
        k: row[k]
        for k in (
            "id",
            "actor",
            "created",
            "updated",
            "console_id",
            "site_id",
            "device_id",
            "operation",
            "port",
            "target",
            "status",
        )
    } | {"result": json.loads(row["result"])}


@router.post("/operations/{request_id}/execute")
async def execute(request_id: str, body: Confirm, user=Depends(require_admin)):
    with db() as conn:
        row = conn.execute("SELECT * FROM network_operations WHERE id=?", (request_id,)).fetchone()
    if not row or row["actor"] != user["username"]:
        raise HTTPException(404, "Review not found")
    if body.confirmation != row["target"]:
        raise HTTPException(422, "Type the exact device name to confirm")
    if row["status"] != "review":
        return receipt(row)
    if row["created"] < time.time() - 120:
        raise HTTPException(409, "Review expired. Review the current connections again.")
    detail = await inspect(row["console_id"], row["site_id"], row["device_id"])
    _, fingerprint = impact(detail, row["operation"], row["port"])
    if fingerprint != row["fingerprint"]:
        raise HTTPException(409, "Device configuration or connected equipment changed. Review the new impact.")
    base, path, _ = await scope(row["console_id"], row["site_id"])
    with db(write=True) as conn:
        claimed = conn.execute(
            "UPDATE network_operations SET status='pending',updated=? WHERE id=? AND status='review' AND created>?",
            (time.time(), request_id, time.time() - 120),
        ).rowcount
        if not claimed:
            return receipt(conn.execute("SELECT * FROM network_operations WHERE id=?", (request_id,)).fetchone())
        audit(
            conn,
            user["username"],
            "network.requested",
            detail={
                "id": request_id,
                "operation": row["operation"],
                "device_id": row["device_id"],
                "port": row["port"],
            },
        )
    path += "/devices/" + quote(row["device_id"], safe="")
    if row["port"] is not None:
        path += "/interfaces/ports/" + str(row["port"])
    try:
        await unifi.call("POST", base + path + "/actions", {"action": row["operation"]})
        status, result = (
            "submitted",
            {"message": "UniFi accepted the request. Refresh device observations to check the outcome."},
        )
    except Exception:
        status, result = (
            "unknown",
            {
                "message": "The provider did not confirm the outcome. Inspect the device before starting another operation."
            },
        )
    unifi.forget_lookups()
    with db(write=True) as conn:
        conn.execute(
            "UPDATE network_operations SET status=?,result=?,updated=? WHERE id=?",
            (status, json.dumps(result), time.time(), request_id),
        )
        audit(
            conn,
            user["username"],
            "network." + status,
            detail={"id": request_id, "operation": row["operation"], "device_id": row["device_id"]},
        )
        return receipt(conn.execute("SELECT * FROM network_operations WHERE id=?", (request_id,)).fetchone())


@router.get("/operations")
def operations(user=Depends(require_user)):
    with db() as conn:
        return [
            receipt(r)
            for r in conn.execute(
                "SELECT * FROM network_operations WHERE status!='review' ORDER BY created DESC LIMIT 100"
            )
        ]
