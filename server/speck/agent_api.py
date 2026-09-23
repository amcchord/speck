"""Discovery, search and MCP access for LLM agents and automation.

Public, credential-free documents explain how to authenticate: ``/llms.txt``,
``/agents.md`` (the full guide), ``/speck.md`` (a drop-in file for any repo)
and ``/api/openapi.json``. Everything else uses a personal API token.

``POST /mcp`` implements the Model Context Protocol's streamable HTTP transport
(stateless JSON responses). Each tool call is dispatched in-process to the same
REST endpoint a human or script would call, with the caller's own token, so
MCP never widens a token's scopes, role, rate limit or audit attribution.
"""

import json
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from speck.api_tokens import authenticate, presented, whoami
from speck.config import origin
from speck.db import db
from speck.security import require_user

router = APIRouter()
GUIDE = Path(__file__).with_name("agent_guide.md")
VERSION = "0.4.0"
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
INTERNAL = ("/api/agent/", "/api/infrastructure/agent/", "/api/integrations/v1/", "/api/credentials/v1/")


def guide_text():
    return GUIDE.read_text().replace("{{ORIGIN}}", origin())


@router.get("/agents.md", include_in_schema=False)
def agents_md():
    return PlainTextResponse(guide_text(), media_type="text/markdown")


@router.get("/llms.txt", include_in_schema=False)
def llms_txt():
    base = origin()
    return PlainTextResponse(
        f"""# Speck RMM

> Speck is a lightweight RMM and infrastructure control plane: Windows/Linux endpoints,
> Proxmox, Linode and Slide infrastructure, GoDaddy DNS, UniFi public IPs, SSH keys and an
> encrypted credential vault that mints or shares API keys for your project.

Authenticate every API call with `Authorization: Bearer speck_pat_…` (a personal API token
created by a human in Speck → API). Tokens act as their creator, capped by their scopes.

- [Agent guide]({base}/agents.md): workflows, endpoints, safety rules
- [Repo drop-in]({base}/speck.md): save as SPECK.md in a project so future agents find Speck
- [OpenAPI schema]({base}/api/openapi.json): machine-readable endpoint reference
- [MCP server]({base}/mcp): streamable HTTP; add with
  `claude mcp add --transport http speck {base}/mcp --header "Authorization: Bearer $SPECK_TOKEN"`

Start with `GET {base}/api/overview`, then `GET {base}/api/search?q=<anything>`.
""",
        media_type="text/markdown",
    )


@router.get("/speck.md", include_in_schema=False)
def repo_dropin():
    base = origin()
    return PlainTextResponse(
        f"""# Speck

<!-- Drop this file in a repository root. It tells an LLM agent how to get
     infrastructure and credentials for this project from Speck. -->

Speck ({base}) manages Austin's machines and infrastructure and holds the
credential vault. Use it instead of asking a human to paste keys.

## Authenticate

Read the token from the environment (never commit it):

```bash
export SPECK_URL={base}
curl -s -H "Authorization: Bearer $SPECK_TOKEN" $SPECK_URL/api/whoami
```

No token? Ask the human to create one in Speck → API with the scopes you need
(`read`, `operate`, `admin`, `keys:read`, `keys:write`).

## Get API keys for this project

```bash
curl -s -X POST $SPECK_URL/api/keys/provision -H "Authorization: Bearer $SPECK_TOKEN" \\
  -H 'Content-Type: application/json' -d '{{"service":"openai","project":"<this-repo-name>"}}'
curl -s $SPECK_URL/api/keys/<entry-name>/env -H "Authorization: Bearer $SPECK_TOKEN" >> .env   # gitignored!
```

Services: `openai` and `twilio` mint a project-scoped key; `anthropic` and
`app-store-connect` share a tracked key. Asking again returns the same entry.

## Everything else

- Full guide: `curl -s $SPECK_URL/agents.md`
- Find anything (machines, IPs, domains, keys): `GET /api/search?q=...`
- MCP: `claude mcp add --transport http speck $SPECK_URL/mcp --header "Authorization: Bearer $SPECK_TOKEN"`

Rules: treat every secret like a password (env vars or gitignored files only),
use this project's real name when provisioning, and confirm with the human before
deleting anything you did not create.
""",
        media_type="text/markdown",
    )


@router.get("/api/whoami")
def me(user=Depends(require_user)):
    return whoami(user)


