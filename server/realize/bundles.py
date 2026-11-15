"""Ready for you: plans built from several saves at once.

A plan elsewhere in the app belongs to one save. A bundle groups saves of one kind into
something to start with one tap: the recipes you saved as this week's dinners with one
merged grocery list, your workouts as a training week, your places as outings, your
product reels as a side-by-side comparison.

The same split as the rest of the app:
- Code decides which saves go together (same type, not already planned), every date and
  time (the same free slots a single plan uses), the merged grocery list, every label.
- Gemini is asked once per bundle for words only: a name, one line about it, a short
  note per save, an order, and for products which one the reels support best. Code
  checks all of it against the saves; without the model the bundle still works.
- Nothing is added to the week until the person taps Start. Starting accepts one plan
  per save through the same code a single plan uses, so times never collide. Recipe
  bundles are never scheduled: they open to cook and to one grocery list.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import timedelta

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from . import actions, board, db, gemini, intent, planops, slots, tickets
from .models import AISLES

# Bundles whose Start books times on the week. Recipes don't: a saved recipe is cooked
# when the person wants to, so a dinners bundle opens with "Start now" and its grocery list.
SCHEDULED = ("workout", "place")
from .timeutil import as_utc, big_time, long_day, now_utc, tz_of

log = logging.getLogger("realize.bundles")

# One action per reel is the rule. Saves are grouped only when doing them together is the
# point: product reels in the same sub-category (three curling irons) become one comparison.
# Recipes, workouts, places and events are never merged; each gets its own action.
TYPES = ["product"]
GROUP_BY_SUBCATEGORY = {"product"}
MIN_SAVES = 2
MAX_SAVES = 4
POOL = 8                    # newest saves of a type considered for one bundle
TITLE_MAX = 34
BLURB_MAX = 110
NOTE_MAX = 70
POLISH_TIMEOUT_S = 25
STARTED_DAYS = 14           # how long a started bundle stays listed
# Saves already on the calendar or finished stay out of a new bundle. A declined plan
# ("just save it") doesn't: that was about one reel on its own, not about a week of them.
PLANNED = ("accepted", "done", "skipped")

# What a bundle is called before (or without) the model: plain and true.
WORDS = {
    "recipe": {"one": "dinner", "many": "dinners", "title": "{n} dinners from your saves",
               "blurb": "Ready when you are, with one grocery list for all of them.",
               "done": "{n} dinners added."},
    "workout": {"one": "workout", "many": "workouts", "title": "{n} workouts, spaced out",
                "blurb": "Your saved workouts on the days you usually train.",
                "done": "{n} workouts added."},
    "place": {"one": "place", "many": "places", "title": "{n} places to go",
              "blurb": "The places you saved, on your free days.",
              "done": "{n} outings added."},
    "product": {"one": "reel", "many": "reels", "title": "Compare {n} product picks",
                "blurb": "Everything those reels recommended, side by side.",
                "done": ""},
}

POLISH_PROMPT = """You name small plans inside Realize, an app that turns saved reels into plans.
Below are {n} {type} reels one person saved. Code has already grouped them. Write the words.

- title: a call to action for what is ready, in at most 30 characters, verb first and specific
  to these reels ("Compare 3 curling irons", "Pick your next serum"). Not generic ("Products").
- blurb: one sentence, at most 100 characters, about what doing these together gets them.
- order: the save_ids in the order to do them (easiest or quickest first). Use every id once.
- notes: for each save_id, at most 60 characters on why it sits where it does or what to know
  ("Quickest one, good for Monday"). Only facts from the reel.
- pick_save_id, pick_name, pick_why: only for product reels. The one product the reels support
  best, named exactly as a reel names it, and why in at most 90 characters using the reel's
  own reasons. For other types leave all three empty.

Sentence case. No em dashes. No exclamation marks. Never invent a time, a price or a claim.

