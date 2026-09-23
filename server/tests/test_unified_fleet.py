import asyncio
import hashlib
import json

import pytest

from speck import fleet, infrastructure as infra
from speck.db import db

UUID = "b6639d30-0647-4a02-a363-984141c2a111"
MAC = "52:54:00:12:34:56"


def endpoint(id="agent", uuid=UUID, **extra):
    return dict(
        id=id,
        label="Workstation",
        hostname="same-name",
        platform="windows",
        online=True,
        approved=True,
        telemetry={"network": {"interfaces": [{"mac": MAC}]}},
        hardware_id=hashlib.sha256(("windows:" + uuid).encode()).hexdigest(),
        **extra,
    )


def resource(id="101", provider="proxmox", kind="qemu", **extra):
    return dict(
        id=id,
        provider=provider,
        kind=kind,
        connection_id="cluster",
        connection_name="Cluster",
        name="same-name",
        node="host-a",
        status="running",
        identity={"uuid": UUID, "macs": [MAC]},
        **extra,
    )


def groups(*rows):
    return [{"resources": list(rows), "stale": False, "checked_at": 100}]


def test_uuid_joins_endpoint_provider_and_keeps_separate_power_and_agent_state():
    d = endpoint()
    d["online"] = False
    rows = fleet.assemble([d], groups(resource()))
    assert len(rows) == 1
    m = rows[0]
    assert m["id"] == "agent" and m["has_endpoint_agent"] and not m["online"]
    assert m["state"] == "running" and m["identity_evidence"] == ["Hardware UUID", "Unique hardware MAC"]
    assert m["location"] == "Cluster · host-a"


def test_mac_bridge_brings_slide_client_to_proxmox_and_endpoint():
    slide = resource("a_demo", "slide", "protected", client={"id": "c1", "key": "origin:c1", "name": "Clinic"})
    slide["identity"] = {"macs": [MAC]}
    result = fleet.assemble([endpoint(slide_agent_id="a_demo")], groups(resource(), slide))
    assert len(result) == 1 and len(result[0]["resources"]) == 2
    assert result[0]["client_name"] == "Clinic"


def test_same_name_or_ip_is_never_identity_and_cluster_ids_remain_scoped():
    p = resource()
    p["identity"] = {}
    p["addresses"] = ["10.0.0.1"]
    p2 = p | {"connection_id": "other"}
    result = fleet.assemble([endpoint()], groups(p, p2))
    assert len(result) == 3


def test_duplicate_uuid_and_mac_do_not_arbitrarily_choose_guest():
    result = fleet.assemble([endpoint()], groups(resource(), resource("102")))
    assert len(result) == 3
    assert any("Duplicate hardware UUID" in m["identity_issues"] for m in result)


def test_mac_bridge_cannot_bypass_conflicting_uuid():
    p = resource()
    p["identity"]["uuid"] = "different-uuid"
    s = resource("a_demo", "slide", "protected")
    s["identity"] = {"macs": [MAC]}
    result = fleet.assemble([endpoint()], groups(s, p))
    assert not any(m["has_endpoint_agent"] and any(r["provider"] == "proxmox" for r in m["resources"]) for m in result)
    assert any("MAC and hardware UUID disagree" in m["identity_issues"] for m in result)


def test_source_and_restore_stay_separate_even_with_cloned_mac():
    source = resource("a_demo", "slide", "protected")
    source["identity"] = {"macs": [MAC]}
    vm = resource("virt_demo", "slide", "virt", source_agent_id="a_demo")
    vm["identity"] = {"macs": [MAC]}
    result = fleet.assemble([], groups(source, vm))
    assert len(result) == 2


def test_multiple_client_memberships_are_visible_conflict():
    p = resource(client={"id": "a", "key": "a", "name": "Alpha"})
    s = resource("a_demo", "slide", "protected", client={"id": "b", "key": "b", "name": "Beta"})
    s["identity"] = {"macs": [MAC]}
    m = fleet.assemble([], groups(p, s))[0]
    assert m["client_conflict"] and m["client_name"] == "Multiple clients" and len(m["clients"]) == 2


def test_cached_provider_state_and_host_agent_are_explicit():
    r = resource("host-a", kind="node", management="host_agent", connector_online=False)
    m = fleet.assemble([], [{"resources": [r], "stale": True, "checked_at": 100}])[0]
    assert m["state"] == "unknown" and not m["online"]
    assert m["has_speck_agent"] and not m["has_endpoint_agent"] and m["agent_status"] == "Host agent offline"


