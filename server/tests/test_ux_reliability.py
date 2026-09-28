import json
import time

import pytest

from speck.config import seal
from speck.db import db, ident, initialize
from speck.scheduling import tick
from test_fleet_operations import managed, batch, finish


def test_compact_fleet_keeps_identity_and_defers_service_details(client):
    d, _ = managed(client)
    with db(write=True) as conn:
        row = conn.execute("SELECT telemetry FROM devices WHERE id=?", (d["device_id"],)).fetchone()
        telemetry = json.loads(row[0]) | {
            "services": [{"name": "example", "start_type": 3}] * 200,
            "network": {"connections": [{"pid": 7}] * 200, "interfaces": [{"mac": "00:11:22:33:44:55"}]},
        }
        conn.execute("UPDATE devices SET telemetry=? WHERE id=?", (json.dumps(telemetry), d["device_id"]))
    full = client.get("/api/fleet").json()
    compact = client.get("/api/fleet?compact=true").json()
    assert len(json.dumps(compact)) < len(json.dumps(full)) / 2
    row = compact["machines"][0]
    assert row["id"] == d["device_id"] and row["telemetry_compact"]
    assert row["telemetry"]["network"]["interfaces"]
    assert "services" not in row["telemetry"]
    detail = client.get("/api/devices/" + d["device_id"]).json()
    assert len(detail["telemetry"]["services"]) == 200
    assert "remote_secret" not in detail


@pytest.mark.parametrize(
    "platform,output", [("windows", '[{"name":"Example","version":"2"}]'), ("linux", "example\t2\tamd64\n")]
)
def test_reviewed_bulk_software_collection_retains_platform_reports(client, platform, output):
    d, h = managed(client, platform=platform)
    body = batch([d["device_id"]]) | {"kind": "inspection.software"}
    preview = client.post("/api/batches/preview", json=body)
    assert preview.status_code == 200 and len(preview.json()["targets"]) == 1
    assert client.post("/api/batches", json=body | {"confirmed": False}).status_code == 422
    result = client.post("/api/batches", json=body).json()
    assert client.post("/api/batches", json=body).json()["id"] == result["id"]
    finish(client, h, {"exit_code": 0, "stdout": output})
    report = client.get("/api/software/inventory").json()[0]
    assert report["platform"] == platform and report["report"]["rows"][0]["version"] == "2"


