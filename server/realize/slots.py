"""Deterministic scheduling: free slots and reminder times (SPEC 8.3).

The LLM never computes dates. It picks from what find_free_slot returns.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Iterable

from .timeutil import (
    DAY_KEYS, as_utc, big_time, local_str, long_day, now_utc, parse_hhmm, parse_local, tz_of,
)

DEFAULT_DURATION = {"recipe": 60, "workout": 45, "place": 90}
MAX_SLOTS = 5


def in_quiet(t: time, quiet_start: str, quiet_end: str) -> bool:
    """True when t is inside the quiet window. Handles windows that cross midnight."""
    qs, qe = parse_hhmm(quiet_start), parse_hhmm(quiet_end)
    if qs == qe:
        return False
    if qs < qe:
        return qs <= t < qe
    return t >= qs or t < qe


def _kind_days_time(prefs: dict, kind: str) -> tuple[list[str], str]:
    if kind == "recipe":
        return prefs["cook_days"], prefs["cook_time"]
    if kind == "workout":
        return prefs["workout_days"], prefs["workout_time"]
    return ["sat", "sun"], prefs["weekend_time"]


def load_accepted(user_id: str) -> list[dict]:
    """Accepted plans as [{start_utc, end_utc}] for overlap and daily-cap checks."""
    from . import db

    out = []
    for p in db.plans().find(
        {"user_id": user_id, "status": "accepted", "scheduled_for": {"$ne": None}},
        {"scheduled_for": 1, "ends_at": 1},
    ):
        start = as_utc(p["scheduled_for"])
        end = as_utc(p["ends_at"]) if p.get("ends_at") else start + timedelta(minutes=60)
        out.append({"start_utc": start, "end_utc": end, "plan_id": p["_id"]})
    return out


def _count_on_date(day, tz, items: Iterable[dict]) -> int:
    return sum(1 for it in items if as_utc(it["start_utc"]).astimezone(tz).date() == day)


def find_free_slot(
    user: dict,
    kind: str,
    not_before: datetime | str | None = None,
    not_after: datetime | str | None = None,
    duration_min: int | None = None,
    reserved: list[dict] | None = None,
    *,
    now: datetime | None = None,
    accepted: list[dict] | None = None,
) -> list[dict]:
    """Up to 5 free slots for a kind, earliest first.

    reserved and accepted are [{start_utc, end_utc}]. Returns
    [{start_local, big_time, long_day, start_utc, duration_min}].
    """
    tz = tz_of(user)
    prefs = user["prefs"]
    now_l = as_utc(now or now_utc()).astimezone(tz)
    reserved = reserved or []
    if accepted is None:
        accepted = load_accepted(user["_id"])

    def _coerce(v: datetime | str | None) -> datetime | None:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            try:
                return parse_local(v, tz)
            except ValueError:
                return None
        return as_utc(v).astimezone(tz)

    nb = max(_coerce(not_before) or now_l, now_l + timedelta(minutes=60))
    na = _coerce(not_after) or nb + timedelta(days=14)
    days, hhmm = _kind_days_time(prefs, kind)
    at = parse_hhmm(hhmm)
    dur = int(duration_min or DEFAULT_DURATION.get(kind, 60))
    dur = max(15, min(dur, 240))

    # A preferred time the user set inside their own quiet window (7 am workouts
    # with quiet until 8) is a deliberate choice, so quiet hours don't block it.
    qs, qe = prefs["quiet_start"], prefs["quiet_end"]
    respect_quiet = not in_quiet(at, qs, qe)

    busy = [(as_utc(a["start_utc"]), as_utc(a["end_utc"])) for a in list(accepted) + list(reserved)]
    out: list[dict] = []
    day = nb.date()
    last = na.date()
    while day <= last and len(out) < MAX_SLOTS:
        this_day = day
        day = day + timedelta(days=1)
        if DAY_KEYS[this_day.weekday()] not in days:
            continue
        start = datetime.combine(this_day, at, tzinfo=tz)
        end = start + timedelta(minutes=dur)
        if start < nb or start > na:
            continue
        # A slot that ends exactly when quiet hours begin is fine, so test its last minute.
        last_minute = (end - timedelta(minutes=1)).time()
        if respect_quiet and (in_quiet(start.time(), qs, qe) or in_quiet(last_minute, qs, qe)):
            continue
        if any(start < b_end and end > b_start for b_start, b_end in busy):
            continue
        taken = _count_on_date(this_day, tz, accepted) + _count_on_date(this_day, tz, reserved)
        if taken >= int(prefs.get("daily_cap", 2)):
            continue
        out.append(
            {
                "start_local": start.strftime("%Y-%m-%dT%H:%M"),
                "big_time": big_time(start, now_l),
                "long_day": long_day(start, now_l),
                "start_utc": as_utc(start),
                "duration_min": dur,
            }
        )
    return out


def public_slot(slot: dict) -> dict:
    """The part of a slot the model sees."""
    return {k: slot[k] for k in ("start_local", "big_time", "long_day")}


# ---------- reminder times (code only) ----------


def adjust_reminder(due_local: datetime, user: dict, accepted: list[dict]) -> datetime:
    """Move a reminder out of quiet hours (to quiet_end) and off days at the daily cap."""
    prefs = user["prefs"]
    tz = due_local.tzinfo
    qs, qe = prefs["quiet_start"], prefs["quiet_end"]
    if in_quiet(due_local.time(), qs, qe):
        end_t = parse_hhmm(qe)
        moved = datetime.combine(due_local.date(), end_t, tzinfo=tz)
        if moved <= due_local:
            moved += timedelta(days=1)
        due_local = moved
    cap = int(prefs.get("daily_cap", 2))
    for _ in range(14):
        if _count_on_date(due_local.date(), tz, accepted) < cap:
            break
        due_local = due_local + timedelta(days=1)
    return due_local


def reminder_due(
    case: str,
    user: dict,
    *,
    now: datetime | None = None,
    accepted: list[dict] | None = None,
    event_start: datetime | None = None,
) -> datetime | None:
    """Reminder time for a case, as an aware UTC datetime.

    Cases: product, week, place, event_no_date, event_ticket.
    event_ticket returns None unless tomorrow 18:00 is at least a day before the event.
    """
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    if accepted is None:
        accepted = load_accepted(user["_id"])
    today = now_l.date()

    def at(days: int, hh: int) -> datetime:
        return datetime.combine(today + timedelta(days=days), time(hh, 0), tzinfo=tz)

    if case == "product":
        due = at(3, 18)
    elif case == "place":
        ahead = (5 - today.weekday()) % 7 or 7  # next Saturday, never today
        due = at(ahead, 10)
    elif case == "event_no_date":
        due = at(2, 18)
    elif case == "event_ticket":
        due = at(1, 18)
        if event_start is None or as_utc(event_start) - as_utc(due) < timedelta(days=1):
            return None
        return as_utc(adjust_reminder(due, user, []))
    else:  # tip, other, "Remind me in a week"
        due = at(7, 9)
    return as_utc(adjust_reminder(due, user, accepted))


def slot_from_local(start_local: str, user: dict, kind: str, *, now: datetime | None = None,
                    duration_min: int | None = None) -> dict:
    """Build a slot dict for an explicit local start (web Change, event dates)."""
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    start = parse_local(start_local, tz)
    return {
        "start_local": local_str(start, tz),
        "big_time": big_time(start, now_l),
        "long_day": long_day(start, now_l),
        "start_utc": as_utc(start),
        "duration_min": int(duration_min or DEFAULT_DURATION.get(kind, 60)),
    }
