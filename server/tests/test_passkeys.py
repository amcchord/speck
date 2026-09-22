"""Exercise real COSE keys, authenticator data and ECDSA signatures (no verifier mocks)."""

import hashlib
import json
import secrets
from concurrent.futures import ThreadPoolExecutor

import cbor2
import pyotp
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from webauthn.helpers import bytes_to_base64url as b64

from speck.config import seal
from speck.db import db, initialize
from speck.main import app

PASSWORD = "test-only-admin-password"
ORIGIN = "https://testserver"


class Authenticator:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.id = secrets.token_bytes(32)
        self.user = None

    def response(self, opts, register=False, origin=ORIGIN, rp="testserver", uv=True, count=0, cross=False):
        options = opts["publicKey"]
        if register:
            self.user = options["user"]["id"]
        client = json.dumps(
            {
                "type": "webauthn.create" if register else "webauthn.get",
                "challenge": options["challenge"],
                "origin": origin,
                "crossOrigin": cross,
            }
        ).encode()
        flags = 1 | (4 if uv else 0) | (64 if register else 0)
        auth = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + count.to_bytes(4, "big")
        if register:
            pub = self.key.public_key().public_numbers()
            cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: pub.x.to_bytes(32, "big"), -3: pub.y.to_bytes(32, "big")})
            auth += bytes(16) + len(self.id).to_bytes(2, "big") + self.id + cose
            response = {
                "attestationObject": b64(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})),
                "transports": ["internal"],
            }
        else:
            signature = self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
            response = {"authenticatorData": b64(auth), "signature": b64(signature), "userHandle": self.user}
        response["clientDataJSON"] = b64(client)
        return {"id": b64(self.id), "rawId": b64(self.id), "type": "public-key", "response": response}


def enroll_key(client, auth=None, **changes):
    auth = auth or Authenticator()
    options = client.post("/api/access/passkeys/options", json={"password": PASSWORD})
    assert options.status_code == 200, options.text
    body = {
        "challenge_id": options.json()["challenge_id"],
        "name": "Test laptop",
        "credential": auth.response(options.json(), register=True, **changes),
    }
    return auth, client.post("/api/access/passkeys/verify", json=body), body


def login_body(client, auth, **changes):
    options = client.post("/api/auth/passkeys/options")
    assert options.status_code == 200, options.text
    return {"challenge_id": options.json()["challenge_id"], "credential": auth.response(options.json(), **changes)}


