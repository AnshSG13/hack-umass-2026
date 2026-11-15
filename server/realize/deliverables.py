"""Deliverables: something finished to send to someone, made from one saved reel.

An itinerary to message a friend, a grocery list for whoever is shopping, an invite with
the time and place, a recipe, a workout, a shortlist, the key points, or the notes from a
chat about the reel. Each one is a short plain-text message plus a public page with the
same content, so it reads well in a text thread and opens for someone without an account.

Everything is assembled in code from what is already stored (the video pass's fields, the
accepted plan, the trip plan, the discussion). No model call: nothing here can say more
than the reel, the plan or the sourced trip already said.
"""
from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from . import actions, db, trip
from .config import get_settings
from .models import AISLES
from .timeutil import as_utc, fmt_time, heading_day, now_utc, tz_of

KINDS = ["itinerary", "invite", "grocery_list", "recipe_card", "workout_card", "shortlist",
         "places_list", "key_points", "chat_notes"]
LABELS = {
    "itinerary": ("Itinerary to send", "The days, stops, times and what they cost"),
    "invite": ("Invite to send", "What, when and where, with a calendar link"),
    "grocery_list": ("Grocery list to send", "Sorted by aisle"),
    "recipe_card": ("Recipe to send", "Ingredients and steps"),
    "workout_card": ("Workout to send", "The exercises in order"),
    "shortlist": ("Shortlist to send", "The products side by side"),
    "places_list": ("Places list to send", "Every place the reel names, with map links"),
    "key_points": ("Key points to send", "The takeaways in a few lines"),
    "chat_notes": ("Notes from this chat", "Your questions and the answers"),
}
TEXT_MAX = 3000
INVITE_VERB = {"recipe": "I'm cooking", "workout": "I'm doing", "place": "I'm going to"}


def _clean(v: Any, limit: int = 200) -> str:
    s = " ".join(str(v or "").split()).replace(" — ", ", ").replace("—", "-")
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def _fields(save: dict, kind: str) -> dict:
    v = (save.get("fields") or {}).get(kind)
    return v if isinstance(v, dict) else {}


def _title(save: dict) -> str:
    return _clean(save.get("title") or "Saved reel", 80)


def _answered(discussion: dict | None) -> list[tuple[str, str]]:
    """(question, answer) pairs from a discussion, in order."""
    pairs: list[tuple[str, str]] = []
    question = None
    for m in (discussion or {}).get("messages") or []:
        if m.get("role") == "user":
            question = m.get("text")
        elif m.get("role") == "assistant" and question and m.get("text"):
            pairs.append((_clean(question, 240), _clean(m["text"], 700)))
            question = None
    return pairs


def _invite_start(save: dict, plan: dict | None, user: dict) -> datetime | None:
    """The moment an invite is for: the accepted plan's time, else the event's own start."""
    tz = tz_of(user)
    if plan and plan.get("status") == "accepted" and plan.get("scheduled_for") \
            and (plan.get("chosen") or {}).get("action") == "event":
        return as_utc(plan["scheduled_for"]).astimezone(tz)
    if save.get("type") == "event":
        start, _ = actions.event_times(save.get("fields"), user)
        return start
    return None


# ---------- which ones fit this reel ----------


def options(save: dict, plan: dict | None, trip_doc: dict | None, discussion: dict | None, user: dict) -> list[dict]:
    """The deliverables this reel can make right now, most useful first. `needs` is "trip"
    when the itinerary can be made once the trip plan has been built."""
    t = save.get("type")
    out: list[str] = []
    needs: dict[str, str] = {}
    trip_ready = bool(trip_doc and trip_doc.get("status") == "ready" and trip_doc.get("days"))

    if t in trip.TRIP_TYPES and (trip_ready or trip.can_build(save)):
        out.append("itinerary")
        if not trip_ready:
            needs["itinerary"] = "trip"
    if t == "event" and (_fields(save, "event").get("name") or save.get("title")):
        out.append("invite")
    if t == "recipe":
        if actions.ingredients(save.get("fields")):
            out.append("grocery_list")
        if actions.ingredients(save.get("fields")) or _fields(save, "recipe").get("steps"):
            out.append("recipe_card")
    if t == "workout" and _fields(save, "workout").get("exercises"):
        out.append("workout_card")
    if t == "product" and _fields(save, "product").get("items"):
        out.append("shortlist")
    if t == "place" and _fields(save, "place").get("places"):
        out.append("places_list")
    if t == "tip" and (_fields(save, "tip").get("key_points") or _fields(save, "tip").get("takeaway")):
        out.append("key_points")
    # A plan with a time (cooking Wednesday at 6:30) can be sent as an invite, after the
    # things that are about the reel itself.
    if t in INVITE_VERB and _invite_start(save, plan, user):
        out.append("invite")
    if _answered(discussion):
        out.append("chat_notes")
    return [{"kind": k, "label": LABELS[k][0], "hint": LABELS[k][1], "needs": needs.get(k)} for k in out]


