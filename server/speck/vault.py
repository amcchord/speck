"""Encrypted credential vault and key arbiter (formerly AustinLand's /api/keys).

Entries hold named groups of environment-style secrets, sealed with the server
encryption key. Where a provider's management API allows it, ``provision``
mints a fresh project-scoped credential (OpenAI service accounts, Twilio API
keys) that can be revoked independently. Anthropic and App Store Connect keys
cannot be minted; they are shared and every recipient project is recorded.

Provider master credentials (the arbiter's OpenAI admin key, Twilio account,
GoDaddy and UniFi keys) live in ``vault_providers``. They are write-only through
the API: status and masked hints are visible, the values never are.

Administrator sessions may use the vault. API tokens additionally need
``keys:read`` (list, reveal) or ``keys:write`` (store, provision, delete) and may
be restricted to entry-name prefixes. Every reveal is audited without values.
"""

import asyncio
import json
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from speck.config import seal, unseal
from speck.db import audit, db
from speck.security import require_user

router = APIRouter(prefix="/api/keys")
NAME = re.compile(r"[A-Za-z0-9._-]{1,120}")
SECRET_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,99}")
MAX_VALUE = 65536
RESERVED = {"services", "provision", "static", "import"}
MINTABLE = ("openai", "twilio")
ARBITER = ("openai", "anthropic", "twilio", "app-store-connect")
APP_STORE_MASTER = "app-store-connect"
APP_STORE_SECRETS = ("APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_PRIVATE_KEY")
OPENAI = "https://api.openai.com/v1"
TWILIO = "https://api.twilio.com/2010-04-01"

