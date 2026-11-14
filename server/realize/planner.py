"""Planner agent and the propose job (SPEC 8).

The model picks the type, the fields and which offered slot to use.
Code computes slots, validates dates, builds labels and writes the plan.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from . import actions, db, gemini, jobs, planops, search, slots, thumbs
from .config import get_settings
from .models import PROPOSE_PLAN_SCHEMA, SLOT_KINDS, TYPES, clean_fields
from .runs import Run
from .timeutil import (
    DAY_KEYS, DAY_SHORT, as_utc, fmt_time, month_day, now_utc, parse_hhmm, prompt_date,
    prompt_now, tz_of,
)

log = logging.getLogger("realize.planner")

PROPOSE_TIMEOUT_S = 15
SAMPLE_TIMEOUT_S = 10

SYSTEM_PROMPT = """You are the planner inside Realize. Someone just shared a short video (an Instagram reel)
because they might want to do something with it. Work out what it is and propose one small,
concrete plan that fits their week. They confirm or decline; you never act yourself.

1. Read the caption, hashtags, creator and thumbnail. Pick the type:
   recipe (food to cook), event (happens at a specific date and place), place (restaurant, cafe,
   shop or destination with no fixed date), workout (exercise routine or sports drill),
   product (something to buy or try), tip (advice, lesson, explainer, motivation),
   other (jokes, memes, vibes, nothing to do).
2. Extract the fields for that type using only what the caption, thumbnail, transcript or
   on-screen text says. Never invent quantities, prices, dates, names or places. If the caption is
   unrelated to the video ("follow for part 2", lyrics, only hashtags), set caption_sufficient
   to false and keep fields minimal.
3. The app has already called search_saves and find_free_slot with default arguments; the
   results are under SIMILAR SAVES and FREE SLOTS. Call those tools yourself only when you need
   a different search, window or duration (a long recipe that needs a weekend slot).
4. Call propose_plan exactly once.
   - recipe, workout, place: every option start must be one of the slots find_free_slot returned.
     Prefer the first slot unless the content suggests otherwise (a long weekend recipe fits a
     weekend slot better).
   - event: use the event's own date and time. Resolve relative dates against the post date
     ("this Friday" is the first Friday after the post date). If there is a date but no time,
     use 19:00 and set confidence to best_guess.
   - product, tip, other: leave option_starts_local empty; the app sets reminder times.
5. question: a short yes/no question, max 50 characters, action first ("Dinner Thursday?").
   why: one plain sentence, max 90 characters, naming the real reason
   ("You cook weeknights and Thursday is free."). confidence: sure when type and timing are
   clear, best_guess otherwise. title: plain words that say what the video is. Never use the
   words leverage, leveraging, pivotal, intricate, showcasing, synergy, delve, realm, robust,
   streamlined, transformative, seamless or game-changer.
6. actionable is false for type other, for events that already happened, and when there is
   nothing a person could do with it.
