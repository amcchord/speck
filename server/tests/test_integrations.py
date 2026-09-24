import json
import time

import pytest
from fastapi.testclient import TestClient

from speck.db import db, initialize
from speck.main import app
from speck.security import digest
from test_management import managed, sample


def setup(client):
    first, _ = managed(client)
    second, _ = managed(client)
    for device, site in ((first, "Clinic A"), (second, "Clinic B")):
        assert client.put(f"/api/devices/{device}/organization", json={"site": site}).status_code == 200
    created = client.post("/api/integrations/tokens", json={"name": "Chat", "site": "Clinic A"})
    assert created.status_code == 200
    token = created.json()
    reader = TestClient(app, base_url="https://testserver", headers={"Authorization": "Bearer " + token["token"]})
    return first, second, token, reader


def test_site_scope_safe_fields_pagination_and_details(client):
    first, second, token, reader = setup(client)
    sample(
        client,
        first,
        secret="private",
        memory={"total": 100, "password": "private"},
        network={"interfaces": [{"name": "eth0", "addrs": [{"address": "192.0.2.5"}], "secret": "private"}]},
    )
    page = reader.get("/api/integrations/v1/devices?limit=1").json()
    assert page["site"] == "Clinic A" and page["next_cursor"] is None
    assert [d["id"] for d in page["devices"]] == [first]
    assert "private" not in json.dumps(page) and "installation_id" not in json.dumps(page)
    assert reader.get(f"/api/integrations/v1/devices/{second}").status_code == 404
    detail = reader.get(f"/api/integrations/v1/devices/{first}").json()["device"]
    assert detail["telemetry"]["services"][0]["name"] == "asterisk.service"
    assert reader.get(f"/api/integrations/v1/devices/{first}?category=volumes").json()["volumes"]
    assert reader.get(f"/api/integrations/v1/devices/{first}?category=patches").json()["available"] is False
    assert reader.get(f"/api/integrations/v1/devices/{first}?category=software").status_code == 422
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET site='Clinic B' WHERE id=?", (first,))
    assert reader.get(f"/api/integrations/v1/devices/{first}").status_code == 404
    assert not reader.get("/api/integrations/v1/devices").json()["devices"]


def test_hash_only_revocation_expiry_owner_status_and_migration(client):
    first, _, token, reader = setup(client)
    initialize()
    initialize()
    with db() as conn:
        row = dict(conn.execute("SELECT * FROM integration_tokens WHERE id=?", (token["id"],)).fetchone())
    assert row["token_hash"] == digest(token["token"])
    assert token["token"] not in str(row)
    assert token["token"] not in client.get("/api/integrations/tokens").text
    assert reader.get("/api/integrations/v1/devices").status_code == 200
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='operator' WHERE id=?", (row["owner_id"],))
    assert reader.get("/api/integrations/v1/devices").status_code == 401
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (row["owner_id"],))
        conn.execute("UPDATE integration_tokens SET expires=? WHERE id=?", (time.time() - 1, token["id"]))
    assert reader.get("/api/integrations/v1/devices").status_code == 401
    with db(write=True) as conn:
        conn.execute("UPDATE integration_tokens SET expires=? WHERE id=?", (time.time() + 300, token["id"]))
    assert client.delete("/api/integrations/tokens/" + token["id"]).status_code == 200
    assert reader.get("/api/integrations/v1/devices").status_code == 401


def test_token_cannot_write_or_use_operator_or_agent_endpoints(client):
    first, _, _, reader = setup(client)
    for method, url, body in [
        ("GET", "/api/devices", None),
        ("GET", "/api/integrations/tokens", None),
        ("POST", "/api/integrations/tokens", {"name": "escalate", "site": "Clinic A"}),
        ("POST", f"/api/devices/{first}/jobs", {"kind": "command", "payload": {"script": "whoami"}}),
        ("GET", "/api/slide/connection", None),
        ("GET", "/api/agent/jobs/next", None),
    ]:
        assert reader.request(method, url, json=body).status_code in (401, 404)
    assert client.get("/api/integrations/v1/devices").status_code == 401
    assert client.post("/api/integrations/tokens", json={"name": "bad", "site": ""}).status_code == 422
    assert client.post("/api/integrations/tokens", json={"name": "bad", "site": "Missing"}).status_code == 422
    assert (
        client.post(
            "/api/integrations/tokens", json={"name": "bad", "site": "Clinic A"}, headers={"X-CSRF-Token": "wrong"}
        ).status_code
        == 403
    )


def test_alerts_are_scoped_and_archives_excluded(client):
    first, second, _, reader = setup(client)
    with db(write=True) as conn:
        for aid, did in (("a", first), ("b", second)):
            conn.execute(
                "INSERT INTO alerts(id,device_id,key,title,severity,opened,updated) VALUES(?,?,?,?,?,?,?)",
                (aid, did, "cpu", "CPU high", "warning", time.time(), time.time()),
            )
    assert [a["id"] for a in reader.get("/api/integrations/v1/alerts").json()["alerts"]] == ["a"]
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET archived=1 WHERE id=?", (first,))
    assert not reader.get("/api/integrations/v1/alerts").json()["alerts"]
    assert reader.get(f"/api/integrations/v1/devices/{first}").status_code == 404


