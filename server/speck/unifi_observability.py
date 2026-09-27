"""Read-only, explicitly scoped UniFi sites and client observations."""

import asyncio
import math
import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from speck.security import require_user
from speck import unifi

router = APIRouter(prefix="/api/unifi")


def coordinate(value, limit):
    return (
        value
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and abs(value) <= limit
        else None
    )


async def cached(key, fetch, age=30):
    record = unifi._lookups.get(key)
    if record and record[0] > time.time() - age:
        return record[1]
    value = await fetch()
    unifi._lookups[key] = (time.time(), value)
    return value


async def cloud_sites():
    async def fetch():
        result, cursor = [], None
        for _ in range(20):
            data = (
                await unifi.call(
                    "GET", unifi.CLOUD + "/sites", params={"pageSize": 200, **({"nextToken": cursor} if cursor else {})}
                )
                or {}
            )
            result.extend(data.get("data") or [])
            cursor = data.get("nextToken")
            if not cursor:
                break
        return result

    return await cached("observed_sites", fetch)


async def site_inventory():
    hosts, sites = await asyncio.gather(unifi.hosts(), cloud_sites())
    by_host = {h["id"]: h for h in hosts}
    wanted = (unifi.provider("unifi") or {}).get("UNIFI_GATEWAY", "")
    rows = []
    for site in sites:
        host = by_host.get(site.get("hostId"), {})
        state, meta, stats = host.get("reportedState") or {}, site.get("meta") or {}, site.get("statistics") or {}
        location = state.get("location") or {}
        lat, lon = coordinate(location.get("lat"), 90), coordinate(location.get("long"), 180)
        rows.append(
            {
                "id": site["siteId"],
                "console_id": site["hostId"],
                "name": state.get("name") or meta.get("desc") or "UniFi site",
                "site_name": meta.get("desc") or meta.get("name"),
                "internal_reference": meta.get("name"),
                "state": state.get("state", "unknown"),
                "model": (state.get("hardware") or {}).get("name"),
                "version": state.get("version"),
                "ip": host.get("ipAddress"),
                "timezone": meta.get("timezone") or state.get("timezone"),
                "location": {
                    "latitude": lat,
                    "longitude": lon,
                    "label": location.get("text"),
                    "source": "UniFi console location",
                }
                if lat is not None and lon is not None
                else None,
                "counts": stats.get("counts") or {},
                "percentages": stats.get("percentages") or {},
                "isp": (stats.get("ispInfo") or {}).get("name"),
                "wans": [
                    {
                        "name": name,
                        "ip": wan.get("externalIp"),
                        "up": wan.get("portUp"),
                        "uptime": wan.get("wanUptime"),
                        "isp": (wan.get("ispInfo") or {}).get("name"),
                        "issues": len(wan.get("wanIssues") or []),
                    }
                    for name, wan in (stats.get("wans") or {}).items()
                ],
                "is_managed_gateway": bool(wanted)
                and (site["hostId"] == wanted or wanted in (state.get("ipAddrs") or [])),
            }
        )
    return {
        "sites": sorted(rows, key=lambda r: r["name"].casefold()),
        "checked_at": time.time(),
        "source": "UniFi Site Manager",
    }


@router.get("/sites")
async def sites(user=Depends(require_user)):
    return await cached("site_inventory", site_inventory)


def normalize_client(client, observation=None, devices=None):
    detail, devices = observation or {}, devices or {}
    seen = detail.get("last_seen")
    disconnected = detail.get("disconnect_timestamp")
    recent = (
        isinstance(seen, (int, float))
        and seen >= time.time() - 180
        and (not isinstance(disconnected, (int, float)) or seen > disconnected)
    )
    device = (
        devices.get(client.get("uplinkDeviceId")) or devices.get(detail.get("ap_mac") or detail.get("sw_mac")) or {}
    )
    return {
        "id": client.get("id"),
        "name": client.get("name") or detail.get("name") or detail.get("hostname") or "",
        "ip": client.get("ipAddress") or detail.get("ip") or "",
        "mac": (client.get("macAddress") or detail.get("mac") or "").lower(),
        "type": client.get("type")
        or (
            "WIRED" if detail.get("is_wired") is True else "WIRELESS" if detail.get("is_wired") is False else "UNKNOWN"
        ),
        "connected_at": client.get("connectedAt") or "",
        "state": "online" if recent else "last_seen" if seen else "unknown",
        "last_seen": seen,
        "network_name": detail.get("network") or detail.get("last_connection_network_name"),
        "vlan": detail.get("gw_vlan", detail.get("vlan")),
        "uplink_id": device.get("id") or client.get("uplinkDeviceId"),
        "uplink_name": device.get("name") or detail.get("last_uplink_name"),
        "uplink_model": device.get("model"),
        "port": detail.get("sw_port") or detail.get("last_uplink_remote_port"),
        "ssid": detail.get("essid"),
        "signal_dbm": detail.get("signal"),
        "channel": detail.get("channel"),
        "radio": detail.get("radio_proto"),
        "experience": detail.get("satisfaction"),
        "vendor": detail.get("oui"),
        "link_mbps": detail.get("wired_rate_mbps"),
        "received_bytes": detail.get("wired-rx_bytes", detail.get("rx_bytes")),
        "sent_bytes": detail.get("wired-tx_bytes", detail.get("tx_bytes")),
        "receive_rate": detail.get("wired-rx_bytes-r", detail.get("rx_bytes-r")),
        "send_rate": detail.get("wired-tx_bytes-r", detail.get("tx_bytes-r")),
        "access": (client.get("access") or {}).get("type"),
        "guest": detail.get("is_guest"),
        "observation_available": bool(observation),
        "checked_at": time.time(),
    }


