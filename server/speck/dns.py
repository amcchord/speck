"""GoDaddy domains and DNS records (formerly AustinLand's /api/dns).

GoDaddy allows about 60 requests per minute, so every call passes one shared
token bucket. Domains and zone records are cached durably; the cache powers
IP→domain connections, cross-references and search without refetching ~270
zones. ``POST /api/dns/scan`` refreshes stale zones slowly in the background.
Record writes require an administrator and update the cache immediately.
"""

import asyncio
import ipaddress
import json
import re
import time
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from speck.db import audit, db
from speck.security import require_admin, require_user
from speck.vault import require_provider

router = APIRouter(prefix="/api/dns")
BASE = "https://api.godaddy.com/v1"
DOMAIN = re.compile(r"(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}")
RECORD_NAME = re.compile(r"@|\*|(\*\.)?[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,251}[A-Za-z0-9_])?")
TYPES = ("A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA")
SCAN = {"running": False, "done": 0, "total": 0, "errors": 0, "started_at": None, "finished_at": None, "stale_hours": None}


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS dns_domains(domain TEXT PRIMARY KEY,data TEXT NOT NULL,fetched REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS dns_zones(domain TEXT PRIMARY KEY,records TEXT NOT NULL,fetched REAL NOT NULL);
    """)


class Bucket:
    """Token bucket shared by interactive calls and the background scan."""

    def __init__(self, per_minute=55, capacity=15):
        self.rate, self.capacity = per_minute / 60, capacity
        self.tokens, self.last = float(capacity), time.monotonic()

    async def take(self):
        while True:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                return
            await asyncio.sleep((1 - self.tokens) / self.rate)


bucket = Bucket()


def valid_domain(domain):
    domain = domain.strip().lower().rstrip(".")
    if not DOMAIN.fullmatch(domain):
        raise HTTPException(422, "Invalid domain name")
    return domain


def valid_name(name):
    name = name.strip()
    if not RECORD_NAME.fullmatch(name):
        raise HTTPException(422, "Record name must be @, * or a hostname label")
    return name


def valid_type(rtype):
    rtype = rtype.strip().upper()
    if rtype not in TYPES:
        raise HTTPException(422, "Record type must be one of " + ", ".join(TYPES))
    return rtype


async def godaddy(method, path, body=None, params=None):
    creds = require_provider("godaddy")
    headers = {
        "Authorization": "sso-key " + creds["GODADDY_API_KEY"] + ":" + creds["GODADDY_API_SECRET"],
        "Accept": "application/json",
    }
    for attempt in range(3):
        await bucket.take()
        try:
            async with httpx.AsyncClient(timeout=45, follow_redirects=False, trust_env=False) as client:
                response = await client.request(method, BASE + path, headers=headers, json=body, params=params)
        except httpx.HTTPError:
            raise HTTPException(502, "GoDaddy is unreachable; a write may have completed. Check records before retrying.") from None
        if response.status_code == 429 and attempt < 2:
            await asyncio.sleep(min(30, float(response.headers.get("retry-after") or 5)))
            continue
        break
    if response.status_code >= 400:
        message = ""
        try:
            data = response.json()
            message = data.get("message") or ""
            fields = data.get("fields") or []
            if fields:
                message += " " + "; ".join(str(f.get("message", "")) for f in fields[:3])
        except (ValueError, AttributeError):
            pass
        raise HTTPException(
            502 if response.status_code >= 500 else response.status_code,
            f"GoDaddy returned HTTP {response.status_code}" + (": " + message.strip()[:400] if message.strip() else ""),
        )
    return response.json() if response.content else None


# ---------------- cache ----------------


def cached_domains():
    with db() as conn:
        rows = conn.execute("SELECT * FROM dns_domains ORDER BY domain").fetchall()
        zones = {r["domain"]: r for r in conn.execute("SELECT domain,fetched,records FROM dns_zones")}
    out = []
    for row in rows:
        item = json.loads(row["data"])
        zone = zones.get(row["domain"])
        records = json.loads(zone["records"]) if zone else None
        item["zone_cached_at"] = zone["fetched"] if zone else None
        item["record_count"] = len(records) if records is not None else None
        item["apex"] = [r.get("data") for r in records or [] if r.get("type") == "A" and r.get("name") == "@"]
        item["nameservers"] = [r.get("data") for r in records or [] if r.get("type") == "NS" and r.get("name") == "@"]
        out.append(item)
    return out, max((r["fetched"] for r in rows), default=None)


def cached_records(domain):
    with db() as conn:
        row = conn.execute("SELECT * FROM dns_zones WHERE domain=?", (domain,)).fetchone()
    return (json.loads(row["records"]), row["fetched"]) if row else (None, None)


def save_zone(conn, domain, records, fetched=None):
    conn.execute(
        "INSERT INTO dns_zones VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET records=excluded.records,fetched=excluded.fetched",
        (domain, json.dumps(records), fetched or time.time()),
    )


def all_zones():
    with db() as conn:
        return {r["domain"]: json.loads(r["records"]) for r in conn.execute("SELECT domain,records FROM dns_zones")}


def fqdn(domain, name):
    return domain if name == "@" else name + "." + domain


def connections_map():
    """IP → A/AAAA records pointing at it, across every cached zone."""
    out = {}
    zones = all_zones()
    for domain, records in sorted(zones.items()):
        for rec in records:
            if rec.get("type") in ("A", "AAAA") and rec.get("data"):
                out.setdefault(rec["data"], []).append(
                    {"domain": domain, "name": rec["name"], "fqdn": fqdn(domain, rec["name"]), "type": rec["type"]}
                )
    return out, len(zones)


async def fetch_domains():
    domains, marker = [], None
    while True:
        params = {"limit": 1000, "statuses": "ACTIVE"}
        if marker:
            params["marker"] = marker
        batch = await godaddy("GET", "/domains", params=params) or []
        domains.extend(batch)
        if len(batch) < 1000:
            break
        marker = batch[-1]["domain"]
    now = time.time()
    with db(write=True) as conn:
        conn.execute("DELETE FROM dns_domains")
        conn.executemany(
            "INSERT INTO dns_domains VALUES(?,?,?)", [(d["domain"].lower(), json.dumps(d), now) for d in domains]
        )
    return domains


async def fetch_zone(domain):
    records = await godaddy("GET", "/domains/" + quote(domain) + "/records") or []
    with db(write=True) as conn:
        save_zone(conn, domain, records)
    return records


def known_domain(domain):
    with db() as conn:
        return bool(conn.execute("SELECT 1 FROM dns_domains WHERE domain=?", (domain,)).fetchone())


# ---------------- reads ----------------


@router.get("/status")
def status(user=Depends(require_user)):
    from speck.vault import provider

    with db() as conn:
        domains = conn.execute("SELECT count(*),max(fetched) FROM dns_domains").fetchone()
        zones = conn.execute("SELECT count(*),min(fetched),max(fetched) FROM dns_zones").fetchone()
    return {
        "configured": bool(provider("godaddy")),
        "domains": domains[0],
        "domains_fetched_at": domains[1],
        "zones_cached": zones[0],
        "oldest_zone_at": zones[1],
        "newest_zone_at": zones[2],
        "scan": SCAN,
        "rate_limit": "GoDaddy allows about 60 requests per minute; Speck queues calls at 55 per minute.",
    }


@router.get("/domains")
async def list_domains(refresh: bool = False, q: str = "", user=Depends(require_user)):
    """All active domains from the cache (``?refresh=true`` refetches the list, one API call per 1000)."""
    domains, fetched = cached_domains()
    if refresh or not domains:
        await fetch_domains()
        domains, fetched = cached_domains()
    needle = q.strip().lower()
    if needle:
        domains = [d for d in domains if needle in d["domain"].lower()]
    return {"fetched_at": fetched, "domains": domains}


@router.get("/domains/{domain}/records")
async def records(domain: str, cached: bool = False, user=Depends(require_user)):
    """Zone records. Fetches live and refreshes the cache unless ``?cached=true`` and a copy exists."""
    domain = valid_domain(domain)
    if cached:
        items, fetched = cached_records(domain)
        if items is not None:
            return {"domain": domain, "fetched_at": fetched, "cached": True, "records": items}
    items = await fetch_zone(domain)
    return {"domain": domain, "fetched_at": time.time(), "cached": False, "records": items}


@router.get("/connections")
def connections(user=Depends(require_user)):
    """Map of IP → DNS names pointing at it, from cached zones."""
    items, count = connections_map()
    return {"connections": items, "domains_cached": count}


async def ip_targets():
    """Public IPs Speck knows: Linode instances and UniFi public-IP mappings."""
    from speck import infrastructure as infra

    targets = {}
    with db() as conn:
        linodes = [r["id"] for r in conn.execute("SELECT id FROM infrastructure_connections WHERE provider='linode'")]
        exposures = conn.execute("SELECT * FROM unifi_exposures").fetchall()
    for connection_id in linodes:
        try:
            cfg = infra.get_connection(connection_id)
            for row in await infra.raw_inventory(cfg):
                for ip in row.get("ipv4", []):
                    targets[ip] = {"label": row["label"], "provider": "linode", "connection_id": connection_id, "id": str(row["id"])}
        except HTTPException:
            continue
    for row in exposures:
        targets[row["public_ip"]] = {"label": row["name"], "provider": "unifi", "lan_ip": row["lan_ip"]}
    return targets


@router.get("/linked")
async def linked(user=Depends(require_user)):
    """Cached DNS names that point at Linode instances or NAT'd public IPs."""
    targets = await ip_targets()
    items, count = connections_map()
    links = []
    for ip, names in items.items():
        target = targets.get(ip)
        if target:
            for name in names:
                links.append(name | {"ip": ip, "vm": target["label"], "target": target})
    links.sort(key=lambda link: (link["domain"], link["name"]))
    return {"links": links, "domains_scanned": count}


@router.get("/search")
def search(q: str, limit: int = 200, user=Depends(require_user)):
    """Find cached records by hostname, value or IP (e.g. ``q=97.107.140.55`` or ``q=mail``)."""
    needle = q.strip().lower()
    if len(needle) < 2:
        raise HTTPException(422, "Search for at least two characters")
    results = []
    for domain, zone in sorted(all_zones().items()):
        for rec in zone:
            name = fqdn(domain, rec.get("name", ""))
            if needle in name.lower() or needle in str(rec.get("data", "")).lower():
                results.append({"domain": domain, "fqdn": name} | rec)
                if len(results) >= min(limit, 1000):
                    return {"results": results, "truncated": True}
    return {"results": results, "truncated": False}


# ---------------- writes ----------------


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str = Field(max_length=8)
    name: str = Field(max_length=253)
    data: str = Field(min_length=1, max_length=4096)
    ttl: int = Field(default=600, ge=600, le=604800)
    priority: int | None = Field(default=None, ge=0, le=65535)

    @field_validator("type")
    @classmethod
    def known_type(cls, value):
        value = value.strip().upper()
        if value not in TYPES:
            raise ValueError("Unsupported record type")
        return value


def payload(rec, with_identity=False):
    item = {"data": rec.data, "ttl": rec.ttl}
    if rec.type in ("MX", "SRV"):
        item["priority"] = 10 if rec.priority is None else rec.priority
    if rec.type == "A":
        ip(rec.data, 4)
    if rec.type == "AAAA":
        ip(rec.data, 6)
    if with_identity:
        item |= {"type": rec.type, "name": valid_name(rec.name)}
    return item


def ip(value, version=4):
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError:
        raise HTTPException(422, f"Not an IPv{version} address") from None
    if address.version != version:
        raise HTTPException(422, f"Not an IPv{version} address")
    return str(address)


def write_audit(user, action, domain, **detail):
    with db(write=True) as conn:
        audit(conn, user["username"], "dns." + action, detail={"domain": domain} | detail)


async def refreshed(domain):
    """Re-read the zone after a write so callers see GoDaddy's stored result."""
    try:
        return await fetch_zone(domain)
    except HTTPException:
        return None


@router.post("/domains/{domain}/records")
async def add_record(domain: str, rec: Record, user=Depends(require_admin)):
    """Append a record, keeping existing records with the same type and name."""
    domain = valid_domain(domain)
    await godaddy("PATCH", "/domains/" + quote(domain) + "/records", [payload(rec, True)])
    write_audit(user, "record.added", domain, type=rec.type, name=rec.name, data=rec.data[:200])
    return {"ok": True, "records": await refreshed(domain)}


class RecordSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    records: list[Record] = Field(min_length=1, max_length=100)


@router.put("/domains/{domain}/records/{rtype}/{name}")
async def replace_set(domain: str, rtype: str, name: str, body: RecordSet, user=Depends(require_admin)):
    """Replace every record of this type and name with the supplied set."""
    domain, rtype, name = valid_domain(domain), valid_type(rtype), valid_name(name)
    items = []
    for rec in body.records:
        rec.type = rtype
        items.append(payload(rec))
    await godaddy("PUT", f"/domains/{quote(domain)}/records/{rtype}/{quote(name, safe='')}", items)
    write_audit(user, "record.replaced", domain, type=rtype, name=name, values=[r["data"][:200] for r in items])
    return {"ok": True, "records": await refreshed(domain)}


@router.delete("/domains/{domain}/records/{rtype}/{name}")
async def delete_set(domain: str, rtype: str, name: str, user=Depends(require_admin)):
    domain, rtype, name = valid_domain(domain), valid_type(rtype), valid_name(name)
    await godaddy("DELETE", f"/domains/{quote(domain)}/records/{rtype}/{quote(name, safe='')}")
    write_audit(user, "record.deleted", domain, type=rtype, name=name)
    return {"ok": True, "records": await refreshed(domain)}


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="@", max_length=253)
    ip: str = Field(max_length=64)
    ttl: int = Field(default=600, ge=600, le=604800)


