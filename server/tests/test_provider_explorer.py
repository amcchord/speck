import pytest
from fastapi import HTTPException
from speck import infrastructure as infra
from speck.slide import Slide


@pytest.fixture
def connection(monkeypatch):
    cfg = {"id": "one", "provider": "linode"}
    monkeypatch.setattr(infra, "get_connection", lambda cid: cfg | {"id": cid})

    async def resolve(c, kind, rid):
        assert c["id"] == "one" and rid == "42"
        return {"id": 42}

    monkeypatch.setattr(infra, "resolve", resolve)
    return cfg


def test_cloud_sections_fail_independently_and_are_redacted(client, monkeypatch, connection):
    calls = []

    async def request(cfg, method, path, params=None):
        calls.append((method, path))
        if path.endswith("/firewalls"):
            raise HTTPException(403, "private upstream body")
        return {"data": [{"id": 1, "label": "Boot", "password": "never-return"}], "pages": 1}

    monkeypatch.setattr(infra, "provider_request", request)
    response = client.get("/api/infrastructure/connections/one/resources/instance/42/explore")
    assert response.status_code == 200, response.text
    sections = response.json()["sections"]
    assert sections["disks"]["state"] == "available" and sections["firewalls"]["state"] == "unavailable"
    assert "never-return" not in response.text and "private upstream" not in response.text
    assert all(m == "GET" and p.startswith("/linode/instances/42/") for m, p in calls)


def test_backup_history_is_filtered_bounded_and_uses_origin(client, monkeypatch, connection):
    connection["provider"] = "slide"
    calls = []

    async def request(self, method, path, params=None):
        calls.append((self.config["id"], method, path, params))
        return {
            "data": [{"agent_id": "42", "backup_id": "b", "password": "never-return"}],
            "pagination": {"next_offset": params["offset"] + 25},
        }

    monkeypatch.setattr(Slide, "request", request)
    response = client.get("/api/infrastructure/connections/one/resources/protected/42/explore")
    assert response.status_code == 200 and "never-return" not in response.text
    assert {x[2] for x in calls} == {"backup", "snapshot"}
    assert all(c[0] == "one" and c[1] == "GET" and c[3] == {"agent_id": "42", "limit": 25, "offset": 0} for c in calls)
    more = client.get("/api/infrastructure/connections/one/resources/protected/42/history?resource=backup&offset=25")
    assert more.json()["next_offset"] == 50
    assert (
        client.get("/api/infrastructure/connections/one/resources/protected/42/history?resource=secret").status_code
        == 422
    )


def test_backup_filter_mismatch_never_leaks_other_system(client, monkeypatch, connection):
    connection["provider"] = "slide"

    async def request(*args, **kwargs):
        return {"data": [{"agent_id": "other", "backup_id": "private-record"}]}

    monkeypatch.setattr(Slide, "request", request)
    response = client.get("/api/infrastructure/connections/one/resources/protected/42/history?resource=backup")
    assert response.status_code == 502 and "private-record" not in response.text
