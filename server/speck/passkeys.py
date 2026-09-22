"""Discoverable, user-verified WebAuthn credentials for human operators."""

import json
import secrets
import sqlite3
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from speck.access import Proof, attempt, close_user_remotes, verify_password, verify_proof
from speck.config import origin
from speck.db import audit, db, ident
from speck.security import digest, issue_session, require_user

router = APIRouter()
TTL = 120


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS passkeys(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,
          credential_id TEXT UNIQUE NOT NULL,public_key BLOB NOT NULL,sign_count INTEGER NOT NULL,
          transports TEXT NOT NULL,backed_up INTEGER NOT NULL,created REAL NOT NULL,last_used REAL);
        CREATE TABLE IF NOT EXISTS desktop_signins(
          id TEXT PRIMARY KEY,verifier_hash TEXT NOT NULL,expires REAL NOT NULL,
          public_key TEXT NOT NULL,code TEXT NOT NULL,user_id TEXT,passkey_id TEXT);
        CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
        CREATE TABLE IF NOT EXISTS passkey_challenges(
          id TEXT PRIMARY KEY,kind TEXT NOT NULL,challenge BLOB NOT NULL,expires REAL NOT NULL,
          user_id TEXT,session_hash TEXT,account_state TEXT);
    """)
    if "passkey_id" not in {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}:
        conn.execute("ALTER TABLE sessions ADD COLUMN passkey_id TEXT")


def rp_id():
    parsed = urlsplit(origin())
    if parsed.scheme != "https" and parsed.hostname != "localhost":
        raise HTTPException(503, "Passkeys require an HTTPS server address")
    return parsed.hostname


def same_origin(request):
    if request.headers.get("origin") != origin():
        raise HTTPException(403, "Origin rejected")


def account_state(row):
    return digest(row["password_hash"] + ":" + (row["totp_secret"] or ""))


def save_challenge(conn, kind, challenge, user=None, row=None):
    challenge_id = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM passkey_challenges WHERE expires<?", (time.time(),))
    conn.execute(
        "INSERT INTO passkey_challenges VALUES(?,?,?,?,?,?,?)",
        (
            digest(challenge_id),
            kind,
            challenge,
            time.time() + TTL,
            user["user_id"] if user else None,
            user["token_hash"] if user else None,
            account_state(row) if row else None,
        ),
    )
    return challenge_id


def consume(challenge_id, kind, user=None):
    # Commit consumption even when cryptographic verification fails. BEGIN IMMEDIATE
    # makes simultaneous completion attempts mutually exclusive across workers.
    with db(write=True) as conn:
        row = conn.execute("DELETE FROM passkey_challenges WHERE id=? RETURNING *", (digest(challenge_id),)).fetchone()
    if not row or row["kind"] != kind or row["expires"] < time.time():
        raise HTTPException(400, "Passkey request expired or already used. Try again.")
    if user and (row["user_id"] != user["user_id"] or row["session_hash"] != user["token_hash"]):
        raise HTTPException(403, "Passkey request belongs to another session")
    return row


class Credential(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=128)
    credential: dict


def validate_credential(value):
    try:
        if len(json.dumps(value)) > 32768:
            raise ValueError()
        client = json.loads(base64url_to_bytes(value["response"]["clientDataJSON"]))
        if client.get("crossOrigin", False) or client.get("topOrigin"):
            raise ValueError()
        # Canonical encoding prevents alternate encodings bypassing ID uniqueness.
        encoded = bytes_to_base64url(base64url_to_bytes(value["id"]))
        if value["id"] != encoded or value["rawId"] != encoded or value["type"] != "public-key":
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "Invalid passkey response") from None


@router.post("/api/auth/passkeys/options")
def authentication_options(request: Request):
    same_origin(request)
    attempt("passkey-options:" + request.client.host)
    options = generate_authentication_options(
        rp_id=rp_id(), timeout=60000, user_verification=UserVerificationRequirement.REQUIRED
    )
    with db(write=True) as conn:
        challenge_id = save_challenge(conn, "login", options.challenge)
    return {"challenge_id": challenge_id, "publicKey": json.loads(options_to_json(options))}


@router.post("/api/auth/passkeys/verify")
def authenticate(body: Credential, request: Request, response: Response):
    same_origin(request)
    attempt_key = "passkey-login:" + request.client.host
    attempt(attempt_key)
    challenge = consume(body.challenge_id, "login")
    validate_credential(body.credential)
    with db(write=True) as conn:
        row, key = verify_assertion(conn, body.credential, challenge)
        conn.execute(
            "DELETE FROM login_attempts WHERE ip IN (?,?)", (attempt_key, "passkey-options:" + request.client.host)
        )
        return issue_session(conn, row, response, passkey_id=key["id"])


def verify_assertion(conn, credential, challenge):
    key = conn.execute("SELECT * FROM passkeys WHERE credential_id=?", (credential["id"],)).fetchone()
    row = conn.execute("SELECT * FROM users WHERE id=? AND disabled=0", (key["user_id"],)).fetchone() if key else None
    try:
        if not row:
            raise ValueError()
        handle = credential["response"].get("userHandle")
        if not handle or base64url_to_bytes(handle) != row["id"].encode():
            raise ValueError()
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge["challenge"],
            expected_rp_id=rp_id(),
            expected_origin=origin(),
            credential_public_key=key["public_key"],
            credential_current_sign_count=key["sign_count"],
            require_user_verification=True,
        )
    except Exception:
        raise HTTPException(401, "Passkey sign-in failed. Try again or use your password.") from None
    conn.execute(
        "UPDATE passkeys SET sign_count=?,last_used=?,backed_up=? WHERE id=?",
        (verified.new_sign_count, time.time(), verified.credential_backed_up, key["id"]),
    )
    return row, key


class DesktopStart(BaseModel):
    verifier_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


@router.post("/api/auth/desktop/start")
def desktop_start(body: DesktopStart, request: Request):
    same_origin(request)
    attempt("desktop-start:" + request.client.host)
    options = generate_authentication_options(
        rp_id=rp_id(), timeout=60000, user_verification=UserVerificationRequirement.REQUIRED
    )
    code = secrets.token_hex(3).upper()
    with db(write=True) as conn:
        challenge_id = save_challenge(conn, "desktop", options.challenge)
        conn.execute("DELETE FROM desktop_signins WHERE expires<?", (time.time(),))
        conn.execute(
            "INSERT INTO desktop_signins VALUES(?,?,?,?,?,NULL,NULL)",
            (digest(challenge_id), body.verifier_hash, time.time() + TTL, options_to_json(options), code),
        )
    return {"id": challenge_id, "code": code}


@router.get("/api/auth/desktop/{request_id}")
def desktop_options(request_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM desktop_signins WHERE id=? AND expires>? AND user_id IS NULL",
            (digest(request_id), time.time()),
        ).fetchone()
    if not row:
        raise HTTPException(404, "This desktop sign-in expired. Start again in Speck Desktop.")
    return {"publicKey": json.loads(row["public_key"]), "code": row["code"]}


@router.post("/api/auth/desktop/authorize")
def desktop_authorize(body: Credential, request: Request):
    same_origin(request)
    attempt("desktop-authorize:" + request.client.host)
    challenge = consume(body.challenge_id, "desktop")
    validate_credential(body.credential)
    with db(write=True) as conn:
        row, key = verify_assertion(conn, body.credential, challenge)
        if not conn.execute(
            "UPDATE desktop_signins SET user_id=?,passkey_id=? WHERE id=? AND expires>? AND user_id IS NULL",
            (row["id"], key["id"], digest(body.challenge_id), time.time()),
        ).rowcount:
            raise HTTPException(400, "This desktop sign-in expired. Start again.")
        conn.execute("DELETE FROM login_attempts WHERE ip=?", ("desktop-authorize:" + request.client.host,))
    return {"ok": True}


class DesktopClaim(BaseModel):
    id: str = Field(min_length=32, max_length=128)
    verifier: str = Field(min_length=43, max_length=128)


@router.post("/api/auth/desktop/claim")
def desktop_claim(body: DesktopClaim, request: Request, response: Response):
    same_origin(request)
    with db(write=True) as conn:
        pending = conn.execute(
            "SELECT * FROM desktop_signins WHERE id=? AND expires>?", (digest(body.id), time.time())
        ).fetchone()
        if not pending or not secrets.compare_digest(pending["verifier_hash"], digest(body.verifier)):
            raise HTTPException(400, "Desktop sign-in expired or invalid. Try again.")
        if not pending["user_id"]:
            return {"pending": True}
        # Re-check access at claim time, so revocation between approval and pickup wins.
        row = conn.execute("SELECT * FROM users WHERE id=? AND disabled=0", (pending["user_id"],)).fetchone()
        key = conn.execute(
            "SELECT * FROM passkeys WHERE id=? AND user_id=?", (pending["passkey_id"], pending["user_id"])
        ).fetchone()
        if not row or not key:
            raise HTTPException(403, "Account access changed. Start again.")
        conn.execute("DELETE FROM desktop_signins WHERE id=?", (pending["id"],))
        conn.execute("DELETE FROM login_attempts WHERE ip=?", ("desktop-start:" + request.client.host,))
        return issue_session(conn, row, response, passkey_id=key["id"])


@router.get("/api/access/passkeys")
def list_keys(user=Depends(require_user)):
    with db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT id,name,created,last_used,backed_up FROM passkeys WHERE user_id=? ORDER BY created",
                (user["user_id"],),
            )
        ]


@router.post("/api/access/passkeys/options")
def registration_options(body: Proof, user=Depends(require_user)):
    verified_hash = verify_password(user, body)["password_hash"]
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        verify_proof(conn, row, body, verified_hash)
        existing = conn.execute("SELECT credential_id FROM passkeys WHERE user_id=?", (user["user_id"],)).fetchall()
        if len(existing) >= 20:
            raise HTTPException(409, "Remove an unused passkey before adding another")
        options = generate_registration_options(
            rp_id=rp_id(),
            rp_name="Speck",
            user_id=user["user_id"].encode(),
            user_name=user["username"],
            timeout=60000,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                require_resident_key=True,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["credential_id"])) for r in existing
            ],
        )
        challenge_id = save_challenge(conn, "register", options.challenge, user, row)
    return {"challenge_id": challenge_id, "publicKey": json.loads(options_to_json(options))}


class Registration(Credential):
    name: str = Field(min_length=1, max_length=80)


@router.post("/api/access/passkeys/verify")
def register(body: Registration, user=Depends(require_user)):
    challenge = consume(body.challenge_id, "register", user)
    validate_credential(body.credential)
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge["challenge"],
            expected_rp_id=rp_id(),
            expected_origin=origin(),
            require_user_verification=True,
        )
    except Exception:
        raise HTTPException(400, "Could not verify this passkey. Start again.") from None
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Give this passkey a name")
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=? AND disabled=0", (user["user_id"],)).fetchone()
        active = conn.execute(
            "SELECT 1 FROM sessions WHERE token_hash=? AND expires>?", (user["token_hash"], time.time())
        ).fetchone()
        if not row or not active or account_state(row) != challenge["account_state"]:
            raise HTTPException(403, "Account access changed. Sign in again.")
        if conn.execute("SELECT count(*) FROM passkeys WHERE user_id=?", (user["user_id"],)).fetchone()[0] >= 20:
            raise HTTPException(409, "Remove an unused passkey before adding another")
        key_id = ident()
        transports = body.credential["response"].get("transports", [])
        if not isinstance(transports, list) or len(transports) > 10:
            raise HTTPException(400, "Invalid authenticator transports")
        transports = [v for v in transports if v in ("usb", "nfc", "ble", "internal", "hybrid")]
        try:
            conn.execute(
                "INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,?,?,NULL)",
                (
                    key_id,
                    user["user_id"],
                    name,
                    bytes_to_base64url(verified.credential_id),
                    verified.credential_public_key,
                    verified.sign_count,
                    json.dumps(transports),
                    verified.credential_backed_up,
                    time.time(),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "This passkey is already registered") from None
        audit(conn, user["username"], "account.passkey_added", detail={"id": key_id, "name": name})
    return {"id": key_id}


class KeyName(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.patch("/api/access/passkeys/{key_id}")
def rename(key_id: str, body: KeyName, user=Depends(require_user)):
    if not body.name.strip():
        raise HTTPException(422, "Give this passkey a name")
    with db(write=True) as conn:
        if not conn.execute(
            "UPDATE passkeys SET name=? WHERE id=? AND user_id=?", (body.name.strip(), key_id, user["user_id"])
        ).rowcount:
            raise HTTPException(404, "Passkey not found")
        audit(conn, user["username"], "account.passkey_renamed", detail={"id": key_id})
    return {"ok": True}


@router.post("/api/access/passkeys/{key_id}/remove")
async def remove(key_id: str, body: Proof, user=Depends(require_user)):
    verified_hash = verify_password(user, body)["password_hash"]
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        verify_proof(conn, row, body, verified_hash)
        if not conn.execute("DELETE FROM passkeys WHERE id=? AND user_id=?", (key_id, user["user_id"])).rowcount:
            raise HTTPException(404, "Passkey not found")
        conn.execute("DELETE FROM sessions WHERE passkey_id=?", (key_id,))
        conn.execute("DELETE FROM passkey_challenges WHERE user_id=?", (user["user_id"],))
        audit(conn, user["username"], "account.passkey_removed", detail={"id": key_id})
    await close_user_remotes(user["user_id"])
    return {"ok": True}