@router.post("/domains/{domain}/point")
async def point(domain: str, body: Point, user=Depends(require_admin)):
    """Create or replace the A record for ``name`` so it resolves to ``ip``."""
    domain, name, address = valid_domain(domain), valid_name(body.name), ip(body.ip, 4)
    await godaddy("PUT", f"/domains/{quote(domain)}/records/A/{quote(name, safe='')}", [{"data": address, "ttl": body.ttl}])
    write_audit(user, "pointed", domain, name=name, ip=address)
    return {"ok": True, "fqdn": fqdn(domain, name), "ip": address, "records": await refreshed(domain)}


class Disconnect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(max_length=253)
    name: str = Field(max_length=253)
    ip: str = Field(max_length=64)


@router.post("/disconnect")
async def disconnect(body: Disconnect, user=Depends(require_admin)):
    """Remove one A record value (name → ip), keeping any other values in the set."""
    domain, name, address = valid_domain(body.domain), valid_name(body.name), ip(body.ip, 4)
    current = await godaddy("GET", "/domains/" + quote(domain) + "/records") or []
    group = [r for r in current if r.get("type") == "A" and r.get("name") == name]
    if not any(r.get("data") == address for r in group):
        raise HTTPException(404, f"No A record {fqdn(domain, name)} → {address}")
    remaining = [{"data": r["data"], "ttl": r["ttl"]} for r in group if r.get("data") != address]
    path = f"/domains/{quote(domain)}/records/A/{quote(name, safe='')}"
    if remaining:
        await godaddy("PUT", path, remaining)
    else:
        await godaddy("DELETE", path)
    write_audit(user, "disconnected", domain, name=name, ip=address)
    return {"ok": True, "records": await refreshed(domain)}