# ---------- the builders: each returns {title, lede, blocks, closing} ----------


def _itinerary(save: dict, trip_doc: dict, user: dict) -> dict:
    v = trip.view(trip_doc, save, user)["trip"]
    blocks = []
    used: list[str] = []

    def note(src: dict | None) -> None:
        if src and src.get("title") and src["title"] not in used:
            used.append(src["title"])

    for d in v["days"]:
        items = []
        w = d.get("weather")
        if w:
            rain = f", {w['rain_chance']}% rain" if w.get("rain_chance") is not None else ""
            items.append({"text": f"Forecast: {w['text']}, {w['high']}° / {w['low']}°{w['unit']}{rain}"})
        for s in d["stops"]:
            bits = [s["cost"], s["hours"]]
            if s["booking"] == "required":
                bits.append("Booking required")
            elif s["booking"] == "recommended":
                bits.append("Booking recommended")
            for src in (s["cost_source"], s["hours_source"], s["booking_source"], s["source"]):
                note(src)
            items.append({"text": f"{s['time']}  {s['name']}".strip(),
                          "sub": " · ".join(b for b in bits if b) or s["what"],
                          "url": s["maps_url"], "url_label": "Map"})
        head = d["label"] + (f": {d['title']}" if d.get("title") else "")
        blocks.append({"heading": head, "items": items})
    closing = [h["text"] for h in v.get("heads_up") or []][:2]
    closing.append(v["times_note"])
    if used:
        closing.append("Prices and hours from: " + ", ".join(used[:6]) + ".")
    return {"title": f"{_title(save)}: the plan", "lede": [f"{v['city']} · {v['date_label']}"],
            "blocks": blocks, "closing": closing}


def _invite(save: dict, plan: dict | None, user: dict) -> dict:
    t = save.get("type")
    ev = _fields(save, "event")
    name = _clean(ev.get("name") or save.get("title") or "this", 80)
    start = _invite_start(save, plan, user)
    lines = []
    if start:
        lines.append({"text": "When", "sub": f"{heading_day(start.date())} at {fmt_time(start)}"})
    elif ev.get("date_text"):
        lines.append({"text": "When", "sub": _clean(ev["date_text"], 80)})
    where = ", ".join(_clean(x, 60) for x in (ev.get("venue"), ev.get("city")) if x)
    if t == "place":
        p = actions.first_place(save.get("fields"))
        where = ", ".join(_clean(x, 60) for x in (p.get("name"), p.get("city")) if x)
    if where:
        lines.append({"text": "Where", "sub": where})
    if ev.get("price_hint"):
        lines.append({"text": "Tickets", "sub": _clean(ev["price_hint"], 80)})
    ticket = str(ev.get("ticket_url") or "")
    if ticket.startswith(("http://", "https://")):
        lines.append({"text": "Get tickets", "url": ticket, "url_label": "Tickets"})
    accepted = bool(plan and plan.get("status") == "accepted" and plan.get("share_token"))
    if accepted:
        lines.append({"text": "Add it to your calendar", "url": actions.plan_link(plan), "url_label": "Calendar"})
    title = f"Want to come to {name}?" if t == "event" else f"{INVITE_VERB.get(t, 'I planned')} {name}. Join me?"
    return {"title": title, "lede": [], "blocks": [{"heading": "", "items": lines}], "closing": []}


def _scaled(ing: dict, factor: float) -> dict:
    try:
        q = float(ing.get("qty"))
    except (TypeError, ValueError):
        return ing
    return {**ing, "qty": round(q * factor, 2)}


def _recipe_parts(save: dict, servings: int | None) -> tuple[list[dict], str]:
    r = _fields(save, "recipe")
    ings = actions.ingredients(save.get("fields"))
    base = r.get("servings") if isinstance(r.get("servings"), int) and r["servings"] > 0 else None
    serves = ""
    if base and servings and 1 <= servings <= 24 and servings != base:
        ings = [_scaled(i, servings / base) for i in ings]
        serves = f"Scaled to serve {servings}"
    elif base:
        serves = f"Serves {base}"
    return ings, serves


