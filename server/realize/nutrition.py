"""Macros for a recipe reel, looked up on the web when someone asks in the reel's chat.

Reels almost never give nutrition, so a question like "what are the macros?" is answered
from a web search (Gemini's Google Search tool), the same way trip plans find prices. The
search looks for the recipe's own published nutrition first (many creators post it on
their site), and otherwise for standard values of the reel's ingredients and amounts.

Code keeps a number only when the search returned a source for it, rounds it, checks it is
plausible, and writes the answer's sentences itself, so no number reaches the person
without a link to where it came from.
"""
from __future__ import annotations

import re

from . import actions, gemini
from .trip import research

NUTRIENTS = [("calories", "calories", ""), ("protein_g", "protein", " g"),
             ("carbs_g", "carbs", " g"), ("fat_g", "fat", " g"),
             ("fiber_g", "fiber", " g"), ("sugar_g", "sugar", " g"), ("sodium_mg", "sodium", " mg")]
LIMITS = {"calories": 6000, "protein_g": 400, "carbs_g": 800, "fat_g": 400, "fiber_g": 150,
          "sugar_g": 500, "sodium_mg": 20000}
ASK = re.compile(
    r"\b(macros?|calories?|calorie count|kcals?|cals?|protein|carbs?|carbohydrates?|fats?|nutrition(al)?|"
    r"nutrients?|fib(er|re)|sugars?|sodium|salt content|healthy|keto|low.carb|high.protein)\b", re.I)
NOT_FOUND = ("I couldn't find nutrition for this recipe from a source I can link, so I won't guess. "
             "The reel doesn't give it either.")

_S = {"type": "string"}
_N = {"type": "number"}
_I = {"type": "integer"}
SCHEMA: dict = {
    "type": "object",
    "properties": {
        "basis": {"type": "string", "enum": ["published", "estimated", "none"],
                  "description": "published: the recipe's own page states nutrition. estimated: built from "
                                 "ingredient values. none: nothing usable in the notes."},
        "per": {"type": "string", "enum": ["serving", "recipe"]},
        "servings": {"type": "integer", "description": "How many servings the numbers assume, or 0"},
        **{k: _N for k, _, _ in NUTRIENTS},
        **{f"{k}_source": _I for k, _, _ in NUTRIENTS},
        "note": {"type": "string", "description": "One plain sentence with no numbers, or empty"},
    },
    "required": ["basis", "per"],
}


def wants_nutrition(save: dict, message: str) -> bool:
    """A recipe reel and a question about macros, calories or nutrients."""
    return save.get("type") == "recipe" and bool(ASK.search(message or ""))


def _recipe_block(save: dict) -> str:
    r = (save.get("fields") or {}).get("recipe") or {}
    creator = (save.get("creator") or {}).get("handle")
    lines = [f"RECIPE: {save.get('title') or 'Untitled'}" + (f" (by @{creator} on Instagram)" if creator else "")]
    if r.get("servings"):
        lines.append(f"SERVES: {r['servings']}")
    ings = actions.ingredients(save.get("fields"))
    if ings:
        lines.append("INGREDIENTS FROM THE REEL:")
        lines += [f"- {actions.ingredient_line(i)}" for i in ings]
    if save.get("url"):
        lines.append(f"REEL: {save['url']}")
    return "\n".join(lines)


def _src(n, count: int) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        return 0
    return v if 1 <= v <= count else 0


def clean(raw: dict, sources: list[dict], recipe_servings: int | None) -> dict | None:
    """What the model read from the notes, after the rules: a number stays only with a real
    source and a plausible size. Returns None when nothing is left. Sources are renumbered so
    the answer lists only the ones its numbers use."""
    if raw.get("basis") not in ("published", "estimated"):
        return None
    kept: dict[str, dict] = {}
    used: list[int] = []
    for key, _, _ in NUTRIENTS:
        n = _src(raw.get(f"{key}_source"), len(sources))
        try:
            v = float(raw.get(key))
        except (TypeError, ValueError):
            continue
        if not n or not 0 <= v <= LIMITS[key] or (key == "calories" and v < 1):
            continue
        if n not in used:
            used.append(n)
        kept[key] = {"value": int(round(v)), "source": used.index(n) + 1}
    if "calories" not in kept and not {"protein_g", "carbs_g", "fat_g"} & kept.keys():
        return None
    per = raw.get("per") if raw.get("per") in ("serving", "recipe") else "serving"
    try:
        servings = int(raw.get("servings") or 0) or None
    except (TypeError, ValueError):
        servings = None
    servings = servings or recipe_servings
    note = " ".join(str(raw.get("note") or "").split())
    if re.search(r"\d", note) or len(note) > 180:
        note = ""  # a number in the note would have no source
    return {"basis": raw["basis"], "per": per, "servings": servings if servings and servings < 100 else None,
            "values": kept, "note": note.replace("—", ", "),
            "sources": [{"n": i + 1, "title": sources[n - 1].get("title") or "", "url": sources[n - 1]["url"]}
                        for i, n in enumerate(used)]}


