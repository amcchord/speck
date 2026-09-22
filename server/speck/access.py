"""Single-organization operator accounts and optional authenticator-based MFA."""

import json
import secrets
import sqlite3
import time
from typing import Literal

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.security import digest, require_admin, require_user

router = APIRouter(prefix="/api/access")


def check_second_factor(conn, row, code):
    if not row["totp_secret"]:
        return True
    if not code.isascii():
        return False
    totp = pyotp.TOTP(unseal(row["totp_secret"]))
    counter = int(time.time() // 30)
    for step in (counter, counter - 1, counter + 1):
        if step > row["totp_counter"] and secrets.compare_digest(totp.at(step * 30), code):
            conn.execute("UPDATE users SET totp_counter=? WHERE id=?", (step, row["id"]))
            return True
    codes = json.loads(row["recovery_codes"])
    hashed = digest(code.strip().upper())
    if hashed in codes:
        codes.remove(hashed)
        conn.execute("UPDATE users SET recovery_codes=? WHERE id=?", (json.dumps(codes), row["id"]))
        audit(conn, row["username"], "account.recovery_code_used")
        return True
    return False


def attempt(key):
    # Persist the attempt independently of any later rollback on invalid credentials.
    with db(write=True) as conn:
        conn.execute("DELETE FROM login_attempts WHERE at<?", (time.time() - 900,))
        if conn.execute("SELECT count(*) FROM login_attempts WHERE ip=?", (key,)).fetchone()[0] >= 10:
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
        conn.execute("INSERT INTO login_attempts VALUES(?,?)", (key, time.time()))


class Proof(BaseModel):
    password: str = Field(max_length=256)
    code: str = Field(default="", max_length=40)


def verify_password(user, proof):
    attempt("account:" + user["user_id"])
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
    try:
        PasswordHasher().verify(row["password_hash"], proof.password)
    except VerificationError:
        raise HTTPException(401, "Incorrect current password") from None
    return row


def verify_proof(conn, row, proof):
    if not check_second_factor(conn, row, proof.code):
        raise HTTPException(401, "Enter a fresh authenticator or recovery code")
    conn.execute("DELETE FROM login_attempts WHERE ip=?", ("account:" + row["id"],))


async def close_user_remotes(user_id):
    from speck.remote import close_session, sessions

    for session_id, session in list(sessions.items()):
        if session.user_id == user_id:
            await close_session(session_id)


@router.get("/me")
def account(user=Depends(require_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        count = conn.execute(
            "SELECT count(*) FROM sessions WHERE user_id=? AND expires>?", (row["id"], time.time())
        ).fetchone()[0]
    return {
        "username": row["username"],
        "role": row["role"],
        "mfa_enabled": bool(row["totp_secret"]),
        "recovery_codes_remaining": len(json.loads(row["recovery_codes"])),
        "sessions": count,
    }


class PasswordChange(Proof):
    new_password: str = Field(min_length=16, max_length=256)


@router.post("/password")
async def change_password(body: PasswordChange, user=Depends(require_user)):
    verify_password(user, body)
    hashed = PasswordHasher().hash(body.new_password)
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        verify_proof(conn, row, body)
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (hashed, row["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (row["id"], user["token_hash"]))
        audit(conn, user["username"], "account.password_changed")
    await close_user_remotes(user["user_id"])
    return {"ok": True}


@router.post("/sessions/revoke")
async def revoke_sessions(user=Depends(require_user)):
    with db(write=True) as conn:
        count = conn.execute(
            "DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["user_id"], user["token_hash"])
        ).rowcount
        audit(conn, user["username"], "account.sessions_revoked", detail={"count": count})
    await close_user_remotes(user["user_id"])
    return {"revoked": count}


@router.post("/totp/setup")
def setup(body: Proof, user=Depends(require_user)):
    verify_password(user, body)
    secret = pyotp.random_base32()
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        if row["totp_secret"]:
            raise HTTPException(409, "Two-factor sign-in is already enabled")
        conn.execute(
            "UPDATE users SET totp_pending=?,totp_pending_until=? WHERE id=?",
            (seal(secret), time.time() + 600, row["id"]),
        )
    return {"secret": secret, "uri": pyotp.TOTP(secret).provisioning_uri(name=user["username"], issuer_name="Speck")}


class Code(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


@router.post("/totp/confirm")
async def confirm(body: Code, user=Depends(require_user)):
    attempt("account:" + user["user_id"])
    codes = [secrets.token_hex(8).upper() for _ in range(10)]
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        if row["totp_secret"] or not row["totp_pending"] or row["totp_pending_until"] < time.time():
            raise HTTPException(409, "Start a new authenticator setup")
        candidate = dict(row) | {"totp_secret": row["totp_pending"], "totp_counter": -1}
        if not check_second_factor(conn, candidate, body.code):
            raise HTTPException(422, "The code did not match. Check your authenticator and its clock.")
        conn.execute(
            "UPDATE users SET totp_secret=totp_pending,totp_pending=NULL,totp_pending_until=NULL,recovery_codes=? WHERE id=?",
            (json.dumps([digest(c) for c in codes]), row["id"]),
        )
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (row["id"], user["token_hash"]))
        conn.execute("DELETE FROM login_attempts WHERE ip=?", ("account:" + row["id"],))
        audit(conn, user["username"], "account.mfa_enabled")
    await close_user_remotes(user["user_id"])
    return {"recovery_codes": codes}


@router.post("/totp/disable")
async def disable(body: Proof, user=Depends(require_user)):
    verify_password(user, body)
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["user_id"],)).fetchone()
        verify_proof(conn, row, body)
        conn.execute(
            "UPDATE users SET totp_secret=NULL,totp_pending=NULL,totp_counter=-1,recovery_codes='[]' WHERE id=?",
            (row["id"],),
        )
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (row["id"], user["token_hash"]))
        audit(conn, user["username"], "account.mfa_disabled")
    await close_user_remotes(user["user_id"])
    return {"ok": True}


@router.get("/users")
def users(user=Depends(require_admin)):
    with db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT id,username,role,disabled,totp_secret IS NOT NULL AS mfa_enabled FROM users ORDER BY username"
            )
        ]