def test_schedule_independent_policy_records_offline_exclusions(client):
    first, _ = managed(client)
    second, _ = managed(client, hardware="second-independent-target")
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET last_seen=0 WHERE id=?", (second["device_id"],))
    op = batch([first["device_id"], second["device_id"]]) | {"kind": "inspection.software", "target_policy": "eligible"}
    body = {"operation": op, "first_run": time.time() + 60, "interval_seconds": 86400, "confirmed": True}
    preview = client.post("/api/schedules/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert [x["id"] for x in preview.json()["targets"]] == [first["device_id"]]
    assert preview.json()["excluded"][0]["id"] == second["device_id"]
    assert (
        client.post("/api/schedules/preview", json=body | {"operation": op | {"target_policy": "all"}}).status_code
        == 409
    )
    schedule = client.post("/api/schedules", json=body).json()["id"]
    tick(body["first_run"])
    saved = next(s for s in client.get("/api/schedules").json() if s["id"] == schedule)
    assert saved["operation"]["target_policy"] == "eligible"
    assert len(saved["operation"]["device_ids"]) == 2
    assert saved["runs"][0]["status"] == "queued" and "offline" in saved["runs"][0]["reason"]
    assert {j["device_id"] for j in client.get("/api/jobs").json()} == {first["device_id"]}
    tick(body["first_run"])
    assert len(client.get("/api/jobs").json()) == 1


def test_workspaces_require_exact_reviewed_associations_and_revision(client):
    device, _ = managed(client)
    body = {
        "name": "Example customer",
        "associations": [{"kind": "machine", "id": device["device_id"], "pinned": True}],
        "confirmed": True,
    }
    assert client.post("/api/workspaces", json=body | {"confirmed": False}).status_code == 422
    assert (
        client.post(
            "/api/workspaces", json=body | {"associations": [{"kind": "machine", "id": "guessed-from-name"}]}
        ).status_code
        == 422
    )
    result = client.post("/api/workspaces", json=body)
    assert result.status_code == 200, result.text
    key = result.json()["id"]
    assert client.put("/api/workspaces/" + key, json=body).status_code == 409
    assert (
        client.put("/api/workspaces/" + key, json=body | {"revision": 1, "name": "Reviewed customer"}).status_code
        == 200
    )
    initialize()
    saved = client.get("/api/workspaces").json()[0]
    assert saved["revision"] == 2 and saved["associations"][0]["pinned"]
    with db() as conn:
        assert device["device_id"] not in conn.execute("SELECT spec FROM customer_workspaces").fetchone()[0]


def test_runbooks_never_advance_without_explicit_stage_review(client):
    device, headers = managed(client, platform="linux")
    gather = batch([device["device_id"]]) | {"kind": "inspection.software"}
    change = batch([device["device_id"]]) | {
        "kind": "template",
        "template_id": "starter-linux-health",
        "template_revision": 1,
    }
    body = {"name": "Reviewed routine", "stages": [gather, change, gather], "confirmed": True}
    result = client.post("/api/maintenance/runbooks", json=body)
    assert result.status_code == 200, result.text
    run = client.post("/api/maintenance/runbooks/" + result.json()["id"] + "/runs").json()["id"]
    assert not client.get("/api/jobs").json()
    path = "/api/maintenance/runs/" + run
    assert client.post(path + "/steps", json={"stage": 0}).status_code == 422
    assert client.post(path + "/preview", json={"stage": 1}).status_code == 409
    assert client.post(path + "/preview", json={"stage": 0}).status_code == 200
    first = client.post(path + "/steps", json={"stage": 0, "confirmed": True}).json()["id"]
    assert client.post(path + "/steps", json={"stage": 0, "confirmed": True}).json()["id"] == first
    assert client.post(path + "/preview", json={"stage": 1}).status_code == 409
    finish(client, headers, {"exit_code": 0, "stdout": "example\t1\tamd64\n"})
    assert client.post(path + "/preview", json={"stage": 1}).status_code == 200
    assert len(client.get("/api/jobs").json()) == 1
    assert client.post(path + "/steps", json={"stage": 1, "confirmed": True}).status_code == 200
    finish(client, headers, {"exit_code": 1, "stdout": "uncertain"})
    assert client.post(path + "/preview", json={"stage": 2}).status_code == 409


def test_metrics_reject_private_dimensions_and_report_bounds(client):
    item = {"journey": "search_to_target", "surface": "browser", "outcome": "ready", "duration_ms": 124}
    assert client.post("/api/ux/measurements", json={"items": [item | {"query": "private"}]}).status_code == 422
    assert (
        client.post("/api/ux/measurements", json={"items": [item | {"surface": "/machines/private-id"}]}).status_code
        == 422
    )
    assert client.post("/api/ux/measurements", json={"items": [item, item | {"outcome": "failed"}]}).status_code == 200
    rows = client.get("/api/ux/scorecard").json()["rows"]
    assert len(rows) == 2 and {r["bucket"] for r in rows} == {200}
    assert all(r["count"] == 1 for r in rows)


def test_recovery_export_redacts_raw_evidence_and_does_not_invent_rto(client):
    plan, run = ident(), ident()
    with db(write=True) as conn:
        conn.execute("INSERT INTO recovery_plans VALUES(?,?,?,?)", (plan, "Example", seal("{}"), time.time()))
        # Table columns: id,plan_id,status,phase,state,report,created,updated.
        conn.execute(
            "INSERT INTO recovery_runs(id,plan_id,status,phase,state,report,created,updated) VALUES(?,?,?,?,?,?,?,?)",
            (
                run,
                plan,
                "stopped",
                "verified",
                json.dumps({"name": "Example", "members": [], "secret": "NEVER_EXPORT", "timeline": []}),
                json.dumps({"passed": True, "stdout": "NEVER_EXPORT"}),
                1000,
                1200,
            ),
        )
    result = client.get("/api/recovery/runs/" + run + "/evidence?retest_days=60")
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["measured_time_to_verification_seconds"] is None
    assert data["next_retest_due"] == 1000 + 60 * 86400
    assert "NEVER_EXPORT" not in result.text
    assert client.get("/api/recovery/runs/" + run + "/evidence?retest_days=0").status_code == 422


@pytest.mark.parametrize(
    "platform,parts",
    [
        ("windows", ['[{"name":"Example app"}]', '[{"pid":7,"name":"worker"}]', '[{"name":"C:"}]']),
        ("linux", ["example\t2\tamd64\n", "7 1 1.0 0.1 worker\n", '{"blockdevices":[{"name":"sda"}]}']),
    ],
)
def test_bundle_records_three_reports_from_one_reviewed_receipt(client, platform, parts):
    device, headers = managed(client, platform=platform)
    path = "/api/devices/" + device["device_id"] + "/inspection"
    preview = client.post(path + "/preview", json={"kind": "bundle"})
    assert preview.status_code == 200
    assert all("__SPECK_REPORT_" + k + "__" in preview.json()["script"] for k in ("software", "processes", "disks"))
    assert client.post(path, json={"kind": "bundle"}).status_code == 422
    job = client.post(path, json={"kind": "bundle", "confirmed": True}).json()["id"]
    output = "\n".join(
        "__SPECK_REPORT_" + kind + "__\n" + part for kind, part in zip(("software", "processes", "disks"), parts)
    )
    finish(client, headers, {"exit_code": 0, "stdout": output})
    reports = client.get("/api/devices/" + device["device_id"] + "/inspections").json()
    assert {r["kind"] for r in reports} == {"software", "processes", "disks"}
    assert {r["job_id"] for r in reports} == {job}


@pytest.mark.parametrize(
    "result",
    [
        {"exit_code": 0, "stdout": "__SPECK_REPORT_software__\n[]\n__SPECK_REPORT_processes__\n[]"},
        {
            "exit_code": 0,
            "stdout": "__SPECK_REPORT_software__\n[]\n__SPECK_REPORT_processes__\n[]\n__SPECK_REPORT_disks__\nINVALID",
        },
        {
            "exit_code": 1,
            "stdout": "__SPECK_REPORT_software__\n[]\n__SPECK_REPORT_processes__\n[]\n__SPECK_REPORT_disks__\n[]",
        },
    ],
)
def test_partial_bundle_never_replaces_evidence_with_empty_success(client, result):
    device, headers = managed(client)
    assert (
        client.post(
            "/api/devices/" + device["device_id"] + "/inspection", json={"kind": "bundle", "confirmed": True}
        ).status_code
        == 200
    )
    finish(client, headers, result)
    assert client.get("/api/devices/" + device["device_id"] + "/inspections").json() == []
