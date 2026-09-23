"""UniFi gateway public IPs, NAT and LAN clients (formerly AustinLand's /api/unifi).

Speck reaches the gateway's local Network application through UniFi Site
Manager's cloud connector (``/v1/connector/consoles/{id}/proxy/network``), so
the control plane needs no LAN route, VPN or port forward. The Site Manager API
key must belong to an account that can administer the gateway's site.

Exposing a LAN host on a public IP creates two gateway rules, tracked together:
a port forward for all TCP/UDP ports except 500 and 4500 (reserved by the
gateway's IPsec VPN; port forwards auto-create their firewall allow rule) and a
v2 SNAT rule so the host's outbound traffic leaves from that IP. Only ``free``
addresses can be assigned; rules Speck did not create are never modified.
"""

import ipaddress
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from speck.db import audit, db
from speck.security import require_admin, require_user
from speck.vault import provider, require_provider

router = APIRouter(prefix="/api/unifi")
CLOUD = "https://api.ui.com/v1"
ALL_PORTS = "1-499,501-4499,4501-65535"
_lookups: dict = {}


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS unifi_exposures(
      public_ip TEXT PRIMARY KEY,lan_ip TEXT NOT NULL,name TEXT NOT NULL,portforward_id TEXT,snat_id TEXT,
      console_id TEXT,created REAL NOT NULL,created_by TEXT NOT NULL,origin TEXT NOT NULL DEFAULT 'speck');
    """)


def forget_lookups():
    _lookups.clear()


def is_public(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.version == 4 and address.is_global


def is_lan(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local


async def call(method, url, body=None, params=None):
    key = require_provider("unifi")["UNIFI_API_KEY"]
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False, trust_env=False) as client:
            response = await client.request(
                method, url, headers={"X-API-KEY": key, "Accept": "application/json"}, json=body, params=params
            )
    except httpx.HTTPError:
        raise HTTPException(502, "UniFi is unreachable; a write may have completed. Inspect the gateway before retrying.") from None
    if response.status_code >= 400:
        detail = ""
        try:
            data = response.json()
            detail = data.get("message") or (data.get("meta") or {}).get("msg") or ""
        except (ValueError, AttributeError):
            pass
        raise HTTPException(
            502 if response.status_code >= 500 else response.status_code,
            f"UniFi returned HTTP {response.status_code}" + (": " + str(detail)[:300] if detail else ""),
        )
    return response.json() if response.content else None


async def hosts():
    data = await call("GET", CLOUD + "/hosts", params={"pageSize": 200})
    return (data or {}).get("data", [])


async def gateway():
    """The Site Manager host for the configured gateway (matched by console ID or LAN IP)."""
    if "host" in _lookups and _lookups["expires"] > time.time():
        return _lookups["host"]
    wanted = (require_provider("unifi").get("UNIFI_GATEWAY") or "").strip()
    candidates = await hosts()
    match = None
    for host in candidates:
        reported = host.get("reportedState") or {}
        if wanted and (host.get("id") == wanted or wanted in (reported.get("ipAddrs") or [])):
            match = host
            break
    if match is None and not wanted:
        consoles = [h for h in candidates if (h.get("reportedState") or {}).get("ipAddrs")]
        match = consoles[0] if len(consoles) == 1 else None
    if match is None:
        raise HTTPException(
            409,
            "Set UNIFI_GATEWAY (the gateway's LAN IP or console ID) under Keys → Providers → UniFi"
            if not wanted
            else "No UniFi console reports " + wanted,
        )
    _lookups.update(host=match, expires=time.time() + 300)
    return match


async def network(method, path, body=None, params=None):
    """A request to the gateway's local Network application via the cloud connector."""
    host = await gateway()
    base = CLOUD + "/connector/consoles/" + host["id"] + "/proxy/network"
    return await call(method, base + path, body, params)


