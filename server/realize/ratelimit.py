"""In-memory sliding-window rate limits. Valid for a single uvicorn process (SPEC 17)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)

LIMITS = {
    "save": (20, 60),          # per key
    "chat": (15, 60),          # per key
    "trip": (6, 600),          # per key: each build is two model calls and a few searches
    "judge_save": (30, 3600),  # per judge key
    "users": (5, 3600),        # per IP
    "demo": (10, 3600),        # per IP
}


def allow(bucket: str, ident: str, *, now: float | None = None) -> bool:
    limit, window = LIMITS[bucket]
    t = time.monotonic() if now is None else now
    key = f"{bucket}:{ident}"
    with _lock:
        q = _hits[key]
        while q and q[0] <= t - window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(t)
        return True


def reset() -> None:
    with _lock:
        _hits.clear()
