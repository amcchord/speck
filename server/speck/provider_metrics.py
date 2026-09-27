"""Provider-native history; missing readings are gaps, never fabricated zeroes."""

import math
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from speck.security import require_user

router = APIRouter(prefix="/api/infrastructure")


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def linode_series(payload, since=0):
    data = payload.get("data") or payload
    result = []
    for key, label, unit, readings in [
        ("cpu", "CPU utilization", "%", data.get("cpu", [])),
        ("netin", "IPv4 received", "bit/s", (data.get("netv4") or {}).get("in", [])),
        ("netout", "IPv4 sent", "bit/s", (data.get("netv4") or {}).get("out", [])),
        ("net6in", "IPv6 received", "bit/s", (data.get("netv6") or {}).get("in", [])),
        ("net6out", "IPv6 sent", "bit/s", (data.get("netv6") or {}).get("out", [])),
        ("disk", "Disk I/O", "blocks/s", (data.get("io") or {}).get("io", [])),
        ("swap", "Swap I/O", "blocks/s", (data.get("io") or {}).get("swap", [])),
    ]:
        points = []
        for pair in readings if isinstance(readings, list) else []:
            if not isinstance(pair, list) or len(pair) != 2 or not finite(pair[0]):
                continue
            stamp = pair[0] / 1000  # Linode graph timestamps are milliseconds.
            if stamp >= since:
                points.append([stamp, pair[1] if finite(pair[1]) else None])
        result.append({"key": key, "label": label, "unit": unit, "points": sorted(points)})
    return result


def proxmox_series(rows):
    result = []
    for key, label, unit, scale in [
        ("cpu", "CPU utilization", "%", 100),
        ("mem", "Memory used", "bytes", 1),
        ("netin", "Network received", "bytes/s", 1),
        ("netout", "Network sent", "bytes/s", 1),
        ("diskread", "Disk read", "bytes/s", 1),
        ("diskwrite", "Disk written", "bytes/s", 1),
        ("iowait", "I/O wait", "%", 100),
    ]:
        points = [
            [r["time"], (r.get(key, r.get("memused") if key == "mem" else None) * scale) if finite(r.get(key, r.get("memused") if key == "mem" else None)) else None]
            for r in rows
            if isinstance(r, dict) and finite(r.get("time"))
        ]
        result.append({"key": key, "label": label, "unit": unit, "points": sorted(points)})
    return result


@router.get("/connections/{connection_id}/resources/{kind}/{rid}/metrics")
async def metrics(
    connection_id: str,
    kind: str,
    rid: str,
    timeframe: Literal["hour", "day", "week", "month"] = "day",
    user=Depends(require_user),
):
    from speck.infrastructure import get_connection, resolve, provider_request, pve_path, segment

    cfg = get_connection(connection_id)
    row = await resolve(cfg, kind, rid)
    if cfg["provider"] == "linode" and kind == "instance":
        if timeframe not in ("hour", "day"):
            raise HTTPException(422, "Linode history supports the last hour or 24 hours")
        payload = await provider_request(cfg, "GET", "/linode/instances/" + segment(rid) + "/stats")
        series = linode_series(payload, time.time() - (3600 if timeframe == "hour" else 86400))
        note = "Linode provider readings. Guest memory, services and processes require a Speck agent."
    elif cfg["provider"] == "proxmox" and kind in ("node", "qemu", "lxc"):
        payload = await provider_request(cfg, "GET", pve_path(row) + "/rrddata", params={"timeframe": timeframe})
        series = proxmox_series(payload)
        note = "Proxmox RRD averages. Gaps indicate readings the provider did not report."
    else:
        raise HTTPException(404, "Performance history is not available for this resource")
    return {
        "provider": cfg["provider"],
        "timeframe": timeframe,
        "checked_at": time.time(),
        "note": note,
        "series": series,
    }
