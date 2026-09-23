"""Human-readable alert evidence. Job payloads stay out of list responses."""

import json

from fastapi import HTTPException

from speck.config import unseal

JOB_NAMES = {
    "command": "Command",
    "service.control": "Service action",
    "network.check": "Network check",
    "files.list": "Folder listing",
    "files.upload": "File upload",
    "files.download": "File download",
    "tunnel": "Remote connection",
    "shell": "Shell session",
}
OUTCOMES = {
    "unknown": (
        "completion unconfirmed",
        "The agent did not report a final result. The operation may have run; check its effects before retrying.",
    ),
    "expired": (
        "did not start in time",
        "The job expired while waiting for the agent to pick it up. Check connectivity before trying again.",
    ),
    "failed": (
        "failed",
        "The agent reported a failure. Review the output to identify what failed and whether any steps completed.",
    ),
}


def present_alert(conn, row):
    item = dict(row)
    key = item["key"]
    item["category"] = "Job" if key.startswith("job:") else "Health"
    item["resolution_hint"] = (
        "Mark reviewed closes this alert; it does not undo or retry the operation."
        if key.startswith("job:")
        else "Clears automatically after a fresh healthy reading. Acknowledging only records that you have seen it."
    )
    if key.startswith("job:"):
        job = conn.execute(
            "SELECT j.id,j.kind,j.status,j.created,j.started,j.finished,j.actor,b.name AS operation_name "
            "FROM jobs j LEFT JOIN batch_jobs bj ON bj.job_id=j.id LEFT JOIN batches b ON b.id=bj.batch_id "
            "WHERE j.id=? AND j.device_id=?",
            (key[4:], item["device_id"]),
        ).fetchone()
        item["job"] = dict(job) if job else None
        if job:
            name = job["operation_name"] or JOB_NAMES.get(job["kind"], "Operation")
            outcome, explanation = OUTCOMES.get(job["status"], ("needs review", "Review the recorded job outcome."))
            item["title"] = f"{name} · {outcome}"
            item["explanation"] = explanation
        else:
            item["title"] = "Past operation needs review"
            item["explanation"] = (
                "The original job is no longer available. Its result cannot be confirmed from this alert."
            )
    elif key == "offline":
        item["explanation"] = (
            "The agent missed its check-in threshold. Check power, network access and the Speck service."
        )
    elif key == "telemetry":
        item["explanation"] = "Fresh inventory is missing. The last reported health values may be out of date."
    elif key.startswith("service:"):
        item["explanation"] = "A watched service was stopped or missing in the latest valid inventory."
    else:
        item["explanation"] = "Usage exceeded the monitoring threshold for the configured duration."
    return item


def alert_detail(conn, alert_id):
    row = conn.execute(
        "SELECT a.*,d.label,d.platform FROM alerts a LEFT JOIN devices d ON d.id=a.device_id WHERE a.id=?",
        (alert_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Alert not found")
    item = present_alert(conn, row)
    if item.get("job"):
        job = conn.execute(
            "SELECT * FROM jobs WHERE id=? AND device_id=?", (item["job"]["id"], item["device_id"])
        ).fetchone()
        result = json.loads(job["result"]) if job["result"] else {}
        # Connection credentials and file payloads must never enter alert/AI context.
        output = {k: str(result[k])[:6000] for k in ("stdout", "stderr", "error") if result.get(k)}
        if "exit_code" in result:
            output["exit_code"] = result["exit_code"]
        output["truncated"] = bool(result.get("truncated")) or any(
            len(str(result.get(k, ""))) > 6000 for k in ("stdout", "stderr", "error")
        )
        item["job"]["result"] = output
        if job["kind"] == "command":
            payload = json.loads(unseal(job["payload"]))
            script = str(payload.get("script", ""))
            item["job"]["script"] = script[:12000]
            item["job"]["script_truncated"] = len(script) > 12000
    return item
