"""Durable occurrences share a transaction with command enqueueing."""

import asyncio
import contextlib
import hashlib
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.monitoring import evaluate
from speck.operations import Batch, all_templates, enqueue_batch, prepare_batch
from speck.security import require_user

router = APIRouter(prefix="/api/schedules")
log = logging.getLogger(__name__)


class Schedule(BaseModel):
    operation: Batch
    first_run: float = Field(gt=0, allow_inf_nan=False)
    interval_seconds: int = Field(default=0, ge=0, le=2592000)
    confirmed: bool = False

    @model_validator(mode="after")
    def allowed(self):
        if self.operation.kind not in ("template", "patch.scan"):
            raise ValueError(
                "Schedule reviewed templates or update scans; patch installation remains a reviewed action"
            )
        if 0 < self.interval_seconds < 900:
            raise ValueError("Recurring operations must be at least 15 minutes apart")
        return self


def validate_schedule(conn, body):
    if body.first_run < time.time() + 5 or body.first_run > time.time() + 366 * 86400:
        raise HTTPException(422, "Choose a first run between now and one year from now")
    prepared = prepare_batch(conn, body.operation)
    if body.interval_seconds and body.interval_seconds <= max(t + 120 for _, _, t in prepared):
        raise HTTPException(422, "The interval must exceed the operation time limit plus two minutes")
    return prepared


@router.post("/preview")
def preview(body: Schedule, user=Depends(require_user)):
    with db() as conn:
        targets = validate_schedule(conn, body)
    return {
        "first_run": body.first_run,
        "interval_seconds": body.interval_seconds,
        "targets": [{"id": d["id"], "label": d["label"], "script": p["script"], "timeout": t} for d, p, t in targets],
    }


@router.post("")
def create(body: Schedule, user=Depends(require_user)):
    if not body.confirmed:
        raise HTTPException(422, "Review and confirm this schedule")
    schedule_id, now = ident(), time.time()
    canonical = json.dumps(
        body.model_dump(exclude={"confirmed": True, "operation": {"confirmed"}}), sort_keys=True, separators=(",", ":")
    )
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
    with db(write=True) as conn:
        existing = conn.execute(
            "SELECT id,fingerprint,owner_id FROM schedules WHERE request_id=?", (body.operation.request_id,)
        ).fetchone()
        if existing:
            if existing["fingerprint"] != fingerprint or existing["owner_id"] != user["user_id"]:
                raise HTTPException(409, "This request ID belongs to another schedule")
            return {"id": existing["id"], "existing": True}
        validate_schedule(conn, body)
        conn.execute(
            "INSERT INTO schedules(id,name,spec,owner_id,created,updated,enabled,interval_seconds,next_run,request_id,fingerprint) VALUES(?,?,?,?,?,?,1,?,?,?,?)",
            (
                schedule_id,
                body.operation.name,
                seal(body.operation.model_dump_json()),
                user["user_id"],
                now,
                now,
                body.interval_seconds,
                body.first_run,
                body.operation.request_id,
                fingerprint,
            ),
        )
        audit(
            conn,
            user["username"],
            "schedule.created",
            detail={
                "schedule_id": schedule_id,
                "device_ids": body.operation.device_ids,
                "kind": body.operation.kind,
                "template_id": body.operation.template_id,
                "revision": body.operation.template_revision,
                "first_run": body.first_run,
                "interval_seconds": body.interval_seconds,
            },
        )
    return {"id": schedule_id, "existing": False}


