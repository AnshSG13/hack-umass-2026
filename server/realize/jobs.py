"""The job queue lives in Atlas: enqueue, atomic claim, heartbeat, complete, fail (SPEC 5.4)."""
from __future__ import annotations

from datetime import timedelta

from bson import ObjectId
from pymongo import ReturnDocument

from . import db
from .config import get_settings
from .timeutil import now_utc

LEASE_SECONDS = 120
BACKOFF = {"propose": [2, 6], "enrich": [10, 30, 90]}
MAX_ATTEMPTS = {"propose": 3, "enrich": 3}


def enqueue(kind: str, save: dict, delay_s: float = 0) -> ObjectId:
    now = now_utc()
    doc = {
        "kind": kind, "user_id": save["user_id"], "save_id": save["_id"],
        "status": "pending", "attempts": 0, "max_attempts": MAX_ATTEMPTS[kind],
        "run_after": now + timedelta(seconds=delay_s), "locked_by": None, "locked_until": None,
        "last_error": None, "created_at": now, "updated_at": now,
    }
    if save.get("expires_at"):
        doc["expires_at"] = save["expires_at"]
    return db.jobs().insert_one(doc).inserted_id


def claim(kind: str) -> dict | None:
    """Atomically lease one runnable job. A running job whose lease expired is claimable again."""
    now = now_utc()
    return db.jobs().find_one_and_update(
        {"kind": kind, "status": {"$in": ["pending", "running"]}, "run_after": {"$lte": now},
         "$or": [{"locked_until": None}, {"locked_until": {"$lt": now}}]},
        {"$set": {"status": "running", "locked_by": get_settings().worker_id,
                  "locked_until": now + timedelta(seconds=LEASE_SECONDS), "updated_at": now},
         "$inc": {"attempts": 1}},
        sort=[("run_after", 1)],
        return_document=ReturnDocument.AFTER,
    )


def heartbeat(job_id: ObjectId) -> None:
    now = now_utc()
    db.jobs().update_one(
        {"_id": job_id, "status": "running"},
        {"$set": {"locked_until": now + timedelta(seconds=LEASE_SECONDS), "updated_at": now}})


def complete(job_id: ObjectId) -> None:
    db.jobs().update_one(
        {"_id": job_id},
        {"$set": {"status": "done", "locked_by": None, "locked_until": None, "updated_at": now_utc()}})


def retry_or_fail(job: dict, error: str, permanent: bool = False, delays: list[int] | None = None) -> bool:
    """Schedule a retry with backoff, or mark the job failed. Returns True if it will retry."""
    now = now_utc()
    backoff = delays or BACKOFF[job["kind"]]
    attempt = int(job.get("attempts") or 1)
    if not permanent and attempt < int(job.get("max_attempts") or 3):
        delay = backoff[min(attempt - 1, len(backoff) - 1)]
        db.jobs().update_one(
            {"_id": job["_id"]},
            {"$set": {"status": "pending", "locked_by": None, "locked_until": None,
                      "run_after": now + timedelta(seconds=delay), "last_error": error[:500],
                      "updated_at": now}})
        return True
    db.jobs().update_one(
        {"_id": job["_id"]},
        {"$set": {"status": "failed", "locked_by": None, "locked_until": None,
                  "last_error": error[:500], "updated_at": now}})
    return False


def worker_beat(lanes: list[str], host: str) -> None:
    db.workers().update_one(
        {"_id": get_settings().worker_id},
        {"$set": {"last_seen": now_utc(), "lanes": lanes, "host": host}}, upsert=True)


def worker_last_seen_s() -> float | None:
    w = db.workers().find_one(sort=[("last_seen", -1)])
    if not w or not w.get("last_seen"):
        return None
    return max(0.0, (now_utc() - w["last_seen"]).total_seconds())