# ---------------- background scan ----------------


async def run_scan(domains):
    try:
        for domain in domains:
            if not SCAN["running"]:
                break
            try:
                await fetch_zone(domain)
            except HTTPException:
                SCAN["errors"] += 1
            SCAN["done"] += 1
            # Leave headroom for interactive requests sharing the rate limit.
            await asyncio.sleep(0.4)
    finally:
        SCAN["running"] = False
        SCAN["finished_at"] = time.time()


class ScanBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stale_hours: float = Field(default=0, ge=0, le=8760)


@router.post("/scan")
async def scan(body: ScanBody | None = None, user=Depends(require_admin)):
    """Refresh cached zones in the background (all, or only those older than ``stale_hours``)."""
    if SCAN["running"]:
        return SCAN
    body = body or ScanBody()
    domains, _ = cached_domains()
    if not domains:
        await fetch_domains()
        domains, _ = cached_domains()
    cutoff = time.time() - body.stale_hours * 3600
    names = [
        d["domain"].lower()
        for d in domains
        if not body.stale_hours or not d["zone_cached_at"] or d["zone_cached_at"] < cutoff
    ]
    SCAN.update(running=True, done=0, total=len(names), errors=0, started_at=time.time(), finished_at=None,
                stale_hours=body.stale_hours)
    asyncio.get_running_loop().create_task(run_scan(names))
    with db(write=True) as conn:
        audit(conn, user["username"], "dns.scan.started", detail={"zones": len(names)})
    return SCAN


