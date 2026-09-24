import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pyotp
import pytest
from fastapi.testclient import TestClient

from speck.db import db, initialize
from speck.main import app
from speck.monitoring import MonitorPolicy, evaluate
from speck.scheduling import tick
from test_control_plane import enroll


def managed(client, platform="linux"):
    obj, headers = enroll(client, "hw-" + str(time.time_ns()), platform + " test")
    sample(client, obj["device_id"], platform=platform)
    return obj["device_id"], headers


def sample(client, device, at=None, platform="linux", **changes):
    at = time.time() if at is None else at
    telemetry = {
        "collected_at": datetime.fromtimestamp(at, timezone.utc).isoformat(),
        "capabilities": {"managed_operations": True},
        "cpu_percent": 12,
        "memory": {"usedPercent": 40},
        "disks": [{"path": "/", "usedPercent": 55}],
        "services": [
            {
                "name": "spooler" if platform == "windows" else "asterisk.service",
                "status": "running" if platform == "windows" else "active",
            }
        ],
    } | changes
    with db(write=True) as conn:
        conn.execute(
            "UPDATE devices SET telemetry=?,platform=?,last_seen=? WHERE id=?",
            (json.dumps(telemetry), platform, at, device),
        )
    return telemetry


def policy(client, device, **changes):
    body = MonitorPolicy().model_dump() | changes
    assert client.put(f"/api/devices/{device}/monitoring", json=body).status_code == 200


def evaluate_at(now):
    with db(write=True) as conn:
        evaluate(conn, now)


def test_existing_database_migration_is_idempotent(client):
    device, _ = managed(client)
    client.put(
        f"/api/devices/{device}/remote", json={"protocol": "ssh", "port": 22, "password": "synthetic-private-password"}
    )
    with db() as conn:
        before = dict(conn.execute("SELECT * FROM devices WHERE id=?", (device,)).fetchone())
    initialize()
    initialize()
    with db() as conn:
        after = dict(conn.execute("SELECT * FROM devices WHERE id=?", (device,)).fetchone())
    assert before == after
    assert client.get("/api/auth/me").json()["role"] == "admin"


@pytest.mark.parametrize("platform,service", [("linux", "asterisk.service"), ("windows", "spooler")])
def test_health_alert_lifecycle_hysteresis_staleness_and_maintenance(client, platform, service):
    device, _ = managed(client, platform)
    policy(client, device, services=[service], hold_seconds=30)
    now = time.time()
    bad = {
        "cpu_percent": 98,
        "memory": {"usedPercent": 98},
        "disks": [{"path": "/", "usedPercent": 94}],
        "services": [],
    }
    sample(client, device, now, platform, **bad)
    evaluate_at(now)
    assert not client.get("/api/alerts").json()["items"]
    sample(client, device, now + 31, platform, **bad)
    evaluate_at(now + 31)
    items = client.get("/api/alerts").json()["items"]
    assert {a["key"] for a in items} == {"cpu", "memory", "disk:/", "service:" + service}
    alert_id = items[0]["id"]
    assert client.post("/api/alerts/" + alert_id, json={"action": "acknowledge"}).status_code == 200
    initialize()
    evaluate_at(now + 35)
    assert len(client.get("/api/alerts").json()["items"]) == 4
    # Missing data must never mark existing conditions healthy.
    sample(client, device, now + 40, platform, cpu_percent=None, memory=None, disks=None, services=None)
    evaluate_at(now + 40)
    assert len(client.get("/api/alerts").json()["items"]) == 4
    sample(client, device, now + 45, platform, cpu_percent=92)
    evaluate_at(now + 45)
    assert [a["key"] for a in client.get("/api/alerts").json()["items"]] == ["cpu"]
    client.put(
        f"/api/devices/{device}/organization",
        json={"maintenance_until": now + 300, "site": "Lab", "tags": ["QA", "qa"]},
    )
    sample(client, device, now + 50, platform)
    evaluate_at(now + 50)
    assert len(client.get("/api/alerts").json()["items"]) == 1
    client.put(f"/api/devices/{device}/organization", json={"maintenance_until": 0})
    evaluate_at(now + 51)
    assert not client.get("/api/alerts").json()["items"]
    with db() as conn:
        assert conn.execute("SELECT count(*) FROM alerts WHERE resolved IS NOT NULL").fetchone()[0] == 4


