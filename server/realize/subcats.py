"""Sub-categories: one short label per save that groups it inside its type
("Food > Dessert", "Fitness > Strength").

The model proposes the label while it reads the reel (planner and video pass), shown the
user's existing labels so it can reuse one. Code cleans the label and snaps it onto an
existing one when they only differ in case, spacing, punctuation or a plural "s", so a
user never ends up with "Dessert", "desserts" and "Desserts!" side by side.
"""
from __future__ import annotations

import re

from . import db

MAX_LEN = 32
MAX_WORDS = 4
PROMPT_PER_TYPE = 12  # existing labels shown to the model per type


def clean(label: object) -> str | None:
    """A tidy label, or None when there is nothing usable."""
    if not isinstance(label, str):
        return None
    text = " ".join(label.replace("_", " ").split()).strip(" #.,;:!?-/>›»|\"'")
    if not text or len(text) > MAX_LEN or len(text.split()) > MAX_WORDS:
        return None
    # "dessert" and "DESSERT" become "Dessert"; "BBQ" and "Thai food" stay as written.
    if text.islower() or (text.isupper() and len(text) > 4):
        text = text.lower()
        text = text[0].upper() + text[1:]
    return text


def key(label: str) -> str:
    """Compare form: lowercase letters and digits, each word without a trailing plural s."""
    words = re.findall(r"[a-z0-9]+", label.lower().replace("&", " and "))
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words)


def snap(label: str | None, existing: list[str]) -> str | None:
    """The existing label this one means, else the label itself."""
    if not label:
        return None
    k = key(label)
    for name in existing:
        if key(name) == k:
            return name
    return label


def counts(user_id: str, type: str | None = None) -> dict[str, list[dict]]:
    """{type: [{name, count}, ...]} for this user, largest first."""
    match: dict = {"user_id": user_id, "subcategory": {"$type": "string"}}
    if type:
        match["type"] = type
    out: dict[str, list[dict]] = {}
    rows = db.saves().aggregate([
        {"$match": match},
        {"$group": {"_id": {"t": "$type", "s": "$subcategory"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1, "_id.s": 1}},
    ])
    for r in rows:
        out.setdefault(r["_id"]["t"], []).append({"name": r["_id"]["s"], "count": r["n"]})
    return out


def _starters(user_id: str) -> dict[str, list[str]]:
    from . import profile  # noqa: PLC0415 - profile imports this module

    return profile.starters(user_id)


def _merge(used: list[str], extra: list[str]) -> list[str]:
    """Used labels first, then starters that aren't already there under another spelling."""
    out = list(used)
    keys = {key(n) for n in out}
    for name in extra:
        if key(name) not in keys:
            keys.add(key(name))
            out.append(name)
    return out


def existing(user_id: str, type: str | None) -> list[str]:
    """Labels this user has for a type: ones in use, then the intro's starters."""
    if not type:
        return []
    used = [x["name"] for x in counts(user_id, type).get(type, [])]
    return _merge(used, _starters(user_id).get(type, []))


def resolve(user_id: str, type: str | None, label: object) -> str | None:
    """Clean a proposed label and snap it onto this user's labels for that type."""
    return snap(clean(label), existing(user_id, type))


def prompt_line(user_id: str) -> str:
    """The user's labels for the model, so it reuses them instead of inventing near-twins."""
    from . import profile  # noqa: PLC0415

    by_type = {t: [x["name"] for x in rows] for t, rows in counts(user_id).items()}
    for t, names in _starters(user_id).items():
        by_type[t] = _merge(by_type.get(t, []), names)
    about = profile.about_line(user_id)
    if not by_type:
        line = "EXISTING SUB-CATEGORIES: none yet"
    else:
        parts = [f"{t}: {', '.join(names[:PROMPT_PER_TYPE])}" for t, names in sorted(by_type.items())]
        line = "EXISTING SUB-CATEGORIES: " + "; ".join(parts)
    return f"{about}\n{line}" if about else line


GUIDE = (
    "subcategory: one short label, 1 to 3 words, that groups this save inside its type, the way "
    "a person would file it (recipe: Dessert, Thai, Quick dinners; workout: Strength, Mobility; "
    "place: Coffee, Date night; product: Skincare; tip: Productivity). It is a group, not the "
    "title: never the dish or product name. Reuse a label from EXISTING SUB-CATEGORIES for the "
    "same type when it fits; make a new one only when none does."
)