async def site():
    """(integration site UUID, v2 short site name)."""
    if "site" not in _lookups:
        data = await network("GET", "/integration/v1/sites")
        sites = (data or {}).get("data", [])
        if not sites:
            raise HTTPException(502, "The gateway reported no Network sites")
        _lookups["site"] = (sites[0]["id"], sites[0].get("internalReference") or "default")
    return _lookups["site"]


def exposures():
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM unifi_exposures ORDER BY public_ip")]


# ---------------- reads ----------------


@router.get("/status")
async def status(user=Depends(require_user)):
    creds = provider("unifi")
    out = {"configured": bool(creds and creds.get("UNIFI_API_KEY")), "gateway": (creds or {}).get("UNIFI_GATEWAY"),
           "transport": "UniFi Site Manager cloud connector", "reachable": False}
    if not out["configured"]:
        return out
    try:
        host = await gateway()
        reported = host.get("reportedState") or {}
        out["console"] = {"id": host["id"], "name": reported.get("name") or reported.get("hostname"),
                          "model": (reported.get("hardware") or {}).get("name"), "version": reported.get("version")}
        info = await network("GET", "/integration/v1/info")
        out["reachable"] = True
        out["network_version"] = (info or {}).get("applicationVersion")
    except HTTPException as exc:
        out["error"] = str(exc.detail)
    return out


@router.get("/consoles")
async def consoles(user=Depends(require_user)):
    """Every UniFi console visible to the Site Manager key."""
    wanted = ((provider("unifi") or {}).get("UNIFI_GATEWAY") or "").strip()
    out = []
    for host in await hosts():
        reported = host.get("reportedState") or {}
        hardware = reported.get("hardware") or {}
        out.append({
            "id": host.get("id"),
            "name": reported.get("name") or reported.get("hostname") or "Unnamed console",
            "ip": host.get("ipAddress"),
            "model": hardware.get("name") or hardware.get("shortname") or "",
            "version": reported.get("version"),
            "state": reported.get("state"),
            "is_managed_gateway": bool(wanted) and (host.get("id") == wanted or wanted in (reported.get("ipAddrs") or [])),
        })
    out.sort(key=lambda h: h["name"].lower())
    return out


async def fetch_clients():
    site_id, _ = await site()
    items, offset = [], 0
    while True:
        data = await network("GET", f"/integration/v1/sites/{site_id}/clients", params={"limit": 200, "offset": offset}) or {}
        batch = data.get("data", [])
        for c in batch:
            items.append({"id": c.get("id"), "name": c.get("name") or "", "ip": c.get("ipAddress") or "",
                          "mac": (c.get("macAddress") or "").lower(), "type": c.get("type") or "",
                          "connected_at": c.get("connectedAt") or ""})
        offset += len(batch)
        if not batch or offset >= data.get("totalCount", 0) or offset >= 5000:
            break
    items.sort(key=lambda c: (c["name"].lower() or "~", c["ip"]))
    return items


async def cached_clients(max_age=60):
    """Clients with a short cache: the cloud connector takes seconds for large sites."""
    cached = _lookups.get("clients")
    if cached and cached[0] > time.time() - max_age:
        return cached[1]
    items = await fetch_clients()
    _lookups["clients"] = (time.time(), items)
    return items


@router.get("/clients")
async def clients(refresh: bool = False, user=Depends(require_user)):
    """Clients on the managed gateway's network (cached for 30 seconds; ``?refresh=true`` refetches)."""
    return await cached_clients(0 if refresh else 30)


