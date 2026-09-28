"""Reusable three-stage runbooks. Every stage requires its own reviewed request."""

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.operations import Batch, enqueue_batch, prepare_batch
from speck.security import require_user

router = APIRouter(prefix="/api/maintenance")


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS maintenance_runbooks(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL,spec TEXT NOT NULL,created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance_runs(id TEXT PRIMARY KEY,runbook_id TEXT NOT NULL,owner TEXT NOT NULL,spec TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL);
    """)


class Runbook(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    stages: list[Batch] = Field(min_length=3, max_length=3)
    confirmed: bool = False


@router.get("/runbooks")
def listing(user=Depends(require_user)):
    with db() as conn:
        return [
            dict(r) | {"spec": json.loads(unseal(r["spec"]))}
            for r in conn.execute("SELECT * FROM maintenance_runbooks ORDER BY created DESC LIMIT 100")
        ]


@router.post("/runbooks")
def create(body: Runbook, user=Depends(require_user)):
    if not body.confirmed:
        raise HTTPException(422, "Review and confirm the runbook")
    if any(
        s.kind not in ("patch.scan", "inspection.software", "inspection.processes", "inspection.disks")
        for s in (body.stages[0], body.stages[2])
    ):
        raise HTTPException(422, "Gather and verify stages must use built-in read-only collectors")
    if any(s.device_ids != body.stages[0].device_ids for s in body.stages):
        raise HTTPException(422, "All stages must use the same explicitly reviewed target set")
    with db(write=True) as conn:
        for stage in body.stages:
            prepare_batch(conn, stage)
        key = ident()
        conn.execute(
            "INSERT INTO maintenance_runbooks VALUES(?,?,?,?,?)",
            (key, body.name, user["user_id"], seal(body.model_dump_json()), time.time()),
        )
        audit(
            conn, user["username"], "runbook.created", detail={"runbook_id": key, "targets": body.stages[0].device_ids}
        )
    return {"id": key}


@router.post("/runbooks/{runbook_id}/runs")
def start(runbook_id: str, user=Depends(require_user)):
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM maintenance_runbooks WHERE id=?", (runbook_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Runbook not found")
        key = ident()
        conn.execute(
            "INSERT INTO maintenance_runs VALUES(?,?,?,?,?,?)",
            (key, runbook_id, user["user_id"], row["spec"], "[]", time.time()),
        )
        audit(conn, user["username"], "runbook.started", detail={"run_id": key, "runbook_id": runbook_id})
    return {"id": key}


@router.get("/runs")
def runs(user=Depends(require_user)):
    with db() as conn:
        result = []
        for r in conn.execute("SELECT * FROM maintenance_runs ORDER BY created DESC LIMIT 100"):
            value = dict(r) | {"spec": json.loads(unseal(r["spec"])), "state": json.loads(r["state"])}
            value["receipts"] = [
                [
                    dict(j)
                    for j in conn.execute(
                        "SELECT j.id,j.status,j.device_id FROM batch_jobs b JOIN jobs j ON j.id=b.job_id WHERE b.batch_id=?",
                        (b,),
                    )
                ]
                for b in value["state"]
            ]
            result.append(value)
        return result


class Review(BaseModel):
    stage: int = Field(ge=0, le=2)
    confirmed: bool = False


def stage_request(conn, run_id, body, user):
    row = conn.execute("SELECT * FROM maintenance_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    if row["owner"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(403, "Only the run owner or administrator can continue")
    state = json.loads(row["state"])
    if len(state) < body.stage:
        raise HTTPException(409, "Complete and review the preceding stage first")
    if len(state) > body.stage:
        return row, state, None, []
    if state:
        states = [
            (r[0], json.loads(r[1] or "{}"))
            for r in conn.execute(
                "SELECT j.status,j.result FROM batch_jobs b JOIN jobs j ON j.id=b.job_id WHERE b.batch_id=?",
                (state[-1],),
            )
        ]
        if not states or any(
            s != "complete" or result.get("exit_code") != 0 or result.get("error") or result.get("truncated")
            for s, result in states
        ):
            raise HTTPException(
                409,
                "The preceding stage has not completed successfully on every target. Inspect its receipts before retrying; no later stage was sent.",
            )
    spec = Runbook.model_validate_json(unseal(row["spec"]))
    operation = spec.stages[body.stage].model_copy(update={"request_id": "runbook:" + run_id + ":" + str(body.stage)})
    prepared = prepare_batch(conn, operation)
    return row, state, operation, prepared


@router.post("/runs/{run_id}/preview")
def preview(run_id: str, body: Review, user=Depends(require_user)):
    with db() as conn:
        _, state, operation, prepared = stage_request(conn, run_id, body, user)
    if operation is None:
        return {"existing_batch": state[body.stage], "targets": []}
    return {
        "phase": ("Gather evidence", "Reviewed change", "Post-change verification")[body.stage],
        "kind": operation.kind,
        "targets": [{"id": d["id"], "label": d["label"], "script": p["script"], "timeout": t} for d, p, t in prepared],
    }


@router.post("/runs/{run_id}/steps")
def execute(run_id: str, body: Review, user=Depends(require_user)):
    if not body.confirmed:
        raise HTTPException(422, "Review and confirm this exact stage")
    with db(write=True) as conn:
        _, state, operation, prepared = stage_request(conn, run_id, body, user)
        if operation is None:
            return {"id": state[body.stage], "existing": True}
        batch_id = enqueue_batch(conn, operation, prepared, user["username"], time.time())
        state.append(batch_id)
        conn.execute("UPDATE maintenance_runs SET state=? WHERE id=?", (json.dumps(state), run_id))
        audit(
            conn,
            user["username"],
            "runbook.stage",
            detail={"run_id": run_id, "stage": body.stage, "batch_id": batch_id},
        )
    return {"id": batch_id, "existing": False}
