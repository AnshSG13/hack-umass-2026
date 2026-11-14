"""Ingest, confirm and everything else under /api/saves (SPEC 6, 7, 15)."""
from __future__ import annotations

import time
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ... import accounts, actions, db, demo, jobs, planner, planops, ratelimit, tickets, urls
from ...config import get_settings
from ...models import ConfirmRequest, SaveRequest, TYPES, failure_message
from ...runs import run_view
from ...timeutil import as_utc, month_day, now_utc, tz_of
from ..deps import background, bad_key_message, bearer, current_user

router = APIRouter()

NOT_A_LINK = "That wasn't an Instagram post link. Share a reel from Instagram, or paste its link."
RATE_LIMITED = "Slow down a little. Try again in a minute."
EXPIRED = "That choice expired. Open Realize to pick again."
IN_FLIGHT = ("queued", "reading", "planning")


def _app(text: str) -> str:
    return text.replace("Realize", get_settings().app_name)


def _save_response(status: str, *, ask: str = "no", save_id: str = "", prompt: str = "",
                   menu: list[str] | None = None, message: str = "", ticket: dict | None = None) -> dict:
    return {"status": status, "ask": ask, "save_id": save_id, "prompt": prompt,
            "menu": menu or [], "message": message, "ticket": ticket}


def _fake_plan_task(save_id, user_id: str) -> None:
    save = db.saves().find_one({"_id": save_id})
    user = db.users().find_one({"_id": user_id})
    if not save or not user:
        return
    db.saves().update_one({"_id": save_id}, {"$set": {"status": "planning"}})
    planner.fake_plan(save, user)
    now = now_utc()
    db.saves().update_one({"_id": save_id}, {"$set": {"status": "ready", "planned_at": now, "ready_at": now}})


def _start_processing(save: dict, user: dict) -> None:
    """Kick off planning for a new or reset save."""
    if save.get("from_cache"):
        background.submit(demo.plan_sample, save["_id"], user["_id"])
    elif get_settings().planner_mode == "fake":
        background.submit(_fake_plan_task, save["_id"], user["_id"])
    else:
        jobs.enqueue("propose", save)


def _respond(save: dict, user: dict, *, prefix: str = "") -> dict:
    """Build the SaveResponse for the save's current state."""
    sid = str(save["_id"])
    plan = planops.get_for_save(save["_id"])
    if save["status"] == "failed":
        msg = save.get("failure_message") or failure_message(save.get("failure_reason"), get_settings().app_name)
        return _save_response("failed", save_id=sid, message=msg, ticket=tickets.ticket(save, plan, user))
    if save["status"] in IN_FLIGHT or not plan:
        return _save_response(
            "pending", save_id=sid,
            message=_app("Saved. Still reading it. Your plan will be waiting in Realize."),
            ticket=tickets.ticket(save, plan, user, with_steps=True))
    plan = planops.refresh_if_stale(plan, save, user)
    prompt = f"{prefix}{save.get('title') or 'Saved reel'}. {plan.get('question') or ''}".strip()
    if len(prompt) > 110:
        prompt = prompt[:109].rstrip() + "…"
    return _save_response("proposed", ask="yes", save_id=sid, prompt=prompt, menu=actions.menu_for(plan),
                          message=prompt, ticket=tickets.ticket(save, plan, user, with_steps=True))