@router.get("")
def schedules(user=Depends(require_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT s.*,u.username AS owner FROM schedules s JOIN users u ON u.id=s.owner_id ORDER BY s.created DESC LIMIT 200"
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item.pop("request_id", None)
            item.pop("fingerprint", None)
            spec = Batch.model_validate_json(unseal(item.pop("spec")))
            item["operation"] = {
                "kind": spec.kind,
                "template_id": spec.template_id,
                "template_revision": spec.template_revision,
                "device_ids": spec.device_ids,
            }
            item["runs"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM schedule_runs WHERE schedule_id=? ORDER BY due DESC LIMIT 10", (row["id"],)
                )
            ]
            for run in item["runs"]:
                if run["batch_id"]:
                    states = {
                        r[0]
                        for r in conn.execute(
                            "SELECT j.status FROM batch_jobs bj JOIN jobs j ON j.id=bj.job_id WHERE batch_id=?",
                            (run["batch_id"],),
                        )
                    }
                    if states == {"complete"}:
                        run["status"] = "complete"
                    elif states & {"queued", "leased", "running"}:
                        run["status"] = "running" if states & {"leased", "running"} else "queued"
                    elif states:
                        run["status"] = "unknown" if "unknown" in states else "failed"
            result.append(item)
    return result


class State(BaseModel):
    enabled: bool
    next_run: float | None = Field(default=None, gt=0, allow_inf_nan=False)


@router.patch("/{schedule_id}")
def set_state(schedule_id: str, body: State, user=Depends(require_user)):
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM schedules WHERE id=?", (schedule_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Schedule not found")
        if user["role"] != "admin" and row["owner_id"] != user["user_id"]:
            raise HTTPException(403, "Only its owner or an administrator can change this schedule")
        next_run = row["next_run"]
        if body.enabled:
            if body.next_run is None:
                raise HTTPException(422, "Choose a new future run time before resuming")
            # Resuming is a new reviewed authorization under the current owner.
            operation = Batch.model_validate_json(unseal(row["spec"]))
            validate_schedule(
                conn, Schedule(operation=operation, first_run=body.next_run, interval_seconds=row["interval_seconds"])
            )
            next_run = body.next_run
        conn.execute(
            "UPDATE schedules SET enabled=?,next_run=?,owner_id=?,updated=?,revision=revision+1 WHERE id=?",
            (body.enabled, next_run, user["user_id"], time.time(), schedule_id),
        )
        audit(
            conn,
            user["username"],
            "schedule.resumed" if body.enabled else "schedule.paused",
            detail={"schedule_id": schedule_id, "next_run": next_run},
        )
    return {"ok": True}


def run_due(conn, now):
    rows = conn.execute(
        "SELECT s.*,u.username,u.disabled,u.role FROM schedules s JOIN users u ON u.id=s.owner_id WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 50",
        (now,),
    ).fetchall()
    for row in rows:
        due = row["next_run"]
        run_id = ident()
        claimed = conn.execute(
            "INSERT OR IGNORE INTO schedule_runs(id,schedule_id,due,created,status,reason) VALUES(?,?,?,?,'pending','')",
            (run_id, row["id"], due, now),
        ).rowcount
        interval = row["interval_seconds"]
        next_run = due + (int((now - due) // interval) + 1) * interval if interval else due
        conn.execute(
            "UPDATE schedules SET next_run=?,enabled=?,updated=? WHERE id=?", (next_run, bool(interval), now, row["id"])
        )
        if not claimed:
            continue
        status, reason, batch_id = "skipped", "", None
        op = Batch.model_validate_json(unseal(row["spec"]))
        if row["disabled"] or row["role"] == "viewer":
            reason = "The schedule owner no longer has operator access"
            conn.execute("UPDATE schedules SET enabled=0 WHERE id=?", (row["id"],))
        elif now - due > 300:
            reason = "Run missed by more than five minutes; no catch-up commands were sent"
        else:
            template = (
                next((t for t in all_templates(conn) if t["id"] == op.template_id), None)
                if op.kind == "template"
                else None
            )
            if op.kind == "template" and (not template or template["revision"] != op.template_revision):
                reason = "Template changed; create a new reviewed schedule"
                status = "needs_review"
                conn.execute("UPDATE schedules SET enabled=0 WHERE id=?", (row["id"],))
            else:
                try:
                    prepared = prepare_batch(conn, op)
                    op.request_id = "schedule:" + run_id
                    batch_id = enqueue_batch(conn, op, prepared, row["username"], now)
                    status = "queued"
                except HTTPException as exc:
                    reason = str(exc.detail)
        conn.execute(
            "UPDATE schedule_runs SET status=?,reason=?,batch_id=? WHERE id=?", (status, reason, batch_id, run_id)
        )
        audit(
            conn,
            "scheduler",
            "schedule." + status,
            detail={"schedule_id": row["id"], "run_id": run_id, "batch_id": batch_id, "reason": reason},
        )


def tick(now=None):
    now = time.time() if now is None else now
    with db(write=True) as conn:
        conn.execute(
            "UPDATE jobs SET status=CASE WHEN status='queued' THEN 'expired' ELSE 'unknown' END,finished=? WHERE deadline<? AND status IN ('queued','leased','running')",
            (now, now),
        )
        run_due(conn, now)
        evaluate(conn, now)
        conn.execute("INSERT OR REPLACE INTO settings VALUES('management_tick',?)", (json.dumps({"at": now}),))


async def worker():
    while True:
        await asyncio.sleep(15)
        try:
            await asyncio.to_thread(tick)
        except Exception:
            log.exception("Management evaluation failed; it will retry on the next tick")


async def stop_worker(task):
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
