"""What is new since the person was last here, kept on the server so every device agrees.

A visit is a stretch of use with no gap longer than VISIT_GAP. When a new visit starts,
the start of the one before becomes the line "new" is measured from. Opening a taste's
board marks that taste as seen, so its badge clears there and nowhere else.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from . import db
from .timeutil import as_utc, now_utc

VISIT_GAP = timedelta(minutes=30)
RECAP_DAYS = 7      # with nothing new since last time, the greeting looks back this far


def touch(user: dict, *, now: datetime | None = None) -> datetime | None:
    """Record activity. Returns when the previous visit ended (None on a first visit)."""
    now = as_utc(now or now_utc())
    v = user.get("visits") or {}
    last = as_utc(v["last"]) if v.get("last") else None
    prev = as_utc(v["prev"]) if v.get("prev") else None
    if last is None or now - last > VISIT_GAP:
        prev = last                      # a new visit: the old one becomes "last time"
    db.users().update_one({"_id": user["_id"]}, {"$set": {"visits.last": now, "visits.prev": prev}})
    return prev


def new_line(prev: datetime | None, seen_at: datetime | None) -> datetime | None:
    """Saves created after this are new for a taste: since last visit, or since its board
    was last opened if that was later."""
    marks = [as_utc(x) for x in (prev, seen_at) if x]
    return max(marks) if marks else None


def mark_taste_seen(user: dict, type_: str, *, now: datetime | None = None) -> None:
    db.users().update_one({"_id": user["_id"]}, {"$set": {f"visits.taste_seen.{type_}": as_utc(now or now_utc())}})


# How the greeting names a count of each kind. Kinds with nothing to show are left out.
RECAP_WORDS = {
    "recipe": ("recipe", "recipes"), "workout": ("workout", "workouts"),
    "product": ("product pick", "product picks"), "place": ("place to go", "places to go"),
    "event": ("event", "events"), "tip": ("tip", "tips"),
}


def recap_parts(counts: dict[str, int], limit: int = 3) -> list[str]:
    """{"recipe": 3, "workout": 4} -> ["4 workouts", "3 recipes"], largest first."""
    ranked = sorted(((t, n) for t, n in counts.items() if n > 0 and t in RECAP_WORDS),
                    key=lambda kv: (-kv[1], list(RECAP_WORDS).index(kv[0])))
    return [f"{n} {RECAP_WORDS[t][0] if n == 1 else RECAP_WORDS[t][1]}" for t, n in ranked[:limit]]


def join_words(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]
