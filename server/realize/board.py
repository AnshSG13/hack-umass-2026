"""A taste's board: every save of one type as a card with one quiet line of facts.

Nothing here calls a model. The line under a title is built from fields the reel gave
(a time, a count, a city); a save with none of those shows who posted it instead.
"""
from __future__ import annotations

from datetime import timedelta

from . import db
from .models import TASTE_LABELS
from .timeutil import as_utc, now_utc

MAX_ITEMS = 80
MAX_TAGS = 6
NEW_HOURS = 24
# Hashtags that say nothing about one save among others of its kind.
DULL_TAGS = {"recipe", "recipes", "food", "foodie", "workout", "fitness", "travel", "reels", "reel", "fyp",
             "viral", "explore", "explorepage", "instagood", "trending", "tips", "tip", "product", "products"}


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _minutes(n) -> str:
    """20 -> "20 min", 250 -> "4 h 10 min". Long times read badly in minutes."""
    n = int(n)
    if n < 90:
        return f"{n} min"
    h, m = divmod(n, 60)
    return f"{h} h {m} min" if m else f"{h} h"


def meta_line(save: dict) -> str:
    """At most two facts, joined with a middle dot. Only what the reel gave."""
    t = save.get("type")
    f = (save.get("fields") or {}).get(t) or {}
    parts: list[str] = []
    if t == "recipe":
        if f.get("total_time_min"):
            parts.append(_minutes(f["total_time_min"]))
        if f.get("ingredients"):
            parts.append(_count(len(f["ingredients"]), "ingredient", "ingredients"))
    elif t == "workout":
        if f.get("duration_min"):
            parts.append(_minutes(f["duration_min"]))
        if f.get("exercises"):
            parts.append(_count(len(f["exercises"]), "move", "moves"))
        if not parts and f.get("goal"):
            parts.append(str(f["goal"]))
    elif t == "place":
        places = f.get("places") or []
        city = next((p.get("city") for p in places if p.get("city")), None)
        if city:
            parts.append(str(city))
        if len(places) > 1:
            parts.append(_count(len(places), "place", "places"))
        elif places and not city:
            parts.append(str(places[0].get("name") or ""))
    elif t == "event":
        if f.get("date_text"):
            parts.append(str(f["date_text"]))
        if f.get("venue") or f.get("city"):
            parts.append(str(f.get("venue") or f.get("city")))
    elif t == "product":
        items = f.get("items") or []
        if len(items) > 1:
            parts.append(_count(len(items), "product", "products"))
        elif items:
            parts += [str(x) for x in (items[0].get("brand"), items[0].get("price_hint")) if x]
    elif t == "tip":
        if f.get("key_points"):
            parts.append(_count(len(f["key_points"]), "point", "points"))
    parts = [" ".join(p.split())[:28] for p in parts if p and str(p).strip()][:2]
    if not parts:
        handle = (save.get("creator") or {}).get("handle")
        return f"@{handle}" if handle else ""
    return " · ".join(parts)


def clean_tags(save: dict) -> list[str]:
    seen: list[str] = []
    for x in save.get("tags") or []:
        tag = str(x).strip().lower().lstrip("#")
        if tag and tag not in DULL_TAGS and tag not in seen:
            seen.append(tag)
    return seen


def top_tags(tag_lists: list[list[str]]) -> list[dict]:
    """The filter chips: tags shared by several saves first, never one that is on every save."""
    counts: dict[str, int] = {}
    place: dict[str, int] = {}   # a save lists its most specific tag first
    for tags in tag_lists:
        for i, tag in enumerate(tags):
            counts[tag] = counts.get(tag, 0) + 1
            place[tag] = min(place.get(tag, i), i)
    n = len(tag_lists)
    useful = {k: v for k, v in counts.items() if n <= 1 or v < n}
    ranked = sorted(useful.items(), key=lambda kv: (-kv[1], place[kv[0]], kv[0]))
    return [{"tag": k, "count": v} for k, v in ranked[:MAX_TAGS]]


def board(user: dict, type_: str) -> dict:
    cursor = db.saves().find(
        {"user_id": user["_id"], "type": type_},
        {"title": 1, "type": 1, "fields": 1, "tags": 1, "note": 1, "thumb_id": 1, "creator": 1,
         "created_at": 1, "status": 1},
    ).sort("created_at", -1).limit(MAX_ITEMS)
    fresh_after = now_utc() - timedelta(hours=NEW_HOURS)
    items, tag_lists = [], []
    for s in cursor:
        tags = clean_tags(s)
        tag_lists.append(tags)
        items.append({
            "save_id": str(s["_id"]), "title": s.get("title") or "Saved reel",
            "thumb_url": f"/api/t/{s['thumb_id']}" if s.get("thumb_id") else None,
            "meta": meta_line(s), "tags": tags,
            "has_note": bool((s.get("note") or "").strip()),
            "is_new": as_utc(s["created_at"]) >= fresh_after,
        })
    return {"type": type_, "label": TASTE_LABELS[type_], "count": len(items),
            "tags": top_tags(tag_lists), "items": items}