async def pool_state():
    host = await gateway()
    reported = host.get("reportedState") or {}
    primary = reported.get("ip")
    addresses = sorted({a for a in reported.get("ipAddrs") or [] if is_public(a)}, key=ipaddress.IPv4Address)
    managed = {e["public_ip"]: e for e in exposures()}
    _, short = await site()
    foreign = {}
    forwards = await network("GET", f"/api/s/{short}/rest/portforward") or {}
    for rule in forwards.get("data", []):
        target = rule.get("destination_ip")
        if target and target != "any" and target not in managed:
            foreign[target] = rule.get("name") or "port forward"
    pool = []
    for address in addresses:
        entry = {"ip": address, "status": "free", "assigned_to": None, "lan_ip": None}
        if address == primary:
            entry.update(status="gateway", assigned_to="Gateway primary WAN address")
        elif address in managed:
            entry.update(status="assigned", assigned_to=managed[address]["name"], lan_ip=managed[address]["lan_ip"])
        elif address in foreign:
            entry.update(status="in_use", assigned_to=foreign[address])
        pool.append(entry)
    return {"pool": pool, "gateway_name": reported.get("name", ""), "console_id": host["id"]}


@router.get("/pool")
async def pool(user=Depends(require_user)):
    """Public IPs on the gateway WAN: ``free``, ``assigned`` (Speck-managed), ``in_use`` (other rules) or ``gateway``."""
    return await pool_state()


@router.get("/exposures")
def list_exposures(user=Depends(require_user)):
    """Speck-managed mappings (public IP → LAN IP), including those imported from AustinLand."""
    return exposures()


# ---------------- writes ----------------


class Expose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_ip: str = Field(max_length=15)
    lan_ip: str = Field(max_length=15)
    name: str = Field(min_length=1, max_length=60, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._-]*$")


async def wan_id(address):
    _, short = await site()
    records = await network("GET", f"/api/s/{short}/rest/networkconf") or {}
    fallback = None
    for record in records.get("data", []):
        if record.get("purpose") != "wan":
            continue
        fallback = fallback or record["_id"]
        if record.get("wan_ip") == address or any(a.split("/")[0] == address for a in record.get("wan_ip_aliases") or []):
            return record["_id"]
    if not fallback:
        raise HTTPException(502, "No WAN network found on the gateway")
    return fallback


async def next_nat_index(short):
    rules = await network("GET", f"/v2/api/site/{short}/nat") or []
    return max([r.get("rule_index") or 0 for r in rules if isinstance(r.get("rule_index"), int)] or [0]) + 1


def nat_filter(address=None):
    base = {"firewall_group_ids": [], "invert_address": False, "invert_port": False}
    if address is None:
        return base | {"filter_type": "NONE"}
    return base | {"filter_type": "ADDRESS_AND_PORT", "address": address}


async def delete_rules(record):
    _, short = await site()
    errors = []
    if record.get("portforward_id"):
        try:
            await network("DELETE", f"/api/s/{short}/rest/portforward/{record['portforward_id']}")
        except HTTPException as exc:
            if exc.status_code != 404:
                errors.append("port forward: " + str(exc.detail))
    if record.get("snat_id"):
        try:
            await network("DELETE", f"/v2/api/site/{short}/nat/{record['snat_id']}")
        except HTTPException as exc:
            if exc.status_code != 404:
                errors.append("SNAT: " + str(exc.detail))
    if errors:
        raise HTTPException(502, "; ".join(errors) + ". Inspect the gateway before retrying.")