def test_offline_job_expiry_and_no_failed_job_alert_reopen(client):
    device, _ = managed(client)
    job = client.post(
        f"/api/devices/{device}/jobs", json={"kind": "command", "payload": {"script": "echo test"}}
    ).json()["id"]
    now = time.time()
    with db(write=True) as conn:
        conn.execute("UPDATE jobs SET deadline=? WHERE id=?", (now - 1, job))
        conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (now - 181, device))
    tick(now)
    assert client.get("/api/jobs/" + job).json()["status"] == "expired"
    items = client.get("/api/alerts").json()["items"]
    assert {a["key"] for a in items} == {"offline", "job:" + job}
    assert len(client.get("/api/alerts?device_id=").json()["items"]) == 2
    assert client.get("/api/monitoring").json()["healthy"] is True
    event = next(a for a in items if a["key"].startswith("job:"))
    assert client.post("/api/alerts/" + event["id"], json={"action": "resolve"}).status_code == 200
    tick(now + 1)
    assert len(client.get("/api/alerts").json()["items"]) == 1


def schedule_body(device, kind="patch.scan", **changes):
    operation = {
        "request_id": "schedule-test-" + str(time.time_ns()),
        "name": "Scheduled test",
        "kind": kind,
        "device_ids": [device],
        "confirmed": True,
    }
    if kind == "template":
        operation |= {"template_id": "starter-linux-health", "template_revision": 1}
    return {
        "operation": operation,
        "first_run": time.time() + 60,
        "interval_seconds": 3600,
        "confirmed": True,
    } | changes


def test_schedule_claim_is_atomic_and_survives_restart(client):
    device, _ = managed(client)
    body = schedule_body(device)
    assert client.post("/api/schedules/preview", json=body).status_code == 200
    result = client.post("/api/schedules", json=body)
    assert result.status_code == 200, result.text
    duplicate = client.post("/api/schedules", json=body)
    assert duplicate.json() == result.json() | {"existing": True}
    assert client.post("/api/schedules", json=body | {"interval_seconds": 7200}).status_code == 409
    due = body["first_run"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(tick, [due] * 4))
    initialize()
    tick(due)
    rows = client.get("/api/schedules").json()
    assert len(rows[0]["runs"]) == 1 and rows[0]["runs"][0]["status"] == "queued"
    assert rows[0]["next_run"] == due + 3600
    assert len(client.get("/api/jobs").json()) == 1
    with db() as conn:
        assert conn.execute("SELECT count(*) FROM batches").fetchone()[0] == 1


def test_schedule_skips_missed_and_offline_runs_without_catchup(client):
    device, _ = managed(client)
    body = schedule_body(device)
    client.post("/api/schedules", json=body)
    tick(body["first_run"] + 7201)
    row = client.get("/api/schedules").json()[0]
    assert row["runs"][0]["status"] == "skipped"
    assert row["next_run"] > body["first_run"] + 7201
    assert not client.get("/api/jobs").json()
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time() - 100, device))
    tick(row["next_run"])
    assert "offline" in client.get("/api/schedules").json()[0]["runs"][0]["reason"]
    assert not client.get("/api/jobs").json()


def test_edited_template_blocks_schedule_until_reviewed(client):
    device, _ = managed(client)
    template = {"name": "Reviewed proof", "platform": "linux", "script": "echo reviewed"}
    saved = client.post("/api/templates", json=template).json()
    body = schedule_body(device, "template")
    body["operation"].update(template_id=saved["id"], template_revision=saved["revision"])
    assert client.post("/api/schedules", json=body).status_code == 200
    client.put("/api/templates/" + saved["id"], json=template | {"script": "echo different"})
    tick(body["first_run"])
    row = client.get("/api/schedules").json()[0]
    assert not row["enabled"] and row["runs"][0]["status"] == "needs_review"
    assert not client.get("/api/jobs").json()