# Master credentials the server uses on your behalf. "settings" are non-secret.
PROVIDERS: dict[str, dict[str, Any]] = {
    "openai": {
        "label": "OpenAI",
        "secrets": ["OPENAI_ADMIN_KEY"],
        "settings": [],
        "mode": "mint",
        "purpose": "Mints a dedicated OpenAI project and service-account key per project.",
    },
    "anthropic": {
        "label": "Anthropic",
        "secrets": ["ANTHROPIC_API_KEY"],
        "settings": [],
        "mode": "shared",
        "purpose": "Hands out the shared Anthropic API key and records each recipient project. "
        "Anthropic's Admin API cannot create API keys.",
    },
    "twilio": {
        "label": "Twilio",
        "secrets": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        "settings": [],
        "mode": "mint",
        "purpose": "Mints a named, independently revocable Twilio API key per project.",
    },
    "godaddy": {
        "label": "GoDaddy DNS",
        "secrets": ["GODADDY_API_KEY", "GODADDY_API_SECRET"],
        "settings": [],
        "mode": "provider",
        "purpose": "Manages domains and DNS records on the DNS page.",
    },
    "unifi": {
        "label": "UniFi Site Manager",
        "secrets": ["UNIFI_API_KEY"],
        "settings": ["UNIFI_GATEWAY"],
        "mode": "provider",
        "purpose": "Reaches the gateway through UniFi's cloud connector for public IPs, NAT and LAN clients. "
        "UNIFI_GATEWAY is the gateway's LAN IP or console ID.",
    },
}


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS vault_entries(
      name TEXT PRIMARY KEY,service TEXT NOT NULL,kind TEXT NOT NULL,project TEXT,notes TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',secret_names TEXT NOT NULL,secrets TEXT NOT NULL,created REAL NOT NULL,
      updated REAL NOT NULL,created_by TEXT NOT NULL,origin TEXT NOT NULL DEFAULT 'speck',
      revealed REAL,reveals INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vault_providers(
      service TEXT PRIMARY KEY,secrets TEXT NOT NULL,settings TEXT NOT NULL DEFAULT '{}',updated REAL NOT NULL,updated_by TEXT NOT NULL);
    """)


# ---------------- access ----------------


def access(user, write=False):
    if user.get("via") == "token":
        scope = "keys:write" if write else "keys:read"
        if scope not in user["scopes"]:
            raise HTTPException(403, "This API token needs the " + scope + " scope")
    if user["role"] != "admin":
        raise HTTPException(403, "Administrator access required for the vault")
    return user


def readers(request: Request):
    return access(require_user(request))


def writers(request: Request):
    return access(require_user(request), write=True)


def permitted(user, name):
    prefixes = user.get("key_prefixes") or []
    return not prefixes or any(name.startswith(p) for p in prefixes)


def require_permitted(user, name):
    if not permitted(user, name):
        raise HTTPException(404, "No key named '" + name + "'")


# ---------------- storage helpers ----------------


def slug(text):
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", (text or "").strip()).strip("-.")[:120]
    if not value:
        raise HTTPException(422, "Name must contain letters or digits")
    if value.lower() in RESERVED:
        raise HTTPException(422, "That name is reserved by the vault API")
    return value


def mask(value):
    value = str(value)
    if len(value) <= 12:
        return "•" * 4 + f" ({len(value)} chars)"
    return value[:4] + "…" + value[-4:]


def clean_secrets(secrets):
    cleaned = {}
    for key, value in (secrets or {}).items():
        key = key.strip()
        if not SECRET_NAME.fullmatch(key):
            raise HTTPException(422, "Secret names must look like environment variables: " + key[:40])
        if not isinstance(value, str):
            raise HTTPException(422, "Secret values must be strings")
        if len(value) > MAX_VALUE:
            raise HTTPException(413, "Secret " + key + " exceeds 64 KiB")
        if value:
            cleaned[key] = value
    if len(cleaned) > 64:
        raise HTTPException(422, "An entry can hold at most 64 secrets")
    return cleaned


def row_entry(row, reveal=False):
    item = {
        "name": row["name"],
        "service": row["service"],
        "kind": row["kind"],
        "project": row["project"],
        "notes": row["notes"],
        "meta": json.loads(row["meta"]),
        "created": row["created"],
        "updated": row["updated"],
        "created_by": row["created_by"],
        "origin": row["origin"],
        "revealed": row["revealed"],
        "reveals": row["reveals"],
        "secret_names": json.loads(row["secret_names"]),
    }
    secrets = json.loads(unseal(row["secrets"]))
    if reveal:
        item["secrets"] = secrets
    else:
        item["hints"] = {k: mask(v) for k, v in secrets.items()}
    return item


def load(conn, name):
    return conn.execute("SELECT * FROM vault_entries WHERE name=?", (name,)).fetchone()


def store(conn, entry, actor, origin="speck"):
    now = time.time()
    secrets = clean_secrets(entry["secrets"])
    if not secrets:
        raise HTTPException(422, "Provide at least one secret value")
    conn.execute(
        "INSERT INTO vault_entries(name,service,kind,project,notes,meta,secret_names,secrets,created,updated,created_by,origin) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            entry["name"],
            entry["service"],
            entry["kind"],
            entry.get("project"),
            entry.get("notes", ""),
            json.dumps(entry.get("meta") or {}),
            json.dumps(sorted(secrets)),
            seal(json.dumps(secrets)),
            entry.get("created") or now,
            now,
            actor,
            origin,
        ),
    )


def record_reveal(conn, user, name, how="reveal"):
    conn.execute("UPDATE vault_entries SET revealed=?,reveals=reveals+1 WHERE name=?", (time.time(), name))
    audit(conn, user["username"], "vault." + how, detail={"name": name})


def entry_secrets(name):
    """Server-side lookup used by other modules (never returned to callers here)."""
    with db() as conn:
        row = load(conn, name)
    return json.loads(unseal(row["secrets"])) if row else None


# ---------------- provider credentials ----------------


def provider(service):
    """Decrypted provider credentials and settings, or None if not configured."""
    with db() as conn:
        row = conn.execute("SELECT * FROM vault_providers WHERE service=?", (service,)).fetchone()
    if not row:
        return None
    return json.loads(unseal(row["secrets"])) | json.loads(row["settings"])


def require_provider(service):
    values = provider(service)
    missing = [k for k in PROVIDERS[service]["secrets"] if not (values or {}).get(k)]
    if missing:
        raise HTTPException(
            503, PROVIDERS[service]["label"] + " is not configured. Add it under Keys → Providers."
        )
    return values


def provider_errors(service, values):
    values = values or {}
    if service == "twilio" and values.get("TWILIO_ACCOUNT_SID") and not values["TWILIO_ACCOUNT_SID"].startswith("AC"):
        return "TWILIO_ACCOUNT_SID must be the account SID (starts with AC), not an API key SID"
    if service == "app-store-connect":
        with db() as conn:
            row = load(conn, APP_STORE_MASTER)
        if not row:
            return None
        secrets = json.loads(unseal(row["secrets"]))
        missing = [k for k in APP_STORE_SECRETS if not secrets.get(k)]
        if missing:
            return "Vault entry app-store-connect is missing " + ", ".join(missing)
        if "BEGIN PRIVATE KEY" not in secrets["APP_STORE_CONNECT_PRIVATE_KEY"]:
            return "APP_STORE_CONNECT_PRIVATE_KEY must contain the downloaded .p8 private key"
    return None


def services_status():
    with db() as conn:
        rows = {r["service"]: r for r in conn.execute("SELECT * FROM vault_providers")}
        app_store = load(conn, APP_STORE_MASTER)
    out = []
    for service, spec in PROVIDERS.items():
        row = rows.get(service)
        secrets = json.loads(unseal(row["secrets"])) if row else {}
        settings = json.loads(row["settings"]) if row else {}
        error = provider_errors(service, secrets)
        out.append(
            {
                "service": service,
                "label": spec["label"],
                "mode": spec["mode"],
                "description": spec["purpose"],
                "secret_fields": spec["secrets"],
                "setting_fields": spec["settings"],
                "configured": bool(row) and all(secrets.get(k) for k in spec["secrets"]) and not error,
                "hints": {k: mask(v) for k, v in secrets.items()},
                "settings": settings,
                "updated": row["updated"] if row else None,
                "updated_by": row["updated_by"] if row else None,
                "configuration_error": error,
                "arbiter": service in ARBITER,
                "last_check": CHECKS.get(service),
            }
        )
    error = provider_errors("app-store-connect", {})
    out.append(
        {
            "service": "app-store-connect",
            "label": "App Store Connect",
            "mode": "shared",
            "description": "Hands out the shared Apple App Store Connect Team API key from the vault entry "
            "named app-store-connect and records each recipient project.",
            "secret_fields": [],
            "setting_fields": [],
            "configured": bool(app_store) and not error,
            "hints": {},
            "settings": {},
            "updated": app_store["updated"] if app_store else None,
            "updated_by": None,
            "configuration_error": error,
            "arbiter": True,
            "master_entry": APP_STORE_MASTER,
            "last_check": CHECKS.get("app-store-connect"),
        }
    )
    return out


@router.get("/services")
def services(user=Depends(readers)):
    return services_status()


class ProviderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    secrets: dict[str, str] = Field(default_factory=dict)
    settings: dict[str, str] = Field(default_factory=dict)


@router.put("/services/{service}")
def set_provider(service: str, body: ProviderBody, user=Depends(writers)):
    spec = PROVIDERS.get(service)
    if not spec:
        raise HTTPException(404, "Unknown provider. One of: " + ", ".join(PROVIDERS))
    if set(body.secrets) - set(spec["secrets"]) or set(body.settings) - set(spec["settings"]):
        raise HTTPException(422, "Unsupported fields for " + spec["label"])
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM vault_providers WHERE service=?", (service,)).fetchone()
        secrets = json.loads(unseal(row["secrets"])) if row else {}
        settings = json.loads(row["settings"]) if row else {}
        # A blank value keeps the stored secret, so forms never need to echo it back.
        secrets |= {k: v.strip() for k, v in body.secrets.items() if v.strip()}
        settings |= {k: v.strip() for k, v in body.settings.items()}
        if any(len(v) > MAX_VALUE for v in secrets.values()):
            raise HTTPException(413, "Credential too large")
        error = provider_errors(service, secrets)
        if error:
            raise HTTPException(422, error)
        conn.execute(
            "INSERT INTO vault_providers VALUES(?,?,?,?,?) ON CONFLICT(service) DO UPDATE SET "
            "secrets=excluded.secrets,settings=excluded.settings,updated=excluded.updated,updated_by=excluded.updated_by",
            (service, seal(json.dumps(secrets)), json.dumps(settings), time.time(), user["username"]),
        )
        audit(conn, user["username"], "vault.provider.saved", detail={"service": service, "fields": sorted(body.secrets)})
    if service == "unifi":
        from speck import unifi

        unifi.forget_lookups()
    return next(s for s in services_status() if s["service"] == service)


CHECKS: dict[str, dict] = {}


def app_store_jwt(secrets):
    """A 10-minute App Store Connect API token signed with the stored .p8 key (ES256)."""
    import base64

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = {"alg": "ES256", "kid": secrets["APP_STORE_CONNECT_KEY_ID"], "typ": "JWT"}
    claims = {"iss": secrets["APP_STORE_CONNECT_ISSUER_ID"], "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}
    signing = b64(json.dumps(header).encode()) + "." + b64(json.dumps(claims).encode())
    key = serialization.load_pem_private_key(secrets["APP_STORE_CONNECT_PRIVATE_KEY"].encode(), password=None)
    r, s = decode_dss_signature(key.sign(signing.encode(), ec.ECDSA(hashes.SHA256())))
    return signing + "." + b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


async def check_provider(service):
    """One read-only upstream call proving the stored credential works."""
    if service == "openai":
        data = await openai_admin("GET", "/organization/projects?limit=100")
        return f"{len((data or {}).get('data', []))} projects visible to the admin key"
    if service == "anthropic":
        key = require_provider("anthropic")["ANTHROPIC_API_KEY"]
        data = await upstream("GET", "https://api.anthropic.com/v1/models?limit=100",
                              headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, label="Anthropic")
        return f"{len((data or {}).get('data', []))} models available"
    if service == "twilio":
        data = await twilio_api("GET", ".json")
        return f"Account {data.get('friendly_name', '')} is {data.get('status', 'unknown')}"
    if service == "godaddy":
        from speck.dns import godaddy

        data = await godaddy("GET", "/domains", params={"limit": 5, "statuses": "ACTIVE"})
        return f"Domain API reachable ({len(data or [])} sample domains)"
    if service == "unifi":
        from speck.unifi import hosts

        return f"{len(await hosts())} consoles visible to the Site Manager key"
    if service == "app-store-connect":
        secrets = entry_secrets(APP_STORE_MASTER)
        if not secrets or provider_errors("app-store-connect", {}):
            raise HTTPException(503, provider_errors("app-store-connect", {}) or "Store the app-store-connect entry first")
        data = await upstream("GET", "https://api.appstoreconnect.apple.com/v1/apps?limit=200&fields[apps]=name",
                              headers={"Authorization": "Bearer " + app_store_jwt(secrets)}, label="App Store Connect")
        return f"{len((data or {}).get('data', []))} apps visible to the Team key"
    raise HTTPException(404, "Unknown provider")


@router.post("/services/{service}/check")
async def check(service: str, user=Depends(readers)):
    """Verify a provider credential with a single read-only request. Never mints or changes anything."""
    started = time.monotonic()
    try:
        detail, ok = await check_provider(service), True
    except HTTPException as exc:
        if exc.status_code == 404 and service not in PROVIDERS and service != "app-store-connect":
            raise
        detail, ok = str(exc.detail), False
    result = {"service": service, "ok": ok, "detail": detail, "checked_at": time.time(),
              "latency_ms": int((time.monotonic() - started) * 1000)}
    CHECKS[service] = result
    with db(write=True) as conn:
        audit(conn, user["username"], "vault.provider.checked", detail={"service": service, "ok": ok})
    return result


@router.delete("/services/{service}")
def remove_provider(service: str, user=Depends(writers)):
    if service not in PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    with db(write=True) as conn:
        conn.execute("DELETE FROM vault_providers WHERE service=?", (service,))
        audit(conn, user["username"], "vault.provider.removed", detail={"service": service})
    return {"ok": True}


# ---------------- upstream provider calls ----------------


async def upstream(method, url, *, headers=None, json_body=None, form=None, auth=None, label="Provider"):
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=False, trust_env=False, auth=auth) as client:
            response = await client.request(method, url, headers=headers, json=json_body, data=form)
    except httpx.HTTPError:
        raise HTTPException(502, label + " is unreachable; a write may have completed. Inspect before retrying.") from None
    if response.status_code >= 400:
        message = ""
        try:
            body = response.json()
            error = body.get("error") if isinstance(body, dict) else None
            message = (error.get("message") if isinstance(error, dict) else body.get("message")) or ""
        except (ValueError, AttributeError):
            pass
        raise HTTPException(
            502 if response.status_code >= 500 else response.status_code,
            f"{label} returned HTTP {response.status_code}" + (": " + str(message)[:300] if message else ""),
        )
    return response.json() if response.content else None


async def openai_admin(method, path, body=None):
    key = require_provider("openai")["OPENAI_ADMIN_KEY"]
    return await upstream(method, OPENAI + path, headers={"Authorization": "Bearer " + key}, json_body=body, label="OpenAI")


async def twilio_api(method, path, form=None):
    creds = require_provider("twilio")
    if provider_errors("twilio", creds):
        raise HTTPException(503, provider_errors("twilio", creds))
    return await upstream(
        method,
        TWILIO + "/Accounts/" + creds["TWILIO_ACCOUNT_SID"] + path,
        form=form,
        auth=(creds["TWILIO_ACCOUNT_SID"], creds["TWILIO_AUTH_TOKEN"]),
        label="Twilio",
    )


async def mint_openai(project, label):
    created = await openai_admin("POST", "/organization/projects", {"name": label})
    project_id = created["id"]
    try:
        account = await openai_admin(
            "POST", "/organization/projects/" + project_id + "/service_accounts", {"name": label}
        )
    except HTTPException:
        try:
            await openai_admin("POST", "/organization/projects/" + project_id + "/archive")
        except HTTPException:
            pass
        raise
    key = (account.get("api_key") or {}).get("value")
    if not key:
        raise HTTPException(502, "OpenAI created the service account but returned no key")
    return {
        "secrets": {"OPENAI_API_KEY": key},
        "meta": {"project_id": project_id, "service_account_id": account.get("id")},
        "notes": f"OpenAI project '{label}' ({project_id}). The key belongs to service account "
        f"{account.get('id')} and only works inside that project.",
    }


async def mint_twilio(project, label):
    key = await twilio_api("POST", "/Keys.json", {"FriendlyName": label})
    sid = require_provider("twilio")["TWILIO_ACCOUNT_SID"]
    return {
        "secrets": {"TWILIO_ACCOUNT_SID": sid, "TWILIO_API_KEY_SID": key["sid"], "TWILIO_API_KEY_SECRET": key["secret"]},
        "meta": {"key_sid": key["sid"]},
        "notes": f"Twilio standard API key '{label}'. Authenticate with the key SID and secret against account {sid}.",
    }


def share_anthropic(project, label):
    key = require_provider("anthropic")["ANTHROPIC_API_KEY"]
    return {
        "secrets": {"ANTHROPIC_API_KEY": key},
        "meta": {},
        "notes": f"Shared Anthropic API key recorded for project '{project}'. Anthropic's Admin API cannot mint keys.",
    }


def share_app_store(project, label):
    error = provider_errors("app-store-connect", {})
    source = entry_secrets(APP_STORE_MASTER)
    if error or not source:
        raise HTTPException(503, error or "Store the master Team key as vault entry app-store-connect first")
    return {
        "secrets": {k: source[k] for k in APP_STORE_SECRETS},
        "meta": {"source_entry": APP_STORE_MASTER},
        "notes": f"Shared App Store Connect Team API key from '{APP_STORE_MASTER}', recorded for project '{project}'. "
        "Sign ES256 JWTs with it; never commit or log the private key.",
    }


async def revoke_upstream(entry):
    revoked = []
    meta = entry["meta"]
    if entry["kind"] != "minted":
        return revoked
    if entry["service"] == "openai" and meta.get("project_id"):
        for delay in (0, 0.25, 0.5, 1.0):
            if delay:
                await asyncio.sleep(delay)
            try:
                if meta.get("service_account_id"):
                    await openai_admin(
                        "DELETE",
                        f"/organization/projects/{meta['project_id']}/service_accounts/{meta['service_account_id']}",
                    )
                break
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
        if meta.get("service_account_id"):
            revoked.append("service account " + meta["service_account_id"])
        try:
            await openai_admin("POST", f"/organization/projects/{meta['project_id']}/archive")
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        revoked.append("project " + meta["project_id"] + " archived")
    elif entry["service"] == "twilio" and meta.get("key_sid"):
        try:
            await twilio_api("DELETE", "/Keys/" + meta["key_sid"] + ".json")
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        revoked.append("Twilio key " + meta["key_sid"])
    return revoked


# ---------------- arbiter ----------------


class ProvisionBody(BaseModel):
    service: str = Field(max_length=40)
    project: str = Field(min_length=1, max_length=100)


_locks: dict[int, asyncio.Lock] = {}


def provisioning_lock():
    """Serialize provisioning so one project never mints two upstream keys."""
    return _locks.setdefault(id(asyncio.get_running_loop()), asyncio.Lock())


@router.post("/provision")
async def provision(body: ProvisionBody, user=Depends(writers)):
    """Get a key for a project. Idempotent: the same service + project returns the stored entry."""
    service = body.service.strip().lower()
    if service not in ARBITER:
        raise HTTPException(
            422,
            f"Unknown service '{service}'. One of: {', '.join(ARBITER)}. Store anything else with POST /api/keys/static.",
        )
    project = slug(body.project)
    name = project + "-" + service
    require_permitted(user, name)
    async with provisioning_lock():
        with db() as conn:
            existing = load(conn, name)
        if existing:
            with db(write=True) as conn:
                record_reveal(conn, user, name, "provision.reused")
            return {"created": False, "entry": row_entry(existing, reveal=True)}
        label = "speck-" + project
        if service == "openai":
            minted, kind = await mint_openai(project, label), "minted"
        elif service == "twilio":
            minted, kind = await mint_twilio(project, label), "minted"
        elif service == "anthropic":
            minted, kind = share_anthropic(project, label), "shared"
        else:
            minted, kind = share_app_store(project, label), "shared"
        entry = {"name": name, "service": service, "kind": kind, "project": project} | minted
        with db(write=True) as conn:
            store(conn, entry, user["username"])
            audit(conn, user["username"], "vault.provisioned", detail={"name": name, "service": service, "kind": kind})
            row = load(conn, name)
    return {"created": True, "entry": row_entry(row, reveal=True)}


# ---------------- entries ----------------


@router.get("")
def list_entries(q: str = "", service: str = "", project: str = "", user=Depends(readers)):
    """All entries the caller may read, with masked value hints. GET /api/keys/{name} reveals values."""
    with db() as conn:
        rows = conn.execute("SELECT * FROM vault_entries ORDER BY lower(name)").fetchall()
    needle = q.strip().lower()
    out = []
    for row in rows:
        if not permitted(user, row["name"]):
            continue
        if service and row["service"] != service:
            continue
        if project and (row["project"] or "") != project:
            continue
        haystack = " ".join([row["name"], row["service"], row["project"] or "", row["notes"], row["secret_names"]]).lower()
        if needle and needle not in haystack:
            continue
        out.append(row_entry(row))
    return out


class StaticBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    service: str = Field(default="", max_length=60)
    project: str = Field(default="", max_length=100)
    secrets: dict[str, str] = Field(default_factory=dict)
    value: str = Field(default="", max_length=MAX_VALUE)
    notes: str = Field(default="", max_length=4000)


@router.post("/static")
def add_static(body: StaticBody, user=Depends(writers)):
    """Store any credential: ``secrets`` as {ENV_NAME: value} or a single ``value``."""
    name = slug(body.name)
    require_permitted(user, name)
    secrets = dict(body.secrets)
    if body.value:
        secrets.setdefault(re.sub(r"[^A-Za-z0-9]+", "_", name).upper().strip("_") or "VALUE", body.value)
    entry = {
        "name": name,
        "service": slug(body.service).lower() if body.service.strip() else "custom",
        "kind": "static",
        "project": slug(body.project) if body.project.strip() else None,
        "notes": body.notes.strip(),
        "secrets": secrets,
    }
    with db(write=True) as conn:
        if load(conn, name):
            raise HTTPException(409, f"A key named '{name}' already exists; update it or choose another name")
        store(conn, entry, user["username"])
        audit(conn, user["username"], "vault.stored", detail={"name": name, "secrets": sorted(clean_secrets(secrets))})
        row = load(conn, name)
    return {"created": True, "entry": row_entry(row)}


class ImportEntry(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    service: str = Field(default="custom", max_length=60)
    kind: str = Field(default="static", pattern=r"^(static|minted|shared)$")
    project: str | None = Field(default=None, max_length=100)
    notes: str = Field(default="", max_length=4000)
    meta: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str]
    created: float | str | None = None

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if not NAME.fullmatch(value) or value.lower() in RESERVED:
            raise ValueError("Invalid entry name")
        return value


class ImportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(default="import", max_length=40, pattern=r"^[a-z0-9-]+$")
    entries: list[ImportEntry] = Field(max_length=1000)


def timestamp(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value:
        from datetime import datetime

        try:
            return datetime.fromisoformat(value).timestamp()
        except ValueError:
            return None
    return None


@router.post("/import")
def import_entries(body: ImportBody, user=Depends(writers)):
    """Bulk import that preserves kind and revocation metadata. Existing names are never overwritten."""
    created, skipped = [], []
    with db(write=True) as conn:
        for item in body.entries:
            if not permitted(user, item.name) or load(conn, item.name):
                skipped.append(item.name)
                continue
            meta = {k: v for k, v in item.meta.items() if isinstance(v, (str, int, float, bool)) or v is None}
            store(
                conn,
                {
                    "name": item.name,
                    "service": item.service,
                    "kind": item.kind,
                    "project": item.project,
                    "notes": item.notes,
                    "meta": meta,
                    "secrets": item.secrets,
                    "created": timestamp(item.created),
                },
                user["username"],
                origin=body.source,
            )
            created.append(item.name)
        audit(conn, user["username"], "vault.imported", detail={"source": body.source, "created": created, "skipped": skipped})
    return {"created": created, "skipped": skipped}


@router.get("/{name}")
def get_entry(name: str, user=Depends(readers)):
    """The full entry including secret values. Audited."""
    require_permitted(user, name)
    with db(write=True) as conn:
        row = load(conn, name)
        if not row:
            raise HTTPException(404, f"No key named '{name}'")
        record_reveal(conn, user, name)
    return row_entry(row, reveal=True)


def dotenv_value(value):
    if re.fullmatch(r"[A-Za-z0-9_./:@+-]*", value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


@router.get("/{name}/env", response_class=PlainTextResponse)
def get_env(name: str, user=Depends(readers)):
    """The entry's secrets as .env lines, for writing straight into a gitignored file."""
    require_permitted(user, name)
    with db(write=True) as conn:
        row = load(conn, name)
        if not row:
            raise HTTPException(404, f"No key named '{name}'")
        record_reveal(conn, user, name, "reveal.env")
    secrets = json.loads(unseal(row["secrets"]))
    lines = [f"# Speck vault entry {name} ({row['service']})"]
    lines += [f"{k}={dotenv_value(v)}" for k, v in sorted(secrets.items())]
    return PlainTextResponse("\n".join(lines) + "\n")


class UpdateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: str | None = Field(default=None, max_length=60)
    project: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=4000)
    secrets: dict[str, str | None] = Field(default_factory=dict)
    replace: bool = False


