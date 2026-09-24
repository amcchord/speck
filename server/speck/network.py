"""How machines are reached: LAN addresses, public IP mappings and DNS names.

Joins evidence Speck already holds and never guesses from names:
- endpoint-agent interface addresses and provider-reported addresses;
- Proxmox guest NIC MACs matched exactly to UniFi client MACs for LAN IPs;
- UniFi public IP mappings (public IP → LAN IP) and public provider addresses;
- cached DNS A/AAAA records pointing at any of those public addresses.
"""

import ipaddress
import time

from fastapi import APIRouter, Depends, HTTPException

from speck.db import db
from speck.security import require_user

router = APIRouter(prefix="/api/network")


GLOBAL_UNICAST_V6 = ipaddress.ip_network("2000::/3")
UNIQUE_LOCAL_V6 = ipaddress.ip_network("fc00::/7")


def lan_address(address):
    """A usable LAN address: private IPv4 or unique-local IPv6 (not loopback, link-local or odd forms)."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return False
    if parsed.version == 4:
        return parsed.is_private and not parsed.is_loopback and not parsed.is_link_local
    return parsed in UNIQUE_LOCAL_V6


def public(address):
    """Internet-routable: global IPv4, or IPv6 in the global unicast range (not odd reserved forms)."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return False
    return parsed.is_global and (parsed.version == 4 or parsed in GLOBAL_UNICAST_V6)


async def build_map(user):
    from speck import dns, fleet, unifi
    from speck.vault import provider

    machines = (await fleet.inventory(user=user))["machines"]
    clients, client_error = [], None
    if provider("unifi"):
        try:
            clients = await unifi.cached_clients()
        except HTTPException as exc:
            client_error = str(exc.detail)
    by_mac = {c["mac"].lower(): c for c in clients if c.get("mac")}
    by_ip = {c["ip"]: c for c in clients if c.get("ip")}
    with db() as conn:
        exposures = [dict(r) for r in conn.execute("SELECT public_ip,lan_ip,name,origin FROM unifi_exposures")]
    names, cached_zones = dns.connections_map()
    by_lan = {}
    for exposure in exposures:
        by_lan.setdefault(exposure["lan_ip"], []).append(exposure)

    out, ip_owner = [], {}
    for m in machines:
        addresses = {a.split("/")[0] for a in m.get("addresses") or [] if a}
        macs = set()
        for resource in m.get("resources") or []:
            addresses |= {a for a in resource.get("addresses") or [] if a}
            macs |= {x.lower() for x in (resource.get("identity") or {}).get("macs", [])}
        lan = {}
        for mac in sorted(macs):
            client = by_mac.get(mac)
            if client and client.get("ip"):
                lan[client["ip"]] = {"ip": client["ip"], "source": "unifi_mac", "mac": mac, "client": client["name"]}
        for address in sorted(addresses):
            if lan_address(address):
                lan.setdefault(address, {"ip": address, "source": "reported", "client": (by_ip.get(address) or {}).get("name")})
        publics = {}
        for address in sorted(addresses):
            if public(address):
                publics[address] = {"ip": address, "via": m.get("provider") or "reported"}
        for address in lan:
            for exposure in by_lan.get(address, []):
                publics[exposure["public_ip"]] = {"ip": exposure["public_ip"], "via": "unifi_nat", "mapping": exposure["name"], "lan_ip": address}
        records = [n | {"ip": ip} for ip in publics for n in names.get(ip, [])]
        if not (lan or publics):
            continue
        item = {
            "id": m["id"],
            "label": m["label"],
            "provider": m.get("provider"),
            "kind": m.get("kind"),
            "state": m.get("state"),
            "endpoint_id": m.get("endpoint_id"),
            "lan": sorted(lan.values(), key=lambda x: x["ip"]),
            "public": sorted(publics.values(), key=lambda x: x["ip"]),
            "dns": sorted(records, key=lambda r: r["fqdn"]),
        }
        out.append(item)
        for address in list(lan) + list(publics):
            ip_owner.setdefault(address, []).append({"id": m["id"], "label": m["label"]})
    ips = {}
    for address, owners in ip_owner.items():
        ips[address] = {"machines": owners, "dns": [n["fqdn"] for n in names.get(address, [])]}
    for exposure in exposures:
        entry = ips.setdefault(exposure["public_ip"], {"machines": ip_owner.get(exposure["lan_ip"], []),
                                                       "dns": [n["fqdn"] for n in names.get(exposure["public_ip"], [])]})
        entry["mapping"] = exposure
        client = by_ip.get(exposure["lan_ip"])
        if client:
            entry["lan_client"] = client["name"]
    return {
        "machines": sorted(out, key=lambda m: m["label"].casefold()),
        "ips": ips,
        "clients_checked": bool(clients),
        "client_error": client_error,
        "zones_cached": cached_zones,
        "checked_at": time.time(),
    }


@router.get("/map")
async def network_map(user=Depends(require_user)):
    """Per machine: LAN IPs, public IPs (provider or NAT) and DNS names that reach it; plus an IP index."""
    return await build_map(user)