def test_archive_is_reversible_and_revocation_explicitly_includes_clones(client):
    device, headers = managed(client)
    clone_headers = headers | {"X-Speck-Hardware": "clone-identity-for-test"}
    clone = client.post(
        "/api/agent/check-in",
        headers=clone_headers,
        json={"hostname": "clone", "platform": "linux", "arch": "amd64", "telemetry": {}},
    ).json()["device_id"]
    client.post(f"/api/devices/{device}/jobs", json={"kind": "command", "payload": {"script": "echo never-started"}})
    assert client.put(f"/api/devices/{device}/archive", json={"archived": True}).status_code == 200
    assert device not in {d["id"] for d in client.get("/api/devices").json()}
    assert client.get("/api/agent/jobs/next", headers=headers).json() == {"job": None}
    assert (
        client.post(
            f"/api/devices/{device}/jobs", json={"kind": "command", "payload": {"script": "echo no"}}
        ).status_code
        == 409
    )
    assert client.put(f"/api/devices/{device}/archive", json={"archived": False}).status_code == 200
    assert client.get("/api/jobs").json()[0]["status"] == "cancelled"
    affected = client.get(f"/api/devices/{device}/installation").json()["devices"]
    assert {d["id"] for d in affected} == {device, clone}
    path = f"/api/devices/{device}/installation/revoke"
    assert client.post(path, json={"confirmed": True, "affected_device_ids": [device]}).status_code == 409
    assert client.get("/api/agent/jobs/next", headers=headers).status_code == 200
    assert client.post(path, json={"confirmed": True, "affected_device_ids": [device, clone]}).status_code == 200
    assert client.get("/api/agent/jobs/next", headers=headers).status_code == 401
    assert client.get("/api/agent/jobs/next", headers=clone_headers).status_code == 401
    assert client.put(f"/api/devices/{device}/archive", json={"archived": False}).status_code == 409


def user_session(client, role):
    obj = client.post(
        "/api/access/users", json={"username": role, "password": "synthetic-account-password", "role": role}
    )
    assert obj.status_code == 200, obj.text
    c = TestClient(app, base_url="https://testserver")
    response = c.post(
        "/api/auth/login",
        json={"username": role, "password": "synthetic-account-password"},
        headers={"Origin": "https://testserver"},
    )
    assert response.status_code == 200
    c.headers.update({"Origin": "https://testserver", "X-CSRF-Token": response.json()["csrf"]})
    return obj.json()["id"], c


def test_role_boundaries_last_admin_and_immediate_session_revocation(client):
    device, _ = managed(client)
    _, viewer = user_session(client, "viewer")
    for path in ("/api/devices", "/api/alerts", "/api/audit/events", "/api/access/me"):
        assert viewer.get(path).status_code == 200
    for path in (
        "/api/jobs",
        "/api/templates",
        "/api/recovery/plans",
        f"/api/devices/{device}/preview",
        f"/api/devices/{device}/remote/native.rdp",
    ):
        assert viewer.get(path).status_code == 403
    assert (
        viewer.post(
            f"/api/devices/{device}/jobs", json={"kind": "command", "payload": {"script": "echo denied"}}
        ).status_code
        == 403
    )
    operator_id, operator = user_session(client, "operator")
    assert (
        operator.post(
            f"/api/devices/{device}/jobs", json={"kind": "command", "payload": {"script": "echo authorized"}}
        ).status_code
        == 200
    )
    assert (
        operator.put("/api/slide/connection", json={"url": "https://api.slide.tech", "token": "a" * 40}).status_code
        == 403
    )
    assert operator.get("/api/access/users").status_code == 403
    admin_id = next(u["id"] for u in client.get("/api/access/users").json() if u["username"] == "admin")
    assert (
        client.patch("/api/access/users/" + admin_id, json={"role": "operator", "disabled": False}).status_code == 409
    )
    assert (
        client.patch("/api/access/users/" + operator_id, json={"role": "operator", "disabled": True}).status_code == 200
    )
    assert operator.get("/api/devices").status_code == 401


def test_mfa_encrypted_secret_code_replay_and_single_use_recovery(client):
    result = client.post("/api/access/totp/setup", json={"password": "test-only-admin-password"})
    assert result.status_code == 200, result.text
    secret = result.json()["secret"]
    otp = pyotp.TOTP(secret)
    assert client.post("/api/access/totp/confirm", json={"code": "not-code"}).status_code == 422
    used = otp.now()
    confirmed = client.post("/api/access/totp/confirm", json={"code": used})
    assert confirmed.status_code == 200, confirmed.text
    codes = confirmed.json()["recovery_codes"]
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username='admin'").fetchone()
        assert secret not in row["totp_secret"] and codes[0] not in row["recovery_codes"]
    login = {"username": "admin", "password": "test-only-admin-password"}
    assert client.post("/api/auth/login", json=login).status_code == 401
    # Replay the exact confirmed code; a fresh otp.now() is valid once the 30-second window rolls over.
    assert client.post("/api/auth/login", json=login | {"code": used}).status_code == 401
    result = client.post("/api/auth/login", json=login | {"code": codes[0]})
    assert result.status_code == 200
    assert client.post("/api/auth/login", json=login | {"code": codes[0]}).status_code == 401
    assert client.get("/api/access/me").json()["recovery_codes_remaining"] == 9