@router.delete("/scan")
def stop_scan(user=Depends(require_admin)):
    SCAN["running"] = False
    return SCAN


@router.get("/scan")
def scan_status(user=Depends(require_user)):
    return SCAN


# ---------------- import ----------------


class CacheImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domains: list[dict] = Field(default_factory=list, max_length=5000)
    domains_fetched_at: float | None = None
    zones: dict[str, dict] = Field(default_factory=dict)


@router.post("/import")
def import_cache(body: CacheImport, user=Depends(require_admin)):
    """Seed the cache from an AustinLand export. Newer cached zones are kept."""
    imported_domains = imported_zones = 0
    with db(write=True) as conn:
        for item in body.domains:
            name = str(item.get("domain", "")).lower()
            if DOMAIN.fullmatch(name):
                imported_domains += conn.execute(
                    "INSERT INTO dns_domains VALUES(?,?,?) ON CONFLICT(domain) DO NOTHING",
                    (name, json.dumps(item), body.domains_fetched_at or time.time()),
                ).rowcount
        for name, zone in body.zones.items():
            name = name.lower()
            records = zone.get("records")
            fetched = float(zone.get("fetched_at") or 0) or time.time()
            if not DOMAIN.fullmatch(name) or not isinstance(records, list):
                continue
            existing = conn.execute("SELECT fetched FROM dns_zones WHERE domain=?", (name,)).fetchone()
            if existing and existing["fetched"] >= fetched:
                continue
            save_zone(conn, name, [r for r in records if isinstance(r, dict)], fetched)
            imported_zones += 1
        audit(conn, user["username"], "dns.imported", detail={"domains": imported_domains, "zones": imported_zones})
    return {"domains": imported_domains, "zones": imported_zones}