def test_end_to_end_discoverable_passkey_revocation_and_password_recovery(client):
    original_cookie = client.cookies.get("speck_session")
    original_csrf = client.headers["x-csrf-token"]
    key, result, _ = enroll_key(client)
    assert result.status_code == 200, result.text
    key_id = result.json()["id"]
    items = client.get("/api/access/passkeys").json()
    assert items[0]["name"] == "Test laptop" and "public_key" not in items[0]
    initialize()
    body = login_body(client, key)
    client.cookies.clear()
    result = client.post("/api/auth/passkeys/verify", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["role"] == "admin"
    assert client.cookies.get("speck_session") != original_cookie
    assert "HttpOnly" in result.headers["set-cookie"] and "Secure" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert client.post("/api/auth/passkeys/verify", json=body).status_code == 400
    logged_in_cookie = client.cookies.get("speck_session")
    client.cookies.clear()
    client.cookies.set("speck_session", original_cookie)
    client.headers["x-csrf-token"] = original_csrf
    assert client.patch("/api/access/passkeys/" + key_id, json={"name": "My Mac"}).status_code == 200
    result = client.post("/api/access/passkeys/" + key_id + "/remove", json={"password": PASSWORD})
    assert result.status_code == 200
    client.cookies.clear()
    client.cookies.set("speck_session", logged_in_cookie)
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/passkeys/verify", json=login_body(client, key)).status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 200
    with db() as conn:
        actions = [r["action"] for r in conn.execute("SELECT action FROM audit")]
    assert "account.passkey_removed" in actions and "account.passkey_added" in actions


@pytest.mark.parametrize(
    "changes", [{"uv": False}, {"rp": "evil.test"}, {"origin": "https://evil.test"}, {"cross": True}]
)
def test_rejects_registration_without_origin_rp_or_verification(client, changes):
    _, result, body = enroll_key(client, **changes)
    assert result.status_code == 400
    assert client.post("/api/access/passkeys/verify", json=body).status_code == 400
    assert not client.get("/api/access/passkeys").json()


@pytest.mark.parametrize(
    "change", ["uv", "rp", "origin", "signature", "handle", "challenge", "disabled", "expiry", "cross"]
)
def test_rejects_invalid_assertions(client, change):
    key, result, _ = enroll_key(client)
    assert result.status_code == 200
    kwargs = (
        {"uv": False}
        if change == "uv"
        else {"rp": "evil.test"}
        if change == "rp"
        else {"origin": "https://evil.test"}
        if change == "origin"
        else {"cross": True}
        if change == "cross"
        else {}
    )
    body = login_body(client, key, **kwargs)
    if change in ("signature", "handle"):
        body["credential"]["response"]["signature" if change == "signature" else "userHandle"] = b64(bytes(32))
    if change == "challenge":
        options = client.post("/api/auth/passkeys/options").json()
        body["challenge_id"] = options["challenge_id"]
    if change == "disabled":
        with db(write=True) as conn:
            conn.execute("UPDATE users SET disabled=1")
    if change == "expiry":
        with db(write=True) as conn:
            conn.execute("UPDATE passkey_challenges SET expires=0")
    assert client.post("/api/auth/passkeys/verify", json=body).status_code in (400, 401)
    assert client.post("/api/auth/passkeys/verify", json=body).status_code == 400


def test_enrollment_needs_password_mfa_csrf_same_session_and_unchanged_account(client):
    assert client.post("/api/access/passkeys/options", json={"password": "bad"}).status_code == 403
    assert (
        client.post(
            "/api/access/passkeys/options", json={"password": PASSWORD}, headers={"X-CSRF-Token": "bad"}
        ).status_code
        == 403
    )
    secret = pyotp.random_base32()
    with db(write=True) as conn:
        conn.execute("UPDATE users SET totp_secret=?", (seal(secret),))
    assert client.post("/api/access/passkeys/options", json={"password": PASSWORD}).status_code == 403
    options = client.post(
        "/api/access/passkeys/options", json={"password": PASSWORD, "code": pyotp.TOTP(secret).now()}
    ).json()
    auth = Authenticator()
    body = {
        "challenge_id": options["challenge_id"],
        "name": "My key",
        "credential": auth.response(options, register=True),
    }
    with db(write=True) as conn:
        conn.execute("UPDATE users SET totp_secret=NULL")
    assert client.post("/api/access/passkeys/verify", json=body).status_code == 403
    options = client.post("/api/access/passkeys/options", json={"password": PASSWORD}).json()
    body = {
        "challenge_id": options["challenge_id"],
        "name": "My key",
        "credential": auth.response(options, register=True),
    }
    result = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    client.headers["x-csrf-token"] = result.json()["csrf"]
    assert client.post("/api/access/passkeys/verify", json=body).status_code == 403


def test_concurrent_assertion_is_consumed_once_and_counter_replay_rejected(client):
    key, _, _ = enroll_key(client)
    body = login_body(client, key, count=1)

    def finish():
        with TestClient(app, base_url=ORIGIN) as c:
            return c.post("/api/auth/passkeys/verify", json=body, headers={"Origin": ORIGIN}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: finish(), range(2))) == [200, 400]
    assert client.post("/api/auth/passkeys/verify", json=login_body(client, key, count=1)).status_code == 401


def test_viewer_passkey_login_obeys_roles_and_user_ownership(client):
    key, _, _ = enroll_key(client)
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='viewer'")
    result = client.post("/api/auth/passkeys/verify", json=login_body(client, key))
    client.headers["x-csrf-token"] = result.json()["csrf"]
    assert result.json()["role"] == "viewer"
    assert client.get("/api/access/passkeys").status_code == 200
    assert client.get("/api/access/users").status_code == 403
    assert client.patch("/api/access/passkeys/not-owned", json={"name": "other"}).status_code == 404