THE REELS
{reels}"""

POLISH_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "blurb": {"type": "string"},
        "order": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "array", "items": {
            "type": "object",
            "properties": {"save_id": {"type": "string"}, "note": {"type": "string"}},
            "required": ["save_id", "note"]}},
        "pick_save_id": {"type": "string"},
        "pick_name": {"type": "string"},
        "pick_why": {"type": "string"},
    },
    "required": ["title", "blurb", "order", "notes"],
}


# ---------- pure helpers ----------


def signature(type_: str, save_ids: list) -> str:
    """The same saves always make the same bundle, whatever order they come in."""
    raw = type_ + ":" + ",".join(sorted(str(i) for i in save_ids))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def clean(text, limit: int) -> str:
    """Model words under the copy rules: one line, no em dashes or exclamation marks, capped."""
    out = re.sub(r"\s*\u2014\s*", ", ", str(text or "")).replace("\u2013", "-").replace("!", ".")
    out = " ".join(out.replace("**", "").split()).strip(" \"'")
    if len(out) > limit:
        out = out[: limit - 1].rstrip(" ,;:") + "\u2026"
    return out


def count_label(type_: str, n: int) -> str:
    w = WORDS[type_]
    return f"{n} {w['one'] if n == 1 else w['many']}"


def _norm_item(name: str) -> str:
    """"Cream cheese, softened" and "cream cheese" are one thing to buy."""
    base = re.split(r"[,(]", str(name or "").lower())[0]
    base = re.sub(r"\b(fresh|large|small|medium|chopped|diced|minced|sliced|softened|cooled|to taste)\b", " ", base)
    return " ".join(base.split())


def merge_groceries(recipes: list[dict]) -> list[dict]:
    """One list for several recipes, grouped by aisle.

    recipes: [{"save_id", "ingredients": [{"item", "qty", "unit", "aisle"}]}].
    The same item from two recipes becomes one line. Quantities add up when the units
    match; otherwise both amounts are kept, because code can't add cups to grams.
    Returns [{"aisle", "items": [{"key", "text", "from": [save_id]}]}] in store order.
    """
    merged: dict[str, dict] = {}
    for r in recipes:
        for ing in r.get("ingredients") or []:
            key = _norm_item(ing.get("item"))
            if not key:
                continue
            m = merged.setdefault(key, {"key": key, "name": str(ing.get("item")).strip(),
                                        "aisle": ing.get("aisle") or "Other", "amounts": [], "from": []})
            if r["save_id"] not in m["from"]:
                m["from"].append(r["save_id"])
            unit = (ing.get("unit") or "").strip().lower()
            try:
                qty = float(ing["qty"]) if ing.get("qty") not in (None, "") else None
            except (TypeError, ValueError):
                qty = None
            if qty is None:
                continue
            same = next((a for a in m["amounts"] if a["unit"] == unit), None)
            if same:
                same["qty"] += qty
            else:
                m["amounts"].append({"qty": qty, "unit": unit})
    order = {a: i for i, a in enumerate(AISLES)}
    groups: dict[str, list[dict]] = {}
    for m in merged.values():
        amount = " + ".join(" ".join(p for p in (actions.fmt_qty(a["qty"]), a["unit"]) if p) for a in m["amounts"])
        name = m["name"] if len(m["from"]) == 1 else m["key"]
        groups.setdefault(m["aisle"], []).append(
            {"key": m["key"], "text": f"{amount} {name}".strip(), "from": m["from"]})
    return [{"aisle": a, "items": sorted(groups[a], key=lambda i: i["key"])}
            for a in sorted(groups, key=lambda a: (order.get(a, len(order)), a))]


def checked_polish(out: dict, type_: str, save_ids: list[str], product_names: dict[str, list[str]]) -> dict:
    """Keep only what the saves support. Anything else falls back to the code-made words."""
    ids = list(save_ids)
    order = [i for i in dict.fromkeys(str(x) for x in out.get("order") or []) if i in ids]
    order += [i for i in ids if i not in order]          # the model can reorder, never drop
    notes = {}
    for n in out.get("notes") or []:
        sid, note = str(n.get("save_id") or ""), clean(n.get("note"), NOTE_MAX)
        if sid in ids and note:
            notes[sid] = note
    result = {"title": clean(out.get("title"), TITLE_MAX), "blurb": clean(out.get("blurb"), BLURB_MAX),
              "order": order, "notes": notes, "pick": None}
    if type_ == "product":
        sid, name = str(out.get("pick_save_id") or ""), clean(out.get("pick_name"), 60)
        named = [n.lower() for n in product_names.get(sid, [])]
        # The pick has to be a product one of these reels actually names.
        if sid in ids and name and any(name.lower() in n or n in name.lower() for n in named):
            result["pick"] = {"save_id": sid, "name": name, "why": clean(out.get("pick_why"), 100)}
    return result


# ---------- which saves go together ----------


def _candidates(user: dict) -> dict[str, list[dict]]:
    """Per type, the newest saves the person hasn't planned yet. Fewer than two is no bundle."""
    out: dict[str, list[dict]] = {}
    for t in TYPES:
        docs = list(db.saves().find(
            {"user_id": user["_id"], "type": t, "status": {"$in": ["planned", "enriching", "ready"]}},
            {"embedding": 0, "transcript": 0, "transcript_text": 0},
        ).sort("created_at", -1).limit(POOL))
        if len(docs) < MIN_SAVES:
            continue
        answered = {p["save_id"] for p in db.plans().find(
            {"user_id": user["_id"], "save_id": {"$in": [d["_id"] for d in docs]},
             "status": {"$in": list(PLANNED)}}, {"save_id": 1})}
        free = [d for d in docs if d["_id"] not in answered]
        if t == "recipe":
            free = [d for d in free if actions.ingredients(d.get("fields"))] or free
        if t == "product":
            free = [d for d in free if ((d.get("fields") or {}).get("product") or {}).get("items")]
        if t in GROUP_BY_SUBCATEGORY:
            # The biggest group of saves that share a sub-category; unrelated saves stay apart.
            groups: dict[str, list[dict]] = {}
            for d in free:
                sub = str(d.get("subcategory") or "").strip().lower()
                if sub:
                    groups.setdefault(sub, []).append(d)
            free = max(groups.values(), key=len) if groups else []
        if len(free) >= MIN_SAVES:
            out[t] = free[:MAX_SAVES]
    return out


