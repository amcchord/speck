import base64
import json
import time

import httpx
import pytest
from fastapi import HTTPException

from speck.assistant import validate_actions
from speck.config import unseal
from speck.db import db
from speck.operations import render_script
from test_control_plane import enroll


def managed(client, hardware="operations-original-123", platform="linux"):
    device, headers = enroll(client, hardware)
    with db(write=True) as conn:
        conn.execute(
            "UPDATE devices SET platform=?,telemetry=?,last_seen=? WHERE id=?",
            (platform, json.dumps({"capabilities": {"managed_operations": True}}), time.time(), device["device_id"]),
        )
    return device, headers


def batch(ids, **kwargs):
    return {
        "request_id": "test-request-" + str(time.time_ns()),
        "name": "Test scan",
        "kind": "patch.scan",
        "device_ids": ids,
        "confirmed": True,
        **kwargs,
    }


def finish(client, headers, result):
    job = client.get("/api/agent/jobs/next", headers=headers).json()["job"]
    assert job
    r = client.post(
        "/api/agent/jobs/" + job["id"],
        headers=headers,
        json={"lease": job["lease"], "status": "complete", "result": result},
    )
    assert r.status_code == 200
    return job


def test_bulk_atomic_validation_idempotency_and_cancel(client):
    d, headers = managed(client)
    body = batch([d["device_id"], "missing"])
    assert client.post("/api/batches", json=body).status_code == 409
    assert client.get("/api/jobs").json() == []
    body["device_ids"] = [d["device_id"]]
    response = client.post("/api/batches", json=body)
    assert response.status_code == 200
    assert client.post("/api/batches", json=body).json()["id"] == response.json()["id"]
    assert len(client.get("/api/jobs").json()) == 1
    assert client.post("/api/batches", json=body | {"name": "different"}).status_code == 409
    assert client.post("/api/batches", json=batch([d["device_id"]])).status_code == 409
    assert client.post("/api/batches/" + response.json()["id"] + "/cancel").json()["cancelled"] == 1
    assert client.get("/api/agent/jobs/next", headers=headers).json()["job"] is None


def test_bulk_blocks_clones_offline_and_outdated_agents(client):
    d, _ = managed(client)
    for field, value in [("approved", 0), ("last_seen", 0), ("telemetry", "{}")]:
        with db(write=True) as conn:
            conn.execute(f"UPDATE devices SET {field}=? WHERE id=?", (value, d["device_id"]))
        assert client.post("/api/batches", json=batch([d["device_id"]])).status_code == 409
        with db(write=True) as conn:
            conn.execute(
                "UPDATE devices SET approved=1,last_seen=?,telemetry=? WHERE id=?",
                (time.time(), json.dumps({"capabilities": {"managed_operations": True}}), d["device_id"]),
            )


def test_template_revision_platform_and_safe_parameter_values(client):
    d, headers = managed(client)
    spec = {
        "name": "Echo parameter",
        "platform": "linux",
        "category": "script",
        "script": 'printf "%s" "$SPECK_PARAM_VALUE"',
        "parameters": [{"name": "VALUE", "label": "Value"}],
        "timeout": 30,
    }
    template = client.post("/api/templates", json=spec).json()
    evil = "hello'; touch /tmp/unwanted; echo '"
    body = batch(
        [d["device_id"]], kind="template", template_id=template["id"], template_revision=1, parameters={"VALUE": evil}
    )
    draft = client.post("/api/batches/preview", json=body)
    assert draft.status_code == 200
    import subprocess

    assert subprocess.check_output(["/bin/sh"], input=draft.json()["targets"][0]["script"].encode()).decode() == evil
    assert client.post("/api/batches", json=body | {"template_revision": 99}).status_code == 409
    assert client.post("/api/batches", json=body | {"confirmed": False}).status_code == 422
    assert client.post("/api/batches", json=body).status_code == 200
    job = client.get("/api/agent/jobs/next", headers=headers).json()["job"]
    assert job["payload"]["timeout"] == 30
    with db() as conn:
        stored = conn.execute("SELECT spec FROM templates WHERE id=?", (template["id"],)).fetchone()["spec"]
        assert spec["script"] not in stored
        assert json.loads(unseal(stored))["script"] == spec["script"]
    windows = spec | {"platform": "windows"}
    assert "$env:SPECK_PARAM_VALUE='a''b'" in render_script(windows, {"VALUE": "a'b"})


