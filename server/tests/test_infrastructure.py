import asyncio
import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from speck import infrastructure as infra
from speck import proxmox_connector as connector
from speck.config import seal, unseal
from speck.db import db
from speck.infrastructure_bridge import app as bridge_app
from speck.infrastructure_catalog import bridge_request


def add(client, provider="proxmox", **extra):
    body = {
        "name": "Cluster A",
        "provider": provider,
        "url": "https://pve.example",
        "token": "provider-secret-12345",
        "token_id": "speck@pve!api",
    } | extra
    r = client.post("/api/infrastructure/connections", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture
def upstream(monkeypatch):
    calls = []
    rows = [
        {"type": "node", "node": "host-a", "status": "online"},
        {"type": "node", "node": "host-b", "status": "online"},
        {"type": "qemu", "vmid": 101, "node": "host-b", "name": "Test VM", "status": "stopped"},
    ]

    async def request(cfg, method, path, body=None, params=None):
        calls.append((cfg.get("id"), method, path, body, params))
        if path in ("/cluster/resources", "/speck/inventory"):
            return rows
        if path == "/linode/instances":
            return {"data": [{"id": 101, "label": "Cloud VM", "status": "running", "specs": {}}], "pages": 1}
        return {"ok": True, "nested": {"token": "must-not-leak", "value": "safe"}}

    monkeypatch.setattr(infra, "provider_request", request)
    return calls, rows


def action(client, cid, **overrides):
    body = {
        "request_id": secrets.token_hex(16),
        "kind": "qemu",
        "resource_id": "101",
        "operation": "start",
        "args": {},
        "confirmation": "Test VM",
    } | overrides
    return client.post("/api/infrastructure/connections/" + cid + "/actions", json=body)


def role(name):
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role=?", (name,))


def test_credentials_are_encrypted_and_not_returned(client, upstream):
    cid = add(client)
    assert "provider-secret" not in client.get("/api/infrastructure/connections").text
    with db() as conn:
        row = conn.execute("SELECT config FROM infrastructure_connections WHERE id=?", (cid,)).fetchone()
        assert "provider-secret" not in row["config"]
        assert json.loads(unseal(row["config"]))["token"] == "provider-secret-12345"
    for bad in (
        "http://pve.example",
        "https://user:password@pve.example",
        "https://pve.example/api",
        "https://pve.example?token=x",
    ):
        assert (
            client.post(
                "/api/infrastructure/connections", json={"name": "bad", "provider": "proxmox", "url": bad}
            ).status_code
            == 422
        )


def test_cluster_identity_fresh_node_resolution_and_deduplication(client, upstream):
    calls, rows = upstream
    a = add(client)
    b = add(client, name="Cluster B")
    data = client.get("/api/infrastructure/inventory").json()
    assert {c["id"] for c in data["connections"]} == {a, b}
    rid = secrets.token_hex(16)
    response = action(client, b, request_id=rid)
    assert response.json()["status"] == "submitted", response.text
    assert calls[-1][0] == b and calls[-1][2] == "/nodes/host-b/qemu/101/status/start"
    assert "must-not-leak" not in response.text
    rows[-1]["node"] = "host-a"
    repeated = action(client, b, request_id=rid)
    assert repeated.json() == response.json()
    assert len([c for c in calls if c[1] == "POST"]) == 1
    assert action(client, b, request_id=rid, operation="stop").status_code == 409
    assert action(client, a, confirmation="wrong").status_code == 422


def test_power_templates_and_validation_guards(client, upstream):
    calls, rows = upstream
    cid = add(client)
    assert (
        action(client, cid, operation="configure", args={"cores": 2, "memory": 4096, "delete": "scsi0"}).status_code
        == 422
    )
    rows[-1]["template"] = 1
    assert action(client, cid, operation="delete").json()["status"] == "rejected"
    rows[-1]["template"] = 0
    rows[-1]["status"] = "running"
    assert action(client, cid, operation="delete").json()["status"] == "rejected"
    assert (
        action(client, cid, kind="node", resource_id="host-b", operation="reboot", confirmation="host-b").json()[
            "status"
        ]
        == "rejected"
    )
    assert not [c for c in calls if c[1] in ("POST", "DELETE")]


def test_role_csrf_and_connections(client, upstream):
    cid = add(client)
    role("operator")
    assert client.get("/api/infrastructure/inventory").status_code == 200
    assert action(client, cid).status_code == 403
    assert client.delete("/api/infrastructure/connections/" + cid).status_code == 403
    role("viewer")
    assert client.get("/api/infrastructure/inventory").status_code == 403
    role("admin")
    client.headers.pop("X-CSRF-Token")
    assert action(client, cid).status_code == 403


def test_provider_failure_receipt_is_not_replayed(client, upstream, monkeypatch):
    cid = add(client)
    calls = []

    async def fail(*args):
        calls.append(args)
        raise HTTPException(502, "Uncertain provider outcome")

    monkeypatch.setattr(infra, "execute", fail)
    rid = secrets.token_hex(16)
    r = action(client, cid, request_id=rid)
    assert r.json()["status"] == "unknown"
    assert action(client, cid, request_id=rid).json() == r.json()
    assert len(calls) == 1
    history = client.get("/api/infrastructure/operations").json()
    assert history[0]["status"] == "unknown"
    assert "args" not in history[0]


def test_partial_outage_preserves_other_inventory(client, upstream, monkeypatch):
    a = add(client)
    b = add(client, name="Other")
    old = infra.raw_inventory

    async def inventory(cfg):
        if cfg["id"] == a:
            raise HTTPException(502, "Unavailable")
        return await old(cfg)

    monkeypatch.setattr(infra, "raw_inventory", inventory)
    data = client.get("/api/infrastructure/inventory").json()["connections"]
    assert next(c for c in data if c["id"] == a)["status"] == "unavailable"
    assert len(next(c for c in data if c["id"] == b)["resources"]) == 3


def test_linode_pagination_validates_pages(monkeypatch):
    calls = []

    async def request(cfg, method, path, body=None, params=None):
        calls.append(params["page"])
        return {"data": [{"id": params["page"]}], "pages": 2}

    monkeypatch.setattr(infra, "provider_request", request)
    assert len(asyncio.run(infra.linode_list({}, "/test"))) == 2
    assert calls == [1, 2]


def test_transport_no_redirect_and_sanitized_error(monkeypatch):
    captured = []

    class Client:
        def __init__(self, **kw):
            captured.append(kw)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def request(self, *args, **kw):
            return httpx.Response(302, text="super-private-password")

    monkeypatch.setattr(infra.httpx, "AsyncClient", Client)
    with pytest.raises(HTTPException) as e:
        asyncio.run(
            infra.provider_request(
                {"provider": "linode", "token": "secret", "verify_tls": True, "url": "https://api.linode.com"},
                "GET",
                "/test",
            )
        )
    assert "super-private" not in str(e.value.detail)
    assert captured[0]["follow_redirects"] is False


def test_bridge_allowlist_path_traversal_and_secret_endpoints():
    for operation in ("keys", "context", "quit", "api/keys", "../keys"):
        with pytest.raises(HTTPException):
            bridge_request(operation, {})
    for value in ("..", "../../keys", "example.com%2fkeys", "example.com?x=y", "a/b"):
        with pytest.raises(HTTPException):
            bridge_request("dns-records", {"domain": value})
    assert bridge_request("dns-records", {"domain": "example.com"}) == (
        "GET",
        "/api/dns/domains/example.com/records",
        {},
    )


def test_bridge_auth_and_templates(tmp_path, monkeypatch):
    path = tmp_path / "token"
    path.write_text("x" * 40)
    monkeypatch.setenv("SPECK_BRIDGE_TOKEN_FILE", str(path))
    with TestClient(bridge_app) as client:
        assert client.post("/operations/domains", json={"args": {}}).status_code == 401
        client.headers["Authorization"] = "Bearer " + "x" * 40
        assert client.post("/operations/keys", json={"args": {}}).status_code == 404
        assert client.post("/operations/proxmox-delete", json={"args": {"vmid": 9000}}).status_code == 409


def enroll_connector(client, cid, hardware="a" * 64):
    enrollment = client.post("/api/infrastructure/connectors/enrollments", json={"connection_id": cid})
    assert enrollment.status_code == 200, enrollment.text
    body = {"token": enrollment.json()["token"], "hardware": hardware, "hostname": "host-a", "version": "0.1.0"}
    r = client.post("/api/infrastructure/agent/enroll", json=body)
    assert r.status_code == 200, r.text
    assert client.post("/api/infrastructure/agent/enroll", json=body).status_code == 401
    return r.json(), {"Authorization": "Bearer " + r.json()["token"], "X-Speck-Hardware": hardware}


def test_connector_one_use_enrollment_identity_and_revocation(client):
    cid = add(client, connector=True)
    agent, headers = enroll_connector(client, cid)
    assert client.post("/api/infrastructure/agent/heartbeat", headers=headers).status_code == 200
    assert (
        client.post("/api/infrastructure/agent/heartbeat", headers=headers | {"X-Speck-Hardware": "b" * 64}).status_code
        == 401
    )
    assert client.get("/api/infrastructure/connectors").json()[0]["online"] is True
    assert "token" not in client.get("/api/infrastructure/connectors").text
    assert client.delete("/api/infrastructure/connectors/" + agent["id"]).status_code == 200
    assert client.post("/api/infrastructure/agent/heartbeat", headers=headers).status_code == 401


def test_connector_upgrade_reports_version_without_changing_identity(client):
    cid = add(client, connector=True)
    agent, headers = enroll_connector(client, cid)
    with db() as conn:
        before = dict(conn.execute("SELECT * FROM proxmox_connectors WHERE id=?", (agent["id"],)).fetchone())
    path = "/api/infrastructure/agent/heartbeat"
    assert client.post(path, headers=headers, json={"version": "0.1.2"}).status_code == 200
    assert client.post(path, headers=headers).status_code == 200  # Legacy agents remain compatible.
    assert client.post(path, headers=headers, json={"version": "bad\\nversion"}).status_code == 422
    with db() as conn:
        after = dict(conn.execute("SELECT * FROM proxmox_connectors WHERE id=?", (agent["id"],)).fetchone())
    assert after["version"] == "0.1.2"
    assert all(after[key] == before[key] for key in before if key not in ("version", "last_seen"))
    assert client.get("/api/infrastructure/connectors").json()[0]["version"] == "0.1.2"


def test_connector_request_roundtrip_lease_and_encryption(client):
    cid = add(client, connector=True)
    agent, headers = enroll_connector(client, cid)
    cfg = infra.get_connection(cid)
    with ThreadPoolExecutor() as executor:
        task = executor.submit(asyncio.run, connector.request(cfg, "GET", "/cluster/resources"))
        job = client.get("/api/infrastructure/agent/next", headers=headers).json()
        assert job["path"] == "/cluster/resources"
        with db() as conn:
            row = conn.execute("SELECT * FROM proxmox_requests WHERE id=?", (job["id"],)).fetchone()
            assert row["status"] == "leased"
            assert "/cluster/resources" not in row["request"]
        result = {"id": job["id"], "lease": job["lease"], "ok": True, "data": [{"type": "node", "node": "host-a"}]}
        assert (
            client.post(
                "/api/infrastructure/agent/result", headers=headers, json=result | {"lease": "wrong"}
            ).status_code
            == 403
        )
        assert client.post("/api/infrastructure/agent/result", headers=headers, json=result).status_code == 200
        assert task.result(timeout=3) == result["data"]
        assert client.post("/api/infrastructure/agent/result", headers=headers, json=result).status_code == 200


def test_connector_offline_no_request_dispatch(client):
    cid = add(client, connector=True)
    with pytest.raises(HTTPException):
        asyncio.run(connector.request(infra.get_connection(cid), "POST", "/nodes/host-a/status", {"command": "reboot"}))
    with db() as conn:
        assert conn.execute("SELECT count(*) FROM proxmox_requests").fetchone()[0] == 0


def test_connector_result_cannot_cross_hosts(client):
    cid = add(client, connector=True)
    a, ah = enroll_connector(client, cid)
    b, bh = enroll_connector(client, cid, "b" * 64)
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO proxmox_requests VALUES(?,?,?,'queued',NULL,NULL,?,?)",
            (
                "c" * 32,
                a["id"],
                seal(json.dumps({"method": "GET", "path": "/cluster/resources", "args": {}})),
                time.time(),
                time.time() + 60,
            ),
        )
    job = client.get("/api/infrastructure/agent/next", headers=ah).json()
    assert (
        client.post(
            "/api/infrastructure/agent/result",
            headers=bh,
            json={"id": job["id"], "lease": job["lease"], "ok": True, "data": []},
        ).status_code
        == 403
    )