def ensure(user: dict) -> list[ObjectId]:
    """Bring the ready bundles in line with the saves. Code only: no model call here.
    Returns the ids of bundles that still want their words from the model."""
    found = _candidates(user)
    want_polish: list[ObjectId] = []
    # Bundles of types no longer grouped (dinners, training weeks, outings) leave the list.
    db.bundles().delete_many({"user_id": user["_id"], "status": "ready", "type": {"$nin": TYPES}})
    for t in TYPES:
        ready = list(db.bundles().find({"user_id": user["_id"], "type": t, "status": "ready"}))
        docs = found.get(t)
        sig = signature(t, [d["_id"] for d in docs]) if docs else None
        for b in ready:
            if b["signature"] != sig:
                # Its saves changed (one was planned, deleted, or a new one arrived).
                db.bundles().delete_one({"_id": b["_id"], "user_id": user["_id"], "status": "ready"})
        if not docs:
            continue
        existing = db.bundles().find_one({"user_id": user["_id"], "type": t, "signature": sig})
        if existing:
            if existing["status"] == "ready" and existing.get("polish") == "pending":
                want_polish.append(existing["_id"])
            continue                                        # started or dismissed: leave it be
        now = now_utc()
        doc = {"_id": ObjectId(), "user_id": user["_id"], "type": t, "signature": sig, "status": "ready",
               "save_ids": [d["_id"] for d in docs], "title": WORDS[t]["title"].format(n=len(docs)),
               "blurb": WORDS[t]["blurb"], "notes": {}, "pick": None, "polish": "pending",
               "created_at": now, "updated_at": now, "started_at": None}
        if user.get("expires_at"):
            doc["expires_at"] = user["expires_at"]
        try:
            db.bundles().insert_one(doc)
            want_polish.append(doc["_id"])
        except DuplicateKeyError:
            pass                                            # two requests at once: one wins
    return want_polish