def test_patch_inventory_only_from_completed_scan_and_bounded_selection(client):
    d, headers = managed(client)
    assert client.post("/api/batches", json=batch([d["device_id"]])).status_code == 200
    report = {
        "manager": "apt",
        "updates": [{"id": "curl", "title": "curl", "version": "2", "severity": "security"}],
        "total": 1,
        "reboot_required": False,
        "truncated": False,
    }
    finish(client, headers, {"exit_code": 0, "stdout": json.dumps(report), "truncated": False})
    assert client.get("/api/patches").json()[0]["report"]["updates"][0]["id"] == "curl"
    body = batch([d["device_id"]], kind="patch.install", updates={d["device_id"]: ["curl;touch /tmp/no"]})
    assert client.post("/api/batches", json=body).status_code == 422
    body["updates"] = {d["device_id"]: ["curl"]}
    script = client.post("/api/batches/preview", json=body).json()["targets"][0]["script"]
    assert "--only-upgrade --no-remove" in script and "reboot\n" not in script
    assert client.post("/api/batches", json=body).status_code == 200
    finish(client, headers, {"exit_code": 0, "stdout": "installed"})
    assert client.get("/api/patches").json() == []


def test_live_preview_opt_in_ttl_purge_and_clone_isolation(client):
    from speck.screens import frames

    frames.clear()
    d, headers = managed(client)
    path = "/api/devices/" + d["device_id"]
    jpeg = b"\xff\xd8\xfftest\xff\xd9"
    body = {"jpeg": base64.b64encode(jpeg).decode(), "captured_at": time.time(), "width": 640, "height": 360}
    assert client.put("/api/agent/preview", headers=headers, json=body).status_code == 403
    assert client.put(path + "/preview-policy", json={"enabled": True}).status_code == 200
    assert client.get("/api/agent/preview-policy", headers=headers).json()["enabled"]
    assert client.put("/api/agent/preview", headers=headers, json=body).status_code == 200
    assert client.get(path + "/preview").content == jpeg
    clone = headers | {"X-Speck-Hardware": "operations-restored-999"}
    discovered = client.post(
        "/api/agent/check-in",
        headers=clone,
        json={"hostname": "clone", "platform": "linux", "arch": "amd64", "telemetry": {}},
    ).json()
    assert not client.get("/api/agent/preview-policy", headers=clone).json()["enabled"]
    assert client.put("/api/agent/preview", headers=clone, json=body).status_code == 403
    assert (
        client.put("/api/devices/" + discovered["device_id"] + "/preview-policy", json={"enabled": True}).status_code
        == 409
    )
    frames[d["device_id"]]["captured_at"] = time.time() - 60
    assert client.get(path + "/preview").status_code == 200
    assert client.get(path + "/preview-status").json()["source"] == "saved"
    assert client.put("/api/agent/preview", headers=headers, json=body).status_code == 200
    client.put(path + "/preview-policy", json={"enabled": False})
    assert d["device_id"] not in frames
    assert client.get(path + "/preview").status_code == 404


def test_ai_secret_boundaries_suggestions_and_computer_validation(client, monkeypatch):
    captured = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            captured.append(kwargs)
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
                                            "summary": "Read-only check",
                                            "script": "uptime",
                                            "verification": "Inspect output",
                                            "caution": "",
                                        }
                                    ),
                                }
                            ],
                        }
                    ],
                },
            )

    monkeypatch.setattr("speck.assistant.httpx.AsyncClient", FakeClient)
    secret = "test-openai-secret-only"
    client.put("/api/ai/settings", json={"key": secret, "model": "gpt-5.4-mini"})
    assert secret not in client.get("/api/ai/settings").text
    r = client.post("/api/ai/assist", json={"prompt": "Check uptime", "platform": "linux"})
    assert r.status_code == 200 and r.json()["script"] == "uptime"
    assert client.get("/api/jobs").json() == []
    assert captured[0]["json"]["store"] is False
    assert "tools" not in captured[0]["json"]
    assert secret not in client.get("/api/audit").text
    assert client.post("/api/ai/assist", json={"prompt": "Click start", "mode": "computer"}).status_code == 422
    with pytest.raises(HTTPException):
        validate_actions([{"type": "click", "x": 9999, "y": 5}], 1280, 720)
    with pytest.raises(HTTPException):
        validate_actions([{"type": "exec", "command": "arbitrary"}], 1280, 720)
    assert validate_actions([{"type": "click", "x": 10, "y": 20}], 1280, 720)


def test_computer_assistant_supplies_initial_screenshot_without_executing(client, monkeypatch):
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
            action = (
                {"type": "screenshot"} if len(captured) == 1 else {"type": "click", "x": 42, "y": 50, "button": "left"}
            )
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output": [{"type": "computer_call", "call_id": "test-call", "actions": [action]}],
                },
            )

    monkeypatch.setattr("speck.assistant.httpx.AsyncClient", FakeClient)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    image = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xfftest").decode()
    result = client.post("/api/ai/assist", json={"prompt": "Click the field", "mode": "computer", "image": image})
    assert result.status_code == 200
    assert result.json()["actions"][0]["type"] == "click"
    assert len(captured) == 2 and all(p["store"] is False for p in captured)
    assert captured[1]["input"][-1]["type"] == "computer_call_output"
    assert captured[1]["input"][-1]["output"]["image_url"] == image
    assert client.get("/api/jobs").json() == []
