import math
import time

import pytest
from speck import infrastructure, unifi, unifi_observability as sites
from speck.provider_metrics import linode_series, proxmox_series


def test_history_units_missing_and_unsorted_samples():
    result = {
        s["key"]: s
        for s in linode_series(
            {
                "data": {
                    "cpu": [[2000, 160], [1000, None], [3000, math.nan], ["bad", 1]],
                    "netv4": {"in": [[1000, 8000]]},
                }
            }
        )
    }
    assert result["cpu"]["points"] == [[1, None], [2, 160], [3, None]]
    assert result["netin"]["unit"] == "bit/s"
    assert result["disk"]["unit"] == "blocks/s"
    assert result["netout"]["points"] == []
    assert linode_series({"cpu": [[1000, 4], [2000, 5]]}, 2)[0]["points"] == [[2, 5]]
    result = {
        s["key"]: s
        for s in proxmox_series([{"time": 2, "cpu": 0.25, "netin": 2048}, {"time": 1}, {"time": True}, {"cpu": 9}])
    }
    assert result["cpu"]["points"] == [[1, None], [2, 25]]
    assert result["netin"]["unit"] == "bytes/s"
    assert result["netin"]["points"] == [[1, None], [2, 2048]]


@pytest.mark.parametrize(
    "provider,kind,rid,path",
    [
        ("linode", "instance", "42", "/linode/instances/42/stats"),
        ("proxmox", "qemu", "101", "/nodes/node-a/qemu/101/rrddata"),
        ("proxmox", "node", "node-a", "/nodes/node-a/rrddata"),
    ],
)
def test_metrics_resolve_exact_resource_and_only_read(client, monkeypatch, provider, kind, rid, path):
    calls = []
    monkeypatch.setattr(infrastructure, "get_connection", lambda cid: {"id": cid, "provider": provider})

    async def resolve(cfg, k, i):
        assert (cfg["id"], k, i) == ("connection-a", kind, rid)
        return {"id": rid, "type": kind, "node": "node-a", "vmid": 101}

    async def request(cfg, method, url, **kw):
        calls.append((method, url, kw))
        return {} if provider == "linode" else []

    monkeypatch.setattr(infrastructure, "resolve", resolve)
    monkeypatch.setattr(infrastructure, "provider_request", request)
    response = client.get(f"/api/infrastructure/connections/connection-a/resources/{kind}/{rid}/metrics?timeframe=day")
    assert response.status_code == 200, response.text
    assert calls == [("GET", path, {} if provider == "linode" else {"params": {"timeframe": "day"}})]
    assert (
        client.get(
            f"/api/infrastructure/connections/connection-a/resources/{kind}/{rid}/metrics?timeframe=century"
        ).status_code
        == 422
    )
    if provider == "linode":
        assert (
            client.get(
                f"/api/infrastructure/connections/connection-a/resources/{kind}/{rid}/metrics?timeframe=week"
            ).status_code
            == 422
        )
        assert len(calls) == 1


def test_site_location_validation_and_allowlisted_details(client, monkeypatch):
    unifi.forget_lookups()

    async def hosts():
        return [
            {
                "id": "one",
                "reportedState": {
                    "name": "North",
                    "state": "connected",
                    "location": {"lat": 41, "long": -73, "text": "North campus"},
                    "ipAddrs": ["203.0.113.4"],
                },
            },
            {"id": "two", "reportedState": {"location": {"lat": 91, "long": False}, "private": "secret"}},
        ]

    async def cloud():
        return [
            {
                "siteId": "a",
                "hostId": "one",
                "meta": {"name": "default"},
                "statistics": {
                    "counts": {"wifiClient": 12},
                    "wans": {"WAN": {"portUp": True, "wanIssues": ["issue"], "externalIp": "203.0.113.4"}},
                },
            },
            {"siteId": "b", "hostId": "two"},
        ]

    monkeypatch.setattr(unifi, "hosts", hosts)
    monkeypatch.setattr(sites, "cloud_sites", cloud)
    monkeypatch.setattr(unifi, "provider", lambda name: {"UNIFI_GATEWAY": "203.0.113.4"})
    response = client.get("/api/unifi/sites")
    assert response.status_code == 200
    one, two = sorted(response.json()["sites"], key=lambda x: x["id"])
    assert one["location"]["longitude"] == -73 and one["is_managed_gateway"]
    assert one["wans"][0]["issues"] == 1
    assert two["location"] is None and not two["is_managed_gateway"]
    assert "secret" not in response.text
    assert sites.coordinate(math.nan, 90) is None


def test_client_presence_traffic_and_unknown_are_honest():
    now = time.time()
    result = sites.normalize_client(
        {"id": "client", "macAddress": "AA:BB"},
        {
            "last_seen": now,
            "is_wired": True,
            "wired-rx_bytes": 1024,
            "satisfaction": 99,
            "gw_vlan": 0,
            "sw_mac": "switch",
            "sw_port": 4,
        },
        {"switch": {"name": "Access switch"}},
    )
    assert result["state"] == "online" and result["type"] == "WIRED"
    assert result["vlan"] == 0 and result["port"] == 4 and result["uplink_name"] == "Access switch"
    assert result["received_bytes"] == 1024 and result["mac"] == "aa:bb"
    assert sites.normalize_client({}, {"last_seen": now - 500})["state"] == "last_seen"
    assert sites.normalize_client({}, {"last_seen": now - 1, "disconnect_timestamp": now})["state"] == "last_seen"
    unknown = sites.normalize_client({})
    assert unknown["state"] == "unknown" and unknown["type"] == "UNKNOWN" and unknown["experience"] is None


def test_site_clients_require_exact_account_and_network_reference(client, monkeypatch):
    unifi.forget_lookups()
    calls = []

    async def cloud():
        return [{"hostId": "other-console", "siteId": "other-site", "meta": {"name": "branch"}}]

    async def hosts():
        return [{"id": "managed-console", "reportedState": {"ipAddrs": ["203.0.113.4"]}}]

    async def call(method, url, **kwargs):
        calls.append((method, url))
        if url.endswith("/integration/v1/sites"):
            return {"data": [{"id": "network-site", "internalReference": "branch"}]}
        if "/clients" in url:
            return {
                "totalCount": 1,
                "data": [{"id": "a", "ipAddress": "192.168.1.10", "macAddress": "AA:BB", "type": "WIRED"}],
            }
        raise RuntimeError("Optional telemetry unavailable")

    monkeypatch.setattr(sites, "cloud_sites", cloud)
    monkeypatch.setattr(unifi, "hosts", hosts)
    monkeypatch.setattr(unifi, "call", call)
    monkeypatch.setattr(unifi, "provider", lambda name: {"UNIFI_GATEWAY": "203.0.113.4"})
    assert client.get("/api/unifi/sites/wrong/other-site/clients").status_code == 404
    assert calls == []
    response = client.get("/api/unifi/sites/other-console/other-site/clients")
    assert response.status_code == 200, response.text
    row = response.json()["clients"][0]
    assert row["ip"] == "192.168.1.10" and row["is_managed_gateway"] is False and row["state"] == "unknown"
    assert all(m == "GET" and "/consoles/other-console/" in u for m, u in calls)
    unifi.forget_lookups()

    async def mismatch(*args, **kwargs):
        return {"data": [{"id": "wrong", "internalReference": "default"}]}

    monkeypatch.setattr(unifi, "call", mismatch)
    assert client.get("/api/unifi/sites/other-console/other-site/clients").status_code == 409
