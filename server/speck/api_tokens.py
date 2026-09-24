"""Personal API tokens for automation and LLM agents.

A token acts as its creator, never above the creator's current role. Scopes
narrow it further: ``read`` allows GET requests, ``operate`` caps the token at
operator writes, ``admin`` allows the creator's administrator writes, and the
independent ``keys:read`` / ``keys:write`` scopes gate the credential vault.
Tokens are bearer credentials: they skip cookie CSRF checks, cannot manage
sign-in, sessions, passkeys or other tokens, and cannot open browser sessions.
"""

import json
import re
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from speck.db import audit, db, ident
from speck.security import digest

router = APIRouter(prefix="/api/tokens")
PREFIX = "speck_pat_"
TOKEN = re.compile(r"Bearer (speck_pat_[A-Za-z0-9_-]{43})")
SCOPES = {
    "read": "Read everything the creator can see (GET requests only)",
    "operate": "Operator changes: jobs, commands, files and provider reads",
    "admin": "Administrator changes: infrastructure, DNS, public IPs and VM provisioning",
    "keys:read": "List vault entries and reveal their secret values",
    "keys:write": "Provision, store, update and delete vault entries",
}
ROLE_SCOPES = ("read", "operate", "admin")
RANK = {"viewer": 0, "operator": 1, "admin": 2}
# Tokens never manage identity or open interactive browser sessions.
BLOCKED = ("/api/auth/", "/api/access/", "/api/tokens", "/api/integrations/tokens", "/api/enrollments")
INTERACTIVE = re.compile(
    r"^/api/(devices/[^/]+/remote/(sessions|native\.rdp)|remote/sessions|infrastructure/connections/[^/]+/console)"
)
RATE_PER_MINUTE = 600
_rates: dict[str, list] = {}


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS api_tokens(
      id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),
      scopes TEXT NOT NULL,key_prefixes TEXT NOT NULL DEFAULT '[]',created REAL NOT NULL,expires REAL NOT NULL,
      revoked REAL,last_used REAL,last_ip TEXT,uses INTEGER NOT NULL DEFAULT 0);
    """)


def presented(request):
    """The bearer API token in a request, or None when the caller uses a session."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer " + PREFIX):
        return None
    match = TOKEN.fullmatch(auth)
    if not match:
        raise HTTPException(401, "Malformed Speck API token")
    return match.group(1)


