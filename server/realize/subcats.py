"""Categories and sub-categories: how a person's saves are filed, two levels, both made as
they go ("Baking > Cakes", "Broadway musicals > Student shows").

A person's first categories are the interests and hobbies from their intro. While a reel is
read (planner and video pass) the model is shown the categories in use with their
sub-categories, and reuses one when it fits; when none does, it names a new category or a
new sub-category. Code cleans every label and snaps it onto an existing one when they only
differ in case, spacing, punctuation or a plural "s", so nobody ends up with "Dessert",
"desserts" and "Desserts!" side by side.

The save's type (recipe, event, ...) is separate: the planner needs it, people don't see it
as a level. Saves filed before categories existed have none; they are shown under their
type's name ("Food") until they are re-sorted.
"""
from __future__ import annotations

import re

from . import db
from .models import TASTE_LABELS

MAX_LEN = 32
MAX_WORDS = 4
PROMPT_CATEGORIES = 25  # categories shown to the model
PROMPT_SUBS = 8         # sub-categories shown per category


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


def merge(used: list[str], extra: list[str]) -> list[str]:
    """Used labels first, then extra ones that aren't already there under another spelling."""
    out = list(used)
    keys = {key(n) for n in out}
    for name in extra:
        if key(name) not in keys:
            keys.add(key(name))
            out.append(name)
    return out


# ---------- where a save is filed ----------


def category_of(save: dict) -> str | None:
    """The save's category, or its type's name for a save filed before categories."""
    c = save.get("category")
    if isinstance(c, str) and c:
        return c
    return TASTE_LABELS.get(save.get("type") or "")


def filed_under(save: dict, category: str | None, sub: str | None = None) -> bool:
    """For list filters: is this save in that category (and sub-category)?"""
    if category and category_of(save) != category:
        return False
    return not sub or save.get("subcategory") == sub


def category_query(category: str) -> dict:
    """The Mongo filter for one category, including older saves shown under their type's name."""
    legacy = [t for t, label in TASTE_LABELS.items() if label == category]
    if not legacy:
        return {"category": category}
    return {"$or": [{"category": category},
                    {"category": {"$in": [None, ""]}, "type": {"$in": legacy}}]}


# ---------- what this person has ----------


def tree(user_id: str) -> list[dict]:
    """[{name, count, type, subcategories: [{name, count}]}], largest first.

    `type` is the type most of the category's saves have, for its colour and icon.
    """
    cats: dict[str, dict] = {}
    rows = db.saves().find({"user_id": user_id, "type": {"$in": list(TASTE_LABELS)}},
                           {"type": 1, "category": 1, "subcategory": 1})
    for s in rows:
        name = category_of(s)
        if not name:
            continue
        c = cats.setdefault(name, {"name": name, "count": 0, "types": {}, "subs": {}})
        c["count"] += 1
        c["types"][s["type"]] = c["types"].get(s["type"], 0) + 1
        sub = s.get("subcategory")
        if isinstance(sub, str) and sub:
            c["subs"][sub] = c["subs"].get(sub, 0) + 1
    out = []
    for c in sorted(cats.values(), key=lambda c: (-c["count"], c["name"])):
        out.append({
            "name": c["name"], "count": c["count"],
            "type": max(c["types"].items(), key=lambda kv: kv[1])[0],
            "subcategories": [{"name": n, "count": k}
                              for n, k in sorted(c["subs"].items(), key=lambda kv: (-kv[1], kv[0]))],
        })
    return out


def _filed(user_id: str) -> dict[str, list[str]]:
    """{category: [sub-categories]} for saves that really have a category, largest first."""
    out: dict[str, dict[str, int]] = {}
    rows = db.saves().aggregate([
        {"$match": {"user_id": user_id, "category": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": {"c": "$category", "s": "$subcategory"}, "n": {"$sum": 1}}},
    ])
    for r in rows:
        subs = out.setdefault(r["_id"]["c"], {})
        if isinstance(r["_id"].get("s"), str) and r["_id"]["s"]:
            subs[r["_id"]["s"]] = subs.get(r["_id"]["s"], 0) + r["n"]
        else:
            subs.setdefault("", 0)
            subs[""] += r["n"]
    size = {c: sum(v.values()) for c, v in out.items()}
    return {c: [s for s, _ in sorted(v.items(), key=lambda kv: -kv[1]) if s]
            for c, v in sorted(out.items(), key=lambda kv: -size[kv[0]])}


def _starters(user_id: str) -> list[str]:
    from . import profile  # noqa: PLC0415 - profile imports this module

    return profile.starters(user_id)


def categories(user_id: str) -> list[str]:
    """Categories in use, then the intro's interests and hobbies not used yet."""
    return merge(list(_filed(user_id)), _starters(user_id))


def subcategories(user_id: str, category: str | None) -> list[str]:
    if not category:
        return []
    return _filed(user_id).get(category, [])


def resolve(user_id: str, category: object, sub: object) -> tuple[str | None, str | None]:
    """Clean a proposed category and sub-category and snap each onto this user's labels."""
    cat = snap(clean(category), categories(user_id))
    if not cat:
        return None, None
    return cat, snap(clean(sub), subcategories(user_id, cat))


def prompt_line(user_id: str) -> str:
    """The user's categories for the model, so it reuses them instead of inventing near-twins."""
    from . import profile  # noqa: PLC0415

    filed = _filed(user_id)
    names = merge(list(filed), _starters(user_id))[:PROMPT_CATEGORIES]
    if not names:
        line = "EXISTING CATEGORIES: none yet"
    else:
        parts = []
        for n in names:
            subs = filed.get(n, [])[:PROMPT_SUBS]
            parts.append(f"{n} ({', '.join(subs)})" if subs else n)
        line = "EXISTING CATEGORIES (sub-categories in brackets): " + "; ".join(parts)
    about = profile.about_line(user_id)
    return f"{about}\n{line}" if about else line


GUIDE = (
    "category: what this save is about, 1 to 3 words, the way a person would name a folder for "
    "their interests (Baking, Travel, Broadway musicals, Strength training, Skincare). Reuse one "
    "from EXISTING CATEGORIES when it fits; name a new one only when none does. "
    "subcategory: a narrower group inside that category, 1 to 3 words (Baking: Cakes, Cookies; "
    "Travel: Japan, Weekend trips). Reuse one listed for that category when it fits, or name a "
    "new one. Neither is ever the title, the dish or the product name."
)