@router.get("/api/guide", response_class=PlainTextResponse)
def guide(user=Depends(require_user)):
    return PlainTextResponse(guide_text(), media_type="text/markdown")


def vault_visible(user):
    return user["role"] == "admin" and (user.get("via") != "token" or "keys:read" in user["scopes"])


@router.get("/api/overview")
async def overview(user=Depends(require_user)):
    """A live orientation summary: what Speck manages and which calls to make next."""
    from speck import vault
    from speck.dns import SCAN

    with db() as conn:
        devices = conn.execute(
            "SELECT count(*) AS total, sum(last_seen>?) AS online FROM devices WHERE archived=0", (time.time() - 75,)
        ).fetchone()
        connections = [dict(r) for r in conn.execute("SELECT id,name,provider FROM infrastructure_connections ORDER BY name")]
        domains = conn.execute("SELECT count(*) FROM dns_domains").fetchone()[0]
        zones = conn.execute("SELECT count(*) FROM dns_zones").fetchone()[0]
        exposures = conn.execute("SELECT count(*) FROM unifi_exposures").fetchone()[0]
        ssh = conn.execute("SELECT count(*) FROM ssh_keys").fetchone()[0]
        entries = conn.execute("SELECT count(*) FROM vault_entries").fetchone()[0]
        contexts = conn.execute("SELECT count(*) FROM context_files").fetchone()[0]
        caches = {r["connection_id"]: r["checked"] for r in conn.execute("SELECT connection_id,checked FROM fleet_inventory_cache")}
    services = {s["service"]: s["configured"] for s in vault.services_status()}
    result = {
        "server": {"origin": origin(), "version": VERSION, "time": time.time()},
        "you": whoami(user),
        "endpoints": {"devices": devices["total"], "online": devices["online"] or 0},
        "infrastructure": [c | {"inventory_checked_at": caches.get(c["id"])} for c in connections],
        "dns": {"configured": services.get("godaddy", False), "domains": domains, "zones_cached": zones, "scan_running": SCAN["running"]},
        "public_ips": {"configured": services.get("unifi", False), "speck_managed_mappings": exposures},
        "ssh_keys": ssh,
        "key_arbiter": {k: services.get(k, False) for k in vault.ARBITER},
        "next": [
            "GET /api/search?q=<name, IP, domain or key> to find anything",
            "GET /api/fleet for machines; GET /api/infrastructure/inventory for provider resources",
            "GET /api/dns/domains and /api/dns/domains/{domain}/records?cached=true for DNS",
            "GET /api/unifi/pool for free public IPs",
            "POST /api/keys/provision {service, project} for project API keys",
            "GET /agents.md for workflows and safety rules",
        ],
    }
    if vault_visible(user):
        result["vault"] = {"entries": entries, "handoff_files": contexts}
    return result


def hit(kind, title, subtitle, api, **extra):
    return {"type": kind, "title": title, "subtitle": subtitle, "api": api} | extra


SEARCH_ORDER = ("machine", "public_ip", "vault_entry", "ssh_key", "domain", "dns_record")


