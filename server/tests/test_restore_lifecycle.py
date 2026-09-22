import asyncio
import json
import time

import pytest
from fastapi import HTTPException

from speck.config import seal
from speck.db import db, initialize
from speck.restore_lifecycle import sync
from speck.slide import Slide, SlideProviderError
from test_control_plane import enroll


class Provider:
    def __init__(self, config):
        self.config = config
        self.vm = {
            "virt_id": "virt_0123456789ab",
            "agent_id": "a_0123456789ab",
            "snapshot_id": "s_0123456789ab",
            "mac_address": "52:54:00:11:22:33",
            "purpose": "test",
            "state": "stopped",
        }
        self.rows = [self.vm]
        self.error = 404
        self.reads = []

    async def listing(self, resource):
        assert resource == "restore/virt"
        return self.rows

    async def request(self, method, path):
        assert method == "GET"  # Cleanup never writes to Slide.
        self.reads.append(path)
        if self.error:
            raise SlideProviderError(self.error)
        return self.vm


@pytest.fixture
def setup(client):
    config = {"url": "https://provider.example", "token": "fixture-private-token"}
    original, headers = enroll(client)
    clone_headers = headers | {"X-Speck-Hardware": "restored-hardware-456"}
    data = {
        "hostname": "testbox",
        "platform": "linux",
        "arch": "amd64",
        "telemetry": {"network": {"interfaces": [{"mac": "52-54-00-11-22-33"}]}},
    }
    clone = client.post("/api/agent/check-in", headers=clone_headers, json=data).json()["device_id"]
    now = time.time()
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES('slide',?)", (seal(json.dumps(config)),))
        conn.execute(
            "UPDATE devices SET slide_agent_id=?,created=?,last_seen=? WHERE id=?",
            ("a_0123456789ab", now - 1000, now, original["device_id"]),
        )
        conn.execute("UPDATE devices SET approved=1,created=?,last_seen=? WHERE id=?", (now - 500, now - 200, clone))
    return Provider(config), original["device_id"], clone, clone_headers, data, now


def run(provider, now):
    return asyncio.run(sync(provider, now=now))


def devices():
    with db() as conn:
        return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM devices")}


def test_removed_restore_archives_only_clone_and_retains_history(client, setup):
    provider, source, clone, headers, data, now = setup
    job = client.post(
        f"/api/devices/{clone}/jobs", json={"kind": "command", "payload": {"script": "echo test"}}
    ).json()["id"]
    assert run(provider, now)["linked"] == [clone]
    provider.rows = []
    assert run(provider, now + 1)["pending"] == [clone]
    initialize()  # Confirmation state survives server restart.
    assert not run(provider, now + 299)["archived"]
    assert run(provider, now + 301)["archived"] == [clone]
    assert [d["id"] for d in client.get("/api/devices").json()] == [source]
    assert len(client.get("/api/devices?include_archived=true").json()) == 2
    assert client.get("/api/jobs/" + job).json()["status"] == "cancelled"
    assert client.post("/api/agent/check-in", headers=headers, json=data).json()["approved"] is False
    assert client.get("/api/agent/jobs/next", headers=headers).json() == {"job": None}
    with db() as conn:
        assert conn.execute("SELECT revoked FROM installations").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM audit WHERE action='slide.restore_archived'").fetchone()[0] == 1
    assert not run(provider, now + 1000)["archived"]
    assert not devices()[source]["archived"]


@pytest.mark.parametrize("state", ["running", "stopped"])
def test_existing_restore_is_retained_even_when_offline(client, setup, state):
    provider, _, clone, _, _, now = setup
    provider.vm["state"] = state
    run(provider, now)
    run(provider, now + 3600)
    assert not devices()[clone]["archived"] and not provider.reads


@pytest.mark.parametrize("error", [None, 401, 403, 429, 500])
def test_list_omission_or_read_failure_never_means_deleted(client, setup, error):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)
    provider.error = error
    run(provider, now + 601)
    assert not devices()[clone]["archived"]
    with db() as conn:
        assert conn.execute("SELECT missing_count FROM slide_restore_instances").fetchone()[0] == 0