def sentence(m: dict) -> str:
    """The answer, written in code from the kept numbers."""
    parts = [f"{v['value']}{unit} {name}" if name != "calories" else f"{v['value']} calories"
             for key, name, unit in NUTRIENTS if (v := m["values"].get(key))]
    if m["per"] == "serving":
        head = f"Per serving (the recipe makes {m['servings']})" if m["servings"] else "Per serving"
    else:
        head = "For the whole recipe"
    lines = [f"{head}: about {', '.join(parts)}."]
    lines.append("These are the numbers published for this recipe." if m["basis"] == "published"
                 else "This is an estimate from the ingredients. The reel doesn't give nutrition.")
    if m["note"]:
        lines.append(m["note"])
    return " ".join(lines)


def answer(save: dict, message: str, step) -> dict:
    """Search, read, keep what is sourced. `step` is Run.step, for the run's trace."""
    r = (save.get("fields") or {}).get("recipe") or {}
    base = r.get("servings") if isinstance(r.get("servings"), int) and r["servings"] > 0 else None
    block = _recipe_block(save)
    sources: list[dict] = []
    with step("nutrition_search", {"question": message[:200]}) as h:
        notes = research(
            "Someone saved this recipe from an Instagram reel and asked about its nutrition.\n"
            f"{block}\nTHEIR QUESTION: {message[:300]}\n\n"
            "Use Google Search. First look for this exact recipe's own published nutrition facts, for "
            "example on the creator's website, and say which page and whether it is per serving. If there "
            "is none, look up standard nutrition values for each ingredient amount above and add them up "
            "for the whole recipe, then divide by the servings. Report calories, protein, carbohydrates, "
            "fat, and fiber, sugar and sodium if found. One fact per line. Only report what the search "
            "results say. No introduction and no closing remarks.", sources, timeout_s=60)
        h["result"] = {"sources": len(sources)}
    if not sources:
        return {"text": NOT_FOUND, "at_sec": None, "from_reel": False, "web": True, "sources": [], "macros": None}
    raw = gemini.generate_json(
        role="fast", schema=SCHEMA, timeout_s=40,
        system=("You read research notes about one recipe's nutrition and fill the fields. Rules:\n"
                "- basis: published when the notes quote the recipe's own nutrition facts; estimated when "
                "they add up ingredient values; none when the notes have no usable numbers.\n"
                "- Every number must appear in the notes. Put the [n] marker that backs it in its _source "
                "field. When the notes don't give a nutrient, leave it out. Never estimate a number yourself.\n"
                "- per and servings: what the numbers in the notes describe. Prefer per serving.\n"
                "- note: at most one plain sentence with no numbers, only if it helps (a lighter swap), "
                "else empty. Sentence case, no em dashes."),
        input=f"{block}\nTHEIR QUESTION: {message[:300]}\n\nRESEARCH NOTES:\n{notes}\n\nSOURCES:\n"
              + "\n".join(f"[{s['n']}] {s['title']}" for s in sources))
    m = clean(raw, sources, base)
    if not m:
        return {"text": NOT_FOUND, "at_sec": None, "from_reel": False, "web": True, "sources": [], "macros": None}
    macros = {"basis": m["basis"], "per": m["per"], "servings": m["servings"], "values": m["values"]}
    return {"text": sentence(m), "at_sec": None, "from_reel": False, "web": True,
            "sources": m["sources"], "macros": macros}
