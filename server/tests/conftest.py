import pytest
from fastapi.testclient import TestClient
from speck.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SPECK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SPECK_ENCRYPTION_KEY", "test-only-random-secret-with-more-than-32-characters")
    monkeypatch.setenv("SPECK_BOOTSTRAP_PASSWORD", "test-only-admin-password")
    monkeypatch.setenv("SPECK_ORIGIN", "https://testserver")
    with TestClient(app, base_url="https://testserver") as c:
        response = c.post(
            "/api/auth/login",
            json={"username": "admin", "password": "test-only-admin-password"},
            headers={"Origin": "https://testserver"},
        )
        assert response.status_code == 200
        c.headers.update({"Origin": "https://testserver", "X-CSRF-Token": response.json()["csrf"]})
        yield c
