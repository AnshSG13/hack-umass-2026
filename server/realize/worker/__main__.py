"""The worker: the only component that talks to Instagram.

Run from server/: python -m realize.worker
Two lanes (propose, enrich), each with its own threads, all claiming jobs from Atlas.
If Instagram blocks one machine, stop this worker there and start it on another;
nothing else changes.
"""
from __future__ import annotations

import logging
import signal
import socket
import threading
import time

from .. import db, enrich, jobs, planner
from ..config import get_settings
from ..models import PERMANENT_REASONS, failure_message
from ..ytdlp import ReelError

log = logging.getLogger("realize.worker")
stop = threading.Event()
POLL_S = 0.5


def _heartbeat(job_id, done: threading.Event) -> None:
    while not done.wait(30):
        try:
            jobs.heartbeat(job_id)
        except Exception as e:  # noqa: BLE001
            log.warning("heartbeat failed: %s", str(e)[:120])


def handle_propose(job: dict, save: dict, user: dict) -> None:
    try:
        planner.run_propose_job(save, user)
        jobs.complete(job["_id"])
    except ReelError as e:
        permanent = e.reason in PERMANENT_REASONS
        will_retry = jobs.retry_or_fail(job, str(e), permanent=permanent)
        if will_retry:
            db.saves().update_one({"_id": save["_id"]}, {"$set": {"status": "queued"}})
            return
        reason = e.reason if e.reason in ("private", "unavailable", "not_video", "blocked") else "processing_error"
        db.saves().update_one({"_id": save["_id"]}, {"$set": {
            "status": "failed", "failure_reason": reason,
            "failure_message": failure_message(reason, get_settings().app_name)}})


def handle_enrich(job: dict, save: dict, user: dict) -> None:
    try:
        enrich.run_enrich_job(save, user)
        jobs.complete(job["_id"])
    except Exception as e:  # noqa: BLE001 - enrichment never makes a save unusable
        reason = e.reason if isinstance(e, ReelError) else "processing_error"
        if jobs.retry_or_fail(job, str(e)):
            db.saves().update_one({"_id": save["_id"], "status": "enriching"}, {"$set": {"status": "planned"}})
            return
        from ..timeutil import now_utc

        db.saves().update_one({"_id": save["_id"]}, {"$set": {
            "status": "ready", "ready_at": now_utc(), "enrich_error": reason}})


HANDLERS = {"propose": handle_propose, "enrich": handle_enrich}


def lane(kind: str, n: int) -> None:
    name = f"{kind}-{n}"
    while not stop.is_set():
        try:
            job = jobs.claim(kind)
        except Exception as e:  # noqa: BLE001 - Atlas hiccup: back off and keep going
            log.warning("[%s] claim failed: %s", name, str(e)[:160])
            stop.wait(3)
            continue
        if not job:
            stop.wait(POLL_S)
            continue
        save = db.saves().find_one({"_id": job["save_id"], "user_id": job["user_id"]})
        user = db.users().find_one({"_id": job["user_id"]})
        if not save or not user:
            jobs.complete(job["_id"])
            continue
        done = threading.Event()
        threading.Thread(target=_heartbeat, args=(job["_id"], done), daemon=True).start()
        t0 = time.monotonic()
        try:
            log.info("[%s] %s attempt %s", name, save["shortcode"], job["attempts"])
            HANDLERS[kind](job, save, user)
        except Exception as e:  # noqa: BLE001 - never let a lane die
            log.exception("[%s] job crashed: %s", name, e)
            try:
                if not jobs.retry_or_fail(job, str(e)) and kind == "propose":
                    db.saves().update_one({"_id": save["_id"]}, {"$set": {
                        "status": "failed", "failure_reason": "processing_error",
                        "failure_message": failure_message("processing_error", get_settings().app_name)}})
            except Exception:  # noqa: BLE001
                pass
        finally:
            done.set()
            log.info("[%s] %s finished in %.1f s", name, save["shortcode"], time.monotonic() - t0)


def beat(lanes: list[str]) -> None:
    host = socket.gethostname()
    while not stop.is_set():
        try:
            jobs.worker_beat(lanes, host)
        except Exception as e:  # noqa: BLE001
            log.warning("worker heartbeat failed: %s", str(e)[:120])
        stop.wait(10)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    if s.planner_mode == "fake":
        log.warning("PLANNER_MODE=fake: the API plans in-process and enqueues nothing; the worker will idle.")
    if not s.cookies_file:
        log.info("No Instagram cookies; public access only.")
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
    except (AttributeError, ValueError):
        pass
    if s.planner_mode != "fake":
        # Probe the model's lowest thinking level now, not inside the first user's 20 seconds.
        from .. import gemini

        log.info("thinking level for %s: %s", s.gemini_model_fast, gemini.lowest_thinking(s.gemini_model_fast))
    threads = [threading.Thread(target=beat, args=(["propose", "enrich"],), daemon=True)]
    for i in range(max(1, s.worker_propose_threads)):
        threads.append(threading.Thread(target=lane, args=("propose", i + 1), daemon=True))
    for i in range(max(1, s.worker_enrich_threads)):
        threads.append(threading.Thread(target=lane, args=("enrich", i + 1), daemon=True))
    for t in threads:
        t.start()
    log.info("worker %s up: %s propose, %s enrich threads", s.worker_id,
             s.worker_propose_threads, s.worker_enrich_threads)
    while not stop.is_set():
        time.sleep(0.5)
    log.info("worker stopping")


if __name__ == "__main__":
    main()