# ---------- the model's words ----------


def _product_names(saves: list[dict]) -> dict[str, list[str]]:
    return {str(s["_id"]): [str(i.get("name") or "") for i in ((s.get("fields") or {}).get("product") or {})
                            .get("items") or [] if i.get("name")] for s in saves}


def _reel_brief(save: dict) -> str:
    t = save.get("type")
    f = (save.get("fields") or {}).get(t) or {}
    lines = [f"save_id: {save['_id']}", f"title: {save.get('title')}", f"summary: {save.get('summary') or ''}"]
    fact = board.meta_line(save)
    if fact:
        lines.append(f"facts: {fact}")
    if t == "recipe":
        lines.append("ingredients: " + ", ".join(str(i.get("item")) for i in (f.get("ingredients") or [])[:14]))
    elif t == "workout":
        lines.append("exercises: " + ", ".join(str(e.get("name")) for e in (f.get("exercises") or [])[:12]))
        if f.get("goal"):
            lines.append(f"goal: {f['goal']}")
    elif t == "place":
        lines.append("places: " + "; ".join(
            f"{p.get('name')} ({p.get('city') or 'city not given'}): {p.get('why') or ''}"
            for p in (f.get("places") or [])[:8]))
    elif t == "product":
        lines.append("products: " + "; ".join(
            f"{i.get('name')} | brand {i.get('brand') or 'not given'} | price {i.get('price_hint') or 'not given'}"
            f" | why {i.get('why') or 'not given'}" for i in (f.get("items") or [])[:10]))
    return "\n".join(lines)


def polish(bundle_id: ObjectId, user_id: str) -> None:
    """Ask the model for the bundle's words, once. Runs off the request; any failure
    leaves the code-made words in place."""
    b = db.bundles().find_one_and_update(
        {"_id": bundle_id, "user_id": user_id, "status": "ready", "polish": "pending"},
        {"$set": {"polish": "running"}})
    if not b:
        return
    try:
        saves = list(db.saves().find({"_id": {"$in": b["save_ids"]}, "user_id": user_id},
                                     {"embedding": 0, "transcript": 0, "transcript_text": 0}))
        if len(saves) < MIN_SAVES:
            raise RuntimeError("saves are gone")
        ids = [str(s["_id"]) for s in saves]
        prompt = POLISH_PROMPT.format(n=len(saves), type=b["type"],
                                      reels="\n\n".join(_reel_brief(s) for s in saves))
        out = gemini.generate_json(role="fast", input=[gemini.user_step(prompt)], schema=POLISH_SCHEMA,
                                   timeout_s=POLISH_TIMEOUT_S)
        good = checked_polish(out, b["type"], ids, _product_names(saves))
        update: dict = {"polish": "done", "notes": good["notes"], "pick": good["pick"],
                        "save_ids": [db.oid(i) for i in good["order"]], "updated_at": now_utc()}
        if good["title"]:
            update["title"] = good["title"]
        if good["blurb"]:
            update["blurb"] = good["blurb"]
        db.bundles().update_one({"_id": bundle_id, "user_id": user_id}, {"$set": update})
    except Exception as e:  # noqa: BLE001
        log.warning("bundle polish failed: %s", str(e)[:200])
        db.bundles().update_one({"_id": bundle_id, "user_id": user_id}, {"$set": {"polish": "failed"}})


# ---------- views ----------


def _load(bundle: dict, user: dict) -> tuple[list[dict], dict]:
    saves = {s["_id"]: s for s in db.saves().find(
        {"_id": {"$in": bundle["save_ids"]}, "user_id": user["_id"]},
        {"embedding": 0, "transcript": 0, "transcript_text": 0})}
    ordered = [saves[i] for i in bundle["save_ids"] if i in saves]
    plans = {p["save_id"]: p for p in db.plans().find(
        {"user_id": user["_id"], "save_id": {"$in": [s["_id"] for s in ordered]}})}
    return ordered, plans