@router.get("/api/search")
async def search(q: str, limit: int = 50, type: str = "", user=Depends(require_user)):
    """Search machines, public IPs, vault entry names (vault readers), SSH keys, domains and cached DNS records.

    Results are grouped in that order; ``type`` restricts to one of those kinds.
    """
    from speck import fleet
    from speck.vault import permitted

    needle = q.strip().lower()
    if len(needle) < 2:
        raise HTTPException(422, "Search for at least two characters")
    if type and type not in SEARCH_ORDER:
        raise HTTPException(422, "type must be one of " + ", ".join(SEARCH_ORDER))
    limit = max(1, min(limit, 200))
    found = {kind: [] for kind in SEARCH_ORDER}

    def matches(*values):
        return any(needle in str(v).lower() for v in values if v)

    try:
        machines = (await fleet.inventory(user=user))["machines"]
    except HTTPException:
        machines = []
    for m in machines:
        addresses = m.get("addresses") or []
        if matches(m.get("label"), m.get("hostname"), m.get("id"), *addresses, *(m.get("aliases") or []), m.get("client_name")):
            resource = m.get("resource") or {}
            if resource.get("connection_id"):
                api = f"GET /api/infrastructure/connections/{resource['connection_id']}/resources/{resource['kind']}/{resource['id']}"
            else:
                api = "GET /api/devices"
            found["machine"].append(hit("machine", m["label"], " · ".join(filter(None, [m.get("provider"), m.get("state"), m.get("location"), ", ".join(addresses[:3])])),
                                        api, id=m.get("id"), device_id=m.get("endpoint_id")))
    if user["role"] != "viewer":
        with db() as conn:
            zones = conn.execute("SELECT domain,records FROM dns_zones ORDER BY domain").fetchall()
            domains = [r[0] for r in conn.execute("SELECT domain FROM dns_domains ORDER BY domain")]
            exposures = conn.execute("SELECT * FROM unifi_exposures ORDER BY public_ip").fetchall()
            keys = conn.execute("SELECT name,fingerprint,comment,purpose FROM ssh_keys ORDER BY name").fetchall()
            vault_rows = conn.execute("SELECT name,service,project,notes,secret_names FROM vault_entries ORDER BY name").fetchall() if vault_visible(user) else []
        for row in exposures:
            if matches(row["public_ip"], row["lan_ip"], row["name"]):
                found["public_ip"].append(hit("public_ip", row["public_ip"], f"{row['name']} → {row['lan_ip']}", "GET /api/unifi/exposures"))
        for row in vault_rows:
            if permitted(user, row["name"]) and matches(row["name"], row["service"], row["project"], row["notes"], row["secret_names"]):
                found["vault_entry"].append(hit("vault_entry", row["name"], f"{row['service']} · {', '.join(json.loads(row['secret_names']))}",
                                                f"GET /api/keys/{row['name']}"))
        for row in keys:
            if matches(row["name"], row["comment"], row["fingerprint"], row["purpose"]):
                found["ssh_key"].append(hit("ssh_key", row["name"], row["fingerprint"], "GET /api/ssh/keys"))
        for domain in domains:
            if needle in domain:
                found["domain"].append(hit("domain", domain, "GoDaddy domain", f"GET /api/dns/domains/{domain}/records?cached=true"))
        for zone in zones:
            for rec in json.loads(zone["records"]):
                name = zone["domain"] if rec.get("name") == "@" else f"{rec.get('name')}.{zone['domain']}"
                if matches(name, rec.get("data")):
                    found["dns_record"].append(hit("dns_record", name, f"{rec.get('type')} → {rec.get('data')}",
                                                   f"GET /api/dns/domains/{zone['domain']}/records?cached=true", domain=zone["domain"]))
    counts = {kind: len(items) for kind, items in found.items()}
    if type:
        results = found[type]
    else:
        # Keep record matches from crowding out rarer, more specific results.
        results = [r for kind in SEARCH_ORDER for r in (found[kind][:25] if kind == "dns_record" else found[kind])]
    return {"query": q, "results": results[:limit], "counts": counts, "truncated": len(results) > limit or sum(counts.values()) > len(results)}


# ---------------- OpenAPI ----------------


_schema: dict = {}


@router.get("/api/openapi.json", include_in_schema=False)
def openapi(request: Request):
    from fastapi.openapi.utils import get_openapi

    if not _schema:
        # FastAPI keeps included routers as nested objects, so filter the generated paths.
        schema = get_openapi(
            title="Speck API",
            version=VERSION,
            description="Authenticate with `Authorization: Bearer speck_pat_…`. See /agents.md for workflows.",
            routes=request.app.routes,
        )
        schema["paths"] = {p: v for p, v in schema["paths"].items() if p.startswith("/api/") and not p.startswith(INTERNAL)}
        schema["servers"] = [{"url": origin()}]
        schema.setdefault("components", {})["securitySchemes"] = {"token": {"type": "http", "scheme": "bearer"}}
        schema["security"] = [{"token": []}]
        _schema.update(schema)
    return _schema


# ---------------- MCP ----------------


def tool(name, description, method, path, properties=None, required=(), body=(), query=(), read_only=True, destructive=False):
    return {
        "name": name,
        "description": description,
        "method": method,
        "path": path,
        "body": list(body),
        "query": list(query),
        "inputSchema": {"type": "object", "properties": properties or {}, "required": list(required), "additionalProperties": False},
        "annotations": {"readOnlyHint": read_only, "destructiveHint": destructive, "openWorldHint": not read_only},
    }


