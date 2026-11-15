"""Custom categories: new top-level groups for reels that fit none of the fixed kinds.

The seven kinds (TYPES) decide what the app does with a reel (cook mode for a recipe, a
calendar slot for an event, price research for a product), so they stay fixed. A reel that
fits none of them is type "other", and instead of all landing in "Just vibes" it gets a
category of its own ("Pets", "Fashion", "Comedy"). The model names it while it reads the
reel, shown this person's existing categories so it reuses one when it fits; code cleans
the name and snaps it onto an existing one when they only differ in case, spacing,
punctuation or a plural "s" (the same rules as sub-categories, subcats.py).

My collection, the taste boards and the knowledge graph treat each category as its own
kind, so they grow as new kinds of reels are saved. Sub-categories still live inside them.
"""
from __future__ import annotations

from . import db, subcats
from .models import TASTE_LABELS, TYPES

MAX_WORDS = 3
PROMPT_MAX = 20  # existing categories shown to the model

# A category can't be one of the fixed kinds: those reels belong in that kind.
_RESERVED = {subcats.key(x) for x in [*TASTE_LABELS.values(), *TYPES, "other", "misc", "miscellaneous",
                                      "general", "random", "vibes", "fun"]}

GUIDE = (
    "category: only when type is other. One short name, 1 or 2 words, for the kind of thing this "
    "reel is, broad enough to hold more reels like it (Pets, Fashion, Comedy, Music, Cars, Art, "
    "Parenting, Home decor). Never a name for one of the fixed types (Food, Events, Places, "
    "Fitness, Products, Learning). Reuse one from EXISTING CATEGORIES when it fits; make a new "
    "one only when none does. Leave it out for every other type."
)


def clean(label: object) -> str | None:
    """A tidy category name, or None when there is nothing usable or it names a fixed kind."""
    text = subcats.clean(label)
    if not text or len(text.split()) > MAX_WORDS or subcats.key(text) in _RESERVED:
        return None
    return text


def snap(label: str | None, existing: list[str]) -> str | None:
    """The existing category this one means, else the name itself."""
    return subcats.snap(label, existing)


def counts(user_id: str) -> list[dict]:
    """[{name, count}] of this user's categories, largest first."""
    rows = db.saves().aggregate([
        {"$match": {"user_id": user_id, "type": "other", "category": {"$type": "string"}}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
        {"$sort": {"n": -1, "_id": 1}},
    ])
    return [{"name": r["_id"], "count": r["n"]} for r in rows]


def existing(user_id: str) -> list[str]:
    return [c["name"] for c in counts(user_id)]


def resolve(user_id: str, label: object) -> str | None:
    """Clean a proposed name and snap it onto this user's categories."""
    return snap(clean(label), existing(user_id))


def prompt_line(user_id: str) -> str:
    names = existing(user_id)[:PROMPT_MAX]
    return "EXISTING CATEGORIES: " + (", ".join(names) if names else "none yet")


def sub_counts(user_id: str) -> dict[str, list[dict]]:
    """{group: [{name, count}, ...]} of sub-categories, largest first, with custom categories
    as groups of their own (subcats.counts groups by type only)."""
    rows = db.saves().aggregate([
        {"$match": {"user_id": user_id, "subcategory": {"$type": "string"}}},
        {"$group": {"_id": {"t": "$type", "c": "$category", "s": "$subcategory"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1, "_id.s": 1}},
    ])
    out: dict[str, list[dict]] = {}
    for r in rows:
        g = group({"type": r["_id"].get("t"), "category": r["_id"].get("c")})
        if g:
            out.setdefault(g, []).append({"name": r["_id"]["s"], "count": r["n"]})
    return out


def seen_key(group_key: str) -> str:
    """A field name for this group under visits.taste_seen (Mongo field names can't hold ".")."""
    return group_key.replace(".", "_")


def group(save: dict) -> str | None:
    """What a save is filed under at the top: its type, or "other:<category>" for a reel in a
    custom category. None while it is still being read."""
    t = save.get("type")
    if t not in TYPES:
        return None
    c = save.get("category")
    return f"other:{c}" if t == "other" and isinstance(c, str) and c else t


def split(group_key: str) -> tuple[str, str | None]:
    """("other", "Pets") from "other:Pets"; ("recipe", None) from "recipe"."""
    if group_key.startswith("other:"):
        return "other", group_key.split(":", 1)[1]
    return group_key, None


def label(group_key: str) -> str:
    t, c = split(group_key)
    return c or TASTE_LABELS.get(t, t)


def query(group_key: str) -> dict:
    """The Mongo filter for one group. Plain "other" means other reels with no category."""
    t, c = split(group_key)
    if t != "other":
        return {"type": t}
    if c:
        return {"type": "other", "category": c}
    return {"type": "other", "category": {"$not": {"$type": "string"}}}
