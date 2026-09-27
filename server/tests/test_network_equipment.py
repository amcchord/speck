import asyncio
import copy
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from speck import unifi, unifi_observability as observations
from speck.db import db

BASE = "/api/unifi/sites/console/site/devices/switch"


@pytest.fixture
def upstream(monkeypatch):
    unifi.forget_lookups()
    state = {"calls": [], "config": "one", "poe": True, "optional_failure": False, "write_failure": False}

    async def cloud():
        return [{"hostId": "console", "siteId": "site", "meta": {"name": "branch"}}]

    monkeypatch.setattr(observations, "cloud_sites", cloud)
    devices = [
        {
            "id": "switch",
            "name": "Access switch",
            "macAddress": "02:00:00:00:00:01",
            "model": "USW",
            "state": "ONLINE",
            "features": ["switching"],
        },
        {
            "id": "ap",
            "name": "Office AP",
            "macAddress": "02:00:00:00:00:02",
            "model": "U6",
            "state": "ONLINE",
            "features": ["accessPoint"],
        },
    ]

    async def call(method, url, body=None, params=None):
        state["calls"].append((method, url, body))
        if method == "POST":
            if state["write_failure"]:
                raise HTTPException(502, "Secret upstream error")
            await asyncio.sleep(0.02)
            return None
        if url.endswith("/integration/v1/sites"):
            return {"data": [{"id": "network-site", "internalReference": "branch"}]}
        assert "/consoles/console/proxy/network/" in url
        if url.endswith("/devices"):
            return {"totalCount": 2, "data": copy.deepcopy(devices)}
        if url.endswith("/devices/switch"):
            return devices[0] | {
                "supported": True,
                "configurationId": state["config"],
                "interfaces": {
                    "ports": [
                        {"idx": 1, "state": "UP", "poe": {"enabled": state["poe"], "state": "UP"}},
                        {"idx": 2, "state": "DOWN"},
                    ]
                },
            }
        if url.endswith("/statistics/latest"):
            if state["optional_failure"]:
                raise HTTPException(403, "no stats")
            return {"cpuUtilizationPct": 10}
        if url.endswith("/stat/device"):
            return {
                "data": [
                    {
                        "mac": devices[0]["macAddress"],
                        "ssh_password": "never-return-this",
                        "port_table": [{"port_idx": 1, "name": "Office", "poe_power": "4.2"}],
                    },
                    {
                        "mac": devices[1]["macAddress"],
                        "uplink": {"uplink_mac": devices[0]["macAddress"], "uplink_remote_port": 1},
                    },
                ]
            }
        if url.endswith("/stat/sta"):
            return {
                "data": [
                    {
                        "mac": "02:00:00:00:00:03",
                        "hostname": "Laptop",
                        "ap_mac": devices[1]["macAddress"],
                        "last_seen": time.time(),
                        "ip": "192.0.2.8",
                        "is_wired": False,
                    }
                ]
            }
        raise AssertionError(url)

    monkeypatch.setattr(unifi, "call", call)
    yield state
    unifi.forget_lookups()


def test_exact_site_device_scope_and_safe_topology(client, upstream):
    assert client.get(BASE.replace("/site/", "/wrong/")).status_code == 404
    assert upstream["calls"] == []
    assert client.get(BASE.replace("/switch", "/outside")).status_code == 404
    response = client.get(BASE)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["children"][0]["id"] == "ap"
    assert result["children"][0]["parent_port"] == 1
    assert result["downstream_clients"][0]["uplink_id"] == "ap"
    assert result["ports"][0]["observation"]["name"] == "Office"
    assert result["ports"][0]["observation"]["poe_power"] == 4.2
    assert "never-return-this" not in response.text and "ssh_password" not in response.text
    before = len(upstream["calls"])
    assert client.get(BASE).json() == result
    assert len(upstream["calls"]) == before


def test_optional_statistics_failure_keeps_ports_and_connections(client, upstream):
    upstream["optional_failure"] = True
    result = client.get(BASE).json()
    assert result["statistics"] is None and result["ports"] and result["children"]


def review(client, operation="POWER_CYCLE", port=1):
    response = client.post(BASE + "/review", json={"operation": operation, "port": port})
    assert response.status_code == 200, response.text
    return response.json()


