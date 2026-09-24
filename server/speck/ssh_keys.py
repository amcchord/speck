"""SSH keypairs for provisioning and agent handoffs (formerly AustinLand's /api/ssh).

Public keys are ordinary inventory: operators can list them and paste them into
``authorized_keys`` when creating machines. Speck generates Ed25519 keypairs on
the server and seals the private half; retrieving it requires an administrator
(and ``keys:read`` for API tokens) and is audited. Imported public-only keys
(for example a workstation's own key) never carry a private half.
"""

import base64
import hashlib
import json
import re
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from speck.config import seal, unseal
from speck.db import audit, db
from speck.security import require_admin, require_user
from speck.vault import access

router = APIRouter(prefix="/api/ssh")
NAME = re.compile(r"[A-Za-z0-9._-]{1,80}")
PUBLIC = re.compile(r"(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]{40,16384}( [^\r\n]{0,200})?")


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS ssh_keys(
      name TEXT PRIMARY KEY,public_key TEXT NOT NULL,fingerprint TEXT NOT NULL,comment TEXT NOT NULL DEFAULT '',
      private_key TEXT,purpose TEXT NOT NULL DEFAULT '',created REAL NOT NULL,created_by TEXT NOT NULL,origin TEXT NOT NULL DEFAULT 'speck');
    """)


def fingerprint(public_key):
    blob = base64.b64decode(public_key.split()[1])
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def identity(public_key):
    parts = public_key.split()
    return " ".join(parts[:2]) if len(parts) >= 2 else public_key


def valid_public(value):
    value = " ".join(value.strip().split())
    if not PUBLIC.fullmatch(value):
        raise HTTPException(422, "Provide one OpenSSH public key line")
    try:
        fingerprint(value)
    except (ValueError, IndexError):
        raise HTTPException(422, "The public key is not valid base64") from None
    return value


def generate(comment):
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()
    return private, public + " " + comment


def create(conn, name, comment, purpose, actor):
    """Generate and store a keypair; returns the public key line."""
    if conn.execute("SELECT 1 FROM ssh_keys WHERE name=?", (name,)).fetchone():
        raise HTTPException(409, f"A key named '{name}' already exists")
    private, public = generate(comment or name)
    conn.execute(
        "INSERT INTO ssh_keys VALUES(?,?,?,?,?,?,?,?,?)",
        (name, public, fingerprint(public), comment or name, seal(private), purpose, time.time(), actor, "speck"),
    )
    audit(conn, actor, "ssh.generated", detail={"name": name, "fingerprint": fingerprint(public)})
    return public


def private_key(name):
    with db() as conn:
        row = conn.execute("SELECT private_key FROM ssh_keys WHERE name=?", (name,)).fetchone()
    return unseal(row["private_key"]) if row and row["private_key"] else None


async def linode_keys():
    """(connection config, account SSH keys) for the first Linode connection, or (None, [])."""
    from speck import infrastructure as infra

    with db() as conn:
        row = conn.execute("SELECT id FROM infrastructure_connections WHERE provider='linode' ORDER BY name LIMIT 1").fetchone()
    if not row:
        return None, []
    cfg = infra.get_connection(row["id"])
    try:
        return cfg, await infra.linode_list(cfg, "/profile/sshkeys")
    except HTTPException:
        return cfg, []


def public_row(row, registered):
    return {
        "name": row["name"],
        "type": row["public_key"].split()[0],
        "public_key": row["public_key"],
        "comment": row["comment"],
        "fingerprint": row["fingerprint"],
        "has_private": bool(row["private_key"]),
        "purpose": row["purpose"],
        "created": row["created"],
        "created_by": row["created_by"],
        "origin": row["origin"],
        "registered_as": registered.get(identity(row["public_key"])),
    }


@router.get("/keys")
async def keys(user=Depends(require_user)):
    """Stored public keys, whether a private half is held, and Linode registration."""
    _, account = await linode_keys()
    registered = {identity(k["ssh_key"]): k["label"] for k in account}
    with db() as conn:
        rows = conn.execute("SELECT * FROM ssh_keys ORDER BY lower(name)").fetchall()
    return [public_row(r, registered) for r in rows]


class Generate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=NAME.pattern)
    comment: str = Field(default="", max_length=120, pattern=r"^[^\r\n]*$")
    purpose: str = Field(default="", max_length=200)


@router.post("/generate")
def generate_key(body: Generate, user=Depends(require_admin)):
    with db(write=True) as conn:
        public = create(conn, body.name, body.comment.strip(), body.purpose.strip(), user["username"])
    return {"ok": True, "name": body.name, "public_key": public, "fingerprint": fingerprint(public)}


def key_readers(request: Request):
    return access(require_user(request))


@router.get("/keys/{name}/private")
def reveal(name: str, user=Depends(key_readers)):
    """The OpenSSH private key. Administrators only; audited."""
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM ssh_keys WHERE name=?", (name,)).fetchone()
        if not row:
            raise HTTPException(404, "SSH key not found")
        if not row["private_key"]:
            raise HTTPException(404, "Speck holds only the public half of this key")
        audit(conn, user["username"], "ssh.private_revealed", detail={"name": name})
    return {"name": name, "public_key": row["public_key"], "private_key": unseal(row["private_key"])}


class Register(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=NAME.pattern)
    label: str = Field(default="", max_length=64)


@router.post("/register")
async def register(body: Register, user=Depends(require_admin)):
    """Add a stored public key to the Linode account profile."""
    from speck import infrastructure as infra

    with db() as conn:
        row = conn.execute("SELECT * FROM ssh_keys WHERE name=?", (body.name,)).fetchone()
    if not row:
        raise HTTPException(404, "SSH key not found")
    cfg, account = await linode_keys()
    if not cfg:
        raise HTTPException(409, "Add a Linode connection under Infrastructure first")
    if any(identity(k["ssh_key"]) == identity(row["public_key"]) for k in account):
        return {"ok": True, "already_registered": True}
    await infra.provider_request(cfg, "POST", "/profile/sshkeys", {"label": body.label or body.name, "ssh_key": row["public_key"]})
    with db(write=True) as conn:
        audit(conn, user["username"], "ssh.registered", detail={"name": body.name, "provider": "linode"})
    return {"ok": True, "already_registered": False}


@router.delete("/keys/{name}")
def remove(name: str, user=Depends(require_admin)):
    with db(write=True) as conn:
        if not conn.execute("DELETE FROM ssh_keys WHERE name=?", (name,)).rowcount:
            raise HTTPException(404, "SSH key not found")
        audit(conn, user["username"], "ssh.deleted", detail={"name": name})
    return {"ok": True}


class ImportKey(BaseModel):
    name: str = Field(pattern=NAME.pattern)
    public_key: str = Field(max_length=16384)
    private_key: str = Field(default="", max_length=65536)
    comment: str = Field(default="", max_length=200)
    purpose: str = Field(default="", max_length=200)
    created: float | None = None


class KeyImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keys: list[ImportKey] = Field(max_length=500)


@router.post("/import")
def import_keys(body: KeyImport, request: Request):
    """Import public keys, optionally with private halves (requires keys:write for tokens)."""
    user = require_user(request)
    if user["role"] != "admin":
        raise HTTPException(403, "Administrator access required")
    if any(k.private_key for k in body.keys):
        access(user, write=True)
    created, skipped = [], []
    with db(write=True) as conn:
        for item in body.keys:
            public = valid_public(item.public_key)
            if item.private_key and "PRIVATE KEY" not in item.private_key:
                raise HTTPException(422, "Private keys must be PEM/OpenSSH encoded: " + item.name)
            if conn.execute("SELECT 1 FROM ssh_keys WHERE name=?", (item.name,)).fetchone():
                skipped.append(item.name)
                continue
            parts = public.split(" ", 2)
            conn.execute(
                "INSERT INTO ssh_keys VALUES(?,?,?,?,?,?,?,?,?)",
                (item.name, public, fingerprint(public), item.comment or (parts[2] if len(parts) > 2 else ""),
                 seal(item.private_key) if item.private_key else None, item.purpose, item.created or time.time(),
                 user["username"], "austinland"),
            )
            created.append(item.name)
        audit(conn, user["username"], "ssh.imported", detail={"created": created, "skipped": skipped,
                                                            "with_private": [k.name for k in body.keys if k.private_key and k.name in created]})
    return {"created": created, "skipped": skipped}


def public_keys_json():
    """Compact list for agent guides."""
    with db() as conn:
        return json.dumps([dict(name=r["name"], public_key=r["public_key"]) for r in conn.execute("SELECT name,public_key FROM ssh_keys")])
