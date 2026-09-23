"""Bounded, independent Proxmox reads for a human-oriented machine view."""

import asyncio
import time

from fastapi import HTTPException

from speck.db import db


def guest_agent_enabled(config):
    value = config.get("agent", "0")
    if isinstance(value, bool):
        return value
    if isinstance(value, dict):
        return bool(value.get("enabled"))
    return str(value).split(",")[0] in ("1", "enabled=1")


def console_capability(cfg, row, config=None):
    if row["type"] != "qemu":
        return {"available": False, "reason": "Screen access is available for virtual machines."}
    if row.get("template"):
        return {"available": False, "reason": "Clone this template to use its screen."}
    if row.get("status") != "running":
        return {"available": False, "reason": "Start the virtual machine to view its screen."}
    display = str((config or {}).get("vga", "std")).split(",")[0].removeprefix("type=")
    if display == "none" or display.startswith("serial"):
        return {
            "available": False,
            "reason": "This VM has no graphical display. Screen preview and control require a graphical display in Proxmox.",
        }
    if cfg.get("connector"):
        with db() as conn:
            online = any(
                r["hostname"].split(".")[0].lower() == row["node"].lower()
                for r in conn.execute(
                    "SELECT hostname FROM proxmox_connectors WHERE connection_id=? AND revoked=0 AND last_seen>?",
                    (cfg["id"], time.time() - 50),
                )
            )
        if not online:
            return {"available": False, "reason": "An online Proxmox host agent is needed on this VM’s current host."}
    return {"available": True, "reason": "Screen access works without an agent inside the guest."}


async def read_sections(cfg, requests):
    from speck.infrastructure import provider_request, public_data

    async def read(name, path, params):
        try:
            data = await asyncio.wait_for(provider_request(cfg, "GET", path, params=params), 25)
            return name, {"state": "available", "data": public_data(data)}
        except (HTTPException, TimeoutError):
            # No provider error bodies or credentials in user-visible diagnostics.
            return name, {
                "state": "unavailable",
                "message": "Not reported. Check provider permissions and connectivity.",
            }

    return dict(await asyncio.gather(*(read(name, path, params) for name, path, params in requests)))


async def machine_detail(cfg, row):
    from speck.infrastructure import pve_path, resources, segment

    kind, path = row["type"], pve_path(row)
    requests = [
        ("status", path + ("/status" if kind == "node" else "/status/current"), None),
        (
            "recent_tasks",
            "/nodes/" + segment(row["node"]) + "/tasks",
            {"limit": 20, **({"vmid": row["vmid"]} if kind != "node" else {})},
        ),
    ]
    if kind == "node":
        requests.extend([(name, path + "/" + name, None) for name in ("storage", "network")])
    else:
        requests.append(("configuration", path + "/config", None))
    sections = await read_sections(cfg, requests)
    config = sections.get("configuration", {}).get("data") or {}
    return {
        "resource": resources(cfg, [row])[0],
        "checked_at": time.time(),
        **{name: section.get("data") for name, section in sections.items()},
        "availability": {name: {k: v for k, v in section.items() if k != "data"} for name, section in sections.items()},
        "capabilities": {
            "console": console_capability(cfg, row, config),
            "guest_agent": guest_agent_enabled(config),
            "guest_agent_config_known": sections.get("configuration", {}).get("state") == "available",
        },
    }


async def guest_details(cfg, row):
    from speck.infrastructure import pve_path, provider_request

    if row["type"] != "qemu" or row.get("status") != "running" or row.get("template"):
        return {"state": "unavailable", "message": "Guest details require a running virtual machine."}
    path = pve_path(row)
    try:
        config = await asyncio.wait_for(provider_request(cfg, "GET", path + "/config"), 25)
    except (HTTPException, TimeoutError):
        return {"state": "unavailable", "message": "Guest-agent configuration could not be read."}
    if not guest_agent_enabled(config):
        return {
            "state": "disabled",
            "message": "Enable the QEMU guest agent in Proxmox and install it inside the guest to report its OS, IP addresses and filesystems.",
        }
    sections = await read_sections(
        cfg,
        [
            (name, path + "/agent/" + suffix, None)
            for name, suffix in (
                ("os", "get-osinfo"),
                ("network", "network-get-interfaces"),
                ("filesystems", "get-fsinfo"),
            )
        ],
    )
    return {
        "state": "available" if any(s["state"] == "available" for s in sections.values()) else "unavailable",
        "message": "The QEMU guest agent must be running and allowed to report guest information.",
        "sections": sections,
    }