def test_hardware_matching_distinguishes_agent_provider_only_and_duplicates(client):
    import hashlib

    with db(write=True) as conn:
        conn.execute("INSERT INTO installations(id,token_hash,created) VALUES('inst','hash',?)", (time.time(),))
        conn.execute(
            "INSERT INTO devices(id,installation_id,hardware_id,hostname,label,platform,arch,created,last_seen,approved) VALUES('endpoint','inst',?,'guest','Guest','windows','amd64',?,?,1)",
            (
                hashlib.sha256(("windows:" + "A1234567-1234-1234-1234-123456789012").encode()).hexdigest(),
                time.time(),
                time.time(),
            ),
        )
    base = {
        "kind": "qemu",
        "connection_id": "cluster",
        "name": "guest",
        "node": "pve",
        "identity": {"uuid": "a1234567-1234-1234-1234-123456789012"},
    }
    groups = [{"resources": [base.copy(), base | {"id": "other", "identity": {}}]}]
    infra.correlate_agents(groups)
    managed, other = groups[0]["resources"]
    assert managed["management"] == "speck_agent" and managed["agent"]["id"] == "endpoint"
    assert other["management"] == "provider_only" and other["agent"] is None
    groups.append({"resources": [base | {"connection_id": "other"}]})
    infra.correlate_agents(groups)
    assert groups[0]["resources"][0]["management"] == "ambiguous"
    assert groups[0]["resources"][0]["agent"] is None


