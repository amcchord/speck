"""Synthetic provider data for the screenshot preview: infrastructure, DNS, UniFi, keys and API.

Documentation-style addresses (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and example
domains only; nothing here reaches a real provider.
"""

import re

GB = 1024**3


def provider_fixture(route, query, now):
    """Return the JSON for a provider GET route, or None when the route is not a fixture."""
    day = 86400
    domains = [
        {"domain": d, "status": "ACTIVE", "expires": exp, "renewAuto": auto, "locked": locked, "privacy": privacy,
         "apex": apex, "record_count": count, "zone_cached_at": None if age is None else now - age}
        for d, exp, auto, locked, privacy, apex, count, age in [
            ("example-clinic.com", "2028-02-01T00:00:00Z", True, True, True, ["203.0.113.10"], 8, 3600),
            ("example-clinic.net", "2027-06-11T00:00:00Z", True, True, True, ["Parked"], 4, 7200),
            ("example-dental.dev", "2026-10-20T00:00:00Z", False, False, True, ["203.0.113.11"], 6, day * 2),
            ("example-labs.io", "2029-03-01T00:00:00Z", True, True, False, ["Parked"], 5, day),
            ("example-notes.app", "2027-01-15T00:00:00Z", True, True, True, [], None, None),
            ("example-shop.com", "2027-09-30T00:00:00Z", True, True, True, ["203.0.113.12"], 11, 5400),
        ]
    ]
    records = [
        {"type": "A", "name": "@", "data": "203.0.113.10", "ttl": 600},
        {"type": "A", "name": "portal", "data": "203.0.113.10", "ttl": 600},
        {"type": "CNAME", "name": "www", "data": "example-clinic.com", "ttl": 3600},
        {"type": "MX", "name": "@", "data": "mail.example-clinic.com", "ttl": 3600, "priority": 10},
        {"type": "TXT", "name": "@", "data": "v=spf1 include:_spf.example.net -all", "ttl": 3600},
    ]
    pool = {"gateway_name": "Main office", "console_id": "console-1", "pool": [
        {"ip": "203.0.113.1", "status": "gateway", "assigned_to": "Gateway primary WAN address", "lan_ip": None},
        {"ip": "203.0.113.10", "status": "assigned", "assigned_to": "clinic-portal", "lan_ip": "192.0.2.20"},
        {"ip": "203.0.113.11", "status": "assigned", "assigned_to": "dental-lab", "lan_ip": "192.0.2.21"},
        {"ip": "203.0.113.12", "status": "in_use", "assigned_to": "Shop storefront", "lan_ip": None},
        {"ip": "203.0.113.13", "status": "free", "assigned_to": None, "lan_ip": None},
        {"ip": "203.0.113.14", "status": "free", "assigned_to": None, "lan_ip": None},
    ]}
    machines = [
        {"id": "proxmox:c1:qemu:101", "label": "clinic-portal", "provider": "proxmox", "kind": "qemu", "state": "running",
         "lan": [{"ip": "192.0.2.20", "source": "unifi_mac"}],
         "public": [{"ip": "203.0.113.10", "via": "unifi_nat", "mapping": "clinic-portal", "lan_ip": "192.0.2.20"}],
         "dns": [{"fqdn": "example-clinic.com", "domain": "example-clinic.com", "name": "@"},
                 {"fqdn": "portal.example-clinic.com", "domain": "example-clinic.com", "name": "portal"}]},
        {"id": "proxmox:c1:qemu:102", "label": "dental-lab", "provider": "proxmox", "kind": "qemu", "state": "running",
         "lan": [{"ip": "192.0.2.21", "source": "agent"}],
         "public": [{"ip": "203.0.113.11", "via": "unifi_nat", "mapping": "dental-lab", "lan_ip": "192.0.2.21"}],
         "dns": [{"fqdn": "example-dental.dev", "domain": "example-dental.dev", "name": "@"}]},
        {"id": "linode:l1:instance:9001", "label": "shop-storefront", "provider": "linode", "kind": "instance", "state": "running",
         "lan": [], "public": [{"ip": "198.51.100.40", "via": "provider"}],
         "dns": [{"fqdn": "example-shop.com", "domain": "example-shop.com", "name": "@"}]},
    ]
    ips = {}
    for m in machines:
        for address in [a["ip"] for a in m["lan"]] + [a["ip"] for a in m["public"]]:
            ips[address] = {"machines": [{"id": m["id"], "label": m["label"]}], "dns": [d["fqdn"] for d in m["dns"]]}
    clients = [
        {"id": f"c{i}", "name": name, "ip": ip, "mac": mac, "type": kind, "connected_at": when}
        for i, (name, ip, mac, kind, when) in enumerate([
            ("clinic-portal", "192.0.2.20", "bc:24:11:00:00:01", "WIRED", "2026-09-20T08:00:00Z"),
            ("dental-lab", "192.0.2.21", "bc:24:11:00:00:02", "WIRED", "2026-09-21T09:30:00Z"),
            ("Front desk printer", "192.0.2.40", "00:11:22:33:44:55", "WIRELESS", "2026-09-22T07:10:00Z"),
            ("Reception tablet", "192.0.2.41", "00:11:22:33:44:56", "WIRELESS", ""),
            ("00:11:22:33:44:57", "", "00:11:22:33:44:57", "WIRED", "2026-09-22T11:00:00Z"),
        ])
    ]
    entries = [
        {"name": name, "service": service, "kind": kind, "project": project, "notes": notes, "meta": {},
         "created": now - day * 9, "updated": now - day * age, "created_by": "demo", "origin": origin,
         "revealed": None if not reveals else now - 600, "reveals": reveals, "secret_names": secrets,
         "hints": {s: "•••• (12 chars)" for s in secrets}}
        for name, service, kind, project, notes, origin, reveals, age, secrets in [
            ("clinic-openai", "openai", "minted", "clinic", "OpenAI project speck-clinic", "speck", 0, 9, ["OPENAI_API_KEY"]),
            ("clinic-database", "postgres", "static", "clinic", "Primary database", "speck", 3, 1, ["DATABASE_URL", "PGPASSWORD"]),
            ("clinic-twilio", "twilio", "minted", "clinic", "Reminder calls", "speck", 0, 4, ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY", "TWILIO_API_SECRET"]),
            ("labs-anthropic", "anthropic", "shared", "labs", "", "austinland", 1, 2, ["ANTHROPIC_API_KEY"]),
            ("labs-app-store-connect", "app-store-connect", "shared", "labs", "Team API key", "austinland", 0, 20, ["APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_PRIVATE_KEY"]),
            ("shop-stripe", "stripe", "static", "shop", "Test mode", "speck", 0, 30, ["STRIPE_SECRET_KEY"]),
        ]
    ]
    services = [
        {"service": s, "label": label, "mode": mode, "description": text, "secret_fields": fields, "setting_fields": [],
         "configured": configured, "hints": {f: "demo…0000" for f in fields} if configured else {}, "settings": {},
         "updated": now - day, "updated_by": "demo", "arbiter": mode != "provider"}
        for s, label, mode, text, fields, configured in [
            ("openai", "OpenAI", "mint", "Mints a dedicated OpenAI project and service-account key per project.", ["OPENAI_ADMIN_KEY"], True),
            ("anthropic", "Anthropic", "shared", "Hands out the shared Anthropic API key and records each recipient project.", ["ANTHROPIC_API_KEY"], True),
            ("twilio", "Twilio", "mint", "Mints a named, independently revocable Twilio API key per project.", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], True),
            ("godaddy", "GoDaddy DNS", "provider", "Manages domains and DNS records on the Network & DNS page.", ["GODADDY_API_KEY", "GODADDY_API_SECRET"], True),
            ("unifi", "UniFi Site Manager", "provider", "Reaches the gateway through UniFi's cloud connector.", ["UNIFI_API_KEY"], False),
        ]
    ]
    ssh_keys = [
        {"name": name, "type": "ssh-ed25519", "public_key": f"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI{name.replace('-', '')}Preview {comment}",
         "comment": comment, "fingerprint": "SHA256:preview" + name.replace("-", ""), "has_private": private, "purpose": purpose,
         "created": now - day * 3, "created_by": "demo", "origin": "speck", "registered_as": None}
        for name, comment, private, purpose in [
            ("clinic-deploy", "clinic deploy", True, "CI deploys"),
            ("labs-builder", "labs builder", True, "Build runner"),
            ("workstation", "demo@laptop", False, "Workstation public key"),
        ]
    ]
    handoffs = [
        {"filename": f"LLMContextAccess-{m}-{d}.md", "machine": m, "domain": d, "size": size, "created": now - day * age, "created_by": "demo", "origin": "speck"}
        for m, d, size, age in [("clinic-portal", "example-clinic.com", 6144, 4), ("shop-storefront", "example-shop.com", 4410, 12)]
    ]
    tokens = [
        {"id": "t1", "name": "Claude Code", "scopes": ["read", "keys:read"], "key_prefixes": ["clinic"], "owner": "demo",
         "created": now - day, "expires": now + day * 60, "revoked": None, "last_used": now - 300, "last_ip": "198.51.100.9", "uses": 42, "active": True},
        {"id": "t2", "name": "Nightly CI", "scopes": ["read"], "key_prefixes": [], "owner": "demo",
         "created": now - day * 40, "expires": now + day * 20, "revoked": None, "last_used": now - day, "last_ip": "198.51.100.12", "uses": 311, "active": True},
        {"id": "t3", "name": "Old laptop", "scopes": ["read", "operate"], "key_prefixes": [], "owner": "demo",
         "created": now - day * 90, "expires": now + day * 5, "revoked": now - day * 10, "last_used": now - day * 11, "last_ip": "198.51.100.30", "uses": 7, "active": False},
    ]

    def resource(rid, kind, name, node, connection, provider, status="running", mem=None, cap=None, addresses=(), management="provider_only", template=False):
        return {"id": rid, "kind": kind, "name": name, "node": node, "connection_id": connection["id"], "connection_name": connection["name"],
                "provider": provider, "status": status, "memory": mem, "max_memory": cap, "addresses": list(addresses),
                "management": management, "template": template}

    cluster = {"id": "c1", "name": "Example cluster", "provider": "proxmox", "connector": True, "status": "connected"}
    cloud = {"id": "l1", "name": "Example cloud", "provider": "linode", "connector": False, "status": "connected"}
    cluster["resources"] = [
        resource("pve-1", "node", "pve-1", "pve-1", cluster, "proxmox", "online", 48 * GB, 128 * GB, ["192.0.2.2"]),
        resource("101", "qemu", "clinic-portal", "pve-1", cluster, "proxmox", "running", 3 * GB, 8 * GB, ["192.0.2.20"]),
        resource("102", "qemu", "dental-lab", "pve-1", cluster, "proxmox", "running", 5 * GB, 16 * GB, ["192.0.2.21"], "agent"),
        resource("103", "qemu", "ubuntu-template", "pve-1", cluster, "proxmox", "stopped", None, 4 * GB, [], template=True),
        resource("pve-2", "node", "pve-2", "pve-2", cluster, "proxmox", "online", 30 * GB, 96 * GB, ["192.0.2.3"]),
        resource("201", "qemu", "build-runner", "pve-2", cluster, "proxmox", "running", 6 * GB, 12 * GB, ["192.0.2.30"]),
        resource("202", "lxc", "dns-cache", "pve-2", cluster, "proxmox", "running", 256 * 1024**2, GB, ["192.0.2.31"]),
        resource("203", "qemu", "legacy-files", "pve-2", cluster, "proxmox", "stopped", None, 8 * GB, []),
    ]
    cloud["resources"] = [
        resource("9001", "instance", "shop-storefront", "us-east", cloud, "linode", "running", None, 4 * GB, ["198.51.100.40"]),
        resource("9002", "instance", "notes-api", "us-east", cloud, "linode", "running", None, 2 * GB, ["198.51.100.41"]),
    ]
    operations = [
        {"id": "op1", "created": now - 900, "actor": "demo", "operation": "reboot", "target": "build-runner", "connection_id": "c1",
         "status": "complete", "result": "UPID:pve-2:0000:reboot"},
        {"id": "op2", "created": now - 5400, "actor": "demo", "operation": "snapshot", "target": "clinic-portal", "connection_id": "c1",
         "status": "complete", "result": {"snapshot": "before-update"}},
    ]

    if route == "/api/dns/status":
        return {"configured": True, "domains": len(domains), "zones_cached": 5, "oldest_zone_at": now - day * 2, "domains_fetched_at": now - 7200, "scan": {"running": False}}
    if route == "/api/dns/domains":
        return {"fetched_at": now - 7200, "domains": domains}
    if re.fullmatch(r"/api/dns/domains/[^/]+/records", route):
        return {"domain": route.split("/")[4], "fetched_at": now - 3600, "cached": True, "records": records}
    if route == "/api/dns/search":
        return {"results": [], "truncated": False}
    if route == "/api/unifi/status":
        return {"configured": True, "reachable": True, "console": {"id": "console-1", "name": "Main office"}}
    if route == "/api/unifi/pool":
        return pool
    if route == "/api/unifi/clients":
        return clients
    if route == "/api/unifi/consoles":
        return [{"id": "console-1", "name": "Main office", "ip": "203.0.113.1", "model": "UniFi Dream Machine Pro Max", "version": "5.0", "state": "connected", "is_managed_gateway": True},
                {"id": "console-2", "name": "Warehouse", "ip": "198.51.100.1", "model": "UniFi Cloud Gateway Ultra", "version": "4.3", "state": "connected", "is_managed_gateway": False}]
    if route == "/api/network/map":
        return {"machines": machines, "ips": ips, "clients_checked": True, "client_error": None, "zones_cached": 5, "checked_at": now}
    if route == "/api/keys":
        return entries
    if route == "/api/keys/services":
        return services
    if route.startswith("/api/keys/"):
        name = route.rsplit("/", 1)[-1]
        entry = next((e for e in entries if e["name"] == name), None)
        return entry and {**entry, "secrets": {s: "preview-value" for s in entry["secret_names"]}}
    if route == "/api/ssh/keys":
        return ssh_keys
    if route == "/api/context/files":
        return handoffs
    if route.startswith("/api/context/files/"):
        return {"filename": handoffs[0]["filename"], "markdown": "# clinic-portal handoff\n\nPreview only.\n"}
    if route == "/api/tokens":
        return tokens
    if route == "/api/tokens/scopes":
        return {"role": "admin", "scopes": {"read": "Read everything the creator can see", "operate": "Operator changes",
                                            "admin": "Administrator changes", "keys:read": "List and reveal vault entries", "keys:write": "Store and delete vault entries"}}
    if route == "/api/openapi.json":
        return {"paths": {
            "/api/overview": {"get": {"summary": "Overview"}}, "/api/search": {"get": {"summary": "Search"}},
            "/api/keys": {"get": {"summary": "List entries"}}, "/api/keys/provision": {"post": {"summary": "Provision"}},
            "/api/dns/domains": {"get": {"summary": "Domains"}}, "/api/dns/domains/{domain}/point": {"post": {"summary": "Point a name"}},
            "/api/unifi/pool": {"get": {"summary": "Public IP pool"}}, "/api/fleet": {"get": {"summary": "Inventory"}},
        }}
    if route == "/api/infrastructure/inventory":
        return {"connections": [cluster, cloud], "checked_at": now}
    if route == "/api/infrastructure/connectors":
        return [{"id": "agent1", "connection_id": "c1", "hostname": "pve-1", "version": "0.1.0", "online": True, "last_seen": now}]
    if route == "/api/infrastructure/operations":
        return operations
    if route.startswith("/api/infrastructure/connections/") and route.endswith("/catalog"):
        return {"reboot": {"label": "Reboot", "method": "POST", "danger": True, "fields": []}}
    return None