def test_online_clone_blocks_archival_and_returning_vm_clears_missing(client, setup):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)
    with db(write=True) as conn:
        conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (now + 600, clone))
    assert run(provider, now + 601)["pending"] == [clone]
    provider.rows = [provider.vm]
    run(provider, now + 700)
    provider.rows = []
    assert not run(provider, now + 1500)["archived"]  # Fresh grace period.


@pytest.mark.parametrize("change", ["source_link", "clone_link", "hardware", "mac", "source_archived"])
def test_identity_changes_block_archival(client, setup, change):
    provider, source, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)
    with db(write=True) as conn:
        if change == "source_link":
            conn.execute("UPDATE devices SET slide_agent_id=NULL WHERE id=?", (source,))
        elif change == "source_archived":
            conn.execute("UPDATE devices SET archived=1 WHERE id=?", (source,))
        elif change == "clone_link":
            conn.execute("UPDATE devices SET slide_agent_id='a_anothersource' WHERE id=?", (clone,))
        elif change == "hardware":
            conn.execute("UPDATE devices SET hardware_id='changed-hardware' WHERE id=?", (clone,))
        else:
            conn.execute("UPDATE devices SET telemetry='{}' WHERE id=?", (clone,))
    assert not run(provider, now + 600)["archived"]


def test_provider_token_rotation_requires_fresh_identity_observation(client, setup):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)
    provider.config = provider.config | {"token": "rotated-token-with-a-different-scope"}
    with db(write=True) as conn:
        conn.execute("UPDATE settings SET value=? WHERE key='slide'", (seal(json.dumps(provider.config)),))
    run(provider, now + 600)
    assert not devices()[clone]["archived"]
    provider.rows = [provider.vm]
    run(provider, now + 700)
    provider.rows = []
    run(provider, now + 800)
    assert run(provider, now + 1100)["archived"] == [clone]


def test_ambiguous_mac_and_verification_vms_are_not_linked(client, setup):
    provider, _, clone, _, _, now = setup
    provider.vm["purpose"] = "verification"
    assert not run(provider, now)["linked"]
    provider.vm["purpose"] = "test"
    provider.rows.append(provider.vm | {"virt_id": "virt_abcdef123456"})
    assert not run(provider, now + 1)["linked"]
    assert not devices()[clone]["archived"]


def test_policy_authentication_redaction_and_pausing(client, setup, monkeypatch):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    assert client.put("/api/slide/restored-devices/settings", json={"enabled": False}).status_code == 200
    provider.rows = []
    run(provider, now + 1)
    run(provider, now + 600)
    assert not devices()[clone]["archived"]
    response = client.get("/api/slide/restored-devices")
    assert response.json()["enabled"] is False
    assert "fixture-private-token" not in response.text and '"scope"' not in response.text
    assert client.post("/api/slide/restored-devices/sync", headers={"X-CSRF-Token": ""}).status_code == 403
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='operator'")
    assert client.put("/api/slide/restored-devices/settings", json={"enabled": True}).status_code == 403
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='viewer'")
    assert client.post("/api/slide/restored-devices/sync").status_code == 403


def test_malformed_inventory_and_pagination_fail_closed(client, setup):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = [{"unexpected": "data"}]
    with pytest.raises(HTTPException):
        run(provider, now + 600)
    assert not devices()[clone]["archived"]
    slide = Slide(provider.config)

    async def malformed(*args, **kwargs):
        return {"message": "not a collection"}

    slide.request = malformed
    with pytest.raises(HTTPException):
        asyncio.run(slide.listing("restore/virt"))


def test_changed_connection_during_read_does_not_archive(client, setup):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)

    async def changed(*args, **kwargs):
        with db(write=True) as conn:
            conn.execute(
                "UPDATE settings SET value=? WHERE key='slide'",
                (seal(json.dumps(provider.config | {"token": "changed"})),),
            )
        raise SlideProviderError(404)

    provider.request = changed
    with pytest.raises(HTTPException):
        run(provider, now + 600)
    assert not devices()[clone]["archived"]


def test_present_vm_with_changed_metadata_breaks_confirmation(client, setup):
    provider, _, clone, _, _, now = setup
    run(provider, now)
    provider.rows = []
    run(provider, now + 1)
    provider.rows = [provider.vm | {"snapshot_id": "s_newsnapshot1"}]
    run(provider, now + 600)
    provider.rows = []
    assert run(provider, now + 1000)["pending"] == [clone]
    assert not devices()[clone]["archived"]
