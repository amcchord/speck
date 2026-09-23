"""Machine-centric inventory. Identity evidence joins records, never names or IPs."""

import asyncio
import copy
import hashlib
import json
import re
import time
from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator

from speck.config import seal, unseal
from speck.db import db
from speck.security import require_user
from speck import infrastructure as infra

router = APIRouter(prefix="/api/fleet")
COLUMNS = [
    "name",
    "status",
    "client",
    "agent",
    "location",
    "app",
    "cpu",
    "memory",
    "address",
    "provider",
    "kind",
    "site",
    "seen",
    "preview",
]
DEFAULT_VISIBLE = ["name", "status", "client", "agent", "location", "app", "cpu", "memory", "address"]


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS fleet_inventory_cache(
        connection_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, checked REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_preferences(
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL);
    """)


class Preferences(BaseModel):
    order: list[str] = Field(default_factory=lambda: COLUMNS.copy(), max_length=len(COLUMNS))
    visible: list[str] = Field(default_factory=lambda: DEFAULT_VISIBLE.copy(), max_length=len(COLUMNS))
    widths: dict[str, int] = Field(default_factory=dict)
    sort: str = "name"
    direction: str = "asc"
    highlight_agents: bool = False

    @model_validator(mode="after")
    def validate_columns(self):
        for values in (self.order, self.visible):
            if len(set(values)) != len(values) or set(values) - set(COLUMNS) or "name" not in values:
                raise ValueError("Choose unique known columns and keep Machine visible")
        if self.sort not in COLUMNS or self.direction not in ("asc", "desc"):
            raise ValueError("Invalid sort")
        if set(self.widths) - set(COLUMNS) or any(not 64 <= width <= 640 for width in self.widths.values()):
            raise ValueError("Column widths must be between 64 and 640 pixels")
        self.order += [key for key in COLUMNS if key not in self.order]
        return self


@router.get("/preferences")
def preferences(user=Depends(require_user)):
    with db() as conn:
        row = conn.execute("SELECT value FROM fleet_preferences WHERE user_id=?", (user["user_id"],)).fetchone()
    return Preferences.model_validate_json(row[0]).model_dump() if row else Preferences().model_dump()


@router.put("/preferences")
def save_preferences(body: Preferences, user=Depends(require_user)):
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO fleet_preferences VALUES(?,?)", (user["user_id"], body.model_dump_json()))
    return body.model_dump()


def mac(value):
    value = re.sub(r"[:-]", "", str(value).lower())
    return value if re.fullmatch(r"[a-f0-9]{12}", value) and value not in ("0" * 12, "f" * 12) else ""


def endpoint_macs(endpoint):
    return {
        m
        for interface in endpoint.get("telemetry", {}).get("network", {}).get("interfaces", [])
        if (m := mac(interface.get("mac", "")))
    }


def resource_key(row):
    # Slide IDs are scoped to the API origin, so overlapping account connections
    # describe one object. Proxmox VM IDs remain scoped to their configured cluster.
    scope = row.get("provider_origin", row["connection_id"]) if row["provider"] == "slide" else row["connection_id"]
    return f"{row['provider']}:{scope}:{row['kind']}:{row['id']}"


async def source_snapshot(cfg, force=False):
    fingerprint = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()
    with db() as conn:
        cached = conn.execute(
            "SELECT * FROM fleet_inventory_cache WHERE connection_id=? AND fingerprint=?", (cfg["id"], fingerprint)
        ).fetchone()
    if cached and not force and cached["checked"] > time.time() - 60:
        return json.loads(unseal(cached["payload"])) | {"checked_at": cached["checked"], "stale": False}
    try:
        async with asyncio.timeout(45):
            rows = infra.resources(cfg, await infra.raw_inventory(cfg))
        for row in rows:
            row["provider_origin"] = cfg.get("url", "")
        value = infra.public_connection(cfg) | {"resources": rows, "status": "connected"}
        checked = time.time()
        with db(write=True) as conn:
            # An edited or removed connection cannot reuse this fingerprint.
            conn.execute(
                "INSERT OR REPLACE INTO fleet_inventory_cache VALUES(?,?,?,?)",
                (cfg["id"], fingerprint, seal(json.dumps(value)), checked),
            )
        return value | {"checked_at": checked, "stale": False}
    except Exception:
        value = json.loads(unseal(cached["payload"])) if cached else infra.public_connection(cfg) | {"resources": []}
        return value | {
            "status": "unavailable",
            "stale": True,
            "checked_at": cached["checked"] if cached else None,
            "error": "Provider refresh unavailable; showing the last successful inventory."
            if cached
            else "Provider inventory unavailable.",
        }


def assemble(endpoints, groups):
    """Join only one-to-one evidence, rejecting chains that combine distinct VMs."""
    endpoints = copy.deepcopy(endpoints)
    records, endpoint_nodes, resource_nodes = {}, {}, {}
    for endpoint in endpoints:
        node = "endpoint:" + endpoint["id"]
        records[node] = {"endpoint": endpoint, "category": "endpoint", "macs": endpoint_macs(endpoint)}
        endpoint_nodes[endpoint["id"]] = node
    for group in groups:
        for value in group["resources"]:
            row = copy.deepcopy(value)
            row.update(stale=group.get("stale", False), checked_at=group.get("checked_at"))
            key = resource_key(row)
            if key in records:
                continue
            category = "proxmox" if row["provider"] == "proxmox" else row["kind"]
            records[key] = {
                "resource": row,
                "category": category,
                "macs": {m for v in row.get("identity", {}).get("macs", []) if (m := mac(v))},
            }
            resource_nodes[key] = row
    parents = {key: key for key in records}
    members = {key: {key} for key in records}
    evidence = defaultdict(set)
    issues = defaultdict(set)

    def root(key):
        while parents[key] != key:
            key = parents[key]
        return key

    def join(a, b, proof):
        ra, rb = root(a), root(b)
        if ra == rb:
            evidence[ra].add(proof)
            return
        combined = members[ra] | members[rb]
        # A bridge record can never make two different endpoint enrollments,
        # Proxmox resources, or Slide restores become the same machine.
        for category in ("endpoint", "proxmox", "virt"):
            if sum(records[x]["category"] == category for x in combined) > 1:
                issues[ra].add("Conflicting identity evidence")
                issues[rb].add("Conflicting identity evidence")
                return
        endpoint = next((records[x]["endpoint"] for x in combined if "endpoint" in records[x]), None)
        for x in combined:
            row = records[x].get("resource", {})
            uuid = row.get("identity", {}).get("uuid")
            if endpoint and uuid and row.get("provider") == "proxmox":
                hashes = {
                    hashlib.sha256((endpoint["platform"] + ":" + v).encode()).hexdigest()
                    for v in (uuid, uuid.lower(), uuid.upper())
                }
                if endpoint.get("hardware_id") and endpoint["hardware_id"] not in hashes:
                    issues[ra].add("MAC and hardware UUID disagree")
                    issues[rb].add("MAC and hardware UUID disagree")
                    return
        if any(records[x]["category"] == "virt" for x in combined) and any(
            records[x]["category"] == "protected" for x in combined
        ):
            issues[ra].add("Restore and protected source share an identity")
            issues[rb].add("Restore and protected source share an identity")
            return
        parents[rb] = ra
        members[ra] = combined
        evidence[ra] |= evidence[rb] | {proof}
        issues[ra] |= issues[rb]

    hardware = defaultdict(list)
    uuids = defaultdict(list)
    for endpoint in endpoints:
        if endpoint.get("hardware_id"):
            hardware[endpoint["hardware_id"]].append(endpoint_nodes[endpoint["id"]])
    for key, row in resource_nodes.items():
        uuid = row.get("identity", {}).get("uuid", "")
        if row["provider"] == "proxmox" and uuid:
            uuids[uuid.lower()].append(key)
    for uuid, keys in uuids.items():
        hashes = {
            hashlib.sha256((platform + ":" + value).encode()).hexdigest()
            for platform in ("windows", "linux")
            for value in (uuid, uuid.upper())
        }
        matches = {node for digest in hashes for node in hardware[digest]}
        if len(keys) == len(matches) == 1:
            join(keys[0], next(iter(matches)), "Hardware UUID")
        elif matches:
            for key in set(keys) | matches:
                issues[root(key)].add("Duplicate hardware UUID")
    slide_links = defaultdict(list)
    for endpoint in endpoints:
        if endpoint.get("slide_agent_id") and not endpoint.get("restored_from"):
            slide_links[endpoint["slide_agent_id"]].append(endpoint_nodes[endpoint["id"]])
    for key, row in resource_nodes.items():
        if row["kind"] == "protected":
            matches = slide_links[row["id"]]
            if len(matches) == 1:
                join(key, matches[0], "Slide agent ID")
            elif matches:
                issues[root(key)].add("Duplicate Slide agent association")
    by_mac = defaultdict(lambda: defaultdict(set))
    for key, record in records.items():
        if record.get("resource", {}).get("kind") == "node":
            continue
        for address in record["macs"]:
            by_mac[address][record["category"]].add(key)
    for categories in by_mac.values():
        # Reused MACs within a provider family are ambiguous, including cloned VMs.
        if any(len(keys) > 1 for keys in categories.values()):
            continue
        keys = [next(iter(values)) for values in categories.values()]
        for key in keys[1:]:
            join(keys[0], key, "Unique hardware MAC")

    machines = []
    for key in records:
        if root(key) != key:
            continue
        group = [records[x] for x in sorted(members[key])]
        endpoint = next((r["endpoint"] for r in group if "endpoint" in r), None)
        resources = [r["resource"] for r in group if "resource" in r]
        resources.sort(
            key=lambda r: (
                {"qemu": 0, "lxc": 0, "virt": 1, "instance": 2, "node": 3, "box": 4, "protected": 5}.get(r["kind"], 9),
                r["connection_id"],
            )
        )
        primary = resources[0] if resources else None
        host_agent = next((r for r in resources if r.get("management") == "host_agent"), None)
        clients = {c["key"]: c for r in resources if (c := r.get("client"))}
        client_values = sorted(clients.values(), key=lambda c: c["name"].casefold())
        label = endpoint["label"] if endpoint else primary["name"]
        online = (
            bool(endpoint and endpoint["online"])
            if endpoint
            else primary["status"] in ("online", "running", "active") and not primary["stale"]
        )
        machine = (
            endpoint
            or {
                "id": key,
                "label": label,
                "hostname": label,
                "platform": primary.get("platform", "unknown"),
                "telemetry": {},
                "tags": [],
                "approved": None,
                "site": "",
                "last_seen": primary.get("checked_at"),
                "online": online,
            }
        ).copy()
        state = primary["status"] if primary else "online" if online else "offline"
        if primary and primary["stale"]:
            state = "unknown"
        machine.update(
            endpoint_id=endpoint["id"] if endpoint else None,
            has_endpoint_agent=bool(endpoint),
            has_speck_agent=bool(endpoint or host_agent),
            resources=resources,
            resource=primary,
            clients=client_values,
            client_name=client_values[0]["name"]
            if len(clients) == 1
            else "Multiple clients"
            if clients
            else "Unassigned",
            client_conflict=len(clients) > 1,
            identity_evidence=sorted(evidence[key]),
            identity_issues=sorted(issues[key]),
            location=" · ".join(filter(None, (primary.get("connection_name"), primary.get("node"))))
            if primary
            else endpoint.get("site", ""),
            provider=" · ".join(sorted({r["provider"] for r in resources})) or "Speck",
            kind=primary["kind"] if primary else "endpoint",
            state=state,
            agent_status=(
                "Endpoint agent " + ("online" if endpoint["online"] and not endpoint.get("revoked") else "offline")
            )
            if endpoint
            else ("Host agent " + ("online" if host_agent.get("connector_online") else "offline"))
            if host_agent
            else "No Speck agent",
            aliases=sorted({r["name"] for r in resources}),
            stale=any(r["stale"] for r in resources),
        )
        if not endpoint and primary:
            machine.update(
                cpu_percent=primary.get("cpu") * 100 if primary.get("cpu") is not None else None,
                memory_percent=100 * primary["memory"] / primary["max_memory"]
                if primary.get("memory") is not None and primary.get("max_memory")
                else None,
                addresses=primary.get("addresses", []),
            )
        machines.append(machine)
    return sorted(machines, key=lambda m: m["label"].casefold())


@router.get("")
async def inventory(refresh: bool = False, user=Depends(require_user)):
    from speck.main import devices

    cfgs = [infra.get_connection(c["id"]) for c in infra.connections(user) if c["provider"] != "austinland"]
    groups = await asyncio.gather(*(source_snapshot(cfg, refresh) for cfg in cfgs))
    infra.correlate_agents(groups)  # Includes specialized host-agent presence.
    return {
        "machines": assemble(devices(user=user), groups),
        "connections": [{k: v for k, v in g.items() if k != "resources"} for g in groups],
        "checked_at": time.time(),
    }