def test_audit_filters_and_cursor_have_no_duplicates(client):
    managed(client)
    first = client.get("/api/audit/events?limit=2").json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = client.get("/api/audit/events?limit=2&before_id=" + str(first["next_cursor"])).json()
    assert not ({a["id"] for a in first["items"]} & {a["id"] for a in second["items"]})
    filtered = client.get("/api/audit/events?actor=admin&action=enrollment").json()["items"]
    assert filtered and all(a["actor"] == "admin" and a["action"] == "enrollment.created" for a in filtered)


def test_alert_cursor_preserves_conditions_opened_at_same_time(client):
    from speck.monitoring import open_alert

    device, _ = managed(client)
    now = time.time()
    with db(write=True) as conn:
        for i in range(5):
            open_alert(conn, device, f"job:synthetic-{i}", f"Job {i}", "warning", now)
    cursor, seen = "", []
    for _ in range(3):
        page = client.get("/api/alerts?limit=2" + ("&before_id=" + cursor if cursor else "")).json()
        seen.extend(a["id"] for a in page["items"])
        cursor = page["next_cursor"]
    assert cursor is None and len(seen) == len(set(seen)) == 5


def test_malformed_optional_telemetry_does_not_stop_monitoring(client):
    device, _ = managed(client)
    sample(
        client,
        device,
        services=[{"name": {"invalid": True}, "status": []}],
        cpu_percent=float("inf"),
        memory=[],
        disks=[{"path": {}, "usedPercent": "invalid"}],
    )
    tick()
    assert client.get("/api/monitoring").json()["healthy"]


def test_mixed_platform_schedule_skips_all_if_one_target_is_offline(client):
    linux, _ = managed(client, "linux")
    windows, _ = managed(client, "windows")
    body = schedule_body(linux)
    body["operation"]["device_ids"].append(windows)
    assert client.post("/api/schedules", json=body).status_code == 200
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time() - 200, windows))
    tick(body["first_run"])
    assert not client.get("/api/jobs").json()
    run = client.get("/api/schedules").json()[0]["runs"][0]
    assert run["status"] == "skipped" and "offline" in run["reason"]


def test_disabling_schedule_owner_pauses_automation(client):
    device, _ = managed(client)
    owner_id, operator = user_session(client, "operator")
    body = schedule_body(device)
    assert operator.post("/api/schedules", json=body).status_code == 200
    assert client.patch("/api/access/users/" + owner_id, json={"role": "viewer", "disabled": False}).status_code == 200
    tick(body["first_run"])
    assert not client.get("/api/jobs").json()
    assert not client.get("/api/schedules").json()[0]["enabled"]