@router.post("/expose")
async def expose(body: Expose, user=Depends(require_admin)):
    """Map a free public IP to a LAN host (all ports inbound except 500/4500, SNAT outbound)."""
    if not is_public(body.public_ip):
        raise HTTPException(422, "Not a public IPv4 address")
    if not is_lan(body.lan_ip):
        raise HTTPException(422, "The LAN address must be a private IPv4 address")
    state = await pool_state()
    entry = next((p for p in state["pool"] if p["ip"] == body.public_ip), None)
    if not entry:
        raise HTTPException(404, "That address is not on the gateway WAN")
    if entry["status"] != "free":
        raise HTTPException(409, f"{body.public_ip} is {entry['status']} ({entry['assigned_to']}); choose a free address")
    _, short = await site()
    forward = {
        "name": "Speck: " + body.name,
        "enabled": True,
        "pfwd_interface": "wan",
        "src": "any",
        "proto": "tcp_udp",
        "destination_ip": body.public_ip,
        "dst_port": ALL_PORTS,
        "fwd": body.lan_ip,
        "fwd_port": ALL_PORTS,
        "log": False,
    }
    result = await network("POST", f"/api/s/{short}/rest/portforward", forward) or {}
    created = {"portforward_id": ((result.get("data") or [{}])[0]).get("_id")}
    try:
        snat = {
            "description": f"Speck: {body.name} out {body.lan_ip} -> {body.public_ip}",
            "enabled": True,
            "type": "SNAT",
            "ip_version": "IPV4",
            "is_predefined": False,
            "rule_index": await next_nat_index(short),
            "setting_preference": "manual",
            "logging": False,
            "exclude": False,
            "pppoe_use_base_interface": False,
            "protocol": "all",
            "out_interface": await wan_id(body.public_ip),
            "ip_address": body.public_ip,
            "source_filter": nat_filter(body.lan_ip),
            "destination_filter": nat_filter(),
        }
        created["snat_id"] = ((await network("POST", f"/v2/api/site/{short}/nat", snat)) or {}).get("_id")
    except HTTPException:
        try:
            await delete_rules(created)
        except HTTPException:
            pass
        raise
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO unifi_exposures VALUES(?,?,?,?,?,?,?,?,?)",
            (body.public_ip, body.lan_ip, body.name, created["portforward_id"], created.get("snat_id"),
             state["console_id"], time.time(), user["username"], "speck"),
        )
        audit(conn, user["username"], "unifi.exposed", detail={"public_ip": body.public_ip, "lan_ip": body.lan_ip, "name": body.name})
    return {"ok": True, "public_ip": body.public_ip, "lan_ip": body.lan_ip, "rules": created}


class Unexpose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_ip: str = Field(max_length=15)


@router.post("/unexpose")
async def unexpose(body: Unexpose, user=Depends(require_admin)):
    """Remove a Speck-managed mapping and both of its gateway rules."""
    record = next((e for e in exposures() if e["public_ip"] == body.public_ip), None)
    if not record:
        raise HTTPException(404, "No Speck-managed mapping for " + body.public_ip)
    await delete_rules(record)
    with db(write=True) as conn:
        conn.execute("DELETE FROM unifi_exposures WHERE public_ip=?", (body.public_ip,))
        audit(conn, user["username"], "unifi.unexposed", detail={"public_ip": body.public_ip, "lan_ip": record["lan_ip"]})
    return {"ok": True}


class ImportExposure(BaseModel):
    public_ip: str = Field(max_length=15)
    lan_ip: str = Field(max_length=15)
    name: str = Field(min_length=1, max_length=80)
    portforward_id: str | None = Field(default=None, max_length=64)
    snat_id: str | None = Field(default=None, max_length=64)
    created_at: float | None = None


class ExposureImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exposures: list[ImportExposure] = Field(max_length=256)


@router.post("/exposures/import")
def import_exposures(body: ExposureImport, user=Depends(require_admin)):
    """Adopt mappings recorded by AustinLand so Speck can manage and remove them."""
    created, skipped = [], []
    with db(write=True) as conn:
        for item in body.exposures:
            if not is_public(item.public_ip) or not is_lan(item.lan_ip) or conn.execute(
                "SELECT 1 FROM unifi_exposures WHERE public_ip=?", (item.public_ip,)
            ).fetchone():
                skipped.append(item.public_ip)
                continue
            conn.execute(
                "INSERT INTO unifi_exposures VALUES(?,?,?,?,?,?,?,?,?)",
                (item.public_ip, item.lan_ip, item.name, item.portforward_id, item.snat_id, None,
                 item.created_at or time.time(), user["username"], "austinland"),
            )
            created.append(item.public_ip)
        audit(conn, user["username"], "unifi.imported", detail={"created": created, "skipped": skipped})
    return {"created": created, "skipped": skipped}