def test_malformed_response_origin_and_rate_limit(client):
    assert client.post("/api/auth/passkeys/options", headers={"Origin": "https://evil.test"}).status_code == 403
    options = client.post("/api/auth/passkeys/options").json()
    result = client.post("/api/auth/passkeys/verify", json={"challenge_id": options["challenge_id"], "credential": {}})
    assert result.status_code == 400
    for _ in range(9):
        assert client.post("/api/auth/passkeys/options").status_code == 200
    assert client.post("/api/auth/passkeys/options").status_code == 429


def test_rejects_duplicate_credential_and_late_registration_after_logout(client):
    key, result, _ = enroll_key(client)
    assert result.status_code == 200
    _, duplicate, _ = enroll_key(client, key)
    assert duplicate.status_code == 409
    options = client.post("/api/access/passkeys/options", json={"password": PASSWORD}).json()
    fresh = Authenticator()
    body = {
        "challenge_id": options["challenge_id"],
        "name": "Late key",
        "credential": fresh.response(options, register=True),
    }
    client.post("/api/auth/logout")
    assert client.post("/api/access/passkeys/verify", json=body).status_code == 401


def test_desktop_browser_handoff_is_pkce_bound_single_use_and_cookie_free(client):
    key, _, _ = enroll_key(client)
    verifier = secrets.token_urlsafe(32)
    started = client.post(
        "/api/auth/desktop/start", json={"verifier_hash": hashlib.sha256(verifier.encode()).hexdigest()}
    ).json()
    browser = TestClient(app, base_url=ORIGIN)
    browser.headers["Origin"] = ORIGIN
    options = browser.get("/api/auth/desktop/" + started["id"]).json()
    assert options["code"] == started["code"]
    payload = {"id": started["id"], "verifier": verifier}
    assert client.post("/api/auth/desktop/claim", json=payload).json()["pending"]
    result = browser.post(
        "/api/auth/desktop/authorize", json={"challenge_id": started["id"], "credential": key.response(options)}
    )
    assert result.status_code == 200, result.text
    assert "set-cookie" not in result.headers
    assert browser.get("/api/auth/me").status_code == 401
    assert (
        client.post("/api/auth/desktop/claim", json=payload | {"verifier": secrets.token_urlsafe(32)}).status_code
        == 400
    )
    result = client.post("/api/auth/desktop/claim", json=payload)
    assert result.status_code == 200 and result.json()["username"] == "admin"
    assert client.post("/api/auth/desktop/claim", json=payload).status_code == 400


def test_desktop_cannot_claim_after_passkey_revocation(client):
    key, result, _ = enroll_key(client)
    verifier = secrets.token_urlsafe(32)
    started = client.post(
        "/api/auth/desktop/start", json={"verifier_hash": hashlib.sha256(verifier.encode()).hexdigest()}
    ).json()
    options = client.get("/api/auth/desktop/" + started["id"]).json()
    assert (
        client.post(
            "/api/auth/desktop/authorize", json={"challenge_id": started["id"], "credential": key.response(options)}
        ).status_code
        == 200
    )
    assert (
        client.post("/api/access/passkeys/" + result.json()["id"] + "/remove", json={"password": PASSWORD}).status_code
        == 200
    )
    assert client.post("/api/auth/desktop/claim", json={"id": started["id"], "verifier": verifier}).status_code == 403


def test_admin_can_reset_lost_passkeys_without_changing_password(client):
    key, result, _ = enroll_key(client)
    users = client.get("/api/access/users").json()
    assert users[0]["passkey_count"] == 1
    assert (
        client.patch(
            "/api/access/users/" + users[0]["id"], json={"role": "admin", "disabled": False, "reset_passkeys": True}
        ).status_code
        == 200
    )
    assert client.post("/api/auth/passkeys/verify", json=login_body(client, key)).status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 200
