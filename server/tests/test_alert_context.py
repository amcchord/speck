import json
import time

import httpx
import pytest

from speck.db import db
from speck.jobs import create_job
from speck.monitoring import open_alert
from test_management import managed, user_session


def alert_job(device, status="unknown", kind="command", payload=None):
    job = create_job(device, kind, payload or {"script": "echo private-job-script"}, "admin")
    with db(write=True) as conn:
        conn.execute(
            "UPDATE jobs SET status=?,finished=?,result=? WHERE id=?",
            (status, time.time(), json.dumps({"exit_code": 1, "stderr": "private-job-output"}), job),
        )
        alert = open_alert(conn, device, "job:" + job, "Job legacy unknown", "warning", time.time())
    return alert, job


@pytest.mark.parametrize(
    "status,title",
    [
        ("unknown", "Command · completion unconfirmed"),
        ("expired", "Command · did not start in time"),
        ("failed", "Command · failed"),
    ],
)
def test_existing_job_alerts_explain_outcomes_without_exposing_output(client, status, title):
    device, _ = managed(client)
    alert, job = alert_job(device, status)
    response = client.get("/api/alerts")
    item = response.json()["items"][0]
    assert item["title"] == title
    assert item["job"]["id"] == job
    assert "private-job" not in response.text
    assert "does not undo or retry" in item["resolution_hint"]
    detail = client.get("/api/alerts/" + alert).json()
    assert detail["job"]["script"] == "echo private-job-script"
    assert detail["job"]["result"]["stderr"] == "private-job-output"
    assert "payload" not in detail["job"]
    assert "lease_hash" not in detail["job"]


def test_operation_names_missing_history_and_viewer_boundaries(client):
    device, _ = managed(client)
    alert, job = alert_job(device)
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO batches VALUES('b','r','f','Daily health check','template','admin',?)", (time.time(),)
        )
        conn.execute("INSERT INTO batch_jobs VALUES('b',?,?)", (job, device))
        missing = open_alert(conn, device, "job:missing", "Job missing unknown", "warning", time.time())
    items = {a["id"]: a for a in client.get("/api/alerts").json()["items"]}
    assert items[alert]["title"] == "Daily health check · completion unconfirmed"
    assert items[missing]["title"] == "Past operation needs review"
    _, viewer = user_session(client, "viewer")
    assert viewer.get("/api/alerts").status_code == 200
    assert viewer.get("/api/alerts/" + alert).status_code == 403
    assert (
        viewer.post("/api/ai/assist", json={"prompt": "diagnose", "device_id": device, "alert_id": alert}).status_code
        == 403
    )


def test_connection_payload_never_enters_alert_evidence_and_output_is_bounded(client):
    device, _ = managed(client)
    alert, job = alert_job(device, kind="tunnel", payload={"password": "private-connection-secret"})
    with db(write=True) as conn:
        conn.execute(
            "UPDATE jobs SET result=? WHERE id=?",
            (json.dumps({"stderr": "x" * 9000, "password": "private-result-secret"}), job),
        )
    response = client.get("/api/alerts/" + alert)
    assert "private-" not in response.text
    assert "script" not in response.json()["job"]
    result = response.json()["job"]["result"]
    assert len(result["stderr"]) == 6000
    assert result["truncated"] is True


@pytest.fixture
def ai(client, monkeypatch):
    captured = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            captured.append(kwargs["json"])
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": json.dumps(
                                        {
                                            "summary": "Check evidence first",
                                            "script": "uptime",
                                            "verification": "Inspect output",
                                            "caution": "Review before running",
                                        }
                                    ),
                                }
                            ],
                        }
                    ],
                },
            )

    monkeypatch.setattr("speck.assistant.httpx.AsyncClient", FakeClient)
    client.put("/api/ai/settings", json={"key": "test-secret", "model": "test-model"})
    return captured


@pytest.mark.parametrize("platform,intent", [("linux", "diagnose"), ("windows", "fix")])
def test_ai_uses_alert_identity_and_opt_in_evidence_without_running_jobs(client, ai, platform, intent):
    device, _ = managed(client, platform)
    alert, _ = alert_job(device)
    body = {
        "prompt": "Help with this alert",
        "device_id": device,
        "alert_id": alert,
        "alert_intent": intent,
        "include_health": True,
    }
    assert client.post("/api/ai/assist", json=body).status_code == 200
    request = ai[-1]
    context = json.loads(request["input"][0]["content"][0]["text"])
    assert context["platform"] == platform
    assert context["alert"]["id"] == alert
    assert context["job"]["status"] == "unknown"
    assert context["health"]["disks"] == [{"path": "/", "used_percent": 55}]
    assert context["health"]["collected_at"]
    assert "private-job" not in json.dumps(request)
    assert "DIAGNOSE mode" in request["instructions"] if intent == "diagnose" else "FIX mode" in request["instructions"]
    assert "tools" not in request
    assert request["store"] is False
    assert (
        client.post("/api/ai/assist", json=body | {"include_health": False, "include_job_evidence": True}).status_code
        == 200
    )
    context = json.loads(ai[-1]["input"][0]["content"][0]["text"])
    assert "health" not in context
    assert context["job"]["script"] == "echo private-job-script"
    assert context["job"]["result"]["stderr"] == "private-job-output"
    assert len(client.get("/api/jobs").json()) == 1
    assert "private-job" not in client.get("/api/audit").text


def test_ai_rejects_wrong_machine_resolved_repairs_and_retired_devices(client, ai):
    device, _ = managed(client)
    other, _ = managed(client)
    alert, _ = alert_job(device)
    body = {"prompt": "Diagnose", "device_id": device, "alert_id": alert}
    assert client.post("/api/ai/assist", json=body | {"device_id": other}).status_code == 422
    assert client.post("/api/ai/assist", json=body | {"device_id": None}).status_code == 422
    assert client.post("/api/ai/assist", json=body | {"alert_id": "missing"}).status_code == 404
    client.post("/api/alerts/" + alert, json={"action": "resolve"})
    assert client.post("/api/ai/assist", json=body | {"alert_intent": "fix"}).status_code == 409
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET archived=1 WHERE id=?", (device,))
    assert client.post("/api/ai/assist", json=body).status_code == 409
    assert ai == []


def test_missing_telemetry_does_not_break_alert_diagnosis(client, ai):
    device, _ = managed(client)
    with db(write=True) as conn:
        conn.execute(
            "UPDATE devices SET telemetry=? WHERE id=?",
            (json.dumps({"memory": None, "disks": None, "services": None, "host": None}), device),
        )
        alert = open_alert(conn, device, "telemetry", "Inventory unavailable", "warning", time.time())
    response = client.post(
        "/api/ai/assist", json={"prompt": "Diagnose", "device_id": device, "alert_id": alert, "include_health": True}
    )
    assert response.status_code == 200
    context = json.loads(ai[-1]["input"][0]["content"][0]["text"])
    assert context["health"]["memory_percent"] is None
    assert context["health"]["services"] == []
