"""Explicitly granted Proxmox inventory only; no provider operations or secrets."""

import asyncio
import hashlib
import json
import time

from speck.db import db
from speck.integrations import fields


async def topology_snapshot(token):
    from speck import infrastructure as infra
    from speck.fleet import source_snapshot

    grants = json.loads(token["topology_connections"])
    with db() as conn:
        ids = {r[0] for r in conn.execute("SELECT id FROM infrastructure_connections WHERE provider='proxmox'")}
        endpoints = [
            dict(r)
            for r in conn.execute(
                "SELECT id,hardware_id,slide_agent_id,site FROM devices WHERE archived=0",
            )
        ]
    endpoints_by_hardware = {}
    for endpoint in endpoints:
        endpoints_by_hardware.setdefault(endpoint["hardware_id"], []).append(endpoint)
    groups = await asyncio.gather(*(source_snapshot(infra.get_connection(cid)) for cid in grants if cid in ids))
    uuids = {}
    for group in groups:
        for row in group["resources"]:
            uuid = row.get("identity", {}).get("uuid", "").lower()
            if uuid:
                uuids[uuid] = uuids.get(uuid, 0) + 1
    result = []
    remaining = 5000
    for group in groups:
        resources = []
        for row in group["resources"][:10000]:
            obj = fields(row, ("id", "kind", "name", "status", "node", "template", "max_memory", "max_disk"))
            obj["identity"] = fields(row.get("identity", {}), ("uuid", "macs"))
            uuid = obj["identity"].get("uuid", "")
            hashes = (
                {
                    hashlib.sha256((p + ":" + v).encode()).hexdigest()
                    for p in ("linux", "windows")
                    for v in (uuid, uuid.lower(), uuid.upper())
                }
                if uuid
                else set()
            )
            matches = [d for h in hashes for d in endpoints_by_hardware.get(h, [])]
            if (
                len(matches) == 1
                and uuids.get(uuid.lower()) == 1
                and (token["site"] == "*" or matches[0]["site"] == token["site"])
            ):
                obj["endpoint"] = fields(matches[0], ("id", "slide_agent_id", "site")) | {"match": "hardware_uuid"}
            resources.append(obj)
        if token["site"] != "*":
            # Shared hypervisors must not disclose unrelated clients' guests.
            guests = [r for r in resources if r.get("endpoint") and r["kind"] in ("qemu", "lxc")]
            parent_nodes = {r["node"] for r in guests}
            resources = guests + [r for r in resources if r["kind"] == "node" and r["id"] in parent_nodes]
        eligible_count = len(resources)
        resources = resources[:remaining]
        remaining -= len(resources)
        result.append(
            fields(group, ("id", "name", "status", "stale", "checked_at", "error"))
            | {
                "resources": resources,
                "truncated": len(resources) < eligible_count or len(group["resources"]) > 10000,
            }
        )
    return {
        "site": token["site"],
        "scope": "topology:read",
        "visibility": "all_granted_resources" if token["site"] == "*" else "site_matched_guests_and_parent_hosts",
        "connections": result,
        "enabled": bool(grants),
        "checked_at": time.time(),
        "unavailable_connections": len(set(grants) - ids),
        "note": "Only explicitly granted Proxmox connections. Placement is reported by Proxmox; endpoint matches use globally unique hardware UUIDs. Named sites return only matched guests and their parent hosts; unassigned and unmatched guests are omitted. All-sites tokens include every granted resource. No backup health is implied. Check per-connection checked_at and stale. No commands or guest scans are triggered.",
    }
