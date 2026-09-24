"""AustinLand features in Speck: API tokens, vault, DNS, UniFi, SSH keys, handoffs, map and MCP.

Providers are replaced at the HTTP layer, so these tests exercise the real request
paths and bodies without contacting OpenAI, Twilio, GoDaddy, UniFi or Linode.
"""

import json
import re
import sqlite3
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from speck import api_tokens, dns, unifi, vault
from speck.config import data_dir
from speck.db import db
from speck.main import app

PUBLIC = ["5.5.5.1", "5.5.5.10", "5.5.5.11", "5.5.5.12"]


class Upstream:
    """Scripted provider responses keyed by method and URL pattern; records every call."""

    def __init__(self):
        self.routes, self.calls = [], []

    def on(self, method, pattern, response=None, status=200):
        self.routes.insert(0, (method, re.compile(pattern), response, status))

    def handle(self, request):
        body = request.content.decode() if request.content else ""
        self.calls.append((request.method, str(request.url), body, dict(request.headers)))
        for method, pattern, response, status in self.routes:
            if method == request.method and pattern.search(str(request.url)):
                value = response(request) if callable(response) else response
                if isinstance(value, httpx.Response):
                    return value
                return httpx.Response(status, json=value)
        return httpx.Response(599, json={"message": "unexpected " + request.method + " " + str(request.url)})

    def methods(self, fragment):
        return [(m, u) for m, u, _, _ in self.calls if fragment in u]


@pytest.fixture
def upstream(monkeypatch):
    fake = Upstream()
    real = httpx.AsyncClient

    class Client(real):
        def __init__(self, *args, **kwargs):
            kwargs.setdefault("transport", httpx.MockTransport(fake.handle))
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    dns.bucket.tokens = dns.bucket.capacity
    unifi.forget_lookups()
    vault.CHECKS.clear()
    return fake


