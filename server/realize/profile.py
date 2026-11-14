"""The intro profile and the starter sub-categories Gemini makes from it.

The intro asks how someone identifies, their age, ethnicity, interests, hobbies and skills.
Identity and ethnicity are stored but never sent to Gemini: what gets filed where comes from
what someone said they like, not from who they are.

From interests, hobbies and skills Gemini proposes starter sub-categories inside each type
("Food > Weeknight dinners", "Fitness > Running"). They are stored on the profile and
offered to the model next to the labels the user already has (subcats.prompt_line), so the
first reels land in them. When a reel fits none, the model makes a new one as before.
"""
from __future__ import annotations

import logging
from typing import Any

from . import db, gemini, subcats
from .config import get_settings

log = logging.getLogger("realize.profile")

STARTER_TYPES = ["recipe", "event", "place", "workout", "product", "tip"]
STARTERS_PER_TYPE = 4
SUGGEST_TIMEOUT_S = 12
STARTER_TIMEOUT_S = 25
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
    """Interests, hobbies, skills and age range. Never identity or ethnicity."""
    p = profile or {}
    lines = []
    for label, field in (("Interests", "interests"), ("Hobbies", "hobbies"), ("Skills", "skills")):
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


def starters(user_id: str) -> dict[str, list[str]]:
    u = db.users().find_one({"_id": user_id}, {"profile.starters": 1})
    raw = (((u or {}).get("profile") or {}).get("starters")) or {}
    return {t: [s for s in v if isinstance(s, str)] for t, v in raw.items() if t in STARTER_TYPES and isinstance(v, list)}


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


# ---------- starter sub-categories ----------

STARTER_SCHEMA = {"type": "object", "properties": {
    t: {"type": "array", "items": {"type": "string"}} for t in STARTER_TYPES}}

STARTER_SYSTEM = f"""You set up an app where people save short videos (Instagram reels) and turn them into plans.
Every save has a type and one sub-category inside that type. Types: recipe (food), event, place,
workout (fitness), product, tip (learning). From what this person likes, propose the sub-categories
their saves will most likely be filed into, up to {STARTERS_PER_TYPE} per type.
{subcats.GUIDE.split(". Reuse")[0]}.
Only fill a type when something they like points to it; leave the others empty. Names are specific
to this person but broad enough to hold many reels ("Weeknight dinners", not "Food" and not
"Spicy vegan ramen"). Sentence case: capitalize only the first word and proper nouns
("Weeknight dinners", "Thai food", not "Weeknight Dinners"). No emoji, no two that overlap."""


def make_starters(profile: dict) -> dict[str, list[str]]:
    """{type: [label, ...]} from the profile, or {} without Gemini or on any error."""
    lines = taste_lines(profile)
    if not lines or not live():
        return {}
    try:
        out: dict[str, Any] = gemini.generate_json(
            role="fast", input="\n".join(lines), schema=STARTER_SCHEMA,
            system=STARTER_SYSTEM, timeout_s=STARTER_TIMEOUT_S, retries=1)
    except Exception as e:  # noqa: BLE001
        log.warning("starter sub-categories failed: %s", str(e)[:160])
        return {}
    result: dict[str, list[str]] = {}
    for t in STARTER_TYPES:
        names: list[str] = []
        for raw in out.get(t) or []:
            name = subcats.snap(subcats.clean(raw), names)
            if name and name not in names:
                names.append(name)
        if names:
            result[t] = names[:STARTERS_PER_TYPE]
    return result
