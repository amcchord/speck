"""External-agent contracts only: temporary data and synthetic endpoint receipts.

These tests exercise HTTP permissions and transport; synthetic agent completion is
not proof that a script executed on a Windows or Linux machine.
"""

import asyncio
import base64
import hashlib
import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from speck import agent_api, api_tokens, screens
from speck.db import db
from speck.main import app
from test_control_plane import enroll


def token_client(client, scopes, name="contract", **fields):
    response = client.post("/api/tokens", json={"name": name, "scopes": scopes, **fields})
    assert response.status_code == 200
    value = response.json()
    return TestClient(app, base_url="https://testserver", headers={"Authorization": "Bearer " + value["token"]}), value


def rpc(agent, method, params=None):
    response = agent.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method,
                                       "params": {} if params is None else params})
    assert response.status_code == 200
    return response.json()


def call(agent, name, arguments=None):
    return rpc(agent, "tools/call", {"name": name, "arguments": {} if arguments is None else arguments})["result"]


def data(result):
    return result.get("structuredContent", json.loads(result["content"][0]["text"]))


def job_count():
    with db() as conn:
        return conn.execute("SELECT count(*) FROM jobs").fetchone()[0]


def test_vault_only_orientation_is_available_without_inventory_or_broader_keys(client):
    for name in ("shop-db", "Shop-db", "other-db"):
        assert client.post("/api/keys/static", json={"name": name, "value": "synthetic"}).status_code == 200
    agent, _ = token_client(client, ["keys:read"], key_prefixes=["shop-"])
    identity = data(call(agent, "speck_whoami"))
    assert identity["capabilities"]["vault_read"] is True
    assert identity["capabilities"]["fleet_read"] is False
    assert identity["key_prefixes_apply_to"] == "vault_entry_names_only"
    assert agent.get("/api/whoami").status_code == 200
    assert agent.get("/api/fleet").status_code == 403
    assert [entry["name"] for entry in data(call(agent, "list_keys"))] == ["shop-db"]
    assert call(agent, "get_key", {"name": "Shop-db"})["isError"]
    assert call(agent, "get_key", {"name": "other-db"})["isError"]
    assert call(agent, "speck_overview")["isError"]
    instructions = rpc(agent, "initialize")["result"]["instructions"]
    assert '"vault_read": true' in instructions and "untrusted" in instructions
    assert "Austin" not in instructions and "resources you created" not in instructions


def test_operator_scope_keeps_vault_role_cap_and_interactive_session_block(client):
    agent, _ = token_client(client, ["operate", "keys:read"])
    identity = agent.get("/api/whoami").json()
    assert identity["role"] == "operator"
    assert identity["capabilities"]["endpoint_jobs"] is True
    assert identity["capabilities"]["vault_read"] is False
    assert agent.get("/api/keys").status_code == 403
    assert agent.post("/api/devices/none/remote/sessions", json={}).status_code == 403
    assert agent.delete("/api/remote/sessions/none").status_code == 403
    assert agent.post("/api/enrollments", json={"label": "denied"}).status_code == 403
    assert agent.get("/api/tokens").status_code == 403
    tools = {entry["name"]: entry for entry in rpc(agent, "tools/list")["result"]["tools"]}
    assert "Unavailable for this token" in tools["get_key"]["description"]
    assert tools["list_directory"]["annotations"]["readOnlyHint"] is False
    assert tools["list_directory"]["annotations"]["destructiveHint"] is False


@pytest.mark.parametrize("arguments", [
    {"device_id": "none"}, [], "script", 1,
    {"device_id": "none", "script": "id", "extra": True},
    {"device_id": "none", "script": "id", "shell": "bash"},
    {"device_id": "none", "script": "id", "timeout": 181},
    {"device_id": "none", "script": "id", "timeout": 600},
    {"device_id": "none", "script": "id", "timeout": 0},
    {"device_id": "none", "script": "id", "timeout": True},
    {"device_id": "none", "script": "id", "wait_seconds": -1},
    {"device_id": "none", "script": "id", "wait_seconds": 31},
])
def test_malformed_command_arguments_are_tool_errors_without_side_effects(client, arguments):
    agent, _ = token_client(client, ["operate"])
    result = call(agent, "run_command", arguments)
    assert result["isError"] is True
    assert "Unknown tool" not in result["content"][0]["text"]
    assert job_count() == 0