def test_guest_command_and_snapshot_scopes(client, upstream):
    calls, _ = upstream
    cid = add(client)
    response = action(client, cid, operation="guest-command", args={"shell": "sh", "script": "hostname"})
    assert response.json()["status"] == "submitted"
    assert calls[-1][2] == "/nodes/host-b/qemu/101/agent/exec"
    assert calls[-1][3] == {"command": ["/bin/sh", "-c", "hostname"]}
    assert (
        action(client, cid, operation="snapshot-delete", args={"snapname": "../../101"}).json()["status"] == "rejected"
    )
    response = client.get(
        "/api/infrastructure/connections/" + cid + "/read/guest-file-read",
        params={"kind": "qemu", "resource_id": "101", "args": json.dumps({"file": "/etc/hostname"})},
    )
    assert response.status_code == 200
    assert calls[-1][4] == {"file": "/etc/hostname", "count": 65536}


def test_provider_console_requires_own_host_agent_and_hides_credentials(client, upstream):
    from speck.remote import sessions

    _, rows = upstream
    rows[-1]["status"] = "running"
    cid = add(client, connector=True)
    # A cluster agent on another node can manage it, but console execution is local.
    agent, headers = enroll_connector(client, cid)
    assert (
        client.post(
            f"/api/infrastructure/connections/{cid}/console", json={"kind": "qemu", "resource_id": "101"}
        ).status_code
        == 409
    )
    with db(write=True) as conn:
        conn.execute("UPDATE proxmox_connectors SET hostname='host-b' WHERE id=?", (agent["id"],))
    result = client.post(f"/api/infrastructure/connections/{cid}/console", json={"kind": "qemu", "resource_id": "101"})
    assert result.status_code == 200, result.text
    assert set(result.json()) == {"id", "protocol"}
    sid = result.json()["id"]
    assert sessions[sid].config["password"]
    assert (
        client.post(
            f"/api/infrastructure/connections/{cid}/console", json={"kind": "qemu", "resource_id": "101"}
        ).status_code
        == 409
    )
    job = client.get("/api/infrastructure/agent/next", headers=headers).json()
    assert job["path"] == "/speck/console" and job["args"]["vmid"] == 101
    with db() as conn:
        row = conn.execute("SELECT request FROM proxmox_requests WHERE id=?", (job["id"],)).fetchone()
        assert job["args"]["password"] not in row["request"]
    assert client.delete("/api/infrastructure/connectors/" + agent["id"]).status_code == 200
    assert sid not in sessions


