"""Saves left half-read by a restart, picked up again.

Most saves are planned through the job queue, whose leases survive a restart. A save of a
reel that is also a demo sample is planned on a background thread in the API instead (it
needs no download), and a restart in the middle of that leaves the save "reading" with no
job behind it. Nothing would ever finish it: reanalyze and a second share both treat it as
busy. The worker calls `sweep()` every minute and starts such saves again.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from . import db, jobs
from .timeutil import now_utc

log = logging.getLogger("realize.recover")

IN_FLIGHT = ("queued", "reading", "planning")
STALE = timedelta(minutes=10)  # planning takes seconds; ten quiet minutes means nobody is on it


def stale_saves(now: datetime | None = None, limit: int = 20) -> list[dict]:
    """Saves in a working state, older than STALE, with no live job and no run started lately."""
    now = now or now_utc()
    cutoff = now - STALE
    out = []
    for s in db.saves().find({"status": {"$in": list(IN_FLIGHT)}, "created_at": {"$lt": cutoff}},
                             {"embedding": 0, "transcript": 0}).limit(limit * 3):
        if db.jobs().find_one({"save_id": s["_id"], "status": {"$in": ["pending", "running"]}}, {"_id": 1}):
            continue
        if db.agent_runs().find_one({"save_id": s["_id"], "started_at": {"$gte": cutoff}}, {"_id": 1}):
            continue
        out.append(s)
        if len(out) >= limit:
            break
    return out


def restart(save: dict) -> None:
    """Plan the save again the way it was first planned. Runs left "running" are closed."""
    db.agent_runs().update_many({"save_id": save["_id"], "status": "running"},
                                {"$set": {"status": "failed", "error": "interrupted by a restart",
                                          "ended_at": now_utc()}})
    db.saves().update_one({"_id": save["_id"], "user_id": save["user_id"]}, {"$set": {"status": "queued"}})
    if save.get("from_cache"):
        from . import demo  # late: demo imports the planner

        demo.plan_sample(save["_id"], save["user_id"])
    else:
        jobs.enqueue("propose", save)


def sweep(now: datetime | None = None) -> int:
    """Start every stuck save again. Returns how many."""
    n = 0
    for s in stale_saves(now):
        try:
            restart(s)
            n += 1
            log.info("restarted a save stuck %s since %s: %s", s.get("status"), s.get("created_at"), s.get("shortcode"))
        except Exception as e:  # noqa: BLE001 - one bad save must not stop the others
            log.warning("could not restart save %s: %s", s.get("_id"), str(e)[:160])
    return n