def test_password_change_keeps_current_session_and_revokes_others(client):
    assert (
        client.post(
            "/api/access/password",
            json={"password": "incorrect-current-password", "new_password": "different-synthetic-passphrase"},
        ).status_code
        == 403
    )
    assert client.get("/api/auth/me").status_code == 200
    other = TestClient(app, base_url="https://testserver")
    response = other.post(
        "/api/auth/login",
        headers={"Origin": "https://testserver"},
        json={"username": "admin", "password": "test-only-admin-password"},
    )
    assert response.status_code == 200
    assert (
        client.post(
            "/api/access/password",
            json={"password": "test-only-admin-password", "new_password": "different-synthetic-passphrase"},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert (
        other.post(
            "/api/auth/login",
            headers={"Origin": "https://testserver"},
            json={"username": "admin", "password": "test-only-admin-password"},
        ).status_code
        == 401
    )
    assert (
        other.post(
            "/api/auth/login",
            headers={"Origin": "https://testserver"},
            json={"username": "admin", "password": "different-synthetic-passphrase"},
        ).status_code
        == 200
    )


def test_schedule_rejects_installations_and_unreviewed_targets(client):
    device, _ = managed(client)
    body = schedule_body(device)
    body["operation"]["kind"] = "patch.install"
    assert client.post("/api/schedules", json=body).status_code == 422
    body["operation"]["kind"] = "patch.scan"
    body["confirmed"] = False
    assert client.post("/api/schedules", json=body).status_code == 422
    body["confirmed"] = True
    body["operation"]["device_ids"] = [device, device]
    assert client.post("/api/schedules", json=body).status_code == 422


def test_remote_listener_is_closed_if_device_is_retired_during_start(client, monkeypatch):
    from fastapi import HTTPException
    from speck import remote

    device, _ = managed(client)
    client.put(f"/api/devices/{device}/remote", json={"protocol": "ssh", "port": 22, "username": "test"})

    def rejected(*args, **kwargs):
        raise HTTPException(409, "Retired while connecting")

    monkeypatch.setattr(remote, "create_job", rejected)
    assert client.post(f"/api/devices/{device}/remote/sessions", json={"width": 1024, "height": 768}).status_code == 409
    assert not remote.sessions


def test_legacy_schema_upgrade_preserves_bootstrap_account_and_identity(tmp_path, monkeypatch):
    import sqlite3
    from argon2 import PasswordHasher

    monkeypatch.setenv("SPECK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SPECK_ENCRYPTION_KEY", "synthetic-migration-key-with-at-least-32-characters")
    with sqlite3.connect(tmp_path / "speck.db") as conn:
        conn.executescript("""
        CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
        CREATE TABLE installations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE devices(id TEXT PRIMARY KEY,installation_id TEXT NOT NULL REFERENCES installations(id),hardware_id TEXT NOT NULL,hostname TEXT NOT NULL,label TEXT NOT NULL,platform TEXT NOT NULL,arch TEXT NOT NULL,created REAL NOT NULL,last_seen REAL NOT NULL,approved INTEGER NOT NULL,telemetry TEXT NOT NULL DEFAULT '{}',slide_agent_id TEXT,remote_secret TEXT,UNIQUE(installation_id,hardware_id));
        """)
        hashed = PasswordHasher().hash("legacy-synthetic-account")
        conn.execute("INSERT INTO users VALUES(?,?,?)", ("legacy-user", "legacy-admin", hashed))
        conn.execute("INSERT INTO installations VALUES(?,?,?,0)", ("legacy-install", "synthetic-token-hash", 100))
        conn.execute(
            "INSERT INTO devices VALUES('original','legacy-install','original-hardware','server','Server','windows','amd64',100,200,1,'{}','slide-original',NULL)"
        )
        conn.execute(
            "INSERT INTO devices VALUES('clone','legacy-install','clone-hardware','server','Recovery candidate','windows','amd64',150,201,0,'{}',NULL,NULL)"
        )
    initialize()
    initialize()
    with db() as conn:
        user = conn.execute("SELECT * FROM users").fetchone()
        assert user["password_hash"] == hashed and user["role"] == "admin" and user["disabled"] == 0
        original = dict(conn.execute("SELECT * FROM devices WHERE id='original'").fetchone())
        clone = dict(conn.execute("SELECT * FROM devices WHERE id='clone'").fetchone())
        assert original["slide_agent_id"] == "slide-original" and original["approved"] == 1
        assert clone["approved"] == 0 and clone["installation_id"] == original["installation_id"]
        assert original["site"] == "" and original["tags"] == "[]" and original["archived"] == 0
        assert conn.execute("SELECT token_hash FROM installations").fetchone()[0] == "synthetic-token-hash"


def test_login_throttle_is_per_account_as_well_as_per_source(client):
    # Ten different client addresses must not bypass the authenticator/password
    # attempt budget for one account.
    for i in range(10):
        remote = TestClient(app, base_url="https://testserver", client=(f"192.0.2.{i + 1}", 12345))
        response = remote.post(
            "/api/auth/login",
            headers={"Origin": "https://testserver"},
            json={"username": "admin", "password": "wrong-synthetic-password"},
        )
        assert response.status_code == 401
    remote = TestClient(app, base_url="https://testserver", client=("192.0.2.200", 12345))
    assert (
        remote.post(
            "/api/auth/login",
            headers={"Origin": "https://testserver"},
            json={"username": "admin", "password": "wrong-synthetic-password"},
        ).status_code
        == 429
    )
