"""Nutrition for a recipe: an estimate per serving, shown as one.

Gemini estimates each ingredient line for the amount the reel gives (a model is good at
"2 tablespoons butter is about 200 kcal"). Code does the arithmetic: it rejects values
that can't be right, adds the lines up and divides by servings. Saved on the save, and
rebuilt only when the ingredient list changes.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from datetime import timedelta

from . import actions, db, gemini
from .timeutil import as_utc, now_utc

log = logging.getLogger("realize.nutrition")

TIMEOUT_S = 30
# After a failed estimate, how long before the same ingredients are tried again.
FAILED_RETRY = timedelta(minutes=30)


class _Busy:
    """Save ids whose estimate is being made right now, so two opens make one call."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ids: set[str] = set()

    def acquire(self, key: str) -> bool:
        with self._lock:
            if key in self._ids:
                return False
            self._ids.add(key)
            return True

    def release(self, key: str) -> None:
        with self._lock:
            self._ids.discard(key)


_building = _Busy()
NUTRIENTS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"]
# A single ingredient line above these is a misread, not a recipe.
CEILING = {"kcal": 6000, "protein_g": 400, "carbs_g": 800, "fat_g": 600, "fiber_g": 150,
           "sugar_g": 600, "sodium_mg": 40000}

PROMPT = """Estimate the nutrition of each ingredient line below, for exactly the amount written.
Use typical values (USDA-style) for the plain ingredient. When no amount is given, assume what a
recipe for {servings} servings would normally use and set assumed to true.
Return one entry per line, in the same order, with the line's index.
Give servings: the number of servings the recipe makes ({servings_hint}).

INGREDIENTS
{lines}"""

SCHEMA: dict = {
    "type": "object",
    "properties": {
        "servings": {"type": "integer"},
        "lines": {"type": "array", "items": {
            "type": "object",
            "properties": {"index": {"type": "integer"}, "assumed": {"type": "boolean"},
                           **{n: {"type": "number"} for n in NUTRIENTS}},
            "required": ["index", *NUTRIENTS]}},
    },
    "required": ["servings", "lines"],
}


def fingerprint(ingredients: list[dict]) -> str:
    raw = json.dumps([[i.get("qty"), i.get("unit"), i.get("item")] for i in ingredients], default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def total(raw_lines: list[dict], n_lines: int, servings: int) -> dict | None:
    """Sum the model's per-line estimates and divide by servings. Lines with an index that
    isn't real, or a value that can't be right, are left out. None when too little is left
    to be worth showing."""
    seen: set[int] = set()
    sums = {n: 0.0 for n in NUTRIENTS}
    used = assumed = 0
    for line in raw_lines:
        try:
            i = int(line.get("index"))
        except (TypeError, ValueError):
            continue
        if not 0 <= i < n_lines or i in seen:
            continue
        vals = {}
        for n in NUTRIENTS:
            try:
                v = float(line.get(n) or 0)
            except (TypeError, ValueError):
                v = -1
            vals[n] = v
        if any(v < 0 or v > CEILING[n] for n, v in vals.items()):
            continue
        seen.add(i)
        used += 1
        assumed += bool(line.get("assumed"))
        for n, v in vals.items():
            sums[n] += v
    if n_lines == 0 or used < max(1, round(n_lines * 0.6)):
        return None
    s = max(1, min(int(servings or 1), 24))
    per = {n: round(sums[n] / s) for n in NUTRIENTS}
    # Calories from the macros: a check that the parts agree with the whole.
    from_macros = 4 * sums["protein_g"] + 4 * sums["carbs_g"] + 9 * sums["fat_g"]
    if sums["kcal"] > 0 and not 0.6 <= from_macros / sums["kcal"] <= 1.4:
        per["kcal"] = round(from_macros / s)
    split = {}
    if from_macros > 0:
        split = {"protein": round(400 * sums["protein_g"] / from_macros),
                 "carbs": round(400 * sums["carbs_g"] / from_macros)}
        split["fat"] = 100 - split["protein"] - split["carbs"]
    return {"per_serving": per, "servings": s, "split_pct": split,
            "lines_counted": used, "lines_total": n_lines, "assumed": assumed}


def get_or_build(save: dict) -> dict | None:
    """The saved estimate when the ingredients haven't changed, else a new one. None when the
    recipe has no ingredients or the model doesn't answer."""
    ings = actions.ingredients(save.get("fields"))
    if not ings:
        return None
    fp = fingerprint(ings)
    have = save.get("nutrition") or {}
    if have.get("fingerprint") == fp:
        if have.get("value") is not None:
            return have.get("value")
        # It failed for these ingredients a little while ago: don't pay to fail again on
        # every open of cook mode. After FAILED_RETRY it is tried once more.
        failed = have.get("failed_at")
        if failed and now_utc() - as_utc(failed) < FAILED_RETRY:
            return None
    if not _building.acquire(str(save["_id"])):
        return None  # the same estimate is being made by another request right now
    try:
        return _build(save, ings, fp)
    finally:
        _building.release(str(save["_id"]))


def _build(save: dict, ings: list, fp: str) -> dict | None:
    recipe = (save.get("fields") or {}).get("recipe") or {}
    servings = int(recipe.get("servings") or 0)
    lines = "\n".join(f"{i}. {actions.ingredient_line(x)}" for i, x in enumerate(ings))
    try:
        out = gemini.generate_json(
            role="fast", schema=SCHEMA, timeout_s=TIMEOUT_S,
            input=[gemini.user_step(PROMPT.format(
                servings=servings or "an unknown number of", lines=lines,
                servings_hint=f"the reel says {servings}" if servings else "the reel doesn't say; estimate it"))])
    except Exception as e:  # noqa: BLE001
        log.warning("nutrition failed: %s", str(e)[:200])
        out = None
    value = total(out.get("lines") or [], len(ings), servings or int(out.get("servings") or 1)) if out else None
    if value:
        value["servings_from"] = "reel" if servings else "estimate"
        db.saves().update_one({"_id": save["_id"], "user_id": save["user_id"]},
                              {"$set": {"nutrition": {"fingerprint": fp, "value": value, "at": now_utc()}}})
    else:
        db.saves().update_one({"_id": save["_id"], "user_id": save["user_id"]},
                              {"$set": {"nutrition": {"fingerprint": fp, "value": None, "failed_at": now_utc()}}})
    return value