S = {"type": "string"}
N = {"type": "integer"}
TOOLS = [
    tool("speck_overview", "Orientation: what Speck manages, your identity/scopes and suggested next calls.", "GET", "/api/overview"),
    tool("speck_search", "Find machines, provider resources, DNS records, domains, public IPs, SSH keys and vault entry names.",
         "GET", "/api/search", {"q": S | {"description": "Name, IP, hostname, domain or key name"}}, ["q"], query=["q"]),
    tool("list_machines", "Unified fleet: Speck endpoint agents joined with Proxmox, Linode and Slide resources.", "GET", "/api/fleet"),
    tool("list_devices", "Enrolled Windows/Linux endpoint agents with telemetry.", "GET", "/api/devices"),
    tool("run_command", "Queue a shell/PowerShell command on an endpoint agent and wait for its output (up to the timeout).",
         "POST", "/api/devices/{device_id}/jobs",
         {"device_id": S, "script": S, "shell": {"type": "string", "enum": ["auto", "sh", "powershell"]},
          "timeout": N | {"description": "Seconds, 5-600 (default 60)"}}, ["device_id", "script"], read_only=False, destructive=True),
    tool("get_job", "Status and bounded output of a job.", "GET", "/api/jobs/{job_id}", {"job_id": S}, ["job_id"]),
    tool("infrastructure_inventory", "Proxmox, Linode and Slide resources by connection, with agent correlation.", "GET",
         "/api/infrastructure/inventory"),
    tool("list_domains", "GoDaddy domains (cached; refresh=true refetches the list).", "GET", "/api/dns/domains",
         {"q": S, "refresh": {"type": "boolean"}}, query=["q", "refresh"]),
    tool("get_dns_records", "Records for a zone. cached=true avoids a GoDaddy call when a copy exists.", "GET",
         "/api/dns/domains/{domain}/records", {"domain": S, "cached": {"type": "boolean"}}, ["domain"], query=["cached"]),
    tool("dns_connections", "Map of IP address → DNS names pointing at it (from cached zones).", "GET", "/api/dns/connections"),
    tool("point_domain", "Create or replace an A record so name.domain resolves to an IPv4 address.", "POST",
         "/api/dns/domains/{domain}/point", {"domain": S, "name": S | {"description": "@ for the apex"}, "ip": S, "ttl": N},
         ["domain", "ip"], body=["name", "ip", "ttl"], read_only=False),
    tool("add_dns_record", "Append a DNS record (keeps existing records with the same type/name).", "POST",
         "/api/dns/domains/{domain}/records",
         {"domain": S, "type": S, "name": S, "data": S, "ttl": N, "priority": N}, ["domain", "type", "name", "data"],
         body=["type", "name", "data", "ttl", "priority"], read_only=False),
    tool("delete_dns_records", "Delete every record with this type and name.", "DELETE",
         "/api/dns/domains/{domain}/records/{type}/{name}", {"domain": S, "type": S, "name": S}, ["domain", "type", "name"],
         read_only=False, destructive=True),
    tool("list_public_ips", "Gateway public IP pool: free, assigned (Speck-managed), in_use or gateway.", "GET", "/api/unifi/pool"),
    tool("list_lan_clients", "Clients on the managed UniFi network (name, IP, MAC).", "GET", "/api/unifi/clients"),
    tool("expose_public_ip", "Map a FREE public IP to a LAN host: all ports inbound (except 500/4500) plus outbound SNAT.",
         "POST", "/api/unifi/expose", {"public_ip": S, "lan_ip": S, "name": S}, ["public_ip", "lan_ip", "name"],
         body=["public_ip", "lan_ip", "name"], read_only=False),
    tool("unexpose_public_ip", "Remove a Speck-managed public IP mapping and its gateway rules.", "POST", "/api/unifi/unexpose",
         {"public_ip": S}, ["public_ip"], body=["public_ip"], read_only=False, destructive=True),
    tool("list_ssh_keys", "Stored SSH public keys (for authorized_keys) and Linode registration.", "GET", "/api/ssh/keys"),
    tool("generate_ssh_key", "Generate an Ed25519 keypair; returns the public key. The private half stays sealed in Speck.",
         "POST", "/api/ssh/generate", {"name": S, "comment": S, "purpose": S}, ["name"], body=["name", "comment", "purpose"], read_only=False),
    tool("key_services", "Key arbiter providers and whether each mints or shares keys.", "GET", "/api/keys/services"),
    tool("list_keys", "Vault entries with masked hints (needs keys:read).", "GET", "/api/keys",
         {"q": S, "service": S, "project": S}, query=["q", "service", "project"]),
    tool("get_key", "Reveal one vault entry's secrets (needs keys:read; audited). Never print values in logs or commits.",
         "GET", "/api/keys/{name}", {"name": S}, ["name"]),
    tool("provision_key", "Get an API key for a project: openai/twilio mint a scoped key; anthropic/app-store-connect share one. Idempotent.",
         "POST", "/api/keys/provision", {"service": {"type": "string", "enum": ["openai", "anthropic", "twilio", "app-store-connect"]},
                                         "project": S}, ["service", "project"], body=["service", "project"], read_only=False),
    tool("store_key", "Store a credential in the vault as {ENV_NAME: value} secrets (needs keys:write).", "POST", "/api/keys/static",
         {"name": S, "service": S, "project": S, "notes": S, "secrets": {"type": "object", "additionalProperties": {"type": "string"}}},
         ["name", "secrets"], body=["name", "service", "project", "notes", "secrets"], read_only=False),
    tool("list_handoffs", "Machine handoff documents (SSH access + DNS + snapshot) for agents.", "GET", "/api/context/files"),
    tool("get_handoff", "Read a machine handoff document (contains a private SSH key; needs keys:read).", "GET",
         "/api/context/files/{filename}", {"filename": S}, ["filename"]),
    tool("speck_api", "Call any Speck REST endpoint with your token (see /api/openapi.json). Use for anything without a dedicated tool.",
         "ANY", "", {"method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
                     "path": S | {"description": "Absolute path starting with /api/"},
                     "query": {"type": "object"}, "body": {"type": ["object", "array", "null"]}},
         ["method", "path"], read_only=False, destructive=True),
]
TOOL_INDEX = {t["name"]: t for t in TOOLS}


