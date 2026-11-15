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
    "reanalyze": (5, 600),     # per key: each one is a video pass, sometimes a planner call
    "trip": (6, 600),          # per key: each build is two model calls and a few searches
    "judge_save": (30, 3600),  # per judge key
    # Per IP. A venue's Wi-Fi puts a whole room behind one address, so this has room for a
    # table of people signing up at once, over a window short enough for "wait a few minutes".
    "users": (15, 600),
    "demo": (10, 3600),        # per IP; the count comes from DEMO_SESSIONS_PER_HOUR (see _limit)
    "login": (20, 600),        # per IP
    # Wrong passwords per IP and email: only failures count, and only from the same address,
    # so nobody can lock someone else out of their account by guessing from elsewhere.
    "login_fail": (10, 600),
    "suggest": (20, 600),      # per key, onboarding interest suggestions
    # Per demo user, for the whole session: trip builds and rebuilds, opening a trip's days,
    # price research and re-watching a video. Each is paid model calls and searches.
    "demo_build": (12, 86400),
}

DEMO_BUILD_MESSAGE = "That's the limit for this demo. Everything it already made still works."


def demo_spend(user: dict) -> bool:
    """True when this user may start one more paid build. Real accounts aren't counted here."""
    return not user.get("is_demo") or allow("demo_build", str(user["_id"]))


def _limit(bucket: str) -> tuple[int, int]:
    limit, window = LIMITS[bucket]
    if bucket == "demo":
        from .config import get_settings  # late: tests swap settings
        limit = max(1, get_settings().demo_sessions_per_hour)
    return limit, window


def allow(bucket: str, ident: str, *, now: float | None = None) -> bool:
    limit, window = _limit(bucket)
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


def full(bucket: str, ident: str, *, now: float | None = None) -> bool:
    """Whether the bucket is at its limit, without counting this as a hit."""
    limit, window = _limit(bucket)
    t = time.monotonic() if now is None else now
    with _lock:
        q = _hits[f"{bucket}:{ident}"]
        while q and q[0] <= t - window:
            q.popleft()
        return len(q) >= limit


def hit(bucket: str, ident: str, *, now: float | None = None) -> None:
    """Count one hit, whether or not the bucket is full (see full)."""
    t = time.monotonic() if now is None else now
    with _lock:
        _hits[f"{bucket}:{ident}"].append(t)


def reset() -> None:
    with _lock:
        _hits.clear()