def test_jsonrpc_invalid_envelopes_and_params_return_protocol_errors(client):
    agent, _ = token_client(client, ["read"])
    assert rpc(agent, "tools/list", [])["error"]["code"] == -32602
    assert rpc(agent, "tools/call", {"name": "missing"})["error"]["code"] == -32602
    for message in (None, 1, {"jsonrpc": "2.0", "id": 1, "method": 5}):
        response = agent.post("/mcp", content=json.dumps(message), headers={"Content-Type": "application/json"})
        assert response.json()["error"]["code"] == -32600


@pytest.mark.parametrize(("platform", "shell", "script", "directory"), [
    ("linux", "sh", "printf contract", "/tmp"),
    ("windows", "powershell", "Write-Output contract", "C:\\Windows"),
])
def test_exact_endpoint_command_and_directory_receipts_for_each_platform(client, platform, shell, script, directory):
    endpoint, headers = enroll(client)
    device_id = endpoint["device_id"]
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET platform=? WHERE id=?", (platform, device_id))
    agent, _ = token_client(client, ["operate"], name=platform + "-contract")
    context = data(call(agent, "get_device", {"device_id": device_id}))
    assert context["id"] == device_id and context["platform"] == platform
    assert context["approved"] and context["manageable"]
    receipt = data(call(agent, "run_command", {"device_id": device_id, "script": script,
                                              "shell": shell, "timeout": 180, "wait_seconds": 0}))
    assert receipt["device_id"] == device_id
    assert receipt["next_poll"] == "GET /api/jobs/" + receipt["id"]
    assert "not command success" in receipt["outcome_note"]
    lease = client.get("/api/agent/jobs/next", headers=headers).json()["job"]
    assert lease["id"] == receipt["id"]
    assert lease["payload"] == {"script": script, "shell": shell, "timeout": 180}
    result = {"stdout": "contract", "stderr": "", "exit_code": 0}
    assert client.post("/api/agent/jobs/" + lease["id"], headers=headers,
                       json={"lease": lease["lease"], "status": "complete", "result": result}).status_code == 200
    completed = data(call(agent, "get_job", {"job_id": receipt["id"]}))
    assert completed["status"] == "complete" and completed["result"] == result
    assert "payload" not in completed and "lease_hash" not in completed
    jobs = data(call(agent, "list_jobs", {"device_id": device_id}))
    assert len(jobs) == 1 and jobs[0]["id"] == receipt["id"]
    listing = data(call(agent, "list_directory", {"device_id": device_id, "path": directory}))
    lease = client.get("/api/agent/jobs/next", headers=headers).json()["job"]
    assert lease["id"] == listing["id"] and lease["kind"] == "files.list"
    assert lease["payload"] == {"path": directory, "timeout": 60}
    with db() as conn:
        actor = conn.execute("SELECT actor FROM audit WHERE action='job.created' AND device_id=? ORDER BY id", (device_id,)).fetchone()
    assert actor["actor"] == "admin (API: " + platform + "-contract)"


def test_readonly_and_provider_only_targets_cannot_queue_endpoint_jobs(client):
    endpoint, _ = enroll(client)
    reader, _ = token_client(client, ["read"], name="reader")
    result = call(reader, "run_command", {"device_id": endpoint["device_id"], "script": "id", "wait_seconds": 0})
    assert data(result)["status"] == 403
    tools = {entry["name"]: entry for entry in rpc(reader, "tools/list")["result"]["tools"]}
    assert "Unavailable for this token" in tools["run_command"]["description"]
    operator, _ = token_client(client, ["operate"], name="operator")
    result = call(operator, "run_command", {"device_id": "provider-only-id", "script": "id", "wait_seconds": 0})
    assert result["isError"] and data(result)["status"] == 404
    assert job_count() == 0


