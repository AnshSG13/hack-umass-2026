"""Ask: a chat agent over the user's saves, streamed as NDJSON (SPEC 12)."""
from __future__ import annotations

import json
import logging
import queue
import threading
from datetime import timedelta
from typing import Iterator

from . import db, gemini, planner, planops, search, tickets
from .config import get_settings
from .models import SLOT_KINDS, STEP_LABELS, TYPES
from .runs import Run
from .timeutil import as_utc, big_time, month_day, now_utc, prompt_date, tz_of, week_bounds

log = logging.getLogger("realize.ask")

TIMEOUT_S = 30
ERROR_LINE = {"type": "error", "message": "Ask didn't answer. Try again."}

SYSTEM_PROMPT = """You are Ask, inside Realize. You help the user find and use reels they saved.
Today is {today_local} ({timezone}).
- Call search_saves before answering anything about their saves. Use get_save for details.
- Only state facts that appear in saves you retrieved. If nothing matches, say so plainly and use
  confidence none. If two saves fit, include both; never guess which one they mean.
- When they ask to plan, schedule or make something from their saves, call propose_plans with the
  matching save_ids. The app shows each plan as a ticket they confirm. Never say a plan was added;
  say it's ready to confirm.
- Finish with respond: 1 to 3 short sentences, answer first. Don't list everything you found; the
  app shows cards. save_ids are the saves that answer the question, best first.
- confidence: high if a save clearly answers it, low if one partly does, none if nothing does.
- follow_ups: up to 2 short next questions this person would likely ask about these saves, in
  their words ("Plan it for Friday", "What do I need to buy?"). Leave it empty when nothing fits."""


def tool_defs() -> list[dict]:
    S = {"type": "string"}
    return [
        gemini.fn_tool("search_saves", "Hybrid search over the user's saved reels.", {
            "type": "object", "properties": {
                "query": S, "type": {"type": "string", "enum": TYPES},
                "limit": {"type": "integer", "description": "At most 8"}},
            "required": ["query"]}),
        gemini.fn_tool("get_save", "Details of one save: fields, summary and transcript.", {
            "type": "object", "properties": {"save_id": S}, "required": ["save_id"]}),
        gemini.fn_tool("list_plans", "The user's plans.", {
            "type": "object", "properties": {
                "range": {"type": "string", "enum": ["week", "upcoming", "done"]}},
            "required": ["range"]}),
        gemini.fn_tool("propose_plans", "Draft plans for saves. The app shows them as tickets to confirm.", {
            "type": "object", "properties": {
                "save_ids": {"type": "array", "items": S, "maxItems": 5}},
            "required": ["save_ids"]}),
        gemini.fn_tool("respond", "Final answer. Call once, last.", {
            "type": "object", "properties": {
                "text": {"type": "string", "description": "1 to 3 short sentences, max 600 chars"},
                "confidence": {"type": "string", "enum": ["high", "low", "none"]},
                "save_ids": {"type": "array", "items": S},
                "follow_ups": {"type": "array", "items": S, "maxItems": 2,
                               "description": "Next questions to offer as buttons, each under 40 chars"}},
            "required": ["text", "confidence", "save_ids"]}),
    ]


def card(save: dict, user: dict, query: str = "") -> dict:
    return {"save_id": str(save["_id"]), "title": save.get("title") or "Saved reel",
            "type": save.get("type"), "thumb_url": tickets.thumb_url(save),
            "saved_on": tickets.saved_on(save, user), "snippet": search.snippet(save, query),
            "url": save.get("url")}


def clean_follow_ups(raw) -> list[str]:
    """At most 2 short, distinct questions; anything long or empty is dropped."""
    out: list[str] = []
    for x in raw if isinstance(raw, list) else []:
        q = " ".join(str(x).replace("\u2014", ",").split()).strip(" \"'")
        if 3 <= len(q) <= 48 and q.lower() not in [o.lower() for o in out]:
            out.append(q)
    return out[:2]


def add_moments(cards: list[dict], user: dict) -> None:
    """Where a card's snippet is a line spoken in the video, give the card that second,
    so the tile opens the reel's transcript there. One query for all the cards."""
    ids = [i for i in (db.oid(c["save_id"]) for c in cards if c.get("snippet")) if i]
    if not ids:
        return
    docs = {str(d["_id"]): d for d in db.saves().find(
        {"_id": {"$in": ids}, "user_id": user["_id"]}, {"summary": 1, "transcript": 1})}
    for c in cards:
        d = docs.get(c["save_id"])
        sec = search.moment(c.get("snippet") or "", d.get("summary"), d.get("transcript")) if d else None
        if sec is not None:
            c["at_sec"], c["at_label"] = sec, f"{sec // 60}:{sec % 60:02d}"