def test_power_review_confirmation_and_replay_are_at_most_once(client, upstream):
    r = review(client)
    assert len(r["clients"]) == len(r["devices"]) == 1
    assert all(c[0] == "GET" for c in upstream["calls"])
    url = "/api/unifi/operations/" + r["id"] + "/execute"
    assert client.post(url, json={"confirmation": "wrong"}).status_code == 422
    first = client.post(url, json={"confirmation": r["target"]})
    assert first.status_code == 200 and first.json()["status"] == "submitted"
    assert client.post(url, json={"confirmation": r["target"]}).json() == first.json()
    writes = [c for c in upstream["calls"] if c[0] == "POST"]
    assert writes == [
        (
            "POST",
            unifi.CLOUD
            + "/connector/consoles/console/proxy/network/integration/v1/sites/network-site/devices/switch/interfaces/ports/1/actions",
            {"action": "POWER_CYCLE"},
        )
    ]
    assert client.get("/api/unifi/operations").json()[0]["id"] == r["id"]
    with db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM audit WHERE action='network.requested'").fetchone()[0] == 1


@pytest.mark.parametrize("change", ["config", "poe", "expiry", "actor"])
def test_changed_expired_or_foreign_review_never_writes(client, upstream, change):
    r = review(client)
    if change == "config":
        upstream["config"] = "two"
    if change == "poe":
        upstream["poe"] = False
    if change in ("expiry", "actor"):
        with db(write=True) as conn:
            if change == "expiry":
                conn.execute("UPDATE network_operations SET created=0")
            else:
                conn.execute("UPDATE network_operations SET actor='someone-else'")
    response = client.post("/api/unifi/operations/" + r["id"] + "/execute", json={"confirmation": r["target"]})
    assert response.status_code in (404, 409)
    assert all(c[0] == "GET" for c in upstream["calls"])


def test_concurrent_duplicate_submission_never_repeats_write(client, upstream):
    r = review(client, "RESTART", None)
    url = "/api/unifi/operations/" + r["id"] + "/execute"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(url, json={"confirmation": r["target"]}), range(2)))
    assert all(r.status_code == 200 for r in responses)
    assert len([c for c in upstream["calls"] if c[0] == "POST"]) == 1


def test_ambiguous_provider_result_is_durable_and_not_retried(client, upstream):
    r = review(client)
    upstream["write_failure"] = True
    url = "/api/unifi/operations/" + r["id"] + "/execute"
    result = client.post(url, json={"confirmation": r["target"]})
    assert result.json()["status"] == "unknown" and "Secret upstream" not in result.text
    assert client.post(url, json={"confirmation": r["target"]}).json() == result.json()
    assert len([c for c in upstream["calls"] if c[0] == "POST"]) == 1


def test_capability_role_and_csrf_boundaries(client, upstream):
    for body in [
        {"operation": "PORT_RESET", "port": 1},
        {"operation": "RESTART", "port": 1},
        {"operation": "POWER_CYCLE", "port": 2},
    ]:
        assert client.post(BASE + "/review", json=body).status_code in (422, 409)
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='operator'")
    assert client.get(BASE).status_code == 200
    assert client.post(BASE + "/review", json={"operation": "RESTART"}).status_code == 403
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='admin'")
    client.headers.pop("X-CSRF-Token")
    assert client.post(BASE + "/review", json={"operation": "RESTART"}).status_code == 403
    assert all(c[0] == "GET" for c in upstream["calls"])


def test_endpoint_mac_link_requires_unique_evidence(client, monkeypatch):
    from speck import fleet, vault, dns

    machines = [
        {
            "id": "a",
            "label": "A",
            "addresses": ["192.168.1.1"],
            "telemetry": {"network": {"interfaces": [{"mac": "02-00-00-00-00-09"}]}},
        },
        {"id": "b", "label": "B", "addresses": ["192.168.1.1"]},
    ]

    async def inventory(**kw):
        return {"machines": machines}

    rows = [
        {
            "mac": "02:00:00:00:00:09",
            "name": "A",
            "ip": "192.168.1.1",
            "console_id": "c",
            "site_id": "s",
            "uplink_id": "switch",
        }
    ]

    async def clients():
        return rows

    monkeypatch.setattr(fleet, "inventory", inventory)
    monkeypatch.setattr(unifi, "cached_clients", clients)
    monkeypatch.setattr(vault, "provider", lambda name: {"configured": True})
    monkeypatch.setattr(dns, "connections_map", lambda: ({}, 0))
    result = client.get("/api/network/map").json()["machines"]
    assert len(result[0]["network_clients"]) == 1 and result[1]["network_clients"] == []
    machines[1]["telemetry"] = machines[0]["telemetry"]
    assert all(not r["network_clients"] for r in client.get("/api/network/map").json()["machines"])
    machines.pop()
    rows.append(rows[0].copy())
    assert not client.get("/api/network/map").json()["machines"][0]["network_clients"]