@pytest.mark.parametrize("role", ["operator", "viewer"])
def test_only_admin_manages_tokens(client, role):
    setup(client)
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role=?", (role,))
    assert client.get("/api/integrations/tokens").status_code == 403
    assert client.post("/api/integrations/tokens", json={"name": "bad", "site": "Clinic A"}).status_code == 403


def test_rate_limit_and_paging(client):
    first, second, token, reader = setup(client)
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET site='Clinic A' WHERE id=?", (second,))
    first_page = reader.get("/api/integrations/v1/devices?limit=1").json()
    next_page = reader.get(
        "/api/integrations/v1/devices", params={"limit": 1, "after": first_page["next_cursor"]}
    ).json()
    assert {first_page["devices"][0]["id"], next_page["devices"][0]["id"]} == {first, second}
    assert next_page["next_cursor"] is None
    with db(write=True) as conn:
        conn.execute(
            "UPDATE integration_tokens SET rate_minute=?,rate_count=120 WHERE id=?",
            (int(time.time() // 60), token["id"]),
        )
    assert reader.get("/api/integrations/v1/devices").status_code == 429


def test_all_sites_requires_explicit_token_and_does_not_widen_old_token(client):
    first, second, _, reader = setup(client)
    assert len(reader.get("/api/integrations/v1/devices").json()["devices"]) == 1
    token = client.post("/api/integrations/tokens", json={"name": "All network", "site": "*"}).json()
    all_reader = TestClient(app, base_url="https://testserver", headers={"Authorization": "Bearer " + token["token"]})
    assert {d["id"] for d in all_reader.get("/api/integrations/v1/devices").json()["devices"]} == {first, second}
    assert all_reader.get(f"/api/integrations/v1/devices/{second}").status_code == 200
    assert len(reader.get("/api/integrations/v1/devices").json()["devices"]) == 1
    assert all_reader.get("/api/infrastructure/inventory").status_code == 401


def test_topology_is_opt_in_granted_connections_only_and_scoped_endpoint_identity(client, monkeypatch):
    import hashlib
    from speck import infrastructure as infra, fleet

    first, second, _, old_reader = setup(client)
    with db(write=True) as conn:
        for cid, provider in [("cluster-a", "proxmox"), ("cluster-b", "proxmox"), ("slide", "slide")]:
            conn.execute(
                "INSERT INTO infrastructure_connections VALUES(?,?,?,?,?)", (cid, cid, provider, "{}", time.time())
            )
        conn.execute(
            "UPDATE devices SET hardware_id=?,slide_agent_id=? WHERE id=?",
            (hashlib.sha256(b"linux:uuid1").hexdigest(), "agent-first", first),
        )
        conn.execute(
            "UPDATE devices SET hardware_id=?,slide_agent_id=? WHERE id=?",
            (hashlib.sha256(b"linux:uuid2").hexdigest(), "agent-private", second),
        )
    calls = []
    monkeypatch.setattr(infra, "get_connection", lambda cid: {"id": cid})

    async def snapshot(cfg):
        calls.append(cfg["id"])
        return {
            "id": cfg["id"],
            "name": "Cluster",
            "status": "connected",
            "stale": False,
            "checked_at": 1,
            "resources": [
                {
                    "id": str(i),
                    "node": "pve",
                    "kind": "qemu",
                    "name": "Guest",
                    "identity": {"uuid": f"uuid{i}", "macs": []},
                    "secret": "private",
                }
                for i in (1, 2)
            ],
        }

    monkeypatch.setattr(fleet, "source_snapshot", snapshot)
    assert old_reader.get("/api/integrations/v1/topology").json()["enabled"] is False
    assert calls == []
    for grants in [["missing"], ["slide"]]:
        assert (
            client.post(
                "/api/integrations/tokens", json={"name": "bad", "site": "Clinic A", "topology_connection_ids": grants}
            ).status_code
            == 422
        )
    token = client.post(
        "/api/integrations/tokens",
        json={"name": "diagram", "site": "Clinic A", "topology_connection_ids": ["cluster-a"]},
    ).json()
    reader = TestClient(app, base_url="https://testserver", headers={"Authorization": "Bearer " + token["token"]})
    result = reader.get("/api/integrations/v1/topology").json()
    assert calls == ["cluster-a"]
    assert result["connections"][0]["resources"][0]["endpoint"]["slide_agent_id"] == "agent-first"
    assert len(result["connections"][0]["resources"]) == 1
    assert result["visibility"] == "site_matched_guests_and_parent_hosts"
    assert "private" not in json.dumps(result)
    assert token["topology_connection_ids"] == ["cluster-a"]
    with db(write=True) as conn:
        conn.execute("DELETE FROM infrastructure_connections WHERE id='cluster-a'")
    missing = reader.get("/api/integrations/v1/topology").json()
    assert missing["unavailable_connections"] == 1 and missing["connections"] == []
    client.delete("/api/integrations/tokens/" + token["id"])
    assert reader.get("/api/integrations/v1/topology").status_code == 401
