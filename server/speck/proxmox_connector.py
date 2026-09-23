"""Outbound-only Proxmox agents: one-use enrollment, leased requests, no write replay."""

import asyncio
import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.security import digest, require_admin, require_user

router = APIRouter(prefix="/api/infrastructure")


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS proxmox_enrollments(token_hash TEXT PRIMARY KEY,connection_id TEXT NOT NULL,expires REAL NOT NULL,used REAL);
    CREATE TABLE IF NOT EXISTS proxmox_connectors(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,hostname TEXT NOT NULL,hardware TEXT NOT NULL,last_seen REAL NOT NULL,version TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS proxmox_requests(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL,lease_hash TEXT,result TEXT,created REAL NOT NULL,deadline REAL NOT NULL);
    """)


class Enrollment(BaseModel):
    connection_id: str


@router.post("/connectors/enrollments")
def enrollment(body: Enrollment, user=Depends(require_admin)):
    from speck.infrastructure import get_connection

    cfg = get_connection(body.connection_id)
    if cfg["provider"] not in ("proxmox", "austinland") or not cfg.get("connector"):
        raise HTTPException(409, "Choose an outbound agent connection")
    token = secrets.token_urlsafe(40)
    with db(write=True) as conn:
        conn.execute(
            "INSERT INTO proxmox_enrollments VALUES(?,?,?,NULL)", (digest(token), cfg["id"], time.time() + 900)
        )
        audit(conn, user["username"], "infrastructure.connector.enrollment", detail={"connection_id": cfg["id"]})
    return {"token": token, "expires": time.time() + 900}


class Enroll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=30, max_length=128)
    hostname: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    hardware: str = Field(pattern=r"^[a-f0-9]{64}$")
    version: str = Field(max_length=32)


@router.post("/agent/enroll")
def enroll(body: Enroll):
    credential = secrets.token_urlsafe(40)
    connector_id = ident()
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT * FROM proxmox_enrollments WHERE token_hash=? AND used IS NULL AND expires>?",
            (digest(body.token), time.time()),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Enrollment expired or already used")
        if not conn.execute("SELECT 1 FROM infrastructure_connections WHERE id=?", (row["connection_id"],)).fetchone():
            raise HTTPException(401, "Connection was removed")
        if conn.execute(
            "SELECT 1 FROM proxmox_connectors WHERE connection_id=? AND hardware=? AND revoked=0",
            (row["connection_id"], body.hardware),
        ).fetchone():
            raise HTTPException(409, "Host is already enrolled")
        conn.execute("UPDATE proxmox_enrollments SET used=? WHERE token_hash=?", (time.time(), digest(body.token)))
        conn.execute(
            "INSERT INTO proxmox_connectors VALUES(?,?,?,?,?,?,?,0)",
            (
                connector_id,
                row["connection_id"],
                digest(credential),
                body.hostname,
                body.hardware,
                time.time(),
                body.version,
            ),
        )
        audit(
            conn,
            "connector:" + connector_id,
            "infrastructure.connector.enrolled",
            detail={"connection_id": row["connection_id"], "hostname": body.hostname},
        )
    return {"id": connector_id, "token": credential}


def authenticate(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    hardware = request.headers.get("x-speck-hardware", "")
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT * FROM proxmox_connectors WHERE token_hash=? AND hardware=? AND revoked=0",
            (digest(token), hardware),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Connector authentication required")
        if not conn.execute("SELECT 1 FROM infrastructure_connections WHERE id=?", (row["connection_id"],)).fetchone():
            raise HTTPException(401, "Connection removed")
        conn.execute("UPDATE proxmox_connectors SET last_seen=? WHERE id=?", (time.time(), row["id"]))
    return dict(row)


@router.get("/connectors")
def connectors(user=Depends(require_user)):
    with db() as conn:
        return [
            dict(r) | {"online": not r["revoked"] and r["last_seen"] > time.time() - 50}
            for r in conn.execute(
                "SELECT id,connection_id,hostname,last_seen,version,revoked FROM proxmox_connectors ORDER BY hostname"
            )
        ]


@router.delete("/connectors/{connector_id}")
async def revoke(connector_id: str, user=Depends(require_admin)):
    with db(write=True) as conn:
        conn.execute("UPDATE proxmox_connectors SET revoked=1 WHERE id=?", (connector_id,))
        conn.execute(
            "UPDATE proxmox_requests SET status='unknown' WHERE connector_id=? AND status IN ('queued','leased')",
            (connector_id,),
        )
        audit(conn, user["username"], "infrastructure.connector.revoked", detail={"connector_id": connector_id})
    from speck.remote import sessions, close_session

    for session_id, session in list(sessions.items()):
        if session.config.get("connector_id") == connector_id:
            await close_session(session_id)
    return {"ok": True}


@router.post("/agent/heartbeat")
def heartbeat(connector=Depends(authenticate)):
    return {"ok": True}


@router.get("/agent/next")
async def next_request(connector=Depends(authenticate)):
    for _ in range(40):
        with db(write=True) as conn:
            # Re-check revocation during the long poll; never dispatch after revocation.
            active = conn.execute("SELECT revoked FROM proxmox_connectors WHERE id=?", (connector["id"],)).fetchone()
            if not active or active["revoked"]:
                raise HTTPException(401, "Connector revoked")
            row = conn.execute(
                "SELECT * FROM proxmox_requests WHERE connector_id=? AND status='queued' AND deadline>? ORDER BY created LIMIT 1",
                (connector["id"], time.time()),
            ).fetchone()
            if row:
                lease = secrets.token_urlsafe(32)
                conn.execute(
                    "UPDATE proxmox_requests SET status='leased',lease_hash=? WHERE id=?", (digest(lease), row["id"])
                )
                return {"id": row["id"], "lease": lease, **json.loads(unseal(row["request"]))}
        await asyncio.sleep(0.5)
    return None


class Result(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    lease: str = Field(max_length=128)
    ok: bool
    data: object = None


@router.post("/agent/result")
def result(body: Result, connector=Depends(authenticate)):
    # Bound durable results; stderr is never accepted from a privileged CLI.
    encoded = json.dumps({"ok": body.ok, "data": body.data})
    if len(encoded) > 8 * 1024 * 1024:
        raise HTTPException(413, "Connector result too large")
    with db(write=True) as conn:
        row = conn.execute(
            "SELECT * FROM proxmox_requests WHERE id=? AND connector_id=?", (body.id, connector["id"])
        ).fetchone()
        if not row or not secrets.compare_digest(row["lease_hash"] or "", digest(body.lease)):
            raise HTTPException(403, "Request lease rejected")
        if row["status"] == "complete":
            return {"ok": True}
        conn.execute("UPDATE proxmox_requests SET status='complete',result=? WHERE id=?", (seal(encoded), body.id))
    return {"ok": True}


async def request(cfg, method, path, body=None, params=None):
    now = time.time()
    timeout = 620 if cfg["provider"] == "austinland" else 80
    with db(write=True) as conn:
        agent = conn.execute(
            "SELECT * FROM proxmox_connectors WHERE connection_id=? AND revoked=0 AND last_seen>? ORDER BY last_seen DESC LIMIT 1",
            (cfg["id"], now - 50),
        ).fetchone()
        if not agent:
            raise HTTPException(502, "No infrastructure agent is online for this connection")
        request_id = ident()
        conn.execute(
            "INSERT INTO proxmox_requests VALUES(?,?,?,'queued',NULL,NULL,?,?)",
            (
                request_id,
                agent["id"],
                seal(json.dumps({"method": method, "path": path, "args": body or params or {}})),
                now,
                now + timeout,
            ),
        )
        conn.execute("DELETE FROM proxmox_requests WHERE created<?", (now - 86400,))
    try:
        for _ in range(timeout * 2):
            with db() as conn:
                row = conn.execute("SELECT * FROM proxmox_requests WHERE id=?", (request_id,)).fetchone()
            if row and row["status"] == "complete":
                value = json.loads(unseal(row["result"]))
                if not value["ok"]:
                    raise HTTPException(
                        502,
                        "The provider rejected the request or the agent could not confirm its result. Inspect provider activity before retrying a write.",
                    )
                return value["data"]
            if row and row["status"] == "unknown":
                break
            await asyncio.sleep(0.5)
    finally:
        with db(write=True) as conn:
            conn.execute(
                "UPDATE proxmox_requests SET status='unknown' WHERE id=? AND status IN ('queued','leased')",
                (request_id,),
            )
    raise HTTPException(
        502, "The infrastructure agent did not confirm the result. Inspect tasks before retrying a write."
    )
