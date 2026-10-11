"""Bounded hourly counts and latency buckets. No URLs, IDs, content or screens."""

import time
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from speck.db import db
from speck.security import require_user

router = APIRouter(prefix="/api/ux")
BUCKETS = (100, 200, 500, 1000, 2000, 5000, 15000, 60000, 600000)


def migrate(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS ux_metrics(
      hour INTEGER NOT NULL, journey TEXT NOT NULL, surface TEXT NOT NULL,
      outcome TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(hour,journey,surface,outcome,bucket))""")


class Measurement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    journey: Literal[
        "signin_to_fleet",
        "first_content",
        "enrichment",
        "search_to_target",
        "alert_to_evidence",
        "session_first_frame",
        "stale_evidence",
    ]
    surface: Literal[
        "home",
        "fleet",
        "alerts",
        "schedules",
        "patches",
        "software",
        "infrastructure",
        "network",
        "slide",
        "recovery",
        "keys",
        "api",
        "activity",
        "settings",
        "workspaces",
        "maintenance",
        "quality",
        "browser",
    ]
    outcome: Literal["ready", "failed", "cancelled", "unknown"]
    duration_ms: float = Field(ge=0, le=600000, allow_inf_nan=False)


class Measurements(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[Measurement] = Field(max_length=30)


@router.post("/measurements")
def record(body: Measurements, user=Depends(require_user)):
    hour = int(time.time() // 3600) * 3600
    with db(write=True) as conn:
        conn.execute("DELETE FROM ux_metrics WHERE hour<?", (hour - 7 * 86400,))
        for item in body.items:
            bucket = next(b for b in BUCKETS if item.duration_ms <= b)
            conn.execute(
                """INSERT INTO ux_metrics VALUES(?,?,?,?,?,1)
                ON CONFLICT(hour,journey,surface,outcome,bucket) DO UPDATE SET count=min(count+1,100000)""",
                (hour, item.journey, item.surface, item.outcome, bucket),
            )
    return {"ok": True}


@router.get("/scorecard")
def scorecard(user=Depends(require_user)):
    with db() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                """SELECT journey,surface,outcome,bucket,sum(count) AS count
          FROM ux_metrics WHERE hour>? GROUP BY journey,surface,outcome,bucket""",
                (time.time() - 7 * 86400,),
            )
        ]
        outcomes = [
            dict(r)
            for r in conn.execute(
                "SELECT status,count(*) AS count FROM jobs WHERE created>? GROUP BY status", (time.time() - 7 * 86400,)
            )
        ]
    return {
        "operation_outcomes": outcomes,
        "rows": rows,
        "window_days": 7,
        "client": "Hosted web console",
        "buckets_ms": BUCKETS,
        "note": "Hourly aggregate histograms; quantiles are bucket upper bounds. No resource IDs, URLs, queries, command text, credentials or remote screens are collected. Browser instrumentation is not native-client or platform runtime qualification.",
    }