def propose_plans(user: dict, save_ids: list[str]) -> list[dict]:
    """Code only: reuse or create a proposed plan per save with fresh options,
    reserving earlier picks so the plans don't collide. Returns tickets."""
    out: list[dict] = []
    reserved: list[dict] = []
    for sid in save_ids[:5]:
        _id = db.oid(sid)
        save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None
        if not save or save.get("status") not in search.SEARCHABLE:
            continue
        plan = planops.get_for_save(save["_id"])
        kind = save.get("type") if save.get("type") in TYPES else "other"
        if plan and plan["status"] in ("accepted", "done"):
            out.append(tickets.ticket(save, plan, user))
            continue
        if plan:
            plan = planops.replan_code(save, plan, user, reserved=reserved)
            if not plan.get("actionable") and kind != "other" and plan.get("options"):
                db.plans().update_one({"_id": plan["_id"]}, {"$set": {"actionable": True}})
                plan["actionable"] = True
        else:
            built = planops.code_options(kind, save, user, reserved=reserved)
            plan = planops.upsert_proposal(
                save, user, kind=kind, actionable=built["actionable"] is not False and kind != "other",
                question=planner.DEFAULT_QUESTION[kind], why=built["why"] or "You asked to plan this.",
                confidence="best_guess", options=built["options"])
        if kind in SLOT_KINDS and plan.get("options"):
            o = plan["options"][0]
            st = as_utc(o["start_utc"])
            reserved.append({"start_utc": st, "end_utc": st + timedelta(minutes=int(o["duration_min"]))})
        out.append(tickets.ticket(save, plan, user))
    return out


def _list_plans(user: dict, rng: str) -> list[dict]:
    tz = tz_of(user)
    now = now_utc()
    now_l = now.astimezone(tz)
    start, end = week_bounds(now_l)
    if rng == "done":
        q = {"user_id": user["_id"], "status": "done"}
        cur = db.plans().find(q).sort("updated_at", -1).limit(15)
    elif rng == "upcoming":
        cur = db.plans().find({"user_id": user["_id"], "status": "accepted",
                               "scheduled_for": {"$gte": now}}).sort("scheduled_for", 1).limit(15)
    else:
        cur = db.plans().find({"user_id": user["_id"], "status": {"$in": ["accepted", "proposed"]},
                               "$or": [{"scheduled_for": {"$gte": start, "$lt": end}},
                                       {"status": "proposed"}]}).limit(20)
    plans = list(cur)
    titles = {s["_id"]: s.get("title") for s in db.saves().find(
        {"_id": {"$in": [p["save_id"] for p in plans]}, "user_id": user["_id"]}, {"title": 1})} if plans else {}
    return [{"save_id": str(p["save_id"]), "title": titles.get(p["save_id"]), "kind": p["kind"],
             "status": p["status"],
             "when": big_time(as_utc(p["scheduled_for"]).astimezone(tz), now_l) if p.get("scheduled_for") else None}
            for p in plans]