def view(bundle: dict, user: dict, *, full: bool = False) -> dict:
    tz = tz_of(user)
    now = now_utc()
    now_l = now.astimezone(tz)
    t = bundle["type"]
    saves, plans = _load(bundle, user)
    slot_kind = t in SCHEDULED
    accepted = slots.load_accepted(user["_id"]) if slot_kind else []
    reserved: list[dict] = []
    items = []
    first_start = None
    for s in saves:
        plan = plans.get(s["_id"])
        when = day = None
        status = plan["status"] if plan else None
        start = None
        if slot_kind:
            if plan and plan.get("scheduled_for") and status in ("accepted", "done", "skipped"):
                start = as_utc(plan["scheduled_for"])
            elif bundle["status"] == "ready":
                # What Start would pick: the next free slot, keeping clear of the others here.
                free = slots.find_free_slot(user, t, reserved=reserved, now=now, accepted=accepted)
                if free:
                    start = as_utc(free[0]["start_utc"])
                    reserved.append({"start_utc": start,
                                     "end_utc": start + timedelta(minutes=int(free[0]["duration_min"]))})
            if start:
                local = start.astimezone(tz)
                when, day = big_time(local, now_l), long_day(local, now_l)
                if first_start is None or start < first_start[0]:
                    first_start = (start, day)
        items.append({"save_id": str(s["_id"]), "title": s.get("title") or "Saved reel",
                      "thumb_url": tickets.thumb_url(s), "meta": board.meta_line(s),
                      "note": (bundle.get("notes") or {}).get(str(s["_id"])) or "",
                      "when": when, "plan_status": status})
    n = len(items)
    out = {
        "id": str(bundle["_id"]), "type": t, "status": bundle["status"],
        "title": bundle["title"], "blurb": bundle["blurb"], "count_label": count_label(t, n),
        "items": items, "thumbs": [i["thumb_url"] for i in items if i["thumb_url"]][:3],
        "polishing": bundle.get("polish") in ("pending", "running"),
        # One main button. Slot kinds start on their first day; products only open.
        "cta": (f"Start {first_start[1]}" if slot_kind and first_start and bundle["status"] == "ready"
                else "Start now" if t == "recipe" else "Compare them" if t == "product" else "Open"),
        "can_start": bool(slot_kind and bundle["status"] == "ready" and first_start),
        "first_when": big_time(first_start[0].astimezone(tz), now_l) if first_start else None,
    }
    if not full:
        return out
    if t == "recipe":
        out["groceries"] = merge_groceries(
            [{"save_id": str(s["_id"]), "ingredients": actions.ingredients(s.get("fields"))} for s in saves])
        out["grocery_count"] = sum(len(g["items"]) for g in out["groceries"])
    if t == "product":
        rows = []
        for s in saves:
            for i in ((s.get("fields") or {}).get("product") or {}).get("items") or []:
                if i.get("name"):
                    rows.append({"save_id": str(s["_id"]), "name": str(i["name"]), "brand": i.get("brand") or "",
                                 "price_hint": i.get("price_hint") or "", "why": i.get("why") or "",
                                 "where_to_buy": i.get("where_to_buy") or ""})
        out["products"] = rows[:24]
        out["pick"] = bundle.get("pick")
    return out


SINGLES_MAX = 40
# Saves whose plan is finished with (done, skipped, or "just save it") are not offered again.
# One given a time (accepted) is still an open action until it is done: Home, All actions and
# the reel page all show the same set (owner's call, 2026-11-14).
ANSWERED = ("done", "skipped", "declined")