async def observations(request, short, site_id):
    results = await asyncio.gather(
        request("/api/s/" + quote(short, safe="") + "/stat/sta"),
        request("/integration/v1/sites/" + quote(site_id, safe="") + "/devices", {"limit": 200}),
        return_exceptions=True,
    )
    active = results[0].get("data", []) if isinstance(results[0], dict) else []
    devices = results[1].get("data", []) if isinstance(results[1], dict) else []
    lookup = {}
    for device in devices:
        for key in (device.get("id"), device.get("macAddress")):
            if key:
                lookup[key] = device
    return {str(c.get("mac", "")).lower(): c for c in active}, lookup


async def enrich_managed_clients(clients):
    sid, short = await unifi.site()

    async def request(path, params=None):
        return await unifi.network("GET", path, params=params)

    observed, devices = await observations(request, short, sid)
    scope = {}
    try:
        host = await unifi.gateway()
        matches = [s for s in await cloud_sites() if s.get("hostId") == host["id"] and (s.get("meta") or {}).get("name") == short]
        if len(matches) == 1:
            scope = {"console_id": host["id"], "site_id": matches[0]["siteId"]}
    except HTTPException:
        pass  # Account discovery must not remove otherwise useful LAN observations.
    for client in clients:
        source = {
            "id": client["id"],
            "name": client["name"],
            "ipAddress": client["ip"],
            "macAddress": client["mac"],
            "type": client["type"],
            "connectedAt": client["connected_at"],
            "uplinkDeviceId": client.get("uplink_id"),
        }
        client.update(normalize_client(source, observed.get(client["mac"]), devices), is_managed_gateway=True, **scope)
    return clients


@router.get("/sites/{console_id}/{site_id}/clients")
async def site_clients(console_id: str, site_id: str, user=Depends(require_user)):
    # Resolve against the account inventory before constructing a proxy URL.
    selected = next(
        (s for s in await cloud_sites() if s.get("hostId") == console_id and s.get("siteId") == site_id), None
    )
    if not selected:
        raise HTTPException(404, "Site is not present in the connected UniFi account")
    base = unifi.CLOUD + "/connector/consoles/" + quote(console_id, safe="") + "/proxy/network"

    async def request(path, params=None):
        return await unifi.call("GET", base + path, params=params)

    async def fetch():
        listing = await request("/integration/v1/sites") or {}
        candidates = listing.get("data") or []
        selected_site = next(
            (s for s in candidates if s.get("internalReference") == (selected.get("meta") or {}).get("name")), None
        )
        if not selected_site:
            raise HTTPException(409, "The Network application did not return this site's exact reference")
        sid = selected_site["id"]
        observed_task = asyncio.create_task(
            observations(request, selected_site.get("internalReference") or "default", sid)
        )
        rows, offset = [], 0
        try:
            while offset < 5000:
                data = (
                    await request(
                        "/integration/v1/sites/" + quote(sid, safe="") + "/clients", {"limit": 200, "offset": offset}
                    )
                    or {}
                )
                batch = data.get("data") or []
                rows.extend(batch)
                offset += len(batch)
                if not batch or offset >= data.get("totalCount", 0):
                    break
            observed, devices = await observed_task
        finally:
            if not observed_task.done():
                observed_task.cancel()
                await asyncio.gather(observed_task, return_exceptions=True)
        wanted = (unifi.provider("unifi") or {}).get("UNIFI_GATEWAY", "")
        managed = bool(wanted) and any(
            h.get("id") == console_id
            and (console_id == wanted or wanted in (h.get("reportedState", {}).get("ipAddrs") or []))
            for h in await unifi.hosts()
        )
        return {
            "clients": [
                normalize_client(r, observed.get(str(r.get("macAddress", "")).lower()), devices)
                | {"console_id": console_id, "site_id": site_id, "is_managed_gateway": managed}
                for r in rows
            ],
            "checked_at": time.time(),
            "truncated": offset >= 5000,
        }

    return await cached("site_clients:" + console_id + ":" + site_id, fetch)
