"""Ticket: the one shape every list returns (SPEC 13.3)."""
from __future__ import annotations

from datetime import datetime

from . import actions, db, intent
from .config import get_settings
from .models import failure_message
from .runs import latest_run, step_views
from .timeutil import DAY_LONG, DAY_SHORT, as_utc, big_time, long_day, month_day, now_utc, tz_of


def saved_on(save: dict, user: dict) -> str:
    return month_day(as_utc(save["created_at"]).astimezone(tz_of(user)))


def thumb_url(save: dict) -> str | None:
    return f"/api/t/{save['thumb_id']}" if save.get("thumb_id") else None


def done_on(plan: dict, tz, now_l: datetime) -> str | None:
    """'today', 'yesterday', 'Thursday' within the week, else 'Nov 3'. When it was marked done."""
    at = plan.get("done_at") or plan.get("updated_at")
    if not at:
        return None
    d = as_utc(at).astimezone(tz)
    delta = (now_l.date() - d.date()).days
    if delta <= 0:
        return "today"
    if delta == 1:
        return "yesterday"
    if delta < 7:
        return DAY_LONG[d.weekday()]
    return month_day(d)


def plan_view(plan: dict, user: dict, *, now: datetime | None = None) -> dict:
    tz = tz_of(user)
    now_u = as_utc(now or now_utc())
    now_l = now_u.astimezone(tz)
    kind = plan["kind"]
    status = plan["status"]
    options = [actions.option_view(o, kind, user, now=now_u) for o in plan.get("options") or []]
    chosen = actions.option_view(plan["chosen"], kind, user, now=now_u) if plan.get("chosen") else None
    if plan.get("scheduled_for"):
        big = big_time(as_utc(plan["scheduled_for"]).astimezone(tz), now_l)
    elif options and plan.get("actionable") and status == "proposed":
        big = options[0]["big_time"]
    else:
        big = None
    accepted = status == "accepted"
    has_cal = accepted and (plan.get("device_actions") or {}).get("event") or (
        accepted and (plan.get("device_actions") or {}).get("reminders"))
    return {
        "status": status, "intent": plan.get("intent"), "kind": kind,
        "actionable": bool(plan.get("actionable")),
        "question": plan.get("question") or "", "why": plan.get("why") or "",
        "confidence": plan.get("confidence") or "best_guess",
        "options": options, "extras": actions.extras_for(plan),
        "chosen": chosen, "big_time": big,
        "scheduled_iso": as_utc(plan["scheduled_for"]).astimezone(tz).isoformat(timespec="seconds")
        if plan.get("scheduled_for") else None,
        "followup_due": bool(accepted and plan.get("ends_at") and now_u > as_utc(plan["ends_at"])),
        # Waiting, but its dates are behind us (actions.is_missed): Actions lists it under Missed.
        "missed": actions.is_missed(plan),
        "confirmed_via": plan.get("confirmed_via"),
        "gcal_url": actions.gcal_url(plan) if has_cal else None,
        "ics_url": actions.ics_url(plan) if has_cal else None,
        "reminders_preview": actions.reminders_preview(plan, user, now=now_u) if accepted else [],
        "share_url": f"/p/{plan['_id']}?t={plan['share_token']}",
        "done_day": DAY_SHORT[as_utc(plan["updated_at"]).astimezone(tz).weekday()]
        if status in ("done", "skipped") and plan.get("updated_at") else None,
        "done_on": done_on(plan, tz, now_l) if status == "done" else None,
        "long_day": long_day(as_utc(plan["scheduled_for"]).astimezone(tz), now_l)
        if plan.get("scheduled_for") else None,
    }


def ticket(save: dict, plan: dict | None, user: dict, *, with_steps: bool = False,
           now: datetime | None = None) -> dict:
    creator = (save.get("creator") or {}).get("handle")
    failed = save.get("status") == "failed"
    t = {
        "save_id": str(save["_id"]),
        "plan_id": str(plan["_id"]) if plan else None,
        "url": save.get("url"),
        "title": save.get("title"),
        "type": save.get("type"),
        "subcategory": save.get("subcategory"),
        "creator": f"@{creator}" if creator else None,
        "thumb_url": thumb_url(save),
        "saved_on": saved_on(save, user),
        "created_at": as_utc(save["created_at"]).isoformat(),
        "processing": save.get("status"),
        "failure_reason": save.get("failure_reason") if failed else None,
        "failure_message": (save.get("failure_message")
                            or failure_message(save.get("failure_reason"), get_settings().app_name))
        if failed else None,
        "is_sample": save.get("source") == "sample",
        "plan": plan_view(plan, user, now=now) if plan else None,
        # What the person wants from the reel and how the app gives it (cook, shop, ...).
        "action": None if failed else intent.view(plan, save),
    }
    if with_steps:
        t["steps"] = step_views(latest_run(save["_id"]))
    return t


def tickets_for(saves: list[dict], user: dict, *, refresh: bool = False) -> list[dict]:
    """Tickets for many saves with one plans query."""
    from . import planops

    ids = [s["_id"] for s in saves]
    by_save = {p["save_id"]: p for p in db.plans().find({"save_id": {"$in": ids}})} if ids else {}
    out = []
    for s in saves:
        plan = by_save.get(s["_id"])
        if refresh:
            plan = planops.refresh_if_stale(plan, s, user)
        out.append(ticket(s, plan, user))
    return out