@router.put("/{name}")
def update_entry(name: str, body: UpdateBody, user=Depends(writers)):
    """Edit metadata or secrets. Secrets merge by name; null removes one; ``replace`` swaps the whole set."""
    require_permitted(user, name)
    with db(write=True) as conn:
        row = load(conn, name)
        if not row:
            raise HTTPException(404, f"No key named '{name}'")
        secrets = {} if body.replace else json.loads(unseal(row["secrets"]))
        for key, value in body.secrets.items():
            if value is None:
                secrets.pop(key, None)
            else:
                secrets[key] = value
        secrets = clean_secrets(secrets)
        if not secrets:
            raise HTTPException(422, "An entry needs at least one secret; delete it instead")
        conn.execute(
            "UPDATE vault_entries SET service=?,project=?,notes=?,secret_names=?,secrets=?,updated=? WHERE name=?",
            (
                slug(body.service).lower() if body.service else row["service"],
                (slug(body.project) if body.project else None) if body.project is not None else row["project"],
                body.notes.strip() if body.notes is not None else row["notes"],
                json.dumps(sorted(secrets)),
                seal(json.dumps(secrets)),
                time.time(),
                name,
            ),
        )
        audit(conn, user["username"], "vault.updated", detail={"name": name, "changed": sorted(body.secrets)})
        row = load(conn, name)
    return row_entry(row)


@router.delete("/{name}")
async def delete_entry(name: str, revoke: bool = True, user=Depends(writers)):
    """Remove an entry. Minted keys are revoked upstream first unless ``?revoke=false``."""
    require_permitted(user, name)
    with db() as conn:
        row = load(conn, name)
    if not row:
        raise HTTPException(404, f"No key named '{name}'")
    entry = row_entry(row)
    revoked = await revoke_upstream(entry) if revoke else []
    with db(write=True) as conn:
        conn.execute("DELETE FROM vault_entries WHERE name=?", (name,))
        audit(conn, user["username"], "vault.deleted", detail={"name": name, "revoked": revoked})
    return {"ok": True, "revoked": revoked}