def _grocery_list(save: dict, servings: int | None) -> dict:
    ings, serves = _recipe_parts(save, servings)
    by_aisle: dict[str, list[dict]] = {}
    for i in ings:
        by_aisle.setdefault(i.get("aisle") if i.get("aisle") in AISLES else "Other", []).append(i)
    order = [a for a in AISLES if a in by_aisle] + (["Other"] if "Other" in by_aisle and "Other" not in AISLES else [])
    blocks = [{"heading": a, "items": [{"text": actions.ingredient_line(i)} for i in by_aisle[a]]} for a in order]
    return {"title": f"Groceries for {_title(save)}", "lede": [serves] if serves else [], "blocks": blocks,
            "closing": []}


def _recipe_card(save: dict, servings: int | None) -> dict:
    r = _fields(save, "recipe")
    ings, serves = _recipe_parts(save, servings)
    lede = [x for x in (serves, f"{r['total_time_min']} min" if r.get("total_time_min") else "") if x]
    blocks = []
    if ings:
        blocks.append({"heading": "Ingredients", "items": [{"text": actions.ingredient_line(i)} for i in ings]})
    steps = [_clean(s, 300) for s in r.get("steps") or [] if str(s).strip()]
    if steps:
        blocks.append({"heading": "Steps", "numbered": True, "items": [{"text": s} for s in steps]})
    tips = [_clean(s, 200) for s in r.get("tips") or [] if str(s).strip()]
    if tips:
        blocks.append({"heading": "Tips", "items": [{"text": s} for s in tips]})
    return {"title": _title(save), "lede": [" · ".join(lede)] if lede else [], "blocks": blocks, "closing": []}


def _workout_card(save: dict) -> dict:
    w = _fields(save, "workout")
    lede = [x for x in (_clean(w.get("goal"), 80), f"{w['duration_min']} min" if w.get("duration_min") else "",
                        "Needs: " + ", ".join(_clean(e, 30) for e in w.get("equipment") or [])
                        if w.get("equipment") else "") if x]
    items = []
    for e in w.get("exercises") or []:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        bits = []
        if e.get("sets") and e.get("reps"):
            bits.append(f"{e['sets']} x {_clean(e['reps'], 20)}")
        elif e.get("sets"):
            bits.append(f"{e['sets']} sets")
        elif e.get("reps"):
            bits.append(_clean(e["reps"], 20))
        if e.get("duration_sec"):
            bits.append(f"{e['duration_sec']} s")
        if e.get("rest_sec"):
            bits.append(f"rest {e['rest_sec']} s")
        cues = "; ".join(_clean(c, 80) for c in (e.get("cues") or [])[:2])
        items.append({"text": _clean(e["name"], 80), "sub": " · ".join(x for x in (", ".join(bits), cues) if x)})
    return {"title": _title(save), "lede": [" · ".join(lede)] if lede else [],
            "blocks": [{"heading": "Exercises", "numbered": True, "items": items}], "closing": []}


def _shortlist(save: dict) -> dict:
    items = []
    for it in _fields(save, "product").get("items") or []:
        if not isinstance(it, dict) or not it.get("name"):
            continue
        name = " ".join(_clean(x, 60) for x in (it.get("brand"), it.get("name")) if x)
        row: dict = {"text": name, "sub": " · ".join(_clean(x, 140) for x in (
            it.get("price_hint"), it.get("why"), it.get("where_to_buy")) if x)}
        url = str(it.get("url") or "")
        if url.startswith(("http://", "https://")):
            row.update({"url": url, "url_label": "Link"})
        items.append(row)
    return {"title": _title(save), "lede": [], "blocks": [{"heading": "The shortlist", "items": items}],
            "closing": []}


def _places_list(save: dict) -> dict:
    items = []
    for p in _fields(save, "place").get("places") or []:
        if not isinstance(p, dict) or not p.get("name"):
            continue
        items.append({"text": _clean(p["name"], 80),
                      "sub": " · ".join(_clean(x, 140) for x in (p.get("city"), p.get("why"), p.get("tip")) if x),
                      "url": trip.maps_url(str(p["name"]), str(p.get("city") or "")), "url_label": "Map"})
    return {"title": _title(save), "lede": [], "blocks": [{"heading": "Places", "items": items}], "closing": []}


def _key_points(save: dict) -> dict:
    tip = _fields(save, "tip")
    items = [{"text": _clean(p, 240)} for p in tip.get("key_points") or [] if str(p).strip()]
    closing = [_clean(tip["takeaway"], 240)] if tip.get("takeaway") else []
    return {"title": _clean(tip.get("topic") or save.get("title") or "Key points", 80), "lede": [],
            "blocks": [{"heading": "Key points", "items": items}] if items else [], "closing": closing}


def _chat_notes(save: dict, discussion: dict) -> dict:
    items = [{"text": q, "sub": a} for q, a in _answered(discussion)]
    return {"title": f"Notes on {_title(save)}", "lede": [], "blocks": [{"heading": "", "items": items}],
            "closing": []}


# ---------- text, storage, views ----------