def _run(user: dict, message: str, history: list[dict], emit) -> None:
    s = get_settings()
    tz = tz_of(user)
    run = Run(user, None, "ask", s.gemini_model_fast)
    run.on_step = lambda label: emit({"type": "step", "label": label})
    state: dict = {"found": {}, "last_query": message, "answer": None, "last_results": []}

    def remember(docs: list[dict]) -> None:
        for d in docs:
            state["found"][str(d["_id"])] = d

    def execute(name: str, args: dict) -> tuple[dict, bool]:
        if name == "search_saves":
            with run.step("search_saves", args) as h:
                q = str(args.get("query") or "")
                t = args.get("type") if args.get("type") in TYPES else None
                limit = max(1, min(int(args.get("limit") or 6), 8))
                docs, _ = search.hybrid_search(user["_id"], q, type=t, limit=limit)
                remember(docs)
                state["last_query"], state["last_results"] = q, docs
                pmap = {p["save_id"]: p["status"] for p in db.plans().find(
                    {"save_id": {"$in": [d["_id"] for d in docs]}}, {"save_id": 1, "status": 1})} if docs else {}
                h["result"] = [{"save_id": str(d["_id"]), "title": d.get("title"), "type": d.get("type"),
                                "creator": (d.get("creator") or {}).get("handle"),
                                "saved_on": tickets.saved_on(d, user), "summary": (d.get("summary") or "")[:240],
                                "snippet": search.snippet(d, q), "plan_status": pmap.get(d["_id"])}
                               for d in docs]
                return {"results": h["result"]}, False
        if name == "get_save":
            with run.step("get_save", args) as h:
                _id = db.oid(args.get("save_id"))
                d = db.saves().find_one({"_id": _id, "user_id": user["_id"]}, {"embedding": 0}) if _id else None
                if not d:
                    h["result"] = {"error": "no such save"}
                    return h["result"], False
                remember([d])
                full = {"save_id": str(d["_id"]), "title": d.get("title"), "type": d.get("type"),
                        "summary": d.get("summary"), "fields": d.get("fields"),
                        "caption": (d.get("caption") or "")[:800],
                        "on_screen_text": (d.get("on_screen_text") or [])[:30],
                        "transcript": (d.get("transcript_text") or "")[:3000]}
                h["result"] = {"save_id": full["save_id"], "title": full["title"]}
                return full, False
        if name == "list_plans":
            with run.step("list_plans", args) as h:
                rng = args.get("range") if args.get("range") in ("week", "upcoming", "done") else "week"
                h["result"] = _list_plans(user, rng)
                return {"plans": h["result"]}, False
        if name == "propose_plans":
            with run.step("propose_plans", args) as h:
                ids = [str(x) for x in (args.get("save_ids") or [])][:5]
                made = propose_plans(user, ids)
                if made:
                    emit({"type": "plans", "tickets": made})
                h["result"] = [{"save_id": t["save_id"], "title": t["title"],
                                "status": t["plan"]["status"] if t["plan"] else None,
                                "first_option": (t["plan"]["options"][0]["label"]
                                                 if t["plan"] and t["plan"]["options"] else None)}
                               for t in made]
                return {"tickets": h["result"]}, False
        if name == "respond":
            with run.step("respond", args) as h:
                conf = args.get("confidence") if args.get("confidence") in ("high", "low", "none") else "low"
                state["answer"] = {"text": str(args.get("text") or "")[:600], "confidence": conf,
                                   "save_ids": [str(x) for x in (args.get("save_ids") or [])][:8],
                                   "follow_ups": clean_follow_ups(args.get("follow_ups"))}
                h["result"] = {"ok": True}
                return h["result"], True
        return {"error": f"unknown tool {name}"}, False

    try:
        now_l = now_utc().astimezone(tz)
        system = SYSTEM_PROMPT.replace("Realize", s.app_name).format(
            today_local=prompt_date(now_l), timezone=str(tz))
        lines = []
        for turn in history[-6:]:
            who = "User" if turn.get("role") == "user" else "Ask"
            lines.append(f"{who}: {str(turn.get('text') or '')[:600]}")
        text = (("Earlier in this chat:\n" + "\n".join(lines) + "\n\nNew message: ") if lines else "") + message[:1000]
        gemini.run_tool_loop(
            role="fast", system=system, history=[gemini.user_step(text)],
            tools=tool_defs(), execute=execute, max_turns=5, force_tool="respond",
            force_from_turn=4, timeout_s=TIMEOUT_S)
        ans = state["answer"]
        if not ans:
            raise RuntimeError("Ask finished without respond")
        # Cards: only saves this user owns.
        cards = []
        for sid in ans["save_ids"]:
            d = state["found"].get(sid)
            if d is None:
                _id = db.oid(sid)
                d = db.saves().find_one({"_id": _id, "user_id": user["_id"]},
                                        {"embedding": 0, "transcript": 0}) if _id else None
            if d is not None:
                cards.append(card(d, user, state["last_query"]))
        if ans["confidence"] == "none":
            closest = state["last_results"]
            if not closest:
                closest, _ = search.hybrid_search(user["_id"], message, limit=3)
            cards = [card(d, user, state["last_query"]) for d in closest[:3]]
            ans["save_ids"] = []
            ans["follow_ups"] = []
        else:
            ans["save_ids"] = [c["save_id"] for c in cards]
        if cards:
            try:
                add_moments(cards, user)
            except Exception as e:  # noqa: BLE001 - a missing moment only loses the deep link
                log.warning("moments failed: %s", str(e)[:120])
            emit({"type": "cards", "cards": cards})
        emit({"type": "answer", **ans})
        emit({"type": "done"})
        run.finish("done")
    except Exception as e:  # noqa: BLE001
        log.warning("ask failed: %s", str(e)[:200])
        run.finish("failed", str(e))
        emit(ERROR_LINE)


def stream(user: dict, message: str, history: list[dict]) -> Iterator[str]:
    """Yield NDJSON lines as the agent works."""
    q: queue.Queue = queue.Queue()
    done = object()

    def emit(obj: dict) -> None:
        q.put(obj)

    def work() -> None:
        try:
            _run(user, message, history, emit)
        finally:
            q.put(done)

    threading.Thread(target=work, name="rl-ask", daemon=True).start()
    while True:
        try:
            item = q.get(timeout=TIMEOUT_S + 15)
        except queue.Empty:
            yield json.dumps(ERROR_LINE) + "\n"
            return
        if item is done:
            return
        yield json.dumps(item, default=str) + "\n"


def chips(user: dict) -> list[str]:
    """Up to 4 starter questions built from the user's data, no LLM (DESIGN 7.6)."""
    out: list[str] = []
    latest = db.saves().find_one({"user_id": user["_id"], "status": {"$in": search.SEARCHABLE},
                                  "title": {"$ne": None}}, {"title": 1}, sort=[("created_at", -1)])
    if latest and latest.get("title"):
        out.append(f"Find that {latest['title']} reel")
    counts = {t: db.saves().count_documents({"user_id": user["_id"], "type": t})
              for t in ("recipe", "place", "workout")}
    if counts["recipe"] >= 2:
        out.append("Plan my dinners this week")
    if counts["place"]:
        out.append("Where did I want to eat?")
    if counts["workout"]:
        out.append("What workouts did I save?")
    if not out:
        out.append("What did I save this week?")
    return out[:4]


__all__ = ["stream", "chips", "propose_plans", "STEP_LABELS"]
