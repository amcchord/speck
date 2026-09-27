import time
import json

import pytest

from speck.db import audit, db, initialize
from speck.vault import CHECKS
from test_fleet_operations import batch, managed
from test_fleet_operations import finish
from test_network_equipment import upstream  # noqa: F401


def test_provider_history_survives_restart_without_claiming_current_health(client):
    CHECKS.clear()
    with db(write=True) as conn:
        audit(conn, "test-operator", "vault.provider.checked", detail={"service": "openai", "ok": True})
    row = next(s for s in client.get("/api/keys/services").json() if s["service"] == "openai")
    assert row["last_check"]["historical"] is True
    assert row["last_check"]["ok"] is True
    assert row["last_check"]["checked_at"] > time.time() - 10


def test_schedule_edit_requires_fresh_review_and_does_not_replay_missed_runs(client):
    device, _ = managed(client)
    operation = batch([device["device_id"]])
    body = {"operation": operation, "first_run": time.time() + 3600, "interval_seconds": 86400, "confirmed": True}
    result = client.post("/api/schedules", json=body)
    assert result.status_code == 200
    schedule_id = result.json()["id"]
    edited = body | {"revision": 1, "operation": operation | {"name": "Reviewed replacement"}}
    assert client.put("/api/schedules/" + schedule_id, json=edited | {"confirmed": False}).status_code == 422
    assert client.put("/api/schedules/" + schedule_id, json=edited | {"first_run": time.time() - 60}).status_code == 422
    assert client.put("/api/schedules/" + schedule_id, json=edited).status_code == 200
    assert client.put("/api/schedules/" + schedule_id, json=edited).status_code == 409
    assert client.get("/api/jobs").json() == []
    schedule = client.get("/api/schedules").json()[0]
    assert schedule["revision"] == 2 and schedule["name"] == "Reviewed replacement"


def test_template_revisions_preserve_encrypted_history_across_migration(client):
    spec = {
        "name": "Example script",
        "platform": "linux",
        "category": "script",
        "script": "echo first",
        "parameters": [],
        "timeout": 60,
    }
    result = client.post("/api/templates", json=spec).json()
    template_id = result["id"]
    assert client.put("/api/templates/" + template_id, json=spec | {"script": "echo second"}).status_code == 200
    initialize()
    history = client.get("/api/templates/" + template_id + "/revisions").json()
    assert [h["revision"] for h in history] == [2, 1]
    assert history[1]["template"]["script"] == "echo first"
    with db() as conn:
        assert all("echo" not in row["spec"] for row in conn.execute("SELECT spec FROM template_revisions"))


@pytest.mark.parametrize(
    "platform,output", [("windows", '[{"name":"Example","version":"1"}]'), ("linux", "example\t1.0\tamd64\n")]
)
def test_inspection_requires_review_and_retains_last_success(client, platform, output):
    device, headers = managed(client, platform=platform)
    path = "/api/devices/" + device["device_id"] + "/inspection"
    assert client.post(path, json={"kind": "software"}).status_code == 422
    preview = client.post(path + "/preview", json={"kind": "software"})
    assert preview.status_code == 200 and preview.json()["script"]
    assert client.post(path, json={"kind": "software", "confirmed": True}).status_code == 200
    assert client.post(path, json={"kind": "software", "confirmed": True}).status_code == 409
    finish(client, headers, {"exit_code": 0, "stdout": output})
    reports = client.get(path + "s").json()
    assert reports[0]["report"]["rows"][0]["version"] in ("1", "1.0")
    assert client.post(path, json={"kind": "software", "confirmed": True}).status_code == 200
    finish(client, headers, {"exit_code": 1, "stdout": "failed"})
    assert client.get(path + "s").json() == reports
    with db() as conn:
        stored = conn.execute("SELECT report FROM inspection_reports").fetchone()[0]
        assert "example" not in stored.lower()


def test_service_inspection_rejects_shell_metacharacters_and_unapproved_targets(client):
    d, _ = managed(client)
    path = "/api/devices/" + d["device_id"] + "/inspection/preview"
    for service in ["sshd; touch /tmp/pwn", "$(id)", "a\nb", "a|b", "a`id`"]:
        assert client.post(path, json={"kind": "service", "service": service}).status_code == 422
    assert client.post(path, json={"kind": "service", "service": "sshd.service"}).status_code == 200
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET approved=0 WHERE id=?", (d["device_id"],))
    assert client.post(path, json={"kind": "processes"}).status_code == 409