def test_slide_client_inheritance_and_normalized_data_exclude_secrets(monkeypatch):
    class Slide:
        def __init__(self, cfg):
            pass

        async def listing(self, path, params=None):
            return {
                "client": [{"client_id": "c1", "name": "Clinic"}],
                "device": [{"device_id": "d1", "display_name": "Box", "client_id": "c1", "password": "never"}],
                "agent": [
                    {
                        "agent_id": "a1",
                        "device_id": "d1",
                        "hostname": "Protected",
                        "passphrase": "never",
                            "ip_addresses": None, "last_seen_at": None,
                        "quiescence_scripts": ["never"],
                        "addresses": [{"mac": MAC}],
                    }
                ],
                "restore/virt": [
                    {
                        "virt_id": "v1",
                        "agent_id": "a1",
                        "device_id": "d1",
                        "state": "running",
                        "vnc_password": "never",
                        "mac_address": "52:54:00:aa:bb:cc",
                    }
                ],
            }[path]

    monkeypatch.setattr(infra, "Slide", Slide)
    cfg = {"id": "c", "name": "Slide", "provider": "slide", "url": "https://slide.example"}
    rows = asyncio.run(infra.raw_inventory(cfg))
    resources = infra.resources(cfg, rows)
    assert {r["kind"] for r in resources} == {"box", "protected", "virt"}
    assert all(r["client"]["name"] == "Clinic" for r in resources)
    assert "never" not in json.dumps(resources) and "quiescence" not in json.dumps(resources)
    assert asyncio.run(infra.resolve(cfg, "box", "d1"))["display_name"] == "Box"
    assert asyncio.run(infra.resolve(cfg, "protected", "a1"))["hostname"] == "Protected"


def test_inventory_cache_survives_outage_and_drops_deleted_machines(client, monkeypatch):
    rows = [{"type": "qemu", "vmid": 101, "node": "host", "name": "VM", "status": "running"}]

    async def request(cfg):
        return rows

    monkeypatch.setattr(infra, "raw_inventory", request)
    response = client.post(
        "/api/infrastructure/connections", json={"name": "PVE", "provider": "proxmox", "connector": True}
    )
    assert response.status_code == 200
    result = client.get("/api/fleet").json()
    assert len(result["machines"]) == 1

    async def fail(cfg):
        raise RuntimeError("secret upstream error")

    monkeypatch.setattr(infra, "raw_inventory", fail)
    result = client.get("/api/fleet?refresh=true").json()
    assert result["machines"][0]["stale"] and result["machines"][0]["state"] == "unknown"
    assert "secret" not in json.dumps(result)
    monkeypatch.setattr(infra, "raw_inventory", request)
    rows.clear()
    assert client.get("/api/fleet?refresh=true").json()["machines"] == []
    with db() as conn:
        assert "resources" not in conn.execute("SELECT payload FROM fleet_inventory_cache").fetchone()[0]


def test_preferences_are_validated_isolated_and_viewer_can_only_edit_own(client):
    prefs = client.get("/api/fleet/preferences").json()
    prefs.update(visible=["name", "client"], widths={"client": 220}, sort="client", direction="desc")
    assert client.put("/api/fleet/preferences", json=prefs).status_code == 200
    assert client.get("/api/fleet/preferences").json() == prefs
    assert client.put("/api/fleet/preferences", json=prefs | {"visible": ["client"]}).status_code == 422
    assert client.put("/api/fleet/preferences", json=prefs | {"widths": {"name": 10000}}).status_code == 422
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='viewer'")
    assert client.get("/api/fleet").status_code == 200
    assert client.put("/api/fleet/preferences", json=prefs).status_code == 200
    assert client.get("/api/infrastructure/inventory").status_code == 403
    assert client.post("/api/infrastructure/connections/x/actions", json={}).status_code == 403
    assert client.put("/api/fleet/preferences", json=prefs, headers={"X-CSRF-Token": "bad"}).status_code == 403
    # Preference rows are keyed by authenticated user, never by a request parameter.
    from speck.fleet import preferences

    assert preferences({"user_id": "other-user"}) == fleet.Preferences().model_dump()


@pytest.mark.parametrize("value", ["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "52xx54xx00xx12xx34xx56", "not a MAC"])
def test_invalid_mac_cannot_be_evidence(value):
    assert not fleet.mac(value)
