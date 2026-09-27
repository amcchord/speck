"""Independent provider detail reads; inventories and write controls remain usable on failures."""

import asyncio
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from speck import infrastructure as infra
from speck.security import require_user
from speck.slide import Slide

router = APIRouter(prefix="/api/infrastructure")


async def section(read):
    try:
        value = await asyncio.wait_for(read(), 25)
        return {"state": "available", "data": infra.public_data(value)}
    except (HTTPException, TimeoutError):
        return {"state": "unavailable", "message": "Not reported. Check provider connectivity and permissions."}


async def protection_page(cfg, rid, resource, offset=0):
    result = await Slide(cfg).request("GET", resource, params={"agent_id": rid, "limit": 25, "offset": offset})
    rows = result.get("data") or []
    # Fail closed if the provider ignored the agent filter, including cross-account ID reuse.
    if any(r.get("agent_id") != rid for r in rows):
        raise HTTPException(502, "Provider returned history for a different protected system")
    cursor = (result.get("pagination") or {}).get("next_offset")
    if cursor is not None and (type(cursor) is not int or cursor <= offset):
        raise HTTPException(502, "Provider returned an invalid history cursor")
    return {"rows": rows, "next_offset": cursor, "offset": offset}


@router.get("/connections/{connection_id}/resources/{kind}/{rid}/explore")
async def explore(connection_id: str, kind: str, rid: str, user=Depends(require_user)):
    cfg = infra.get_connection(connection_id)
    await infra.resolve(cfg, kind, rid)
    if cfg["provider"] == "linode" and kind == "instance":
        names = ["disks", "configs", "volumes", "firewalls"]
        root = "/linode/instances/" + infra.segment(rid) + "/"

        async def read(name):
            # Bounded first provider page. The UI reports pagination rather than implying completeness.
            return await section(lambda: infra.provider_request(cfg, "GET", root + name, params={"page_size": 100}))
    elif cfg["provider"] == "slide" and kind == "protected":
        names = ["backup", "snapshot"]

        async def read(name):
            return await section(lambda: protection_page(cfg, rid, name))
    else:
        raise HTTPException(404, "Additional provider details are not available for this resource")
    result = await asyncio.gather(*(read(name) for name in names))
    return {"sections": dict(zip(names, result)), "checked_at": time.time()}


@router.get("/connections/{connection_id}/resources/protected/{rid}/history")
async def history(
    connection_id: str,
    rid: str,
    resource: Literal["backup", "snapshot"],
    offset: int = Query(default=0, ge=0, le=100000),
    user=Depends(require_user),
):
    cfg = infra.get_connection(connection_id)
    if cfg["provider"] != "slide":
        raise HTTPException(404, "This connection does not provide backup history")
    await infra.resolve(cfg, "protected", rid)
    return infra.public_data(await protection_page(cfg, rid, resource, offset))
