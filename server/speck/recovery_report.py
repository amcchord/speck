"""Private, allowlisted recovery evidence without raw commands, credentials or output."""

import datetime
import math
import time

from fastapi import APIRouter, Depends, Query

from speck.db import db
from speck.security import require_user
from speck.slide import run_load

router = APIRouter(prefix="/api/recovery")


def timestamp(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return value
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


@router.get("/runs/{run_id}/evidence")
def evidence(run_id: str, retest_days: int = Query(default=30, ge=1, le=365), user=Depends(require_user)):
    run = run_load(run_id)
    state, report = run.get("state") or {}, run.get("report") or {}
    with db() as conn:
        labels = {d["id"]: d["label"] for d in conn.execute("SELECT id,label FROM devices")}
    verified = timestamp(report.get("verified_at"))
    started = timestamp(run.get("created"))
    members = []
    for member in state.get("members", []):
        proof = next(
            (p for p in report.get("members", []) if p.get("source_device_id") == member.get("source_device_id")), {}
        )
        snapshot = member.get("snapshot_verification") or {}
        point = timestamp(snapshot.get("backup_ended_at") or snapshot.get("created_at"))
        members.append(
            {
                "source_id": member.get("source_device_id"),
                "source_name": labels.get(member.get("source_device_id"), "Source not in current inventory"),
                "restored_id": member.get("restored_device_id"),
                "snapshot_id": member.get("snapshot_id"),
                "snapshot_at": point,
                "data_age_at_start_seconds": started - point if point and started and point <= started else None,
                "application_check": "passed" if proof.get("passed") else "failed" if proof else "not recorded",
                "output_comparison": "matched"
                if proof.get("output_matches")
                else "different"
                if proof.get("compared")
                else "not required / not recorded",
                "baseline_job_id": member.get("baseline_job_id"),
                "verification_job_id": member.get("verify_job_id"),
            }
        )
    return {
        "report_version": 1,
        "generated_at": time.time(),
        "run_id": run_id,
        "plan_id": run["plan_id"],
        "name": state.get("name", "Recovery rehearsal"),
        "actor": state.get("actor"),
        "status": run["status"],
        "started": started,
        "verified_at": verified,
        "measured_time_to_verification_seconds": verified - started
        if verified and started and verified >= started
        else None,
        "isolation": "Recovery workflow uses a separate isolated network and distinct restored identities; source machines remain separate.",
        "timeline": [{k: t.get(k) for k in ("at", "phase", "status")} for t in state.get("timeline", [])],
        "members": members,
        "retest_days": retest_days,
        "next_retest_due": (verified or started or time.time()) + retest_days * 86400,
        "cleanup": "Restored VMs stopped; resources and evidence retained"
        if run["status"] == "stopped"
        else "Completed cleanup not recorded; inspect retained resources",
        "exceptions": ["Current phase: " + str(run.get("phase", "not recorded"))] if not report.get("passed") else [],
        "limits": [
            "This report reflects this rehearsal and its configured checks; it is not a guarantee of current recoverability.",
            "Measured time begins at the Speck run request, not a customer outage. A contractual RTO is not inferred.",
            "Snapshot age is reported only when timestamps exist; a contractual RPO is not inferred.",
            "Raw command output, credentials, remote-session data and untested application behavior are excluded.",
            "The retest interval is an operator-selected objective, not an automatically scheduled recovery run.",
        ],
    }