def token(client, scopes, name="agent", **extra):
    response = client.post("/api/tokens", json={"name": name, "scopes": scopes, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def bearer(value):
    # No Origin or CSRF header: bearer tokens must work like any API client.
    return TestClient(app, base_url="https://testserver", headers={"Authorization": "Bearer " + value})


def audit_rows(action):
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM audit WHERE action=? ORDER BY id", (action,))]


# ---------------- API tokens ----------------


def test_tokens_act_as_owner_with_scope_caps_and_attribution(client):
    reader = token(client, ["read"], "reader")
    assert reader["token"].startswith("speck_pat_") and reader["scopes"] == ["read"]
    with db() as conn:
        stored = dict(conn.execute("SELECT * FROM api_tokens WHERE id=?", (reader["id"],)).fetchone())
    assert reader["token"] not in json.dumps(stored)
    assert reader["token"] not in client.get("/api/tokens").text

    r = bearer(reader["token"])
    assert r.get("/api/fleet").status_code == 200
    assert r.get("/api/auth/me").json()["role"] == "admin"
    assert r.get("/api/whoami").json()["scopes"] == ["read"]
    assert r.post("/api/enrollments", json={"label": "x"}).status_code == 403
    assert r.put("/api/keys/services/openai", json={"secrets": {}}).status_code == 403
    assert r.post("/api/devices/none/jobs", json={"kind": "command", "payload": {"script": "id"}}).status_code == 403
    assert r.post("/api/tokens", json={"name": "x", "scopes": ["read"]}).status_code == 403
    assert r.get("/api/tokens").status_code == 403

    writer = bearer(token(client, ["read", "admin"], "writer")["token"])
    created = writer.post("/api/ssh/generate", json={"name": "deploy"})
    assert created.status_code == 200
    assert audit_rows("ssh.generated")[-1]["actor"] == "admin (API: writer)"

    operator = bearer(token(client, ["operate"], "ops")["token"])
    assert operator.post("/api/ssh/generate", json={"name": "other"}).status_code == 403

    vault_only = bearer(token(client, ["keys:read"], "vault")["token"])
    assert vault_only.get("/api/fleet").status_code == 403
    assert vault_only.get("/api/keys").status_code == 200

    assert client.delete("/api/tokens/" + reader["id"]).status_code == 200
    assert r.get("/api/fleet").status_code == 401
    with db(write=True) as conn:
        conn.execute("UPDATE api_tokens SET expires=? WHERE name='writer'", (time.time() - 1,))
    assert writer.get("/api/fleet").status_code == 401
    assert bearer("speck_pat_short").get("/api/fleet").status_code == 401


def test_token_creation_respects_roles_and_rate_limit(client, monkeypatch):
    assert client.post("/api/access/users", json={"username": "op", "password": "operator-password-123", "role": "operator"}).status_code == 200
    session = TestClient(app, base_url="https://testserver")
    login = session.post("/api/auth/login", json={"username": "op", "password": "operator-password-123"}, headers={"Origin": "https://testserver"})
    session.headers.update({"Origin": "https://testserver", "X-CSRF-Token": login.json()["csrf"]})
    assert session.post("/api/tokens", json={"name": "x", "scopes": ["admin"]}).status_code == 403
    assert session.post("/api/tokens", json={"name": "x", "scopes": ["keys:read"]}).status_code == 403
    ops = session.post("/api/tokens", json={"name": "ops", "scopes": ["operate"]}).json()
    assert bearer(ops["token"]).get("/api/whoami").json()["role"] == "operator"
    assert [t["name"] for t in session.get("/api/tokens").json()] == ["ops"]
    assert client.post("/api/tokens", json={"name": "bad", "scopes": ["root"]}).status_code == 422

    monkeypatch.setattr(api_tokens, "RATE_PER_MINUTE", 3)
    limited = bearer(token(client, ["read"], "limited")["token"])
    assert [limited.get("/api/whoami").status_code for _ in range(4)] == [200, 200, 200, 429]


# ---------------- vault ----------------


def test_vault_entries_are_sealed_masked_and_reveals_audited(client):
    stored = client.post("/api/keys/static", json={
        "name": "shop-db", "service": "postgres", "project": "shop", "notes": "primary",
        "secrets": {"DATABASE_URL": "postgres://u:very-secret-value@db/shop", "PGPASSWORD": "tiny"},
    })
    assert stored.status_code == 200 and "secrets" not in stored.json()["entry"]
    listing = client.get("/api/keys").json()
    assert listing[0]["hints"]["DATABASE_URL"] == "post…shop" and listing[0]["hints"]["PGPASSWORD"] == "•••• (4 chars)"
    assert "very-secret-value" not in json.dumps(listing)
    raw = sqlite3.connect(data_dir() / "speck.db").execute("SELECT secrets FROM vault_entries").fetchone()[0]
    assert "very-secret-value" not in raw

    full = client.get("/api/keys/shop-db").json()
    assert full["secrets"]["PGPASSWORD"] == "tiny"
    env = client.get("/api/keys/shop-db/env").text
    assert "PGPASSWORD=tiny" in env and 'DATABASE_URL=postgres://u:very-secret-value@db/shop' in env
    reveals = audit_rows("vault.reveal") + audit_rows("vault.reveal.env")
    assert len(reveals) == 2 and all("very-secret" not in r["detail"] for r in reveals)
    assert client.get("/api/keys").json()[0]["reveals"] == 2

    updated = client.put("/api/keys/shop-db", json={"secrets": {"PGPASSWORD": None, "PGUSER": "app"}, "notes": "moved"})
    assert updated.json()["secret_names"] == ["DATABASE_URL", "PGUSER"] and updated.json()["notes"] == "moved"
    assert client.put("/api/keys/shop-db", json={"secrets": {"DATABASE_URL": None, "PGUSER": None}}).status_code == 422
    assert client.post("/api/keys/static", json={"name": "shop-db", "value": "x"}).status_code == 409
    assert client.post("/api/keys/static", json={"name": "services", "value": "x"}).status_code == 422
    assert client.post("/api/keys/static", json={"name": "bad", "secrets": {"1BAD": "x"}}).status_code == 422
    single = client.post("/api/keys/static", json={"name": "misc.token", "value": "abc"}).json()["entry"]
    assert single["secret_names"] == ["MISC_TOKEN"]
    assert client.delete("/api/keys/shop-db").json() == {"ok": True, "revoked": []}
    assert client.get("/api/keys/shop-db").status_code == 404


def test_vault_scopes_and_name_prefixes(client):
    for name in ("lucea-db", "lucea-mail", "other-db"):
        client.post("/api/keys/static", json={"name": name, "value": "v-" + name})
    limited = bearer(token(client, ["keys:read"], "lucea", key_prefixes=["lucea"])["token"])
    assert [e["name"] for e in limited.get("/api/keys").json()] == ["lucea-db", "lucea-mail"]
    assert limited.get("/api/keys/other-db").status_code == 404
    assert limited.get("/api/keys/lucea-db").json()["secrets"] == {"LUCEA_DB": "v-lucea-db"}
    assert limited.post("/api/keys/static", json={"name": "lucea-new", "value": "x"}).status_code == 403
    writer = bearer(token(client, ["keys:write"], "lucea-writer", key_prefixes=["lucea"])["token"])
    assert writer.post("/api/keys/static", json={"name": "other-new", "value": "x"}).status_code == 404
    assert writer.post("/api/keys/static", json={"name": "lucea-new", "value": "x"}).status_code == 200
    assert writer.get("/api/keys").status_code == 403


def test_provider_credentials_are_write_only_and_validated(client):
    saved = client.put("/api/keys/services/twilio", json={"secrets": {"TWILIO_ACCOUNT_SID": "SK123", "TWILIO_AUTH_TOKEN": "t" * 32}})
    assert saved.status_code == 422 and "account SID" in saved.text
    saved = client.put("/api/keys/services/godaddy", json={"secrets": {"GODADDY_API_KEY": "key-value-123456", "GODADDY_API_SECRET": "secret-value-1234"}})
    assert saved.status_code == 200 and saved.json()["configured"]
    assert "secret-value-1234" not in client.get("/api/keys/services").text
    client.put("/api/keys/services/godaddy", json={"secrets": {"GODADDY_API_KEY": "rotated-key-123456", "GODADDY_API_SECRET": ""}})
    assert vault.provider("godaddy") == {"GODADDY_API_KEY": "rotated-key-123456", "GODADDY_API_SECRET": "secret-value-1234"}
    assert client.put("/api/keys/services/godaddy", json={"secrets": {"OTHER": "x"}}).status_code == 422
    assert client.put("/api/keys/services/nope", json={}).status_code == 404
    assert audit_rows("vault.provider.saved")[-1]["detail"] == json.dumps({"service": "godaddy", "fields": ["GODADDY_API_KEY", "GODADDY_API_SECRET"]})


def test_provisioning_mints_reuses_and_revokes_openai_keys(client, upstream):
    client.put("/api/keys/services/openai", json={"secrets": {"OPENAI_ADMIN_KEY": "sk-admin-test-value"}})
    upstream.on("POST", r"/organization/projects$", {"id": "proj_1"})
    upstream.on("POST", r"/projects/proj_1/service_accounts$", {"id": "svc_1", "api_key": {"value": "sk-svcacct-minted"}})
    upstream.on("DELETE", r"/service_accounts/svc_1$", {"deleted": True})
    upstream.on("POST", r"/projects/proj_1/archive$", {"id": "proj_1"})
    first = client.post("/api/keys/provision", json={"service": "openai", "project": "My Repo"})
    assert first.status_code == 200 and first.json()["created"]
    entry = first.json()["entry"]
    assert entry["name"] == "My-Repo-openai" and entry["kind"] == "minted"
    assert entry["secrets"] == {"OPENAI_API_KEY": "sk-svcacct-minted"}
    assert entry["meta"] == {"project_id": "proj_1", "service_account_id": "svc_1"}
    assert json.loads(upstream.calls[0][2]) == {"name": "speck-My-Repo"}
    assert upstream.calls[0][3]["authorization"] == "Bearer sk-admin-test-value"
    again = client.post("/api/keys/provision", json={"service": "openai", "project": "My Repo"}).json()
    assert not again["created"] and again["entry"]["secrets"] == entry["secrets"] and len(upstream.calls) == 2
    deleted = client.delete("/api/keys/My-Repo-openai").json()
    assert deleted["revoked"] == ["service account svc_1", "project proj_1 archived"]
    assert [c[0] for c in upstream.calls[2:]] == ["DELETE", "POST"]


def test_provisioning_twilio_anthropic_and_app_store(client, upstream):
    assert client.post("/api/keys/provision", json={"service": "anthropic", "project": "p"}).status_code == 503
    client.put("/api/keys/services/anthropic", json={"secrets": {"ANTHROPIC_API_KEY": "sk-ant-shared"}})
    shared = client.post("/api/keys/provision", json={"service": "anthropic", "project": "p"}).json()["entry"]
    assert shared["kind"] == "shared" and shared["secrets"] == {"ANTHROPIC_API_KEY": "sk-ant-shared"}
    client.put("/api/keys/services/twilio", json={"secrets": {"TWILIO_ACCOUNT_SID": "AC" + "1" * 32, "TWILIO_AUTH_TOKEN": "auth"}})
    upstream.on("POST", r"/Accounts/AC1+/Keys\.json$", {"sid": "SKabc", "secret": "twilio-secret"})
    upstream.on("DELETE", r"/Keys/SKabc\.json$", {})
    minted = client.post("/api/keys/provision", json={"service": "twilio", "project": "p"}).json()["entry"]
    assert minted["secrets"]["TWILIO_API_KEY_SID"] == "SKabc" and "FriendlyName=speck-p" in upstream.calls[0][2]
    assert client.delete("/api/keys/p-twilio?revoke=false").json()["revoked"] == []
    assert len(upstream.calls) == 1
    assert client.post("/api/keys/provision", json={"service": "app-store-connect", "project": "p"}).status_code == 503
    client.post("/api/keys/static", json={"name": "app-store-connect", "service": "apple", "secrets": {
        "APP_STORE_CONNECT_KEY_ID": "K1", "APP_STORE_CONNECT_ISSUER_ID": "I1",
        "APP_STORE_CONNECT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"}})
    apple = client.post("/api/keys/provision", json={"service": "app-store-connect", "project": "p"}).json()["entry"]
    assert apple["secrets"]["APP_STORE_CONNECT_KEY_ID"] == "K1" and apple["meta"] == {"source_entry": "app-store-connect"}
    assert client.post("/api/keys/provision", json={"service": "stripe", "project": "p"}).status_code == 422


def test_provider_checks_are_read_only(client, upstream):
    client.put("/api/keys/services/openai", json={"secrets": {"OPENAI_ADMIN_KEY": "sk-admin"}})
    client.put("/api/keys/services/unifi", json={"secrets": {"UNIFI_API_KEY": "cloud-key"}})
    upstream.on("GET", r"/organization/projects", {"data": [{"id": "a"}, {"id": "b"}]})
    upstream.on("GET", r"api\.ui\.com/v1/hosts", {"data": [{"id": "h"}]})
    assert client.post("/api/keys/services/openai/check").json() | {"latency_ms": 0, "checked_at": 0} == {
        "service": "openai", "ok": True, "detail": "2 projects visible to the admin key", "latency_ms": 0, "checked_at": 0}
    assert client.post("/api/keys/services/unifi/check").json()["detail"] == "1 consoles visible to the Site Manager key"
    failed = client.post("/api/keys/services/anthropic/check").json()
    assert failed["ok"] is False and "not configured" in failed["detail"]
    assert {m for m, _, _, _ in upstream.calls} == {"GET"}
    services = {s["service"]: s for s in client.get("/api/keys/services").json()}
    assert services["openai"]["last_check"]["ok"] is True


def test_import_preserves_metadata_and_never_overwrites(client):
    client.post("/api/keys/static", json={"name": "existing", "value": "keep"})
    result = client.post("/api/keys/import", json={"source": "austinland", "entries": [
        {"name": "existing", "secrets": {"X": "replace"}},
        {"name": "repo-openai", "service": "openai", "kind": "minted", "project": "repo",
         "meta": {"project_id": "proj_9", "service_account_id": "svc_9", "nested": {"x": 1}},
         "secrets": {"OPENAI_API_KEY": "sk-imported"}, "created": "2026-08-01T10:00:00"},
    ]}).json()
    assert result == {"created": ["repo-openai"], "skipped": ["existing"]}
    entry = client.get("/api/keys/repo-openai").json()
    assert entry["kind"] == "minted" and entry["origin"] == "austinland"
    assert entry["meta"] == {"project_id": "proj_9", "service_account_id": "svc_9"}
    assert time.strftime("%Y-%m", time.localtime(entry["created"])) == "2026-08"
    assert client.get("/api/keys/existing").json()["secrets"] == {"EXISTING": "keep"}


# ---------------- DNS ----------------


def configure_godaddy(client):
    client.put("/api/keys/services/godaddy", json={"secrets": {"GODADDY_API_KEY": "gd-key-123456", "GODADDY_API_SECRET": "gd-secret-123456"}})


ZONE = [
    {"type": "A", "name": "@", "data": "5.5.5.10", "ttl": 600},
    {"type": "A", "name": "www", "data": "5.5.5.10", "ttl": 600},
    {"type": "A", "name": "www", "data": "5.5.5.11", "ttl": 600},
    {"type": "MX", "name": "@", "data": "mail.example.com", "ttl": 3600, "priority": 10},
    {"type": "NS", "name": "@", "data": "ns1.domaincontrol.com", "ttl": 3600},
]


def test_dns_domains_records_cache_search_and_connections(client, upstream):
    assert client.get("/api/dns/domains").status_code == 503
    configure_godaddy(client)
    upstream.on("GET", r"/v1/domains\?", [{"domain": "example.com", "status": "ACTIVE", "renewAuto": True}, {"domain": "other.io", "status": "ACTIVE"}])
    upstream.on("GET", r"/v1/domains/example\.com/records$", ZONE)
    domains = client.get("/api/dns/domains").json()["domains"]
    assert [d["domain"] for d in domains] == ["example.com", "other.io"]
    assert upstream.calls[0][3]["authorization"] == "sso-key gd-key-123456:gd-secret-123456"
    zone = client.get("/api/dns/domains/example.com/records").json()
    assert zone["cached"] is False and len(zone["records"]) == 5
    assert client.get("/api/dns/domains/Example.COM/records?cached=true").json()["cached"] is True
    assert len(upstream.methods("/records")) == 1
    listed = client.get("/api/dns/domains?q=example").json()["domains"]
    assert listed[0]["apex"] == ["5.5.5.10"] and listed[0]["nameservers"] == ["ns1.domaincontrol.com"] and listed[0]["record_count"] == 5
    assert {h["fqdn"] for h in client.get("/api/dns/search?q=5.5.5.11").json()["results"]} == {"www.example.com"}
    connections = client.get("/api/dns/connections").json()["connections"]
    assert [c["fqdn"] for c in connections["5.5.5.10"]] == ["example.com", "www.example.com"]
    assert client.get("/api/dns/domains/bad_domain/records").status_code == 422
    assert client.get("/api/dns/search?q=a").status_code == 422


def test_dns_writes_validate_send_exact_bodies_and_refresh(client, upstream):
    configure_godaddy(client)
    upstream.on("GET", r"/v1/domains/example\.com/records$", ZONE)
    upstream.on("PUT", r"/records/A/", {})
    upstream.on("PATCH", r"/records$", {})
    upstream.on("DELETE", r"/records/TXT/", {})
    pointed = client.post("/api/dns/domains/example.com/point", json={"name": "@", "ip": "5.5.5.12"})
    assert pointed.status_code == 200 and pointed.json()["fqdn"] == "example.com"
    put = [c for c in upstream.calls if c[0] == "PUT"][0]
    assert put[1].endswith("/v1/domains/example.com/records/A/%40") and json.loads(put[2]) == [{"data": "5.5.5.12", "ttl": 600}]
    client.post("/api/dns/disconnect", json={"domain": "example.com", "name": "www", "ip": "5.5.5.10"})
    put = [c for c in upstream.calls if c[0] == "PUT"][-1]
    assert put[1].endswith("/records/A/www") and json.loads(put[2]) == [{"data": "5.5.5.11", "ttl": 600}]
    assert client.post("/api/dns/disconnect", json={"domain": "example.com", "name": "www", "ip": "9.9.9.9"}).status_code == 404
    client.post("/api/dns/domains/example.com/records", json={"type": "mx", "name": "@", "data": "mx2.example.com"})
    patch = [c for c in upstream.calls if c[0] == "PATCH"][0]
    assert json.loads(patch[2]) == [{"data": "mx2.example.com", "ttl": 600, "priority": 10, "type": "MX", "name": "@"}]
    assert client.delete("/api/dns/domains/example.com/records/TXT/_dmarc").status_code == 200
    assert client.post("/api/dns/domains/example.com/point", json={"ip": "not-an-ip"}).status_code == 422
    assert client.post("/api/dns/domains/example.com/point", json={"ip": "::1"}).status_code == 422
    assert client.post("/api/dns/domains/example.com/records", json={"type": "A", "name": "x", "data": "1.2.3.4", "ttl": 60}).status_code == 422
    assert client.put("/api/dns/domains/example.com/records/SPF/x", json={"records": [{"type": "A", "name": "x", "data": "1.1.1.1"}]}).status_code == 422
    assert [a["detail"] for a in audit_rows("dns.pointed")] == [json.dumps({"domain": "example.com", "name": "@", "ip": "5.5.5.12"})]
    reader = bearer(token(client, ["read"])["token"])
    assert reader.post("/api/dns/domains/example.com/point", json={"ip": "5.5.5.12"}).status_code == 403


def test_dns_retries_rate_limits_and_imports_cache(client, upstream, monkeypatch):
    configure_godaddy(client)
    sleeps = []

    async def no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(dns.asyncio, "sleep", no_sleep)
    responses = iter([httpx.Response(429, headers={"retry-after": "2"}, json={}), httpx.Response(200, json=[])])
    upstream.on("GET", r"/v1/domains\?", lambda request: next(responses))
    assert client.get("/api/dns/domains").json()["domains"] == []
    assert sleeps == [2.0]
    result = client.post("/api/dns/import", json={
        "domains": [{"domain": "Example.com", "status": "ACTIVE"}, {"domain": "bad domain"}],
        "domains_fetched_at": 100.0,
        "zones": {"example.com": {"fetched_at": 50.0, "records": ZONE}, "../etc": {"records": []}},
    }).json()
    assert result == {"domains": 1, "zones": 1}
    again = client.post("/api/dns/import", json={"domains": [{"domain": "example.com"}], "zones": {"example.com": {"fetched_at": 10.0, "records": []}}}).json()
    assert again == {"domains": 0, "zones": 0}
    assert client.get("/api/dns/status").json()["zones_cached"] == 1


# ---------------- UniFi ----------------


def unifi_routes(upstream, forwards=None):
    upstream.on("GET", r"api\.ui\.com/v1/hosts", {"data": [
        {"id": "other", "reportedState": {"name": "Elsewhere", "ipAddrs": ["10.0.0.1"]}},
        {"id": "console1", "reportedState": {"name": "Office", "ip": PUBLIC[0], "ipAddrs": ["192.168.100.1", *PUBLIC]}},
    ]})
    base = r"/connector/consoles/console1/proxy/network"
    upstream.on("GET", base + r"/integration/v1/sites$", {"data": [{"id": "site-1", "internalReference": "default"}]})
    upstream.on("GET", base + r"/integration/v1/info$", {"applicationVersion": "10.0"})
    upstream.on("GET", base + r"/api/s/default/rest/portforward$", {"data": forwards or [{"destination_ip": PUBLIC[3], "name": "JumpServer"}]})
    upstream.on("GET", base + r"/v2/api/site/default/nat$", [{"rule_index": 4}, {"rule_index": "x"}])
    upstream.on("GET", base + r"/api/s/default/rest/networkconf$", {"data": [{"_id": "wan-1", "purpose": "wan", "wan_ip": PUBLIC[0], "wan_ip_aliases": [PUBLIC[1] + "/32"]}]})
    upstream.on("POST", base + r"/api/s/default/rest/portforward$", {"data": [{"_id": "pf-1"}]})
    upstream.on("POST", base + r"/v2/api/site/default/nat$", {"_id": "nat-1"})
    upstream.on("DELETE", base + r"/api/s/default/rest/portforward/pf-1$", {})
    upstream.on("DELETE", base + r"/v2/api/site/default/nat/nat-1$", {})
    upstream.on("GET", base + r"/integration/v1/sites/site-1/clients", {"data": [
        {"id": "c1", "name": "web", "ipAddress": "192.168.1.20", "macAddress": "BC:24:11:00:00:01", "type": "WIRED"}], "totalCount": 1})


def test_unifi_pool_expose_and_unexpose_through_cloud_connector(client, upstream):
    client.put("/api/keys/services/unifi", json={"secrets": {"UNIFI_API_KEY": "cloud-key"}, "settings": {"UNIFI_GATEWAY": "192.168.100.1"}})
    unifi_routes(upstream)
    status = client.get("/api/unifi/status").json()
    assert status["reachable"] and status["console"]["id"] == "console1" and status["network_version"] == "10.0"
    pool = {p["ip"]: p["status"] for p in client.get("/api/unifi/pool").json()["pool"]}
    assert pool == {PUBLIC[0]: "gateway", PUBLIC[1]: "free", PUBLIC[2]: "free", PUBLIC[3]: "in_use"}
    assert client.post("/api/unifi/expose", json={"public_ip": PUBLIC[3], "lan_ip": "192.168.1.20", "name": "web"}).status_code == 409
    assert client.post("/api/unifi/expose", json={"public_ip": PUBLIC[1], "lan_ip": "8.8.8.8", "name": "web"}).status_code == 422
    exposed = client.post("/api/unifi/expose", json={"public_ip": PUBLIC[1], "lan_ip": "192.168.1.20", "name": "web"})
    assert exposed.status_code == 200 and exposed.json()["rules"] == {"portforward_id": "pf-1", "snat_id": "nat-1"}
    forward = json.loads([c for c in upstream.calls if c[0] == "POST" and c[1].endswith("portforward")][0][2])
    assert forward["destination_ip"] == PUBLIC[1] and forward["fwd"] == "192.168.1.20" and forward["dst_port"] == "1-499,501-4499,4501-65535"
    snat = json.loads([c for c in upstream.calls if c[0] == "POST" and c[1].endswith("/nat")][0][2])
    assert snat["rule_index"] == 5 and snat["out_interface"] == "wan-1" and snat["source_filter"]["address"] == "192.168.1.20"
    assert all(c[3]["x-api-key"] == "cloud-key" for c in upstream.calls)
    assert client.get("/api/unifi/pool").json()["pool"][1] | {} == {"ip": PUBLIC[1], "status": "assigned", "assigned_to": "web", "lan_ip": "192.168.1.20"}
    assert client.post("/api/unifi/expose", json={"public_ip": PUBLIC[1], "lan_ip": "192.168.1.21", "name": "again"}).status_code == 409
    assert client.post("/api/unifi/unexpose", json={"public_ip": PUBLIC[2]}).status_code == 404
    assert client.post("/api/unifi/unexpose", json={"public_ip": PUBLIC[1]}).status_code == 200
    assert [c[0] for c in upstream.calls if c[0] == "DELETE"] == ["DELETE", "DELETE"]
    assert client.get("/api/unifi/exposures").json() == []
    assert client.get("/api/unifi/clients").json()[0]["mac"] == "bc:24:11:00:00:01"


def test_unifi_expose_rolls_back_port_forward_when_snat_fails(client, upstream):
    client.put("/api/keys/services/unifi", json={"secrets": {"UNIFI_API_KEY": "cloud-key"}, "settings": {"UNIFI_GATEWAY": "console1"}})
    unifi_routes(upstream)
    upstream.on("POST", r"/v2/api/site/default/nat$", {"message": "bad"}, status=400)
    failed = client.post("/api/unifi/expose", json={"public_ip": PUBLIC[1], "lan_ip": "192.168.1.20", "name": "web"})
    assert failed.status_code == 400
    assert any(c[0] == "DELETE" and c[1].endswith("portforward/pf-1") for c in upstream.calls)
    assert client.get("/api/unifi/exposures").json() == []


def test_unifi_import_adopts_austinland_mappings(client):
    result = client.post("/api/unifi/exposures/import", json={"exposures": [
        {"public_ip": PUBLIC[1], "lan_ip": "192.168.1.20", "name": "a", "portforward_id": "p", "snat_id": "s", "created_at": 5.0},
        {"public_ip": "10.0.0.5", "lan_ip": "192.168.1.21", "name": "not public"},
    ]}).json()
    assert result == {"created": [PUBLIC[1]], "skipped": ["10.0.0.5"]}
    assert client.get("/api/unifi/exposures").json()[0]["origin"] == "austinland"


# ---------------- SSH keys and handoffs ----------------


def test_ssh_keys_generate_seal_reveal_and_import(client):
    generated = client.post("/api/ssh/generate", json={"name": "deploy", "comment": "deploy key", "purpose": "CI"}).json()
    assert generated["public_key"].startswith("ssh-ed25519 ") and generated["public_key"].endswith(" deploy key")
    assert generated["fingerprint"].startswith("SHA256:")
    with db() as conn:
        sealed = conn.execute("SELECT private_key FROM ssh_keys WHERE name='deploy'").fetchone()[0]
    assert "PRIVATE KEY" not in sealed
    listed = client.get("/api/ssh/keys").json()[0]
    assert listed["has_private"] and "private_key" not in listed and listed["registered_as"] is None
    private = client.get("/api/ssh/keys/deploy/private").json()["private_key"]
    assert private.startswith("-----BEGIN OPENSSH PRIVATE KEY-----")
    assert audit_rows("ssh.private_revealed")
    no_vault = bearer(token(client, ["read"])["token"])
    assert no_vault.get("/api/ssh/keys/deploy/private").status_code == 403
    imported = client.post("/api/ssh/import", json={"keys": [
        {"name": "laptop", "public_key": generated["public_key"].replace("deploy key", "laptop")},
        {"name": "deploy", "public_key": generated["public_key"]},
    ]}).json()
    assert imported == {"created": ["laptop"], "skipped": ["deploy"]}
    assert client.get("/api/ssh/keys/laptop/private").status_code == 404
    assert client.post("/api/ssh/import", json={"keys": [{"name": "x", "public_key": "not a key"}]}).status_code == 422
    assert client.post("/api/ssh/generate", json={"name": "deploy"}).status_code == 409
    assert client.post("/api/ssh/register", json={"name": "deploy"}).status_code == 409


def test_handoffs_are_sealed_and_reads_audited(client):
    markdown = "# Access\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n"
    result = client.post("/api/context/import", json={"files": [{"filename": "LLMContextAccess-web-example.com.md", "markdown": markdown, "created": 7.0}]}).json()
    assert result == {"created": ["LLMContextAccess-web-example.com.md"], "skipped": []}
    listed = client.get("/api/context/files").json()[0]
    assert listed["machine"] == "web" and listed["domain"] == "example.com" and "markdown" not in listed
    with db() as conn:
        assert "PRIVATE KEY" not in conn.execute("SELECT markdown FROM context_files").fetchone()[0]
    assert client.get("/api/context/files/LLMContextAccess-web-example.com.md").json()["markdown"] == markdown
    assert client.get("/api/context/files/LLMContextAccess-web-example.com.md/raw").text == markdown
    assert len(audit_rows("context.read")) == 2
    assert bearer(token(client, ["read", "admin"])["token"]).get("/api/context/files/LLMContextAccess-web-example.com.md").status_code == 403


# ---------------- network map, search, docs and MCP ----------------


def test_network_map_joins_macs_mappings_and_dns(client, upstream, monkeypatch):
    from speck import fleet

    async def inventory(refresh=False, user=None):
        return {"machines": [
            {"id": "proxmox:c:qemu:101", "label": "web", "provider": "proxmox", "kind": "qemu", "state": "running",
             "addresses": [], "resources": [{"identity": {"macs": ["BC:24:11:00:00:01"]}, "addresses": []}]},
            {"id": "linode:l:instance:1", "label": "edge", "provider": "linode", "kind": "instance", "state": "running",
             "addresses": ["5.5.5.12"], "resources": []},
            {"id": "none", "label": "isolated", "addresses": [], "resources": []},
        ]}

    monkeypatch.setattr(fleet, "inventory", inventory)
    client.put("/api/keys/services/unifi", json={"secrets": {"UNIFI_API_KEY": "cloud-key"}, "settings": {"UNIFI_GATEWAY": "console1"}})
    unifi_routes(upstream)
    client.post("/api/unifi/exposures/import", json={"exposures": [{"public_ip": PUBLIC[1], "lan_ip": "192.168.1.20", "name": "web"}]})
    client.post("/api/dns/import", json={"zones": {"example.com": {"fetched_at": time.time(), "records": [
        {"type": "A", "name": "@", "data": PUBLIC[1]}, {"type": "A", "name": "edge", "data": "5.5.5.12"}]}}})
    result = client.get("/api/network/map").json()
    machines = {m["label"]: m for m in result["machines"]}
    assert set(machines) == {"web", "edge"}
    assert machines["web"]["lan"] == [{"ip": "192.168.1.20", "source": "unifi_mac", "mac": "bc:24:11:00:00:01", "client": "web"}]
    assert machines["web"]["public"][0] | {} == {"ip": PUBLIC[1], "via": "unifi_nat", "mapping": "web", "lan_ip": "192.168.1.20"}
    assert [d["fqdn"] for d in machines["web"]["dns"]] == ["example.com"]
    assert [d["fqdn"] for d in machines["edge"]["dns"]] == ["edge.example.com"]
    assert result["ips"][PUBLIC[1]]["machines"] == [{"id": "proxmox:c:qemu:101", "label": "web"}]


def test_search_groups_types_and_respects_vault_access(client):
    client.post("/api/keys/static", json={"name": "alpha-db", "value": "x"})
    client.post("/api/dns/import", json={"domains": [{"domain": "alpha.dev"}], "zones": {"alpha.dev": {"fetched_at": time.time(), "records": [{"type": "A", "name": "@", "data": "5.5.5.10"}]}}})
    client.post("/api/ssh/generate", json={"name": "alpha-deploy"})
    result = client.get("/api/search?q=alpha").json()
    assert [r["type"] for r in result["results"]] == ["vault_entry", "ssh_key", "domain", "dns_record"]
    assert result["results"][0]["api"] == "GET /api/keys/alpha-db"
    reader = bearer(token(client, ["read"])["token"])
    assert "vault_entry" not in {r["type"] for r in reader.get("/api/search?q=alpha").json()["results"]}
    assert client.get("/api/search?q=alpha&type=domain").json()["results"][0]["title"] == "alpha.dev"
    assert client.get("/api/search?q=alpha&type=bogus").status_code == 422
    overview = client.get("/api/overview").json()
    assert overview["vault"]["entries"] == 1 and overview["ssh_keys"] == 1 and overview["dns"]["domains"] == 1
    assert "vault" not in reader.get("/api/overview").json()


def test_public_agent_documents_and_openapi(client):
    anonymous = TestClient(app, base_url="https://testserver")
    for path in ("/llms.txt", "/agents.md", "/speck.md"):
        response = anonymous.get(path)
        assert response.status_code == 200 and "https://testserver" in response.text and "{{ORIGIN}}" not in response.text
    schema = anonymous.get("/api/openapi.json").json()
    assert "/api/keys/provision" in schema["paths"] and "/api/unifi/expose" in schema["paths"] and "/api/infrastructure/inventory" in schema["paths"]
    assert not [p for p in schema["paths"] if p.startswith(("/api/agent/", "/api/infrastructure/agent/"))]
    assert schema["components"]["securitySchemes"]["token"] == {"type": "http", "scheme": "bearer"}
    assert anonymous.get("/api/guide").status_code == 401


def rpc(client, method, params=None, ident=1):
    return client.post("/mcp", json={"jsonrpc": "2.0", "id": ident, "method": method, "params": params or {}})


def test_mcp_server_lists_tools_dispatches_with_the_callers_scopes(client):
    anonymous = TestClient(app, base_url="https://testserver")
    denied = rpc(anonymous, "initialize")
    assert denied.status_code == 401 and denied.headers["www-authenticate"].startswith("Bearer")
    assert anonymous.post("/mcp", headers={"Authorization": "Bearer speck_pat_" + "x" * 43}, json={}).status_code == 401
    client.post("/api/keys/static", json={"name": "repo-db", "value": "db-secret"})
    agent = bearer(token(client, ["read", "keys:read"], "claude")["token"])
    init = rpc(agent, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test"}}).json()["result"]
    assert init["protocolVersion"] == "2025-06-18" and init["serverInfo"]["name"] == "speck" and "tools" in init["capabilities"]
    assert rpc(agent, "initialize", {"protocolVersion": "1999-01-01"}).json()["result"]["protocolVersion"] == "2025-06-18"
    note = agent.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert note.status_code == 202 and not note.content
    tools = {t["name"]: t for t in rpc(agent, "tools/list").json()["result"]["tools"]}
    assert {"speck_search", "provision_key", "point_domain", "expose_public_ip", "run_command", "speck_api"} <= set(tools)
    assert tools["get_key"]["annotations"]["readOnlyHint"] and tools["unexpose_public_ip"]["annotations"]["destructiveHint"]
    revealed = rpc(agent, "tools/call", {"name": "get_key", "arguments": {"name": "repo-db"}}).json()["result"]
    assert not revealed["isError"] and revealed["structuredContent"]["secrets"] == {"REPO_DB": "db-secret"}
    assert audit_rows("vault.reveal")[-1]["actor"] == "admin (API: claude)"
    blocked = rpc(agent, "tools/call", {"name": "store_key", "arguments": {"name": "x", "secrets": {"A": "b"}}}).json()["result"]
    assert blocked["isError"] and "403" in blocked["content"][0]["text"]
    generic = rpc(agent, "tools/call", {"name": "speck_api", "arguments": {"method": "GET", "path": "/api/whoami"}}).json()["result"]
    assert generic["structuredContent"]["data"]["token"] == "claude"
    escape = rpc(agent, "tools/call", {"name": "speck_api", "arguments": {"method": "GET", "path": "/api/agent/jobs/next"}}).json()["result"]
    assert escape["isError"]
    assert rpc(agent, "tools/call", {"name": "missing"}).json()["error"]["code"] == -32602
    assert rpc(agent, "nope").json()["error"]["code"] == -32601
    guide = rpc(agent, "resources/read", {"uri": "speck://guide"}).json()["result"]["contents"][0]
    assert guide["mimeType"] == "text/markdown" and "Speck" in guide["text"]
    batch = agent.post("/mcp", json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/x"}]).json()
    assert batch == [{"jsonrpc": "2.0", "id": 1, "result": {}}]
    assert agent.post("/mcp", headers={"Origin": "https://evil.example"}, json={}).status_code == 403


def test_token_mode_proxmox_inventory_reads_guest_identity(monkeypatch):
    import asyncio

    from speck import infrastructure as infra

    calls = []

    async def request(cfg, method, path, body=None, params=None):
        calls.append(path)
        if path == "/cluster/resources":
            return [{"type": "node", "node": "pve"}, {"type": "qemu", "node": "pve", "vmid": 101}]
        return {"smbios1": "uuid=12345678-1234-1234-1234-123456789abc", "agent": "1,fstrim_cloned_disks=1",
                "net0": "virtio=BC:24:11:AA:BB:CC,bridge=vmbr0", "net1": "e1000=bc:24:11:00:00:02"}

    monkeypatch.setattr(infra, "provider_request", request)
    infra._token_identity.clear()
    cfg = {"id": "c", "provider": "proxmox", "connector": False}
    rows = asyncio.run(infra.raw_inventory(cfg))
    assert rows[1]["speck_identity"] == {"macs": ["BC:24:11:AA:BB:CC", "bc:24:11:00:00:02"], "uuid": "12345678-1234-1234-1234-123456789abc", "guest_agent": True}
    asyncio.run(infra.raw_inventory(cfg))
    assert calls.count("/nodes/pve/qemu/101/config") == 1


def test_host_command_issues_audited_tokens(client):
    token_id, value = api_tokens.issue("admin", "migration", ["admin", "keys:write"], days=1)
    assert bearer(value).get("/api/whoami").json()["token"] == "migration"
    assert audit_rows("api_token.created")[-1]["actor"] == "host:admin"
    with pytest.raises(SystemExit):
        api_tokens.issue("nobody", "x", ["read"])
    with pytest.raises(Exception):
        api_tokens.issue("admin", "x", ["root"])
    created = api_tokens.main(["--username", "admin", "--name", "cli", "--scopes", "read"])
    assert bearer(created["token"]).get("/api/whoami").status_code == 200
    assert api_tokens.main(["--username", "admin", "--revoke", created["id"]]) == {"revoked": created["id"]}
    assert bearer(created["token"]).get("/api/whoami").status_code == 401
    with pytest.raises(SystemExit):
        api_tokens.main(["--username", "admin", "--revoke", "missing"])
    with pytest.raises(SystemExit):
        api_tokens.main(["--username", "admin", "--name", "no-scopes"])