Do not write reasoning in text. Use the tools."""

DEFAULT_QUESTION = planops.QUESTIONS


class PlannerBusy(Exception):
    """Gemini is rate limited or overloaded. The propose job retries later instead of
    settling for the deterministic fallback on the first attempt."""


def system_prompt() -> str:
    return SYSTEM_PROMPT.replace("Realize", get_settings().app_name)


def tool_defs() -> list[dict]:
    return [
        gemini.fn_tool(
            "search_saves", "Hybrid search over this user's saved reels.",
            {"type": "object", "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "description": "At most 5"}},
             "required": ["query"]}),
        gemini.fn_tool(
            "find_free_slot", "Free slots in the user's week for a kind of plan, earliest first.",
            {"type": "object", "properties": {
                "kind": {"type": "string", "enum": SLOT_KINDS},
                "not_before_local": {"type": "string", "description": "YYYY-MM-DDTHH:mm"},
                "not_after_local": {"type": "string", "description": "YYYY-MM-DDTHH:mm"},
                "duration_min": {"type": "integer"}},
             "required": ["kind"]}),
        gemini.fn_tool("propose_plan", "Propose the plan. Call exactly once.", PROPOSE_PLAN_SCHEMA),
    ]


# ---------- the first user message ----------


def _clock(hhmm: str) -> str:
    t = parse_hhmm(hhmm)
    h12 = t.hour % 12 or 12
    return f"{h12}:{t.minute:02d} {'am' if t.hour < 12 else 'pm'}"


def _days_phrase(days: list[str]) -> str:
    idx = sorted(DAY_KEYS.index(d) for d in days if d in DAY_KEYS)
    if not idx:
        return "no days"
    if len(idx) >= 3 and idx == list(range(idx[0], idx[-1] + 1)):
        return f"{DAY_SHORT[idx[0]]} to {DAY_SHORT[idx[-1]]}"
    return ", ".join(DAY_SHORT[i] for i in idx)


def prefs_line(user: dict) -> str:
    p = user["prefs"]
    off = [t for t, on in (p.get("types_on") or {}).items() if not on]
    return (
        f"cooks {_days_phrase(p['cook_days'])} at {_clock(p['cook_time'])}; "
        f"workouts {_days_phrase(p['workout_days'])} at {_clock(p['workout_time'])}; "
        f"weekend plans at {_clock(p['weekend_time'])}; "
        f"max {p.get('daily_cap', 2)} plans a day; "
        f"quiet {_clock(p['quiet_start'])} to {_clock(p['quiet_end'])}; "
        f"types off: {', '.join(off) if off else 'none'}"
    )


def upcoming_lines(user: dict, now: datetime) -> list[str]:
    tz = tz_of(user)
    cur = db.plans().find(
        {"user_id": user["_id"], "status": "accepted",
         "scheduled_for": {"$gte": now, "$lte": now + timedelta(days=14)}}).sort("scheduled_for", 1)
    plans = list(cur)
    titles = {s["_id"]: s.get("title") for s in db.saves().find(
        {"_id": {"$in": [p["save_id"] for p in plans]}}, {"title": 1})} if plans else {}
    out = []
    for p in plans:
        st = as_utc(p["scheduled_for"]).astimezone(tz)
        out.append(f"- {DAY_SHORT[st.weekday()]} {month_day(st)} {fmt_time(st)} | {p['kind']} | "
                   f"{titles.get(p['save_id']) or 'Saved reel'}")
    return out


def precompute(save: dict, user: dict, now: datetime, run: Run, with_enrichment: bool) -> dict:
    """Run search_saves and find_free_slot in code before the first model turn.

    Measured on the free-tier key: one extra model turn costs 4 to 9 seconds, which a
    Shortcut waiting 20 seconds can't spare. The model still has both tools and can
    call them again with other arguments. Both calls are recorded as agent steps.
    """
    tz = tz_of(user)
    similar: list[dict] = []
    others = db.saves().count_documents({"user_id": user["_id"], "_id": {"$ne": save["_id"]},
                                         "status": {"$in": search.SEARCHABLE}}, limit=1)
    query = " ".join(((save.get("title") or "") + " " + (save.get("summary") or "")
                      if with_enrichment and save.get("title") else (save.get("caption") or "")).split())[:300]
    with run.step("search_saves", {"query": query, "limit": 3}) as h:
        if others and query:
            try:
                docs, _ = search.hybrid_search(user["_id"], query, limit=4)
            except Exception as e:  # noqa: BLE001 - similar saves are a nice-to-have
                log.warning("similar-saves search failed: %s", str(e)[:120])
                docs = []
            docs = [d for d in docs if d["_id"] != save["_id"]][:3]
            pmap = {p["save_id"]: p["status"] for p in db.plans().find(
                {"save_id": {"$in": [d["_id"] for d in docs]}}, {"save_id": 1, "status": 1})} if docs else {}
            similar = [{"save_id": str(d["_id"]), "title": d.get("title"), "type": d.get("type"),
                        "saved_on": month_day(as_utc(d["created_at"]).astimezone(tz)),
                        "plan_status": pmap.get(d["_id"])} for d in docs]
        h["result"] = similar
    found: dict[str, list[dict]] = {}
    with run.step("find_free_slot", {"kind": "recipe, workout, place"}) as h:
        accepted = slots.load_accepted(user["_id"])
        for kind in SLOT_KINDS:
            found[kind] = slots.find_free_slot(user, kind, now=now, accepted=accepted)
        h["result"] = {k: [slots.public_slot(x) for x in v[:3]] for k, v in found.items()}
    return {"similar": similar, "slots": found}


def build_message(user: dict, save: dict, now: datetime, with_enrichment: bool,
                  pre: dict | None = None) -> str:
    tz = tz_of(user)
    now_l = as_utc(now).astimezone(tz)
    up = upcoming_lines(user, now)
    creator = (save.get("creator") or {}).get("handle") or "unknown"
    posted = prompt_date(as_utc(save["posted_at"]).astimezone(tz)) if save.get("posted_at") else "unknown"
    dur = f"{save['duration_sec']} s" if save.get("duration_sec") else "unknown"
    tags = " ".join(f"#{h}" for h in (save.get("hashtags") or [])[:20]) or "none"
    lines = [
        f"NOW: {prompt_now(now_l, str(tz))}",
        f"PREFS: {prefs_line(user)}",
        "UPCOMING (accepted, next 14 days):",
        *(up or ["- nothing"]),
        "REEL:",
        f"creator: @{creator} | posted: {posted} | duration: {dur}",
        f'caption: """{(save.get("caption") or "")[:3000]}"""',
        f"hashtags: {tags}",
    ]
    if with_enrichment:
        if save.get("type"):
            lines.append(f"TYPE (from the video, keep it): {save['type']}")
        if save.get("title"):
            lines.append(f"TITLE (from the video): {save['title']}")
        if save.get("fields"):
            lines.append(f"FIELDS (from the video): {search.fields_text(save.get('type'), save.get('fields'))[:1500]}")
        lines.append(f'TRANSCRIPT: """{(save.get("transcript_text") or "")[:6000]}"""')
        lines.append("ON SCREEN: " + (" | ".join(save.get("on_screen_text") or [])[:1500] or "none"))
        lines.append("VISUAL: " + (save.get("visual_summary") or "none")[:1200])
    if pre is not None:
        lines.append("SIMILAR SAVES (search_saves, already run):")
        lines += [f"- {x['save_id']} | {x['type']} | {x['title']} | saved {x['saved_on']} | plan: {x['plan_status'] or 'none'}"
                  for x in pre["similar"]] or ["- none"]
        lines.append("FREE SLOTS (find_free_slot, already run with default settings):")
        for kind in SLOT_KINDS:
            opts = ", ".join(f"{x['start_local']} ({x['big_time']})" for x in pre["slots"].get(kind, [])[:4])
            lines.append(f"- {kind}: {opts or 'none free in the next 14 days'}")
    return "\n".join(lines)


# ---------- validation and writing ----------


def _write_plan(save: dict, user: dict, args: dict, known_slots: list[dict],
                keep_save_fields: bool) -> dict:
    """Validate propose_plan arguments (already shape-checked) and write save + plan."""
    kind = args.get("type") if args.get("type") in TYPES else "other"
    if keep_save_fields and save.get("type") in TYPES:
        kind = save["type"]
    title = " ".join(str(args.get("title") or "").split())[:60] or (save.get("title") or "Saved reel")
    question = " ".join(str(args.get("question") or "").split())[:50] or DEFAULT_QUESTION[kind]
    why = " ".join(str(args.get("why") or "").split())[:90]
    confidence = args.get("confidence") if args.get("confidence") in ("sure", "best_guess") else "best_guess"
    actionable = bool(args.get("actionable")) and kind != "other"

    if keep_save_fields:
        fields = save.get("fields") or {}
        title = save.get("title") or title
    else:
        fields = actions.fix_event_year(clean_fields(kind, args.get("fields")), save.get("posted_at"))
        update = {"type": kind, "title": title, "summary": str(args.get("summary") or "")[:400],
                  "fields": fields, "caption_sufficient": bool(args.get("caption_sufficient", True))}
        edited = set(save.get("user_edited") or [])
        update = {k: v for k, v in update.items() if k not in edited}
        db.saves().update_one({"_id": save["_id"]}, {"$set": update})
        save = {**save, **update}

    type_on = (user["prefs"].get("types_on") or {}).get(kind, True)
    if not type_on:
        options, actionable = [], False
        why = "This type is switched off in your settings."
    else:
        built = planops.code_options(kind, {**save, "title": title, "fields": fields}, user,
                                     starts_local=[str(s) for s in args.get("option_starts_local") or []],
                                     known_slots=known_slots)
        options = built["options"]
        if built["actionable"] is False:
            actionable, why = False, built["why"]
        elif built["why"] and not why:
            why = built["why"]
    return planops.upsert_proposal(
        save, user, kind=kind, actionable=actionable, question=question, why=why,
        confidence=confidence, options=options,
        similar_save_id=str(args["similar_save_id"]) if args.get("similar_save_id") else None)


def _shape_errors(args: dict) -> list[str]:
    errs = []
    if args.get("type") not in TYPES:
        errs.append(f"type must be one of {', '.join(TYPES)}")
    if not str(args.get("title") or "").strip():
        errs.append("title is required")
    starts = args.get("option_starts_local") or []
    if not isinstance(starts, list) or len(starts) > 3:
        errs.append("option_starts_local takes 0 to 3 items")
    if args.get("fields") is not None and not isinstance(args.get("fields"), dict):
        errs.append("fields must be an object")
    return errs


def fallback_plan(save: dict, user: dict) -> dict:
    """Deterministic plan when the model can't be used: the user still gets a ticket.

    Before the video is read the type is unknown, so the plan is "other" with a
    reminder in a week. Once enrichment has typed the save, a still-proposed plan
    of a different kind is rebuilt by code for that type with real slots.
    """
    existing = planops.get_for_save(save["_id"])
    kind = save.get("type") if save.get("type") in TYPES else "other"
    if existing and (existing["status"] != "proposed" or existing["kind"] == kind):
        return existing
    caption = " ".join((save.get("caption") or "").split())
    title = save.get("title") or caption[:50] or "Saved reel"
    update = {"type": kind, "title": title}
    if not save.get("summary"):
        update["summary"] = ""
    db.saves().update_one({"_id": save["_id"]}, {"$set": update})
    save = {**save, **update}
    if kind == "other":
        built = planops.code_options("other", save, user)
        return planops.upsert_proposal(
            save, user, kind=kind, actionable=False, question="Keep this one?",
            why="Couldn't read enough to plan it. It's saved either way.",
            confidence="best_guess", options=built["options"])
    type_on = (user["prefs"].get("types_on") or {}).get(kind, True)
    built = planops.code_options(kind, save, user)
    actionable = type_on and built["actionable"] is not False
    return planops.upsert_proposal(
        save, user, kind=kind, actionable=actionable, question=DEFAULT_QUESTION[kind],
        why=built["why"] or "Planned from what the video shows.",
        confidence="best_guess", options=built["options"] if type_on else [])


def cached_plan_fallback(save: dict, user: dict, cached: dict | None) -> dict:
    """Sample fallback: the cached plan with options recomputed by code (no dates are cached)."""
    if not cached:
        return fallback_plan(save, user)
    existing = planops.get_for_save(save["_id"])
    if existing:
        return existing
    kind = cached.get("type") if cached.get("type") in TYPES else (save.get("type") or "other")
    built = planops.code_options(kind, save, user)
    actionable = bool(cached.get("actionable")) and kind != "other"
    why = cached.get("why") or ""
    if built["actionable"] is False:
        actionable, why = False, built["why"]
    elif built["why"]:
        why = built["why"]
    if not (user["prefs"].get("types_on") or {}).get(kind, True):
        actionable, built["options"] = False, []
    return planops.upsert_proposal(
        save, user, kind=kind, actionable=actionable,
        question=cached.get("question") or DEFAULT_QUESTION[kind], why=why,
        confidence=cached.get("confidence") or "best_guess", options=built["options"])


def fake_plan(save: dict, user: dict) -> dict:
    """PLANNER_MODE=fake: no Gemini, no Instagram. Real slots, canned recipe."""
    run = Run(user, save["_id"], "propose", "fake")
    fields = {"recipe": {"servings": 2, "total_time_min": 40, "ingredients": [
        {"qty": 2, "unit": "tbsp", "item": "test paste", "aisle": "Pantry"},
        {"qty": 1, "unit": "", "item": "test squash", "aisle": "Produce"},
        {"qty": 3, "unit": "tbsp", "item": "test butter", "aisle": "Dairy & Eggs"}],
        "steps": ["Mix.", "Roast.", "Eat."], "tips": []}}
    update = {"caption": save["url"], "type": "recipe", "title": "Test recipe",
              "summary": "A canned recipe for contract tests.", "fields": fields,
              "caption_sufficient": True, "hashtags": [], "creator": {"handle": "test", "name": "Test"}}
    db.saves().update_one({"_id": save["_id"]}, {"$set": update})
    save = {**save, **update}
    with run.step("find_free_slot", {"kind": "recipe"}) as h:
        found = slots.find_free_slot(user, "recipe")
        h["result"] = [slots.public_slot(s) for s in found]
    with run.step("propose_plan", {"type": "recipe", "title": "Test recipe"}) as h:
        built = planops.code_options("recipe", save, user)
        plan = planops.upsert_proposal(save, user, kind="recipe", actionable=True,
                                       question="Cook this?", why="Fake planner: first free cook night.",
                                       confidence="sure", options=built["options"])
        h["result"] = {"ok": True}
    run.finish("done")
    return plan


def run_planner(save: dict, user: dict, *, run_kind: str = "propose", with_enrichment: bool = False,
                timeout_s: float = PROPOSE_TIMEOUT_S, cached_plan: dict | None = None,
                on_step=None, run: Run | None = None, raise_busy: bool = False) -> tuple[dict, str]:
    """Run the planner agent. Always returns a plan; the second value is the run status
    (done or fallback)."""
    s = get_settings()
    run = run or Run(user, save["_id"], run_kind, s.gemini_model_fast)
    run.on_step = on_step
    now = now_utc()
    state: dict = {"slots": [], "plan": None, "invalid": 0}

    def execute(name: str, args: dict) -> tuple[dict, bool]:
        if name == "search_saves":
            with run.step("search_saves", args) as h:
                limit = max(1, min(int(args.get("limit") or 5), 5))
                docs, _ = search.hybrid_search(user["_id"], str(args.get("query") or ""), limit=limit + 1)
                docs = [d for d in docs if d["_id"] != save["_id"]][:limit]
                pmap = {p["save_id"]: p["status"] for p in db.plans().find(
                    {"save_id": {"$in": [d["_id"] for d in docs]}}, {"save_id": 1, "status": 1})} if docs else {}
                tz = tz_of(user)
                h["result"] = [{"save_id": str(d["_id"]), "title": d.get("title"), "type": d.get("type"),
                                "saved_on": month_day(as_utc(d["created_at"]).astimezone(tz)),
                                "plan_status": pmap.get(d["_id"])} for d in docs]
                return {"results": h["result"]}, False
        if name == "find_free_slot":
            with run.step("find_free_slot", args) as h:
                kind = args.get("kind")
                if kind not in SLOT_KINDS:
                    h["result"] = {"error": "kind must be recipe, workout or place"}
                    return h["result"], False
                found = slots.find_free_slot(
                    user, kind, not_before=args.get("not_before_local"),
                    not_after=args.get("not_after_local"), duration_min=args.get("duration_min"), now=now)
                state["slots"] += found
                h["result"] = [slots.public_slot(x) for x in found]
                return {"slots": h["result"]}, False
        if name == "propose_plan":
            with run.step("propose_plan", args) as h:
                errs = _shape_errors(args)
                if errs:
                    state["invalid"] += 1
                    h["result"] = {"ok": False, "errors": errs}
                    if state["invalid"] >= 2:
                        raise ValueError("propose_plan arguments invalid twice: " + "; ".join(errs))
                    return h["result"], False
                state["plan"] = _write_plan(save, user, args, state["slots"], keep_save_fields=with_enrichment)
                h["result"] = {"ok": True}
                return h["result"], True
        return {"error": f"unknown tool {name}"}, False

    try:
        pre = precompute(save, user, now, run, with_enrichment)
        for found in pre["slots"].values():
            state["slots"] += found
        image = thumbs.get_bytes(save.get("thumb_id"))
        history = [gemini.user_step(build_message(user, save, now, with_enrichment, pre), image)]
        gemini.run_tool_loop(
            role="fast", system=system_prompt(), history=history, tools=tool_defs(),
            execute=execute, max_turns=4, force_tool="propose_plan", force_from_turn=3,
            timeout_s=timeout_s)
        if state["plan"] is None:
            raise RuntimeError("planner finished without calling propose_plan")
        used = gemini.last_model.get("fast")
        if used and used != s.gemini_model_fast:
            db.agent_runs().update_one({"_id": run.id}, {"$set": {"model": used}})
        run.finish("done")
        return state["plan"], "done"
    except Exception as e:  # noqa: BLE001 - any failure falls back; the user still gets a ticket
        log.warning("planner fallback for save %s: %s", save["_id"], str(e)[:200])
        if state["plan"] is not None:
            run.finish("done")
            return state["plan"], "done"
        if raise_busy and isinstance(e, (gemini.RateLimited, gemini.Unavailable)):
            run.finish("failed", str(e))
            raise PlannerBusy(str(e)[:300]) from e
        fresh = db.saves().find_one({"_id": save["_id"]}) or save
        source = "cached plan" if cached_plan else "deterministic fallback"
        # The plan is still drafted, by code this time; the trace says so.
        with run.step("propose_plan", {"source": source}) as h:
            plan = cached_plan_fallback(fresh, user, cached_plan) if cached_plan else fallback_plan(fresh, user)
            h["result"] = {"ok": True, "source": source,
                           "options": [o["label"] for o in plan.get("options") or []]}
        run.finish("fallback", str(e))
        return plan, "fallback"


# ---------- propose job (worker, propose lane) ----------


def run_propose_job(save: dict, user: dict, final_attempt: bool = True) -> None:
    """Steps 1 to 5 of SPEC 8.1. Raises ReelError (from ytdlp) on read failures and
    PlannerBusy when Gemini is rate limited and another attempt is still allowed."""
    from . import ytdlp  # only the worker reaches Instagram

    sid = save["_id"]
    db.saves().update_one({"_id": sid}, {"$set": {"status": "reading"}})
    meta_run = Run(user, sid, "propose", get_settings().gemini_model_fast)
    try:
        with meta_run.step("fetch_metadata", {"url": save["url"]}) as h:
            meta = ytdlp.fetch_metadata(save["url"])
            h["result"] = {"caption_chars": len(meta["caption"]), "creator": meta["creator"]["handle"],
                           "duration_sec": meta["duration_sec"]}
    except Exception as e:
        meta_run.finish("failed", str(e))
        raise
    thumb_id = save.get("thumb_id") or thumbs.fetch_and_store(
        meta.pop("thumbnail_url", None), user["_id"], user.get("expires_at"))
    meta.pop("thumbnail_url", None)
    update = {**meta, "thumb_id": thumb_id, "status": "planning"}
    db.saves().update_one({"_id": sid}, {"$set": update})
    save = {**save, **update}

    run_planner(save, user, run_kind="propose", timeout_s=PROPOSE_TIMEOUT_S, run=meta_run,
                raise_busy=not final_attempt)

    # The plan is ready: flip to planned first so a waiting Shortcut gets its menu
    # without also waiting on the embedding call, then file the caption-level vector.
    db.saves().update_one({"_id": sid}, {"$set": {"status": "planned", "planned_at": now_utc()}})
    save = db.saves().find_one({"_id": sid})
    try:
        vec = gemini.embed_one(search.embedding_text(save, full=False), "RETRIEVAL_DOCUMENT")
        db.saves().update_one({"_id": sid}, {"$set": {"embedding": vec, "embedding_source": "caption"}})
    except Exception as e:  # noqa: BLE001 - search can catch up at enrich time
        log.warning("caption embedding failed for %s: %s", sid, str(e)[:160])
    jobs.enqueue("enrich", save)