def to_text(body: dict, reel_url: str, share_url: str) -> str:
    """The message: short lines that read well in a text thread, the page link last."""
    lines = [body["title"]] + [x for x in body.get("lede") or [] if x]
    for b in body.get("blocks") or []:
        if not b.get("items"):
            continue
        lines.append("")
        if b.get("heading"):
            lines.append(b["heading"])
        for n, it in enumerate(b["items"], 1):
            mark = f"{n}." if b.get("numbered") else "-"
            sub = f": {it['sub']}" if it.get("sub") and not it.get("url") else ""
            if it.get("sub") and it.get("url") and it.get("url_label") == "Map":
                sub = f" ({it['sub']})"
            link = f" {it['url']}" if it.get("url") and it.get("url_label") != "Map" else ""
            lines.append(f"{mark} {it['text']}{sub}{link}")
    closing = [x for x in body.get("closing") or [] if x]
    if closing:
        lines.append("")
        lines += closing
    text = "\n".join(lines).strip()
    if len(text) > TEXT_MAX:
        text = text[: TEXT_MAX - 1].rstrip() + "…"
    tail = [f"Full version: {share_url}"]
    if reel_url:
        tail.append(f"The reel: {reel_url}")
    return text + "\n\n" + "\n".join(tail)


def build(save: dict, user: dict, kind: str, *, discussion: dict | None = None,
          servings: int | None = None) -> dict:
    """Make (or remake) one deliverable for this save and store it. Raises ValueError with a
    line the person can read when this reel can't make that one."""
    plan = db.plans().find_one({"save_id": save["_id"], "user_id": user["_id"]})
    trip_doc = trip.get_for_save(save["_id"], user["_id"])
    allowed = {o["kind"]: o for o in options(save, plan, trip_doc, discussion, user)}
    if kind not in allowed:
        raise ValueError("This reel doesn't have what that needs.")
    if allowed[kind]["needs"] == "trip":
        raise ValueError("Build the trip plan first, then the itinerary can be sent.")
    if kind == "itinerary":
        body = _itinerary(save, trip_doc, user)
    elif kind == "invite":
        body = _invite(save, plan, user)
    elif kind == "grocery_list":
        body = _grocery_list(save, servings)
    elif kind == "recipe_card":
        body = _recipe_card(save, servings)
    elif kind == "workout_card":
        body = _workout_card(save)
    elif kind == "shortlist":
        body = _shortlist(save)
    elif kind == "places_list":
        body = _places_list(save)
    elif kind == "key_points":
        body = _key_points(save)
    else:
        body = _chat_notes(save, discussion or {})

    key = {"user_id": user["_id"], "save_id": save["_id"], "kind": kind,
           "discussion_id": discussion["_id"] if kind == "chat_notes" and discussion else None}
    now = now_utc()
    existing = db.deliverables().find_one(key)
    _id = existing["_id"] if existing else ObjectId()
    token = existing["share_token"] if existing else secrets.token_urlsafe(16)[:22]
    share_url = f"{get_settings().public_base_url}/d/{_id}?t={token}"
    doc = {**key, **body, "text": to_text(body, save.get("url") or "", share_url), "share_token": token,
           "updated_at": now}
    if user.get("expires_at"):
        doc["expires_at"] = user["expires_at"]
    try:
        db.deliverables().update_one({"_id": _id}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
    except DuplicateKeyError:
        # A double tap: the other request made the same thing a moment ago. Answer with that one.
        made = db.deliverables().find_one(key)
        if made:
            return made
        raise
    return {**doc, "_id": _id, "created_at": (existing or {}).get("created_at") or now}


def view(d: dict) -> dict:
    return {
        "id": str(d["_id"]), "kind": d["kind"], "label": LABELS[d["kind"]][0], "title": d["title"],
        "lede": d.get("lede") or [], "blocks": d.get("blocks") or [], "closing": d.get("closing") or [],
        "text": d["text"], "share_path": f"/d/{d['_id']}?t={d['share_token']}",
        "share_url": f"{get_settings().public_base_url}/d/{d['_id']}?t={d['share_token']}",
        "updated_at": as_utc(d["updated_at"]).isoformat(),
    }


def public_view(d: dict, save: dict | None) -> dict:
    """What someone with the link sees: the deliverable and the reel it came from. No account data."""
    handle = ((save or {}).get("creator") or {}).get("handle")
    out = view(d)
    out["reel"] = {
        "title": (save or {}).get("title"), "creator": f"@{handle}" if handle else None,
        "url": (save or {}).get("url"),
        "thumb_url": f"/api/t/{save['thumb_id']}" if save and save.get("thumb_id") else None,
    }
    out["app_name"] = get_settings().app_name
    return out
