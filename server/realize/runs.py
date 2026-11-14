"""agent_runs: one document per agent run, steps pushed as they happen (SPEC 5.5)."""
from __future__ import annotations

import json
import time
from contextlib import contextmanager
from typing import Any, Iterator

from bson import ObjectId

from . import db
from .models import STEP_LABELS
from .timeutil import as_utc, now_utc

MAX_BYTES = 2048


def _truncate(value: Any) -> Any:
    """Keep args and results under 2 KB each."""
    if value is None:
        return None
    try:
        raw = json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        raw = str(value)
    if len(raw.encode("utf-8")) <= MAX_BYTES:
        return json.loads(raw) if not isinstance(value, str) else value
    return {"truncated": raw.encode("utf-8")[: MAX_BYTES - 40].decode("utf-8", "ignore") + "…"}


class Run:
    def __init__(self, user: dict, save_id: ObjectId | None, kind: str, model: str):
        self.user_id = user["_id"]
        doc: dict = {
            "user_id": self.user_id, "save_id": save_id, "kind": kind, "model": model,
            "status": "running", "steps": [], "error": None,
            "started_at": now_utc(), "ended_at": None,
        }
        if user.get("expires_at"):
            doc["expires_at"] = user["expires_at"]
        self.id = db.agent_runs().insert_one(doc).inserted_id
        self._n = 0
        self.on_step = None  # optional callback(label) for live streams

    @contextmanager
    def step(self, key: str, args: Any = None, tool: str | None = None) -> Iterator[dict]:
        """Record a step. The body sets holder['result']; errors mark the step failed and re-raise."""
        idx = self._n
        self._n += 1
        label = STEP_LABELS.get(key, key)
        db.agent_runs().update_one(
            {"_id": self.id},
            {"$push": {"steps": {"key": key, "label": label, "tool": tool or key,
                                 "args": _truncate(args), "result": None, "ms": None,
                                 "ts": now_utc()}}},
        )
        if self.on_step:
            self.on_step(label)
        holder: dict = {"result": None}
        t0 = time.monotonic()
        try:
            yield holder
        except Exception as e:
            db.agent_runs().update_one(
                {"_id": self.id},
                {"$set": {f"steps.{idx}.ms": int((time.monotonic() - t0) * 1000),
                          f"steps.{idx}.error": str(e)[:300]}},
            )
            raise
        db.agent_runs().update_one(
            {"_id": self.id},
            {"$set": {f"steps.{idx}.ms": int((time.monotonic() - t0) * 1000),
                      f"steps.{idx}.result": _truncate(holder["result"])}},
        )

    def finish(self, status: str = "done", error: str | None = None) -> None:
        db.agent_runs().update_one(
            {"_id": self.id},
            {"$set": {"status": status, "error": (error or None) and str(error)[:500],
                      "ended_at": now_utc()}},
        )


def step_views(run: dict | None) -> list[dict]:
    """Steps as the ticket shows them: [{label, state, ms}]."""
    if not run:
        return []
    running = run.get("status") == "running"
    out = []
    steps = run.get("steps") or []
    for i, s in enumerate(steps):
        if s.get("error"):
            state = "failed"
        elif s.get("ms") is not None:
            state = "done"
        elif running and i == len(steps) - 1:
            state = "current"
        else:
            state = "failed" if not running else "done"
        out.append({"label": s.get("label") or s.get("key"), "state": state, "ms": s.get("ms")})
    return out


def run_view(run: dict) -> dict:
    """A run with full steps for the trace panel."""
    def iso(v):
        return as_utc(v).isoformat() if v else None

    return {
        "id": str(run["_id"]), "kind": run.get("kind"), "model": run.get("model"),
        "status": run.get("status"), "error": run.get("error"),
        "started_at": iso(run.get("started_at")), "ended_at": iso(run.get("ended_at")),
        "steps": [
            {"key": s.get("key"), "label": s.get("label"), "tool": s.get("tool"),
             "args": s.get("args"), "result": s.get("result"), "ms": s.get("ms"),
             "error": s.get("error"), "ts": iso(s.get("ts")),
             "state": v["state"]}
            for s, v in zip(run.get("steps") or [], step_views(run))
        ],
    }


def latest_run(save_id: ObjectId) -> dict | None:
    return db.agent_runs().find_one({"save_id": save_id}, sort=[("started_at", -1)])
