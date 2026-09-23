"""Provider consoles use the existing Guacamole gateway; provider secrets stay server-side."""

import asyncio
import json
import secrets
import time
from urllib.parse import urlsplit

import websockets
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from speck.config import seal
from speck.db import audit, db, ident
from speck.infrastructure import get_connection, resolve
from speck.proxmox_connector import authenticate
from speck.remote import Session, close_session, expire_session, sessions
from speck.security import require_user
from speck.slide import Slide

router = APIRouter(prefix="/api/infrastructure")
workers = set()


class Console(BaseModel):
    kind: str
    resource_id: str


def spawn(coro):
    task = asyncio.create_task(coro)
    workers.add(task)
    task.add_done_callback(workers.discard)


@router.post("/connections/{connection_id}/console")
async def start(connection_id: str, body: Console, user=Depends(require_user)):
    cfg = get_connection(connection_id)
    row = await resolve(cfg, body.kind, body.resource_id)
    if sum(s.user_id == user["user_id"] for s in sessions.values()) >= 4:
        raise HTTPException(429, "Close an existing remote session first")
    if any(s.config.get("infra_target") == (connection_id, body.kind, body.resource_id) for s in sessions.values()):
        raise HTTPException(409, "This provider console is already open; close it before reconnecting")
    password = ""
    upstream = None
    connector = None
    if cfg["provider"] == "proxmox" and body.kind == "qemu" and cfg.get("connector"):
        if row.get("status") != "running":
            raise HTTPException(409, "Start the VM before opening its console")
        with db() as conn:
            connector = next(
                (
                    dict(r)
                    for r in conn.execute(
                        "SELECT * FROM proxmox_connectors WHERE connection_id=? AND revoked=0 AND last_seen>?",
                        (connection_id, time.time() - 50),
                    )
                    if r["hostname"].split(".")[0].lower() == row["node"].lower()
                ),
                None,
            )
        if not connector:
            raise HTTPException(409, "Enroll an online Proxmox host agent on this VM’s current host to use its console")
        password = secrets.token_hex(4)
    elif cfg["provider"] == "slide" and body.kind == "virt":
        row = await Slide(cfg).request("GET", "restore/virt/" + body.resource_id)
        if row.get("state") != "running":
            raise HTTPException(409, "Start the virtual machine before opening its console")
        if not row.get("vnc_enabled"):
            raise HTTPException(409, "Enable the VM console first")
        # URL is supplied only by the authenticated Slide API, never by the browser.
        upstream = next(
            (v["websocket_uri"] for v in row.get("vnc", []) if v.get("websocket_uri", "").startswith("wss://")), None
        )
        if not upstream or urlsplit(upstream).username:
            raise HTTPException(409, "Slide has not published a secure WebSocket console for this VM")
        password = row.get("vnc_password", "")
    else:
        raise HTTPException(409, "Provider consoles support Proxmox VMs with a host agent and Slide virtual machines")
    session = Session(
        ident(),
        None,
        user["user_id"],
        secrets.token_urlsafe(32),
        {
            "protocol": "vnc",
            "password": password,
            "infra_target": (connection_id, body.kind, body.resource_id),
            "connector_id": connector["id"] if connector else None,
        },
        1440,
        900,
        actor=user["username"],
    )
    session.tcp = asyncio.get_running_loop().create_future()

    async def connected(reader, writer):
        if session.tcp.done():
            writer.close()
            return
        session.tcp.set_result((reader, writer))
        await session.finished.wait()
        writer.close()

    session.listener = await asyncio.start_server(connected, "127.0.0.1", 0)
    sessions[session.id] = session
    spawn(expire_session(session.id))
    try:
        if connector:
            with db(write=True) as conn:
                conn.execute(
                    "INSERT INTO proxmox_requests VALUES(?,?,?,'queued',NULL,NULL,?,?)",
                    (
                        ident(),
                        connector["id"],
                        seal(
                            json.dumps(
                                {
                                    "method": "POST",
                                    "path": "/speck/console",
                                    "args": {
                                        "session_id": session.id,
                                        "secret": session.secret,
                                        "password": password,
                                        "vmid": int(body.resource_id),
                                    },
                                }
                            )
                        ),
                        time.time(),
                        time.time() + 40,
                    ),
                )
        else:
            spawn(slide_tunnel(session, upstream))
        with db(write=True) as conn:
            audit(
                conn,
                user["username"],
                "infrastructure.console.started",
                detail={
                    "connection_id": connection_id,
                    "kind": body.kind,
                    "resource_id": body.resource_id,
                    "session_id": session.id,
                },
            )
    except Exception:
        await close_session(session.id)
        raise
    return {"id": session.id, "protocol": "vnc"}


async def slide_tunnel(session, upstream):
    tasks = []
    try:
        async with websockets.connect(
            upstream, open_timeout=20, max_size=8 * 1024 * 1024, proxy=None, subprotocols=["binary"]
        ) as ws:
            session.ready.set()
            reader, writer = await asyncio.wait_for(asyncio.shield(session.tcp), 120)

            async def receive():
                async for message in ws:
                    if not isinstance(message, bytes):
                        raise ValueError("Expected binary console data")
                    writer.write(message)
                    await writer.drain()

            async def send():
                while data := await reader.read(65536):
                    await ws.send(data)

            tasks = [asyncio.create_task(receive()), asyncio.create_task(send())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED, timeout=7200)
    except (OSError, ValueError, TimeoutError, websockets.WebSocketException):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await close_session(session.id)


@router.websocket("/agent/consoles/{session_id}")
async def agent_console(socket: WebSocket, session_id: str):
    session = sessions.get(session_id)
    try:
        connector = authenticate(socket)
        if (
            not session
            or session.config.get("connector_id") != connector["id"]
            or session.agent
            or not secrets.compare_digest(socket.headers.get("x-speck-tunnel-secret", ""), session.secret)
        ):
            raise HTTPException(403, "Console rejected")
    except HTTPException:
        await socket.close(code=1008)
        return
    await socket.accept()
    session.agent = socket
    session.ready.set()
    tasks = []
    try:
        reader, writer = await asyncio.wait_for(asyncio.shield(session.tcp), 120)

        async def receive():
            while True:
                data = await socket.receive_bytes()
                if len(data) > 2 * 1024 * 1024:
                    raise ValueError("Console frame too large")
                writer.write(data)
                await writer.drain()

        async def send():
            while data := await reader.read(65536):
                await socket.send_bytes(data)

        tasks = [asyncio.create_task(receive()), asyncio.create_task(send())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED, timeout=7200)
    except (OSError, ValueError, TimeoutError, WebSocketDisconnect):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await close_session(session.id)