def test_history_is_scoped_encrypted_and_disabled_by_default(client, upstream):  # noqa: F811
    base = "/api/unifi/sites/console/site/devices/switch"
    assert client.get(base).status_code == 200
    response = client.get(base + "/history").json()
    assert response["collection"]["enabled"] is False
    assert len(response["samples"]) == 1
    assert client.get(base).status_code == 200
    assert len(client.get(base + "/history").json()["samples"]) == 1
    assert client.get(base.replace("/console/", "/another/") + "/history").status_code == 404
    assert client.put(base + "/history", json={"enabled": True}).status_code == 200
    assert client.get(base + "/history").json()["collection"]["enabled"] == 1
    with db() as conn:
        assert "ports" not in conn.execute("SELECT payload FROM network_samples").fetchone()[0]
    assert client.get("/api/unifi/equipment/index").json()[0]["id"] in ("switch", "ap")
    assert not any(method == "POST" for method, _, _ in upstream["calls"])


def test_history_prunes_old_samples_and_ignores_invalid_measurements(client):
    from speck.network_history import record, RETENTION

    data = {
        "site": {"console_id": "console", "id": "site"},
        "device": {"id": "switch"},
        "ports": [
            {"idx": 1, "state": "UP", "speedMbps": float("nan"), "observation": {"poe_power": True, "rx_errors": -2}}
        ],
    }
    record(data | {"checked_at": time.time() - RETENTION - 100})
    record(data)
    from speck.config import unseal

    with db() as conn:
        rows = conn.execute("SELECT payload FROM network_samples").fetchall()
        assert len(rows) == 1
        port = json.loads(unseal(rows[0][0]))["ports"][0]
        assert port["speed_mbps"] is None and port["poe_power"] is None and port["rx_errors"] is None


def test_rotation_plan_is_metadata_only_encrypted_and_validated(client):
    assert client.post("/api/keys/static", json={"name": "upgrade-key", "value": "secret-value"}).status_code == 200
    path = "/api/keys/upgrade-key/rotation-plan"
    plan = {
        "owner": "Operations",
        "purpose": "Database access",
        "next_review": "2026-10-01",
        "procedure": "Review consumers, replace, validate, revoke old credential",
    }
    assert client.put(path, json=plan | {"next_review": "2026-02-31"}).status_code == 422
    assert client.put(path, json=plan).status_code == 200
    detail = client.get("/api/keys/upgrade-key/details").json()
    assert detail["rotation_plan"]["owner"] == "Operations"
    assert "secret-value" not in json.dumps(detail)
    with db() as conn:
        assert "Database access" not in conn.execute("SELECT payload FROM key_rotation_plans").fetchone()[0]


def test_sessions_never_expose_authentication_material(client):
    response = client.get("/api/access/sessions")
    assert response.status_code == 200
    encoded = response.text
    assert "token_hash" not in encoded and "csrf" not in encoded
    rows = response.json()
    assert any(r["current"] and r["created"] and r["last_seen"] for r in rows)


def test_schedule_history_pages_without_duplicating_boundaries(client):
    device, _ = managed(client)
    response = client.post(
        "/api/schedules",
        json={"operation": batch([device["device_id"]]), "first_run": time.time() + 3600, "confirmed": True},
    )
    sid = response.json()["id"]
    with db(write=True) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(schedule_runs)")}
        assert {"schedule_id", "due", "status"} <= columns
        for i in range(102):
            conn.execute(
                "INSERT INTO schedule_runs(schedule_id,due,status,reason,created) VALUES(?,?,?,?,?)",
                (sid, time.time() - 200 + i, "skipped", "Offline target", time.time()),
            )
    first = client.get("/api/schedules/" + sid + "/history").json()
    assert len(first["items"]) == 100
    second = client.get("/api/schedules/" + sid + "/history", params={"before": first["next_cursor"]}).json()
    assert len(second["items"]) == 2
    assert not {r["due"] for r in first["items"]} & {r["due"] for r in second["items"]}