@router.post("/api/save")
def post_save(body: SaveRequest, authorization: str | None = Header(default=None)) -> dict:
    s = get_settings()
    user = accounts.find_by_key(bearer(authorization))
    if not user:
        return _save_response("error", message=bad_key_message())
    if not ratelimit.allow("save", user["_id"]):
        return _save_response("error", message=RATE_LIMITED)
    link = urls.extract(body.input)
    if not link:
        return _save_response("error", message=NOT_A_LINK)

    wait = body.wait if body.wait is not None else (s.proposal_wait_seconds if body.source == "shortcut" else 0)
    wait = max(0.0, min(float(wait), float(s.wait_cap)))
    tz = tz_of(user)
    q = {"user_id": user["_id"], "shortcode": link.shortcode}

    def existing_response(save: dict) -> dict | None:
        """Step 4. None means: keep going and wait on it."""
        day = month_day(as_utc(save["created_at"]).astimezone(tz))
        if save["status"] == "failed":
            db.saves().update_one({"_id": save["_id"]}, {"$set": {
                "status": "queued", "failure_reason": None, "failure_message": None}})
            _start_processing({**save, "status": "queued"}, user)
            return None
        if save["status"] in IN_FLIGHT:
            return None
        plan = planops.get_for_save(save["_id"])
        if plan and plan["status"] == "proposed":
            return _respond(save, user, prefix=f"You saved this on {day}. ")
        return _save_response(
            "duplicate", save_id=str(save["_id"]),
            message=f"You saved this on {day}. {actions.state_phrase(plan, user)}",
            ticket=tickets.ticket(save, plan, user))

    save = db.saves().find_one(q)
    if save:
        early = existing_response(save)
        if early:
            return early
    else:
        sample = demo.sample_for(link.shortcode)
        if user.get("is_demo") and not sample:
            live = db.saves().count_documents({"user_id": user["_id"], "from_cache": {"$ne": True}})
            if live >= demo.LIVE_LIMIT:
                return _save_response("error", message=demo.LIVE_LIMIT_MESSAGE)
        if user.get("is_judge") and not ratelimit.allow("judge_save", user["_id"]):
            return _save_response("error", message=RATE_LIMITED)
        if sample:
            doc = demo.save_doc_from_sample(user, sample, status="planning", source=body.source)
        else:
            doc = {
                **q, "url": link.url, "source": body.source, "status": "queued",
                "failure_reason": None, "failure_message": None, "caption": "", "hashtags": [],
                "creator": {}, "posted_at": None, "duration_sec": None, "thumb_id": None,
                "type": None, "title": None, "summary": "", "fields": {}, "caption_sufficient": True,
                "transcript": [], "transcript_text": "", "on_screen_text": [], "visual_summary": "",
                "entities": [], "tags": [], "unverified": [], "language": None,
                "intent": None, "plan_id": None, "enrich_error": None, "user_edited": [],
                "created_at": now_utc(), "planned_at": None, "ready_at": None,
            }
            if user.get("expires_at"):
                doc["expires_at"] = user["expires_at"]
        try:
            doc["_id"] = db.saves().insert_one(doc).inserted_id
            save = doc
            _start_processing(save, user)
        except DuplicateKeyError:  # an insert race is an existing save
            save = db.saves().find_one(q)
            early = existing_response(save)
            if early:
                return early

    deadline = time.monotonic() + wait
    while save["status"] in IN_FLIGHT and time.monotonic() < deadline:
        time.sleep(0.4)
        save = db.saves().find_one({"_id": save["_id"]}) or save
    return _respond(save, user)


def _own_save(save_id: str, user: dict) -> dict:
    _id = db.oid(save_id)
    save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None
    if not save:
        raise HTTPException(status_code=404, detail="That save isn't in your library.")
    return save


def _confirm_response(status: str, plan: dict | None, save: dict | None, user: dict | None,
                      message: str) -> dict:
    base = {"status": status, "plan_id": str(plan["_id"]) if plan else "", "message": message,
            "has_event": "no", "event_title": "", "event_start_text": "", "event_end_text": "",
            "event_start_iso": "", "event_end_iso": "", "event_location": "", "event_notes": "",
            "event": None, "reminders": [], "gcal_url": "", "ics_url": "", "ticket": None}
    if plan and user and status == "accepted":
        base.update(actions.device_payload(plan, user))
    if plan and save and user:
        base["ticket"] = tickets.ticket(save, plan, user)
    return base


@router.post("/api/saves/{save_id}/confirm")
def confirm(save_id: str, body: ConfirmRequest, authorization: str | None = Header(default=None)) -> dict:
    user = accounts.find_by_key(bearer(authorization))
    if not user:
        return _confirm_response("error", None, None, None, bad_key_message())
    _id = db.oid(save_id)
    save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None
    plan = planops.get_for_save(save["_id"]) if save else None
    if not save or not plan:
        return _confirm_response("error", None, None, user, _app(EXPIRED))
    try:
        if body.start_local:
            option = actions.custom_option(plan["kind"], body.start_local, save.get("title") or "Saved reel",
                                           save.get("fields"), user)
            kind = "option"
        else:
            kind, option = actions.match_choice(plan, body.choice)
        if kind == "option":
            same = (plan["status"] == "accepted" and plan.get("chosen")
                    and plan["chosen"]["id"] == option["id"]
                    and as_utc(plan["chosen"]["start_utc"]) == as_utc(option["start_utc"]))
            if not same:
                plan = planops.accept(plan, save, option, user, body.source)
            msg = actions.accepted_message(plan, plan["chosen"], user, plan.get("confirmed_via") or body.source)
            return _confirm_response("accepted", plan, save, user, msg)
        if kind == "later":
            plan = planops.later(plan)
            return _confirm_response("later", plan, save, user, _app("Okay. It's waiting in Realize."))
        if kind == "none":
            plan = planops.decline(plan)
            return _confirm_response("declined", plan, save, user, "Saved to your library.")
    except planops.PlanError as e:
        return _confirm_response("error", plan, save, user, _app(str(e)))
    except ValueError as e:
        return _confirm_response("error", plan, save, user, str(e) or _app(EXPIRED))
    return _confirm_response("error", plan, save, user, _app(EXPIRED))