def test_slide_virtual_machine_actions_are_scoped(client, monkeypatch):
    calls = []

    class Slide:
        def __init__(self, cfg):
            self.cfg = cfg

        async def listing(self, resource, params=None):
            if resource in ("agent", "client"):
                return []
            if resource == "device":
                return [{"device_id": "d_123456789012", "display_name": "Box"}]
            return [
                {
                    "virt_id": "virt_123456789012",
                    "device_id": "d_123456789012",
                    "state": "running",
                    "vnc_enabled": True,
                    "vnc_password": "never-return",
                    "vnc": [{"websocket_uri": "wss://example.test/secret-ticket"}],
                }
            ]

        async def request(self, method, path, body=None, params=None):
            calls.append((method, path, body))
            return {"vnc_password": "never-return", "vnc": [{"websocket_uri": "wss://example.test/secret-ticket"}]}

    monkeypatch.setattr(infra, "Slide", Slide)
    cid = add(client, provider="slide", url="https://api.slide.example")
    inventory = client.get("/api/infrastructure/inventory")
    assert {r["kind"] for r in inventory.json()["connections"][0]["resources"]} == {"box", "virt"}
    assert "never-return" not in inventory.text
    response = action(
        client,
        cid,
        kind="virt",
        resource_id="virt_123456789012",
        confirmation="virt_123456789012 · VM",
        operation="stop",
    )
    assert response.json()["status"] == "submitted"
    assert calls[-1] == ("PATCH", "restore/virt/virt_123456789012", {"state": "stopped"})
    assert "never-return" not in response.text and "secret-ticket" not in response.text


def test_only_protected_slide_backup_skips_target_confirmation(client, upstream):
    cid = add(client)
    assert action(client, cid, confirmation='').status_code == 422
    assert action(client, cid, operation='backup', confirmation='').status_code == 422
    for kind in ('box', 'virt'):
        for spec in infra.catalog({'provider': 'slide'}, kind).values():
            assert spec.get('requires_confirmation', True)
    assert infra.catalog({'provider': 'slide'}, 'protected')['backup']['requires_confirmation'] is False
