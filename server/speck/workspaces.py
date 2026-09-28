"""Reviewed organizational contexts; associations never grant resource permissions.

No tenant is inferred from host names. Existing endpoint/provider authorization is
still required when a linked resource is opened. This is not a tenant sandbox.
"""

import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.security import require_user

router = APIRouter(prefix="/api/workspaces")


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS customer_workspaces(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
        revision INTEGER NOT NULL, spec TEXT NOT NULL, updated REAL NOT NULL);
    """)


class Association(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["machine", "infrastructure", "site", "domain", "key", "schedule"]
    id: str = Field(min_length=1, max_length=512)
    connection: str = Field(default="", max_length=512)
    resourceKind: str = Field(default="", max_length=100)
    provider: str = Field(default="", max_length=100)
    pinned: bool = False


class Workspace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    associations: list[Association] = Field(default_factory=list, max_length=500)
    members: list[str] = Field(default_factory=list, max_length=100)
    retest_days: int = Field(default=30, ge=1, le=365)
    revision: int = Field(default=0, ge=0)
    confirmed: bool = False


def public(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "owner_id": row["owner_id"],
        "revision": row["revision"],
        "updated": row["updated"],
        **json.loads(unseal(row["spec"])),
    }


def visible(row, user):
    return user["role"] == "admin" or row["owner_id"] == user["user_id"] or user["user_id"] in row["members"]


@router.get("")
def listing(user=Depends(require_user)):
    with db() as conn:
        rows = [public(r) for r in conn.execute("SELECT * FROM customer_workspaces ORDER BY name")]
    return [r for r in rows if visible(r, user)]


@router.get("/catalog")
async def catalog(user=Depends(require_user)):
    from speck.fleet import inventory
    from speck.infrastructure import connections
    from speck.scheduling import schedules

    rows = []
    data = await inventory(compact=True, user=user)
    for machine in data["machines"]:
        rows.append(
            {
                "kind": "machine",
                "id": machine["id"],
                "label": machine["label"],
                "description": "Recovery copy" if machine.get("restored_from") else machine.get("agent_status", ""),
            }
        )
        for r in machine.get("resources", []):
            rows.append(
                {
                    "kind": "infrastructure",
                    "id": str(r["id"]),
                    "connection": r["connection_id"],
                    "resourceKind": r["kind"],
                    "provider": r["provider"],
                    "label": r["name"],
                    "description": r.get("connection_name", ""),
                }
            )
    rows.extend(
        {"kind": "schedule", "id": s["id"], "label": s["name"], "description": "Reviewed schedule"}
        for s in schedules(user)
    )
    from speck.dns import cached_domains

    rows.extend(
        {
            "kind": "domain",
            "id": d.get("domain") or d.get("name"),
            "label": d.get("domain") or d.get("name"),
            "description": "DNS zone",
        }
        for d in cached_domains()[0]
    )
    from speck.unifi_observability import sites

    try:
        data_sites = await sites(user)
        rows.extend(
            {
                "kind": "site",
                "id": str(s["id"]),
                "connection": s["console_id"],
                "label": s["name"],
                "description": "Network site",
            }
            for s in data_sites.get("sites", [])
        )
    except HTTPException:
        pass  # Existing reviewed associations survive unavailable providers.
    # Configuration associations are explicit; reading a workspace never reveals credentials.
    if user["role"] == "admin":
        from speck.vault import list_entries

        rows.extend(
            {"kind": "key", "id": k["name"], "label": k["name"], "description": "Credential metadata"}
            for k in list_entries(user=user)
        )
    return {
        "items": list({identity(r): r for r in rows}.values()),
        "connections": [{"id": c["id"], "name": c["name"]} for c in connections(user)],
        "sources": data["connections"],
    }


def identity(value):
    return tuple(value.get(k, "") for k in ("kind", "id", "connection", "resourceKind", "provider"))


@router.post("")
async def create(body: Workspace, user=Depends(require_user)):
    return await save(None, body, user)


@router.put("/{workspace_id}")
async def update(workspace_id: str, body: Workspace, user=Depends(require_user)):
    return await save(workspace_id, body, user)


async def save(workspace_id, body, user):
    if not body.confirmed:
        raise HTTPException(422, "Review the exact associations and confirm")
    # Validate exact catalog identities, including the connection for provider IDs.
    known = {identity(row) for row in (await catalog(user))["items"]}
    chosen = [a.model_dump() for a in body.associations]
    if len({identity(a) for a in chosen}) != len(chosen):
        raise HTTPException(422, "Duplicate associations")
    with db(write=True) as conn:
        previous = (
            conn.execute("SELECT * FROM customer_workspaces WHERE id=?", (workspace_id,)).fetchone()
            if workspace_id
            else None
        )
        if workspace_id and not previous:
            raise HTTPException(404, "Workspace not found")
        if previous and previous["owner_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(403, "Only the owner or an administrator can edit associations")
        if previous and previous["revision"] != body.revision:
            raise HTTPException(409, "Workspace changed; reopen and review current associations")
        retained = {identity(a) for a in public(previous)["associations"]} if previous else set()
        if any(identity(a) not in known | retained for a in chosen):
            raise HTTPException(422, "Association is not in current inventory; refresh the catalog")
        if any(a["kind"] == "key" for a in chosen) and user["role"] != "admin":
            raise HTTPException(403, "Credential associations require an administrator")
        for member in body.members:
            if not conn.execute("SELECT 1 FROM users WHERE id=? AND disabled=0", (member,)).fetchone():
                raise HTTPException(422, "Choose an active workspace member")
        workspace_id = workspace_id or ident()
        revision = previous["revision"] + 1 if previous else 1
        spec = {"associations": chosen, "members": sorted(set(body.members)), "retest_days": body.retest_days}
        conn.execute(
            "INSERT OR REPLACE INTO customer_workspaces VALUES(?,?,?,?,?,?)",
            (
                workspace_id,
                body.name,
                previous["owner_id"] if previous else user["user_id"],
                revision,
                seal(json.dumps(spec)),
                time.time(),
            ),
        )
        audit(
            conn,
            user["username"],
            "workspace.reviewed",
            detail={
                "workspace_id": workspace_id,
                "revision": revision,
                "association_count": len(chosen),
                "member_count": len(body.members),
            },
        )
    return {"id": workspace_id, "revision": revision}