def singles(user: dict, exclude: set) -> list[dict]:
    """One action per reel, newest first: what is ready for each save that hasn't been acted
    on. The words are the plan's action (the model's call to action, checked by code)."""
    docs = list(db.saves().find(
        {"user_id": user["_id"], "status": {"$in": ["planned", "enriching", "ready"]},
         "type": {"$in": [t for t in intent.DEFAULT_DELIVER if t != "other"]}},
        {"embedding": 0, "transcript": 0, "transcript_text": 0}).sort("created_at", -1).limit(80))
    docs = [d for d in docs if d["_id"] not in exclude]
    plans = {p["save_id"]: p for p in db.plans().find(
        {"user_id": user["_id"], "save_id": {"$in": [d["_id"] for d in docs]}})} if docs else {}
    out = []
    for s in docs:
        plan = plans.get(s["_id"])
        if plan and plan.get("status") in ANSWERED:
            continue
        a = intent.view(plan, s)
        if not a or a["deliver"] == "keep":
            continue
        out.append({"save_id": str(s["_id"]), "type": s.get("type"), "title": s.get("title") or "Saved reel",
                    "thumb_url": tickets.thumb_url(s), "meta": board.meta_line(s), **a})
        if len(out) >= SINGLES_MAX:
            break
    return out


def listing(user: dict) -> dict:
    ready = list(db.bundles().find({"user_id": user["_id"], "status": "ready", "type": {"$in": TYPES}}))
    ready.sort(key=lambda b: TYPES.index(b["type"]))
    since = now_utc() - timedelta(days=STARTED_DAYS)
    started = list(db.bundles().find({"user_id": user["_id"], "status": "started",
                                      "started_at": {"$gte": since}}).sort("started_at", -1).limit(6))
    views = [v for v in (view(b, user) for b in ready) if len(v["items"]) >= MIN_SAVES]
    grouped = {db.oid(i["save_id"]) for v in views for i in v["items"]}
    return {"ready": views, "actions": singles(user, grouped),
            "started": [view(b, user) for b in started]}


def get(bundle_id: str, user: dict) -> dict | None:
    _id = db.oid(bundle_id)
    return db.bundles().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None


# ---------- actions ----------


def start(bundle: dict, user: dict) -> tuple[dict, str]:
    """Accept one plan per save, each on its own free slot. Returns (bundle, message).
    Uses the same proposal and accept code as a single plan, one save at a time, so the
    second save sees the first one's time as taken."""
    from . import ask  # ask imports the planner; keep that out of module import time

    t = bundle["type"]
    if t not in SCHEDULED or bundle["status"] != "ready":
        return bundle, ""
    saves, _ = _load(bundle, user)
    added = 0
    for s in saves:
        plan = planops.get_for_save(s["_id"])
        if plan and plan["status"] in PLANNED:
            continue
        ask.propose_plans(user, [str(s["_id"])])
        plan = planops.get_for_save(s["_id"])
        option = next((o for o in (plan or {}).get("options") or [] if o.get("action") == "event"), None)
        if not plan or plan["status"] != "proposed" or not option:
            continue
        if planops.slot_taken(plan, option, user):
            plan = planops.replan_code(s, plan, user)
            option = next((o for o in plan.get("options") or [] if o.get("action") == "event"), None)
            if not option or planops.slot_taken(plan, option, user):
                continue
        try:
            planops.accept(plan, s, option, user, "web")
            added += 1
        except planops.PlanError:
            continue
    if added == 0:
        return bundle, "Nothing was added. Your week is full on those days."
    bundle = db.bundles().find_one_and_update(
        {"_id": bundle["_id"], "user_id": user["_id"]},
        {"$set": {"status": "started", "started_at": now_utc(), "updated_at": now_utc()}},
        return_document=ReturnDocument.AFTER)
    words = WORDS[t]
    noun = {"recipe": "dinner", "workout": "workout", "place": "outing"}[t]
    message = words["done"].format(n=added) if added != 1 else f"1 {noun} added."
    return bundle, message


def dismiss(bundle: dict, user: dict) -> None:
    """Not now: it stays away until the saves in it change."""
    db.bundles().update_one({"_id": bundle["_id"], "user_id": user["_id"], "status": "ready"},
                            {"$set": {"status": "dismissed", "updated_at": now_utc()}})