def rpc_error(ident, code, message):
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": code, "message": message}}


def text_result(value, error=False):
    text = value if isinstance(value, str) else json.dumps(value, indent=1, default=str)
    if len(text) > 200_000:
        text = text[:200_000] + "\n… truncated; narrow the request or use speck_api with filters."
    result = {"content": [{"type": "text", "text": text}], "isError": error}
    if isinstance(value, dict) and not error:
        result["structuredContent"] = value
    return result


async def dispatch(request, method, path, query=None, body=None):
    from speck.main import app

    if not path.startswith("/api/") or path.startswith(INTERNAL) or ".." in path:
        raise ValueError("Path must be a public /api/ endpoint")
    headers = {"authorization": request.headers["authorization"], "accept": "application/json"}
    transport = httpx.ASGITransport(app=app, client=(request.client.host if request.client else "127.0.0.1", 0))
    async with httpx.AsyncClient(transport=transport, base_url=origin(), timeout=660) as client:
        response = await client.request(method, path, params=query or None, json=body, headers=headers)
    try:
        data = response.json()
    except ValueError:
        data = response.text
    return response.status_code, data


async def call_tool(request, name, args):
    spec = TOOL_INDEX.get(name)
    if not spec:
        raise KeyError(name)
    args = dict(args or {})
    if name == "speck_api":
        status, data = await dispatch(request, args.get("method", "GET").upper(), args.get("path", ""), args.get("query"), args.get("body"))
        return text_result({"status": status, "data": data}, status >= 400)
    path = spec["path"]
    for key in list(args):
        if "{" + key + "}" in path:
            from urllib.parse import quote

            path = path.replace("{" + key + "}", quote(str(args.pop(key)), safe="@"))
    if "{" in path:
        return text_result("Missing required path arguments for " + name, True)
    query = {k: args[k] for k in spec["query"] if k in args}
    body = {k: args[k] for k in spec["body"] if k in args} if spec["method"] in ("POST", "PUT", "PATCH") else None
    if name == "run_command":
        timeout = int(args.get("timeout") or 60)
        body = {"kind": "command", "payload": {"script": args["script"], "shell": args.get("shell", "auto")}, "timeout": max(5, min(timeout, 600))}
        status, data = await dispatch(request, "POST", path, None, body)
        if status >= 400:
            return text_result({"status": status, "data": data}, True)
        import asyncio

        deadline = time.monotonic() + body["timeout"] + 30
        job = data
        while time.monotonic() < deadline:
            status, job = await dispatch(request, "GET", "/api/jobs/" + data["id"])
            if status >= 400 or job.get("status") not in ("queued", "leased", "running"):
                break
            await asyncio.sleep(1.5)
        return text_result(job, status >= 400 or job.get("status") in ("failed", "expired", "unknown"))
    status, data = await dispatch(request, spec["method"], path, query, body)
    return text_result(data if status < 400 else {"status": status, "data": data}, status >= 400)