def test_poll_failure_preserves_submitted_receipt_without_retry(monkeypatch):
    calls = []

    async def dispatch(request, method, path, query=None, body=None):
        calls.append((method, path))
        return (200, {"id": "receipt"}) if method == "POST" else (503, {"detail": "temporarily unavailable"})

    monkeypatch.setattr(agent_api, "dispatch", dispatch)
    request = Request({"type": "http", "headers": []})
    result = asyncio.run(agent_api.call_tool(request, "run_command", {"device_id": "exact-endpoint", "script": "id"}))
    assert result["isError"]
    receipt = data(result)
    assert receipt["id"] == "receipt" and receipt["device_id"] == "exact-endpoint"
    assert receipt["next_poll"] == "GET /api/jobs/receipt" and receipt["poll_error"]["status"] == 503
    assert calls == [("POST", "/api/devices/exact-endpoint/jobs"), ("GET", "/api/jobs/receipt")]


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_numbers_rejected_even_inside_generic_json(value):
    for payload in ({"query": {"limit": value}}, {"body": {"nested": [value]}}):
        with pytest.raises(ValueError, match="finite"):
            agent_api.validate_argument({"method": "POST", "path": "/api/devices", **payload},
                                        agent_api.TOOL_INDEX["speck_api"]["inputSchema"], "arguments")


def test_truncation_bounds_structured_output_as_well_as_text():
    result = agent_api.text_result({"rows": ["large" * 50_000]})
    assert len(result["content"][0]["text"]) < 201_000
    assert "truncated" in result["content"][0]["text"]
    assert result["structuredContent"]["truncated"] is True
    assert "rows" not in result["structuredContent"]


@pytest.mark.parametrize("payload", [b"synthetic\x00binary\xff", b'{"binary_file":"valid JSON is still file content"}'])
def test_binary_file_response_uses_download_metadata_in_mcp(client, payload):
    endpoint, headers = enroll(client)
    transfer = client.post("/api/devices/" + endpoint["device_id"] + "/files/download", json={"path": "/tmp/contract"}).json()
    checksum = hashlib.sha256(payload).hexdigest()
    assert client.put("/api/agent/transfers/" + transfer["id"],
                      headers=headers | {"X-Content-SHA256": checksum}, content=payload).status_code == 200
    reader, _ = token_client(client, ["read"])
    path = "/api/transfers/" + transfer["id"] + "/file"
    response = data(call(reader, "speck_api", {"method": "GET", "path": path}))
    assert response["status"] == 200
    assert response["data"]["binary_response"] is True
    assert response["data"]["bytes"] == len(payload) and response["data"]["sha256"] == checksum
    assert response["data"]["download_path"] == path
    assert reader.get(path).content == payload


def test_opt_in_preview_rest_access_and_mcp_metadata_are_distinct_from_gui_access(client):
    endpoint, headers = enroll(client)
    path = "/api/devices/" + endpoint["device_id"]
    operator, _ = token_client(client, ["operate"], name="preview-operator")
    reader, _ = token_client(client, ["read"], name="preview-reader")
    assert reader.put(path + "/preview-policy", json={"enabled": True}).status_code == 403
    assert operator.put(path + "/preview-policy", json={"enabled": True}).status_code == 200
    payload = b"\xff\xd8\xffsynthetic-preview\xff\xd9"
    captured_at = time.time()
    assert client.put("/api/agent/preview", headers=headers, json={"jpeg": base64.b64encode(payload).decode(),
                       "captured_at": captured_at, "width": 640, "height": 360}).status_code == 200
    identity = reader.get("/api/whoami").json()["capabilities"]
    assert identity["screen_preview_read"] and not identity["screen_preview_policy"]
    assert not identity["interactive_sessions"]
    status = data(call(reader, "speck_api", {"method": "GET", "path": path + "/preview-status"}))["data"]
    assert status["available"] and status["source"] == "live"
    image = data(call(reader, "speck_api", {"method": "GET", "path": path + "/preview"}))["data"]
    assert image["binary_response"] and image["content_type"] == "image/jpeg"
    assert float(image["captured_at"]) == captured_at and image["preview_source"] == "live"
    assert reader.get(path + "/preview").content == payload
    assert operator.put(path + "/preview-policy", json={"enabled": False}).status_code == 200
    assert reader.get(path + "/preview").status_code == 404
    assert endpoint["device_id"] not in screens.frames


