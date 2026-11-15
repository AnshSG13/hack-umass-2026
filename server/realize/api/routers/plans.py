"""Plans (home), plan status, and the public plan page routes (SPEC 15)."""
from __future__ import annotations

import hmac
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ... import actions, db, planops, tickets
from ...models import PlanStatusRequest
from ...timeutil import as_utc, heading_day, month_day, now_utc, tz_of, week_bounds
from ..deps import current_user

router = APIRouter()


def _tickets_for_plans(plans: list[dict], user: dict, refresh: bool = False) -> list[dict]:
    ids = [p["save_id"] for p in plans]
    saves = {s["_id"]: s for s in db.saves().find(
        {"_id": {"$in": ids}, "user_id": user["_id"]}, {"embedding": 0, "transcript": 0})} if ids else {}
    out = []
    for p in plans:
        save = saves.get(p["save_id"])
        if not save:
            continue
        if refresh:
            p = planops.refresh_if_stale(p, save, user) or p
        out.append(tickets.ticket(save, p, user))
    return out


def _group_days(plans: list[dict], user: dict) -> list[dict]:
    tz = tz_of(user)
    days: dict = {}
    for p in sorted(plans, key=lambda p: as_utc(p["scheduled_for"])):
        d = as_utc(p["scheduled_for"]).astimezone(tz).date()
        days.setdefault(d, []).append(p)
    return [{"label": heading_day(d), "date": d.isoformat(),
             "items": _tickets_for_plans(items, user)} for d, items in days.items()]


@router.get("/api/plans")
def list_plans(range: str = Query(default="week", pattern="^(week|upcoming)$"),
               user: dict = Depends(current_user)) -> dict:
    tz = tz_of(user)
    now_l = now_utc().astimezone(tz)
    start, end = week_bounds(now_l)
    uid = user["_id"]
    last = end - timedelta(days=1)
    week_label = f"{month_day(start)} to {month_day(last)}"
    if range == "upcoming":
        later = list(db.plans().find({"user_id": uid, "status": "accepted", "scheduled_for": {"$gte": end}}))
        return {"waiting": [], "days": _group_days(later, user), "done": [], "later_count": 0,
                "week_label": week_label}

    # A recipe isn't waiting on a time: people cook a saved recipe when they want to, so
    # it opens to cook mode instead of asking for a slot (owner's call, 2026-11-14).
    waiting = list(db.plans().find({"user_id": uid, "status": "proposed", "kind": {"$ne": "recipe"}})
                   .sort("created_at", -1).limit(20))
    # Accepted plans up to the end of this week, including older ones still waiting on a follow-up.
    this_week = list(db.plans().find({"user_id": uid, "status": "accepted", "scheduled_for": {"$lt": end}}))
    done = list(db.plans().find({"user_id": uid, "status": "done",
                                 "updated_at": {"$gte": start - timedelta(days=7)}})
                .sort("updated_at", -1).limit(30))
    later_count = db.plans().count_documents(
        {"user_id": uid, "status": "accepted", "scheduled_for": {"$gte": end}})
    return {
        "waiting": _tickets_for_plans(waiting, user, refresh=True),
        "days": _group_days(this_week, user),
        "done": _tickets_for_plans(done, user),
        "later_count": later_count,
        "week_label": week_label,
    }


@router.get("/api/done")
def list_done(limit: int = Query(default=20, ge=1, le=50), user: dict = Depends(current_user)) -> dict:
    """Home's "Completed": actions marked done, newest first, with how many this week and
    in all. Counted in code."""
    uid = user["_id"]
    tz = tz_of(user)
    today, _ = week_bounds(now_utc().astimezone(tz))
    start = today - timedelta(days=6)  # the last 7 days, today included
    done = list(db.plans().find({"user_id": uid, "status": "done"})
                .sort([("done_at", -1), ("updated_at", -1)]).limit(limit))
    week = db.plans().count_documents({"user_id": uid, "status": "done", "$or": [
        {"done_at": {"$gte": start}}, {"done_at": None, "updated_at": {"$gte": start}}]})
    total = db.plans().count_documents({"user_id": uid, "status": "done"})
    return {"items": _tickets_for_plans(done, user), "week": week, "total": total}


def _status_message(status: str) -> str:
    return {"done": "Marked done.", "skipped": "Marked skipped.", "accepted": "Undone."}[status]


@router.post("/api/plans/{plan_id}/status")
def set_status(plan_id: str, body: PlanStatusRequest, user: dict = Depends(current_user)) -> dict:
    _id = db.oid(plan_id)
    plan = db.plans().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None
    if not plan:
        raise HTTPException(status_code=404, detail="That plan isn't yours or no longer exists.")
    try:
        plan = planops.set_status(plan, body.status)
    except planops.PlanError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    save = db.saves().find_one({"_id": plan["save_id"], "user_id": user["_id"]})
    return {"message": _status_message(body.status), "ticket": tickets.ticket(save, plan, user)}


# ---------- public plan page: share_token instead of a key ----------


def _public_plan(plan_id: str, t: str | None) -> tuple[dict, dict, dict]:
    _id = db.oid(plan_id)
    plan = db.plans().find_one({"_id": _id}) if _id else None
    if not plan or not t or not hmac.compare_digest(str(plan.get("share_token") or ""), str(t)):
        raise HTTPException(status_code=404, detail="This link doesn't open a plan.")
    # user_id comes from the plan the token unlocked, never from the request.
    user = db.users().find_one({"_id": plan["user_id"]})
    save = db.saves().find_one({"_id": plan["save_id"], "user_id": plan["user_id"]})
    if not user or not save:
        raise HTTPException(status_code=404, detail="This link doesn't open a plan.")
    return plan, save, user


@router.get("/api/public/plans/{plan_id}")
def public_plan(plan_id: str, t: str | None = None) -> dict:
    plan, save, user = _public_plan(plan_id, t)
    return {"ticket": tickets.ticket(save, plan, user)}


@router.post("/api/public/plans/{plan_id}/status")
def public_status(plan_id: str, body: PlanStatusRequest, t: str | None = None) -> dict:
    plan, save, user = _public_plan(plan_id, t)
    if body.status not in ("done", "skipped"):
        raise HTTPException(status_code=400, detail="Only done or skipped work from this link.")
    try:
        plan = planops.set_status(plan, body.status)
    except planops.PlanError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"message": _status_message(body.status), "ticket": tickets.ticket(save, plan, user)}


@router.get("/api/public/plans/{plan_id}/ics")
def public_ics(plan_id: str, t: str | None = None) -> Response:
    plan, _, _ = _public_plan(plan_id, t)
    body = actions.build_ics(plan)
    if not body:
        raise HTTPException(status_code=404, detail="This plan has nothing to add to a calendar yet.")
    return Response(content=body.encode("utf-8"), media_type="text/calendar",
                    # inline, so Safari on an iPhone opens its "Add to Calendar" sheet
                    # straight away; browsers that can't show a calendar file still save it.
                    headers={"Content-Disposition": 'inline; filename="plan.ics"'})