class NewUser(BaseModel):
    username: str = Field(min_length=2, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.@-]+$")
    password: str = Field(min_length=16, max_length=256)
    role: Literal["admin", "operator", "viewer"] = "operator"


@router.post("/users")
def add_user(body: NewUser, user=Depends(require_admin)):
    user_id, hashed = ident(), PasswordHasher().hash(body.password)
    with db(write=True) as conn:
        try:
            conn.execute(
                "INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)",
                (user_id, body.username, hashed, body.role),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "That username already exists") from None
        audit(conn, user["username"], "account.created", detail={"username": body.username, "role": body.role})
    return {"id": user_id}


class UserUpdate(BaseModel):
    role: Literal["admin", "operator", "viewer"]
    disabled: bool
    new_password: str | None = Field(default=None, min_length=16, max_length=256)


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, user=Depends(require_admin)):
    hashed = PasswordHasher().hash(body.new_password) if body.new_password else None
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Account not found")
        if row["role"] == "admin" and not row["disabled"] and (body.role != "admin" or body.disabled):
            if conn.execute("SELECT count(*) FROM users WHERE role='admin' AND disabled=0").fetchone()[0] <= 1:
                raise HTTPException(409, "Keep at least one enabled administrator")
        conn.execute(
            "UPDATE users SET role=?,disabled=?,password_hash=coalesce(?,password_hash) WHERE id=?",
            (body.role, body.disabled, hashed, user_id),
        )
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        if body.disabled or body.role == "viewer":
            conn.execute("UPDATE schedules SET enabled=0 WHERE owner_id=?", (user_id,))
        audit(
            conn,
            user["username"],
            "account.updated",
            detail={
                "username": row["username"],
                "role": body.role,
                "disabled": body.disabled,
                "password_reset": bool(hashed),
            },
        )
    await close_user_remotes(user_id)
    return {"ok": True}