def test_oversized_batch_is_rejected_before_any_tool_call(client, monkeypatch):
    agent, _ = token_client(client, ["operate"])
    executed = []

    async def call_tool(*args):
        executed.append(args)
        return agent_api.text_result({"id": "should-not-execute"})

    monkeypatch.setattr(agent_api, "call_tool", call_tool)
    message = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "run_command"}}
    for batch in ([], [message] * 51):
        response = agent.post("/mcp", json=batch)
        assert response.status_code == 400 and response.json()["error"]["code"] == -32600
    assert executed == []


def test_compact_fleet_and_search_filters_are_forwarded(monkeypatch):
    calls = []

    async def dispatch(request, method, path, query=None, body=None):
        calls.append((method, path, query))
        return 200, {"matches": []}

    monkeypatch.setattr(agent_api, "dispatch", dispatch)
    request = Request({"type": "http", "headers": []})
    asyncio.run(agent_api.call_tool(request, "list_machines", {}))
    asyncio.run(agent_api.call_tool(request, "speck_search", {"q": "host", "limit": 200, "type": "machine"}))
    assert calls == [("GET", "/api/fleet", {"compact": True}),
                     ("GET", "/api/search", {"q": "host", "limit": 200, "type": "machine"})]


def test_live_owner_role_and_revocation_restrict_existing_token(client):
    agent, issued = token_client(client, ["admin", "keys:read"])
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='viewer' WHERE username='admin'")
    identity = agent.get("/api/whoami").json()
    assert identity["role"] == "viewer"
    assert not identity["capabilities"]["endpoint_jobs"] and not identity["capabilities"]["vault_read"]
    assert agent.get("/api/keys").status_code == 403
    with db(write=True) as conn:
        conn.execute("UPDATE api_tokens SET revoked=1 WHERE id=?", (issued["id"],))
    assert agent.get("/api/whoami").status_code == 401


def test_host_token_issue_obeys_viewer_scope_and_rate_response_retry_after(client, monkeypatch):
    assert client.post("/api/access/users", json={"username": "viewer", "password": "synthetic-password-123", "role": "viewer"}).status_code == 200
    with pytest.raises(SystemExit, match="read-only"):
        api_tokens.issue("viewer", "denied", ["operate"])
    monkeypatch.setattr(api_tokens, "RATE_PER_MINUTE", 1)
    agent, _ = token_client(client, ["read"])
    assert agent.get("/api/whoami").status_code == 200
    limited = agent.get("/api/whoami")
    assert limited.status_code == 429 and 1 <= int(limited.headers["retry-after"]) <= 60


def test_discovery_documents_match_actual_catalog_and_prompt_support(client):
    agent, _ = token_client(client, ["read"])
    guide = client.get("/agents.md").text
    for entry in agent_api.TOOLS:
        assert "`" + entry["name"] + "`" in guide
    assert rpc(agent, "prompts/list")["result"] == {"prompts": []}
    for path in ("/llms.txt", "/speck.md"):
        document = client.get(path).text
        assert "/api/whoami" in document and "speck_whoami" in document
        assert "Austin's" not in document
    assert "/api/devices/{device_id}/inspections" in client.get("/api/openapi.json").json()["paths"]
