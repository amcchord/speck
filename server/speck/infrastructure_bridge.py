"""Run on the AustinLand host, behind an SSH tunnel; never expose its vault.

SPECK_BRIDGE_TOKEN_FILE points to a mode-600 random bearer token. Bind uvicorn
only to 127.0.0.1. No arbitrary upstream paths, URLs, context files or key exports.
"""

import os
import secrets
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from speck.infrastructure_catalog import bridge_request
from speck.slide import safe_provider

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class BridgeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict = Field(default_factory=dict)


@app.post("/operations/{operation_id}")
async def run(operation_id: str, body: BridgeBody, request: Request):
    expected = Path(os.environ["SPECK_BRIDGE_TOKEN_FILE"]).read_text().strip()
    if len(expected) < 32 or not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + expected):
        raise HTTPException(401, "Bridge authentication required")
    if operation_id in ("proxmox-delete", "proxmox-migrate") and body.args.get("vmid") in (9000, 9001):
        raise HTTPException(409, "Protected template")
    method, path, args = bridge_request(operation_id, body.args)
    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=False, trust_env=False) as client:
            # Fixed localhost destination. Caller cannot address AustinLand's keys or context APIs.
            r = await client.request(
                method,
                "http://127.0.0.1:8472" + path,
                params=args if method == "GET" else None,
                json=args if method != "GET" else None,
            )
        if r.status_code >= 300:
            raise HTTPException(
                502, "AustinLand returned HTTP " + str(r.status_code) + ". Inspect its state before retrying writes."
            )
        return safe_provider(r.json())
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            502, "AustinLand is unavailable; a write outcome may be unknown. Inspect before retrying."
        ) from None


# The default deployment uses an outbound worker rather than a listening bridge.
# Kept in this module so the exact same operation allowlist covers both transports.
def atomic_json(path, value):
    import json
    import tempfile

    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".speck-bridge-")
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


async def worker(config_path, enroll=False):
    import asyncio
    import hashlib
    import json
    import platform
    import sys
    import uuid
    from urllib.parse import urlsplit

    async def api(client, cfg, method, suffix, body=None):
        response = await client.request(
            method,
            cfg["server"] + "/api/infrastructure/agent" + suffix,
            headers={"Authorization": "Bearer " + cfg.get("token", ""), "X-Speck-Hardware": cfg["hardware"]},
            json=body,
        )
        if response.status_code >= 300:
            raise RuntimeError("Control plane HTTP " + str(response.status_code))
        return response.json()

    cfg = json.load(sys.stdin) if enroll else json.loads(config_path.read_text())
    parsed = urlsplit(cfg["server"])
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("An HTTPS Speck origin is required")
    cfg["server"] = cfg["server"].rstrip("/")
    hardware = hashlib.sha256((platform.node() + ":" + str(uuid.getnode())).encode()).hexdigest()
    if enroll:
        if config_path.exists():
            raise RuntimeError("Existing enrollment preserved")
        cfg["hardware"] = hardware
    elif cfg["hardware"] != hardware:
        raise RuntimeError("Enrollment belongs to a different host")
    async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as control:
        if enroll:
            result = await api(
                control,
                cfg,
                "POST",
                "/enroll",
                {
                    "token": cfg["token"],
                    "hardware": hardware,
                    "hostname": platform.node(),
                    "version": "austinland-0.1.0",
                },
            )
            cfg.update(result)
            atomic_json(config_path, cfg)
            return

        async def heartbeat():
            while True:
                try:
                    await api(control, cfg, "POST", "/heartbeat")
                except (httpx.HTTPError, RuntimeError):
                    pass
                await asyncio.sleep(15)

        heartbeat_task = asyncio.create_task(heartbeat())
        journal = config_path.with_name("request.json")
        try:
            while True:
                try:
                    if journal.exists():
                        await api(control, cfg, "POST", "/result", json.loads(journal.read_text()))
                        journal.unlink()
                    job = await api(control, cfg, "GET", "/next")
                    if not job:
                        continue
                    receipt = {"id": job["id"], "lease": job["lease"], "ok": False, "data": None}
                    atomic_json(journal, receipt)
                    try:
                        if job["method"] != "POST" or not job["path"].startswith("/operations/"):
                            raise ValueError("Unsupported request")
                        operation_id = job["path"].removeprefix("/operations/")
                        args = job.get("args", {}).get("args", {})
                        if operation_id in ("proxmox-delete", "proxmox-migrate") and args.get("vmid") in (9000, 9001):
                            raise ValueError("Protected template")
                        method, path, args = bridge_request(operation_id, args)
                        async with httpx.AsyncClient(timeout=600, follow_redirects=False, trust_env=False) as local:
                            response = await local.request(
                                method,
                                "http://127.0.0.1:8472" + path,
                                params=args if method == "GET" else None,
                                json=args if method != "GET" else None,
                            )
                        if response.status_code >= 300:
                            raise ValueError("AustinLand request failed")
                        receipt.update(ok=True, data=safe_provider(response.json()))
                    except (httpx.HTTPError, ValueError, HTTPException):
                        pass
                    atomic_json(journal, receipt)
                except (httpx.HTTPError, RuntimeError):
                    await asyncio.sleep(5)
        finally:
            heartbeat_task.cancel()


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Speck outbound AustinLand connector")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--enroll", action="store_true")
    parser.add_argument("--run", action="store_true")
    options = parser.parse_args()
    asyncio.run(worker(options.config, options.enroll))