def authenticate(token, request=None):
    """Resolve a token to the acting user with its effective role and scopes."""
    now = time.time()
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT t.*,u.username,u.role AS owner_role FROM api_tokens t JOIN users u ON u.id=t.owner_id "
            "WHERE t.token_hash=? AND t.revoked IS NULL AND t.expires>? AND u.disabled=0",
            (digest(token), now),
        ).fetchone()
        if not row:
            raise HTTPException(401, "API token is invalid, expired, revoked or its account is disabled")
        window = _rates.setdefault(row["id"], [int(now // 60), 0])
        if window[0] != int(now // 60):
            window[:] = [int(now // 60), 0]
        window[1] += 1
        if window[1] > RATE_PER_MINUTE:
            raise HTTPException(429, "API token rate limit exceeded; retry next minute")
        client = request.client.host if request and request.client else ""
        conn.execute(
            "UPDATE api_tokens SET last_used=?,last_ip=?,uses=uses+1 WHERE id=?", (now, client[:64], row["id"])
        )
    scopes = json.loads(row["scopes"])
    owner = row["owner_role"]
    cap = "admin" if "admin" in scopes else "operator" if "operate" in scopes else owner
    role = owner if RANK[owner] <= RANK[cap] else cap
    return {
        "user_id": row["owner_id"],
        # Audit and rate-limit history attribute token activity separately.
        "username": row["username"] + " (API: " + row["name"] + ")",
        "owner": row["username"],
        "role": role,
        "csrf": "",
        "token_hash": "api-token:" + row["id"],
        "expires": row["expires"],
        "via": "token",
        "token_id": row["id"],
        "token_name": row["name"],
        "scopes": scopes,
        "key_prefixes": json.loads(row["key_prefixes"]),
        "read_only": not ({"operate", "admin"} & set(scopes)),
        "general": bool(set(ROLE_SCOPES) & set(scopes)),
    }


def enforce(user, request):
    """Apply token-specific limits before the ordinary role checks."""
    path, method = request.url.path, request.method
    if path == "/api/auth/me" and method == "GET":
        return
    if path.startswith(BLOCKED) or INTERACTIVE.match(path):
        raise HTTPException(403, "API tokens cannot manage sign-in, tokens or interactive sessions")
    if path.startswith("/api/keys"):
        return  # The vault checks keys:read / keys:write itself.
    if not user["general"]:
        raise HTTPException(403, "This token only has vault scopes; add read, operate or admin for this endpoint")
    if user["read_only"] and method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(403, "This token is read-only; add the operate or admin scope for changes")


def public(row, owner=None):
    item = {k: row[k] for k in ("id", "name", "created", "expires", "revoked", "last_used", "last_ip", "uses")}
    item["scopes"] = json.loads(row["scopes"])
    item["key_prefixes"] = json.loads(row["key_prefixes"])
    item["owner"] = owner if owner is not None else row["username"]
    item["active"] = row["revoked"] is None and row["expires"] > time.time()
    return item


def session_only(request: Request):
    from speck.security import require_user

    user = require_user(request)
    if user.get("via") == "token":
        raise HTTPException(403, "Manage API tokens from a signed-in session")
    return user


class NewToken(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[str] = Field(min_length=1, max_length=len(SCOPES))
    expires_days: int = Field(default=90, ge=1, le=365)
    key_prefixes: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("name")
    @classmethod
    def printable(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError("Use a printable token name")
        return value

    @field_validator("scopes")
    @classmethod
    def known(cls, value):
        unknown = set(value) - set(SCOPES)
        if unknown:
            raise ValueError("Unknown scopes: " + ", ".join(sorted(unknown)))
        return sorted(set(value))

    @field_validator("key_prefixes")
    @classmethod
    def prefixes(cls, value):
        cleaned = sorted({v.strip() for v in value if v.strip()})
        if any(not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", v) for v in cleaned):
            raise ValueError("Key prefixes may contain letters, digits, dots, dashes and underscores")
        return cleaned


@router.get("/scopes")
def scopes(user=Depends(session_only)):
    return {"scopes": SCOPES, "role": user["role"]}


@router.get("")
def list_tokens(user=Depends(session_only)):
    with db() as conn:
        rows = conn.execute(
            "SELECT t.*,u.username FROM api_tokens t JOIN users u ON u.id=t.owner_id "
            + ("" if user["role"] == "admin" else "WHERE t.owner_id=? ")
            + "ORDER BY t.created DESC LIMIT 200",
            () if user["role"] == "admin" else (user["user_id"],),
        ).fetchall()
    return [public(r) for r in rows]


@router.post("")
def create_token(body: NewToken, user=Depends(session_only)):
    if user["role"] == "viewer" and set(body.scopes) - {"read"}:
        raise HTTPException(403, "Viewer accounts can create read-only tokens")
    if {"admin", "keys:read", "keys:write"} & set(body.scopes) and user["role"] != "admin":
        raise HTTPException(403, "Only administrators can grant admin or vault scopes")
    if "operate" in body.scopes and user["role"] == "viewer":
        raise HTTPException(403, "Viewer accounts cannot grant operate")
    token = PREFIX + secrets.token_urlsafe(32)
    token_id, now = ident(), time.time()
    with db(write=True) as conn:
        active = conn.execute(
            "SELECT count(*) FROM api_tokens WHERE owner_id=? AND revoked IS NULL AND expires>?", (user["user_id"], now)
        ).fetchone()[0]
        if active >= 50:
            raise HTTPException(409, "Revoke an existing API token before creating another")
        conn.execute(
            "INSERT INTO api_tokens(id,token_hash,name,owner_id,scopes,key_prefixes,created,expires) VALUES(?,?,?,?,?,?,?,?)",
            (
                token_id,
                digest(token),
                body.name,
                user["user_id"],
                json.dumps(body.scopes),
                json.dumps(body.key_prefixes),
                now,
                now + body.expires_days * 86400,
            ),
        )
        audit(
            conn,
            user["username"],
            "api_token.created",
            detail={"id": token_id, "name": body.name, "scopes": body.scopes, "key_prefixes": body.key_prefixes},
        )
        row = conn.execute("SELECT * FROM api_tokens WHERE id=?", (token_id,)).fetchone()
    return public(row, user["username"]) | {"token": token}


@router.delete("/{token_id}")
def revoke_token(token_id: str, user=Depends(session_only)):
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM api_tokens WHERE id=?", (token_id,)).fetchone()
        if not row or (user["role"] != "admin" and row["owner_id"] != user["user_id"]):
            raise HTTPException(404, "API token not found")
        conn.execute("UPDATE api_tokens SET revoked=coalesce(revoked,?) WHERE id=?", (time.time(), token_id))
        audit(conn, user["username"], "api_token.revoked", detail={"id": token_id, "name": row["name"]})
    _rates.pop(token_id, None)
    return {"ok": True}


def whoami(user):
    """Identity summary shared by /api/agent/whoami and the MCP server."""
    item = {"username": user.get("owner", user["username"]), "role": user["role"], "via": user.get("via", "session")}
    if user.get("via") == "token":
        item |= {
            "token": user["token_name"],
            "token_id": user["token_id"],
            "scopes": user["scopes"],
            "read_only": user["read_only"],
            "key_prefixes": user["key_prefixes"],
            "expires": user["expires"],
        }
    return item


def issue(username, name, scopes, days=1, key_prefixes=()):
    """Create a token for an existing account from the server host (break-glass automation)."""
    body = NewToken(name=name, scopes=scopes, expires_days=days, key_prefixes=list(key_prefixes))
    with db(write=True) as conn:
        user = conn.execute("SELECT * FROM users WHERE username=? AND disabled=0", (username,)).fetchone()
        if not user:
            raise SystemExit("No enabled account named " + username)
        if {"admin", "keys:read", "keys:write"} & set(body.scopes) and user["role"] != "admin":
            raise SystemExit("Only administrators can hold admin or vault scopes")
        token = PREFIX + secrets.token_urlsafe(32)
        token_id, now = ident(), time.time()
        conn.execute(
            "INSERT INTO api_tokens(id,token_hash,name,owner_id,scopes,key_prefixes,created,expires) VALUES(?,?,?,?,?,?,?,?)",
            (token_id, digest(token), body.name, user["id"], json.dumps(body.scopes), json.dumps(body.key_prefixes),
             now, now + body.expires_days * 86400),
        )
        audit(conn, "host:" + username, "api_token.created",
              detail={"id": token_id, "name": body.name, "scopes": body.scopes, "via": "host command"})
    return token_id, token


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Create a Speck API token from the server host. Prints the token once.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--scopes", required=True, help="Comma-separated: " + ", ".join(SCOPES))
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--key-prefix", action="append", default=[])
    parser.add_argument("--revoke", metavar="TOKEN_ID", help="Revoke a token instead of creating one")
    options = parser.parse_args()
    if options.revoke:
        with db(write=True) as conn:
            conn.execute("UPDATE api_tokens SET revoked=coalesce(revoked,?) WHERE id=?", (time.time(), options.revoke))
            audit(conn, "host:" + options.username, "api_token.revoked", detail={"id": options.revoke, "via": "host command"})
        print(json.dumps({"revoked": options.revoke}))
    else:
        created_id, created = issue(options.username, options.name, options.scopes.split(","), options.days, options.key_prefix)
        print(json.dumps({"id": created_id, "token": created}))