@router.post("/api/saves/{save_id}/unconfirm")
def unconfirm(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    plan = planops.get_for_save(save["_id"])
    if not plan:
        raise HTTPException(status_code=404, detail="This save has no plan yet.")
    try:
        plan, msg = planops.unconfirm(plan)
    except planops.PlanError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    # Offer times that are free now, not the ones computed before other plans were accepted.
    plan = planops.replan_code(save, plan, user)
    return {"status": "proposed", "message": msg, "ticket": tickets.ticket(save, plan, user)}


@router.post("/api/saves/{save_id}/replan")
def replan(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    plan = planops.get_for_save(save["_id"])
    if not plan:
        raise HTTPException(status_code=409, detail="This save is still being read.")
    plan = planops.replan_code(save, plan, user)
    return {"ticket": tickets.ticket(save, plan, user)}


@router.get("/api/saves/{save_id}/slots")
def free_slots(save_id: str, user: dict = Depends(current_user)) -> dict:
    """Up to 3 free slots for the Change sheet ("Sun 12 pm · You're free")."""
    from ... import slots as slots_mod
    from ...models import SLOT_KINDS

    save = _own_save(save_id, user)
    plan = planops.get_for_save(save["_id"])
    if not plan or plan["kind"] not in SLOT_KINDS:
        return {"slots": []}
    accepted = [a for a in slots_mod.load_accepted(user["_id"]) if a.get("plan_id") != plan["_id"]]
    found = slots_mod.find_free_slot(user, plan["kind"], accepted=accepted)
    return {"slots": [slots_mod.public_slot(x) for x in found[:3]]}


@router.post("/api/saves/{save_id}/retry")
def retry(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    if save["status"] != "failed":
        raise HTTPException(status_code=409, detail="This save doesn't need a retry.")
    db.saves().update_one({"_id": save["_id"]}, {"$set": {
        "status": "queued", "failure_reason": None, "failure_message": None}})
    save = {**save, "status": "queued", "failure_reason": None, "failure_message": None}
    _start_processing(save, user)
    return {"ticket": tickets.ticket(save, planops.get_for_save(save["_id"]), user, with_steps=True)}


@router.delete("/api/saves/{save_id}")
def delete_save(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    db.plans().delete_many({"save_id": save["_id"], "user_id": user["_id"]})
    db.agent_runs().delete_many({"save_id": save["_id"], "user_id": user["_id"]})
    db.jobs().delete_many({"save_id": save["_id"], "user_id": user["_id"]})
    if save.get("thumb_id"):
        db.thumbnails().delete_one({"_id": save["thumb_id"], "owner_user_id": user["_id"]})
    db.saves().delete_one({"_id": save["_id"], "user_id": user["_id"]})
    return {"ok": True}


@router.get("/api/saves")
def list_saves(type: str | None = None, limit: int = Query(default=30, ge=1, le=100),
               before: str | None = None, user: dict = Depends(current_user)) -> dict:
    q: dict = {"user_id": user["_id"]}
    if type in TYPES:
        q["type"] = type
    if before:
        try:
            q["created_at"] = {"$lt": datetime.fromisoformat(before.replace("Z", "+00:00"))}
        except ValueError as e:
            raise HTTPException(status_code=400, detail="before must be an ISO date.") from e
    docs = list(db.saves().find(q, {"embedding": 0, "transcript": 0}).sort("created_at", -1).limit(limit + 1))
    more = len(docs) > limit
    docs = docs[:limit]
    return {"items": tickets.tickets_for(docs, user, refresh=True),
            "next_before": as_utc(docs[-1]["created_at"]).isoformat() if more and docs else None}


@router.get("/api/saves/{save_id}")
def get_save(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    plan = planops.refresh_if_stale(planops.get_for_save(save["_id"]), save, user)
    runs = list(db.agent_runs().find({"save_id": save["_id"], "user_id": user["_id"]}).sort("started_at", 1))
    return {
        "ticket": tickets.ticket(save, plan, user, with_steps=True),
        "details": {
            "caption": save.get("caption") or "", "summary": save.get("summary") or "",
            "fields": save.get("fields") or {}, "transcript": save.get("transcript") or [],
            "on_screen_text": save.get("on_screen_text") or [], "entities": save.get("entities") or [],
            "unverified": save.get("unverified") or [], "enrich_error": save.get("enrich_error"),
            "visual_summary": save.get("visual_summary") or "", "language": save.get("language"),
            "duration_sec": save.get("duration_sec"),
        },
        "runs": [run_view(r) for r in runs],
    }


@router.get("/api/agent_runs")
def agent_runs(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    runs = list(db.agent_runs().find({"save_id": save["_id"], "user_id": user["_id"]}).sort("started_at", 1))
    return {"runs": [run_view(r) for r in runs]}