def instructions():
    return (
        "Speck manages Austin's endpoints (Windows/Linux agents), Proxmox/Linode/Slide infrastructure, GoDaddy DNS, "
        "UniFi public IPs, SSH keys and an encrypted credential vault. Start with speck_overview, then speck_search. "
        "Use provision_key to get API keys for a project (use the real repo name). Writes change live systems: only "
        "assign FREE public IPs, never touch resources you did not create without the human's confirmation, and keep "
        "secrets out of logs, commits and transcripts. speck_api reaches any endpoint in /api/openapi.json; the full "
        "guide is the speck://guide resource."
    )


async def handle(request, message):
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or "method" not in message:
        return rpc_error(message.get("id") if isinstance(message, dict) else None, -32600, "Invalid JSON-RPC request")
    ident, method, params = message.get("id"), message["method"], message.get("params") or {}
    if ident is None:
        return None  # Notifications (e.g. notifications/initialized) need no response.
    if method == "initialize":
        version = params.get("protocolVersion")
        return {"jsonrpc": "2.0", "id": ident, "result": {
            "protocolVersion": version if version in PROTOCOLS else PROTOCOLS[0],
            "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}},
            "serverInfo": {"name": "speck", "title": "Speck RMM", "version": VERSION},
            "instructions": instructions(),
        }}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": ident, "result": {}}
    if method == "tools/list":
        tools = [{k: t[k] for k in ("name", "description", "inputSchema", "annotations")} for t in TOOLS]
        return {"jsonrpc": "2.0", "id": ident, "result": {"tools": tools}}
    if method == "tools/call":
        try:
            result = await call_tool(request, params.get("name"), params.get("arguments"))
        except KeyError:
            return rpc_error(ident, -32602, "Unknown tool: " + str(params.get("name")))
        except (ValueError, TypeError) as exc:
            result = text_result(str(exc), True)
        return {"jsonrpc": "2.0", "id": ident, "result": result}
    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": ident, "result": {"resources": [
            {"uri": "speck://guide", "name": "Speck agent guide", "mimeType": "text/markdown"},
            {"uri": "speck://openapi", "name": "Speck OpenAPI schema", "mimeType": "application/json"},
        ]}}
    if method == "resources/read":
        uri = params.get("uri")
        if uri == "speck://guide":
            contents = {"uri": uri, "mimeType": "text/markdown", "text": guide_text()}
        elif uri == "speck://openapi":
            contents = {"uri": uri, "mimeType": "application/json", "text": json.dumps(openapi(request))}
        else:
            return rpc_error(ident, -32602, "Unknown resource")
        return {"jsonrpc": "2.0", "id": ident, "result": {"contents": [contents]}}
    if method in ("prompts/list", "resources/templates/list"):
        key = "prompts" if method == "prompts/list" else "resourceTemplates"
        return {"jsonrpc": "2.0", "id": ident, "result": {key: []}}
    return rpc_error(ident, -32601, "Method not found: " + method)


def unauthorized(message):
    return JSONResponse({"error": message}, status_code=401, headers={"WWW-Authenticate": 'Bearer realm="speck"'})


@router.post("/mcp", include_in_schema=False)
async def mcp(request: Request):
    if request.headers.get("origin") and request.headers["origin"] != origin():
        raise HTTPException(403, "Origin rejected")
    try:
        token = presented(request)
        if not token:
            return unauthorized("A Speck API token is required: Authorization: Bearer speck_pat_…")
        # Each tool call is re-authorized against its own REST path and method.
        authenticate(token, request)
    except HTTPException as exc:
        if exc.status_code == 401:
            return unauthorized(str(exc.detail))
        raise
    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse(rpc_error(None, -32700, "Parse error"), status_code=400)
    if isinstance(payload, list):
        responses = [r for r in [await handle(request, m) for m in payload[:50]] if r is not None]
        return JSONResponse(responses) if responses else Response(status_code=202)
    response = await handle(request, payload)
    return JSONResponse(response) if response is not None else Response(status_code=202)


@router.get("/mcp", include_in_schema=False)
def mcp_stream():
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp", include_in_schema=False)
def mcp_close():
    return Response(status_code=405, headers={"Allow": "POST"})
