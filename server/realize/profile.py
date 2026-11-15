"""The intro profile, and the first categories made from it.

The intro asks how someone identifies, their age, ethnicity, interests and hobbies.
Identity and ethnicity are stored but never sent to Gemini: what gets filed where comes from
what someone said they like, not from who they are.

Each interest and hobby becomes one of the person's first categories, as written ("Baking",
"Broadway musicals"). They are stored on the profile and offered to the model next to the
categories already in use (subcats.prompt_line), so the first reels land in them. When a reel
fits none, the model makes a new category, as it does for sub-categories.
"""
from __future__ import annotations

import logging

from . import db, gemini, subcats
from .config import get_settings

log = logging.getLogger("realize.profile")

SUGGEST_TIMEOUT_S = 12
PREFER_NOT = "Prefer not to say"

# The fixed chips on "Choose what you like". Gemini adds more specific ones on top.
INTERESTS = [
    "Food and cooking", "Fitness", "Travel", "Fashion", "Beauty", "Home and decor",
    "Tech", "Music", "Art and design", "Books", "Movies and TV", "Gaming", "Sports",
    "Outdoors", "Pets", "Money", "Career", "Wellness", "Comedy", "DIY and crafts",
    "Science", "Parenting", "Cars", "Nightlife",
]


def live() -> bool:
    s = get_settings()
    return s.planner_mode != "fake" and bool(s.gemini_api_key)


def taste_lines(profile: dict | None) -> list[str]:
    """Interests, hobbies and age range. Never identity or ethnicity."""
    p = profile or {}
    lines = []
    for label, field in (("Interests", "interests"), ("Hobbies", "hobbies")):
        vals = [str(v) for v in (p.get(field) or []) if str(v).strip()]
        if vals:
            lines.append(f"{label}: {', '.join(vals[:20])}")
    if p.get("age_range") and p["age_range"] != PREFER_NOT:
        lines.append(f"Age range: {p['age_range']}")
    return lines


def about_line(user_id: str) -> str | None:
    """One prompt line for the planner and the video pass, or None without a profile."""
    u = db.users().find_one({"_id": user_id}, {"profile": 1})
    lines = taste_lines((u or {}).get("profile"))
    return "ABOUT THE USER (from their intro): " + "; ".join(lines) if lines else None


def starters(user_id: str) -> list[str]:
    """The categories made from the intro. Accounts from the first version of the intro have
    {type: [labels]}; those labels count too."""
    u = db.users().find_one({"_id": user_id}, {"profile.starters": 1})
    raw = (((u or {}).get("profile") or {}).get("starters")) or []
    if isinstance(raw, dict):
        raw = [x for v in raw.values() if isinstance(v, list) for x in v]
    return [x for x in raw if isinstance(x, str) and x.strip()] if isinstance(raw, list) else []


# ---------- "More for you" interest chips ----------

SUGGEST_SCHEMA = {"type": "object", "properties": {
    "suggestions": {"type": "array", "items": {"type": "string"}}}, "required": ["suggestions"]}

SUGGEST_SYSTEM = """You help someone pick interests for an app that turns saved short videos into plans.
Given the broad interests they picked, suggest more specific interests they might also like,
the way a video app's onboarding does ("Food and cooking" -> "Meal prep", "Korean food", "Baking").
Rules: 8 to 12 suggestions, each 1 to 3 words, sentence case, no emoji, no duplicates of what they
picked, nothing about identity, ethnicity or religion."""


def suggest_interests(picked: list[str], age_range: str | None) -> list[str]:
    picked = [p for p in (subcats.clean(x) for x in picked) if p][:20]
    if not picked or not live():
        return []
    text = "Picked: " + ", ".join(picked)
    if age_range and age_range != PREFER_NOT:
        text += f"\nAge range: {age_range}"
    try:
        out = gemini.generate_json(role="fast", input=text, schema=SUGGEST_SCHEMA,
                                   system=SUGGEST_SYSTEM, timeout_s=SUGGEST_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 - suggestions are a nice-to-have
        log.warning("interest suggestions failed: %s", str(e)[:160])
        return []
    seen = {subcats.key(p) for p in picked} | {subcats.key(i) for i in INTERESTS}
    result = []
    for s in out.get("suggestions") or []:
        name = subcats.clean(s)
        if name and subcats.key(name) not in seen:
            seen.add(subcats.key(name))
            result.append(name)
    return result[:12]


# ---------- starter categories ----------


def make_starters(profile: dict) -> list[str]:
    """The person's interests and hobbies, as written: their first categories."""
    out: list[str] = []
    for raw in [*(profile.get("interests") or []), *(profile.get("hobbies") or [])]:
        name = subcats.clean(raw)
        if name:
            out = subcats.merge(out, [name])
    return out
