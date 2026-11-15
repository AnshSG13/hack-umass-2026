"""The week on Home: seven days, the free time in them, and one shopping list.

All in code, no model call:
- days: the next seven days (the same rolling week as /api/plans), with how many plans each has;
- free: the first free slot per day from the person's own week settings (cook evenings,
  workout mornings, weekend afternoons), each with up to two saved reels that fit it and are
  still waiting for a time, so one tap can fill it;
- groceries: the ingredients of every recipe planned this week, merged into one list.
"""
from __future__ import annotations

import re
from datetime import timedelta

from . import actions, db, slots
from .timeutil import DAY_LONG, DAY_SHORT, as_utc, big_time, now_utc, tz_of, week_bounds

# Which saves fit which kind of free time, and how the free time is named.
SLOT_KINDS = [("recipe", "Free to cook"), ("workout", "Free to work out"), ("place", "Free to go out")]
SUGGEST = 2
FREE_MAX = 4


def _norm(item: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", (item or "").lower())
    s = " ".join(w for w in s.split() if w not in {"fresh", "large", "small", "chopped", "minced", "diced"})
    return re.sub(r"(?<=[a-z])s\b", "", s).strip()  # "onions" and "onion" are one line


def merge_groceries(recipes: list[tuple[str, str, list[dict]]]) -> list[dict]:
    """[(save_id, title, ingredients)] -> one list, one line per ingredient. Amounts in the same
    unit add up; different units are listed side by side. Sorted by name."""
    lines: dict[str, dict] = {}
    for save_id, title, ings in recipes:
        for i in ings:
            key = _norm(i.get("item") or "")
            if not key:
                continue
            row = lines.setdefault(key, {"item": " ".join(str(i["item"]).split()), "amounts": {}, "for": []})
            unit = (i.get("unit") or "").strip().lower()
            try:
                q = float(i.get("qty"))
            except (TypeError, ValueError):
                q = None
            if q is not None:
                row["amounts"][unit] = row["amounts"].get(unit, 0.0) + q
            if title not in row["for"]:
                row["for"].append(title)
    out = []
    for key in sorted(lines):
        row = lines[key]
        amount = " + ".join(" ".join(p for p in (actions.fmt_qty(q), u) if p) for u, q in row["amounts"].items())
        out.append({"key": key, "item": row["item"], "amount": amount, "for": row["for"]})
    return out


def _suggestions(user: dict, kind: str, used: set) -> list[dict]:
    """Saves of this kind with no time yet, not already suggested: the ones waiting on a
    decision first, then ones saved without a plan, newest first within each."""
    plans = list(db.plans().find({"user_id": user["_id"], "kind": kind,
                                  "status": {"$in": ["proposed", "later", "declined"]}},
                                 {"save_id": 1, "status": 1}).sort("created_at", -1).limit(20))
    plans.sort(key=lambda p: p["status"] == "declined")  # stable: keeps newest first within each
    ids = [p["save_id"] for p in plans if p["save_id"] not in used]
    if not ids:
        return []
    saves = {s["_id"]: s for s in db.saves().find({"_id": {"$in": ids}, "user_id": user["_id"]},
                                                 {"title": 1, "thumb_id": 1, "type": 1})}
    out = []
    for sid in ids:
        s = saves.get(sid)
        if s:
            out.append({"save_id": str(sid), "title": s.get("title") or "Saved reel", "type": s.get("type"),
                        "thumb_url": f"/api/t/{s['thumb_id']}" if s.get("thumb_id") else None})
        if len(out) == SUGGEST:
            break
    return out


def build(user: dict, *, now=None) -> dict:
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    start, end = week_bounds(now_l)
    uid = user["_id"]
    accepted = slots.load_accepted(uid)

    planned = list(db.plans().find({"user_id": uid, "status": "accepted",
                                    "scheduled_for": {"$gte": as_utc(start), "$lt": as_utc(end)}},
                                   {"scheduled_for": 1, "kind": 1, "save_id": 1}))
    per_day: dict = {}
    for p in planned:
        d = as_utc(p["scheduled_for"]).astimezone(tz).date()
        per_day[d] = per_day.get(d, 0) + 1
    days = []
    for n in range(7):
        d = (start + timedelta(days=n)).date()
        days.append({"date": d.isoformat(), "short": DAY_SHORT[d.weekday()], "long": DAY_LONG[d.weekday()],
                     "num": d.day, "today": n == 0, "planned": per_day.get(d, 0)})

    # Free time: the first open slot per day from their own settings, with saves that fit.
    by_day: dict = {}
    for kind, label in SLOT_KINDS:
        for s in slots.find_free_slot(user, kind, not_after=end, accepted=accepted, now=now):
            d = as_utc(s["start_utc"]).astimezone(tz).date()
            if d < end.date() and d not in by_day:
                by_day[d] = (kind, label, s)
    free, used = [], set()
    for d in sorted(by_day):
        kind, label, s = by_day[d]
        picks = _suggestions(user, kind, used)
        if not picks:
            continue
        used.update(db.oid(p["save_id"]) for p in picks)
        local = as_utc(s["start_utc"]).astimezone(tz)
        free.append({"date": d.isoformat(), "kind": kind, "label": label, "start_local": s["start_local"],
                     "when": big_time(local, now_l), "day": DAY_LONG[d.weekday()], "suggestions": picks})
        if len(free) == FREE_MAX:
            break

    # One shopping list for the recipes planned this week, still to cook.
    recipe_ids = [p["save_id"] for p in planned if p.get("kind") == "recipe"
                  and as_utc(p["scheduled_for"]) >= as_utc(now_l) - timedelta(hours=3)]
    recipes = []
    if recipe_ids:
        for s in db.saves().find({"_id": {"$in": recipe_ids}, "user_id": uid}, {"title": 1, "fields": 1}):
            ings = actions.ingredients(s.get("fields"))
            if ings:
                recipes.append((str(s["_id"]), s.get("title") or "Saved recipe", ings))
    return {"days": days, "free": free,
            "groceries": {"items": merge_groceries(recipes),
                          "recipes": [{"save_id": sid, "title": t} for sid, t, _ in recipes]}}
