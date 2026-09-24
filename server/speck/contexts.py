"""Machine handoff files for LLM agents (formerly AustinLand's LLMContextAccess files).

A handoff is a Markdown document describing one machine: how to reach it, its
DNS wiring, a system snapshot and a dedicated SSH private key. Because it embeds
a private key it is sealed at rest and treated like a vault entry: listing is
available to administrators, and reading the document requires ``keys:read`` for
API tokens and is audited.
"""

import re
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from speck.config import seal, unseal
from speck.db import audit, db
from speck.security import require_admin, require_user
from speck.vault import access

router = APIRouter(prefix="/api/context")
FILENAME = re.compile(r"[A-Za-z0-9._-]{1,160}\.md")


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS context_files(
      filename TEXT PRIMARY KEY,machine TEXT NOT NULL DEFAULT '',domain TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',markdown TEXT NOT NULL,size INTEGER NOT NULL,created REAL NOT NULL,created_by TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'speck');
    """)


def readers(request: Request):
    return access(require_user(request))


def writers(request: Request):
    return access(require_user(request), write=True)


def parse_name(filename):
    """Machine and domain from ``LLMContextAccess-<machine>-<domain>.md``."""
    stem = filename.removesuffix(".md").removeprefix("LLMContextAccess-")
    match = re.fullmatch(r"(.+)-([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)", stem)
    return (match.group(1), match.group(2)) if match else (stem, "")


def save(conn, filename, markdown, actor, *, provider="", target="", created=None, origin="speck", replace=False):
    machine, domain = parse_name(filename)
    if not replace and conn.execute("SELECT 1 FROM context_files WHERE filename=?", (filename,)).fetchone():
        return False
    conn.execute(
        "INSERT OR REPLACE INTO context_files VALUES(?,?,?,?,?,?,?,?,?,?)",
        (filename, machine, domain, provider, target, seal(markdown), len(markdown.encode()), created or time.time(), actor, origin),
    )
    return True


@router.get("/files")
def files(user=Depends(require_admin)):
    with db() as conn:
        rows = conn.execute(
            "SELECT filename,machine,domain,provider,target,size,created,created_by,origin FROM context_files ORDER BY created DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/files/{filename}")
def read(filename: str, user=Depends(readers)):
    """The Markdown handoff (contains a private SSH key). Audited."""
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM context_files WHERE filename=?", (filename,)).fetchone()
        if not row:
            raise HTTPException(404, "Handoff file not found")
        audit(conn, user["username"], "context.read", detail={"filename": filename})
    return {"filename": filename, "markdown": unseal(row["markdown"])}


@router.get("/files/{filename}/raw", response_class=PlainTextResponse)
def raw(filename: str, user=Depends(readers)):
    return PlainTextResponse(read(filename, user)["markdown"], media_type="text/markdown")


@router.delete("/files/{filename}")
def delete(filename: str, user=Depends(writers)):
    with db(write=True) as conn:
        if not conn.execute("DELETE FROM context_files WHERE filename=?", (filename,)).rowcount:
            raise HTTPException(404, "Handoff file not found")
        audit(conn, user["username"], "context.deleted", detail={"filename": filename})
    return {"ok": True}


class ImportFile(BaseModel):
    filename: str = Field(pattern=FILENAME.pattern)
    markdown: str = Field(min_length=1, max_length=512 * 1024)
    created: float | None = None


class FileImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: list[ImportFile] = Field(max_length=500)


@router.post("/import")
def import_files(body: FileImport, user=Depends(writers)):
    created, skipped = [], []
    with db(write=True) as conn:
        for item in body.files:
            if save(conn, item.filename, item.markdown, user["username"], created=item.created, origin="austinland"):
                created.append(item.filename)
            else:
                skipped.append(item.filename)
        audit(conn, user["username"], "context.imported", detail={"created": created, "skipped": skipped})
    return {"created": created, "skipped": skipped}
