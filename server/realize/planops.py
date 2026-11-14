"""Plan documents and their transitions (SPEC 5.3, 7). One plan per save."""
from __future__ import annotations

import secrets
from datetime import datetime

from bson import ObjectId
from pymongo import ReturnDocument

from . import actions, db, slots
from .models import SLOT_KINDS
from .timeutil import as_utc, now_utc


class PlanError(Exception):
    """A transition the plan's current state doesn't allow. The message is user-facing."""


def _hist(frm: str, to: str) -> dict:
    return {"from": frm, "to": to, "at": now_utc()}


def get_for_save(save_id: ObjectId) -> dict | None:
    return db.plans().find_one({"save_id": save_id})


def code_options(kind: str, save: dict, user: dict, *, reserved: list[dict] | None = None,
                 now: datetime | None = None, starts_local: list[str] | None = None,
                 known_slots: list[dict] | None = None) -> dict:
    """Options computed by code alone. For slot kinds, starts_local picks from
    known_slots (this run's find_free_slot results); anything else is dropped and
    replaced with the first free slots."""
    accepted = slots.load_accepted(user["_id"])
    chosen: list[dict] = []
    if kind in SLOT_KINDS:
        fresh = slots.find_free_slot(user, kind, reserved=reserved, now=now, accepted=accepted)
        valid = {s["start_local"]: s for s in (known_slots or [])}
        valid.update({s["start_local"]: s for s in fresh})
        for st in starts_local or []:
            s = valid.get(str(st)[:16])
            if s and s not in chosen and as_utc(s["start_utc"]) > as_utc(now or now_utc()):
                chosen.append(s)
        if not chosen:
            chosen = fresh[:2]
    built = actions.build_options(kind, save.get("title") or "Saved reel", save.get("fields"), user,
                                  slots=chosen, now=now, accepted=accepted)
    if kind == "event" and built["why"] is None and built["options"]             and built["options"][0]["label"] == actions.CHECK_DATES:
        # An event with no readable date gets a reminder, and the reason has to say so.
        built["why"] = "The date isn't clear yet, so this is a reminder to check."
    return built


def upsert_proposal(save: dict, user: dict, *, kind: str, actionable: bool, question: str,
                    why: str, confidence: str, options: list[dict],
                    similar_save_id: str | None = None) -> dict:
    """Create the plan at proposal time, or refresh a still-proposed one.
    Old options move to options_prev so a Shortcut menu shown earlier still matches."""
    now = now_utc()
    existing = get_for_save(save["_id"])
    if existing:
        if existing["status"] != "proposed":
            return existing
        plan = db.plans().find_one_and_update(
            {"_id": existing["_id"], "status": "proposed"},
            {"$set": {"kind": kind, "actionable": actionable, "question": question, "why": why,
                      "confidence": confidence, "options": options,
                      "options_prev": existing.get("options") or [], "updated_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        return plan or existing
    doc = {
        "user_id": user["_id"], "save_id": save["_id"], "kind": kind, "actionable": actionable,
        "question": question, "why": why, "confidence": confidence,
        "options": options, "options_prev": [], "status": "proposed", "intent": None,
        "chosen": None, "scheduled_for": None, "ends_at": None,
        "device_actions": {"event": None, "reminders": []},
        "confirmed_via": None, "followup_at": None,
        "share_token": secrets.token_urlsafe(16)[:22],
        "similar_save_id": similar_save_id,
        "history": [], "created_at": now, "updated_at": now,
    }
    if user.get("expires_at"):
        doc["expires_at"] = user["expires_at"]
    try:
        doc["_id"] = db.plans().insert_one(doc).inserted_id
    except Exception:  # unique {save_id}: someone else created it first
        found = get_for_save(save["_id"])
        if not found:
            raise
        doc = found
    db.saves().update_one({"_id": save["_id"]}, {"$set": {"plan_id": doc["_id"]}})
    return doc


def accept(plan: dict, save: dict, option: dict, user: dict, source: str) -> dict:
    """proposed → accepted, or accepted → accepted with a different option."""
    if plan["status"] not in ("proposed", "accepted"):
        raise PlanError("That choice expired. Open Realize to pick again.")
    da = actions.build_device_actions(plan, save, option, user)
    plan = db.plans().find_one_and_update(
        {"_id": plan["_id"]},
        {"$set": {"status": "accepted", "intent": None, "chosen": option,
                  "scheduled_for": da["scheduled_for"], "ends_at": da["ends_at"],
                  "followup_at": da["followup_at"],
                  "device_actions": {"event": da["event"], "reminders": da["reminders"]},
                  "confirmed_via": source, "updated_at": now_utc()},
         "$push": {"history": _hist(plan["status"], "accepted")}},
        return_document=ReturnDocument.AFTER,
    )
    db.saves().update_one({"_id": save["_id"]}, {"$set": {"intent": "yes"}})
    return plan


def later(plan: dict) -> dict:
    if plan["status"] != "proposed":
        raise PlanError("That choice expired. Open Realize to pick again.")
    plan = db.plans().find_one_and_update(
        {"_id": plan["_id"]}, {"$set": {"intent": "later", "updated_at": now_utc()}},
        return_document=ReturnDocument.AFTER)
    db.saves().update_one({"_id": plan["save_id"]}, {"$set": {"intent": "later"}})
    return plan


def decline(plan: dict) -> dict:
    if plan["status"] not in ("proposed", "declined"):
        raise PlanError("That choice expired. Open Realize to pick again.")
    if plan["status"] == "declined":
        return plan
    plan = db.plans().find_one_and_update(
        {"_id": plan["_id"]},
        {"$set": {"status": "declined", "intent": None, "updated_at": now_utc()},
         "$push": {"history": _hist("proposed", "declined")}},
        return_document=ReturnDocument.AFTER)
    db.saves().update_one({"_id": plan["save_id"]}, {"$set": {"intent": "none"}})
    return plan


def _back_to_proposed(plan: dict, extra: dict | None = None) -> dict:
    return db.plans().find_one_and_update(
        {"_id": plan["_id"]},
        {"$set": {"status": "proposed", "intent": None, "chosen": None, "scheduled_for": None,
                  "ends_at": None, "followup_at": None,
                  "device_actions": {"event": None, "reminders": []},
                  "updated_at": now_utc(), **(extra or {})},
         "$push": {"history": _hist(plan["status"], "proposed")}},
        return_document=ReturnDocument.AFTER)


def unconfirm(plan: dict) -> tuple[dict, str]:
    """accepted → proposed. Returns (plan, message)."""
    if plan["status"] != "accepted":
        raise PlanError("There's nothing to undo on this plan.")
    via = plan.get("confirmed_via")
    new = _back_to_proposed(plan, {"confirmed_via": None})
    db.saves().update_one({"_id": plan["save_id"]}, {"$set": {"intent": None}})
    msg = ("Back in Waiting on you. If it's on your phone's calendar, delete it there too."
           if via == "shortcut" else "Undone.")
    return new, msg


def set_status(plan: dict, status: str) -> dict:
    """accepted → done | skipped; done | skipped → accepted (undo)."""
    cur = plan["status"]
    allowed = (cur == "accepted" and status in ("done", "skipped")) or (
        cur in ("done", "skipped") and status == "accepted")
    if cur == status:
        return plan
    if not allowed:
        raise PlanError("This plan can't change to that right now.")
    return db.plans().find_one_and_update(
        {"_id": plan["_id"]},
        {"$set": {"status": status, "updated_at": now_utc()},
         "$push": {"history": _hist(cur, status)}},
        return_document=ReturnDocument.AFTER)


def replan_code(save: dict, plan: dict, user: dict, *, reserved: list[dict] | None = None) -> dict:
    """Fresh options from slots.py and back to proposed ("Plan again"). Never touches accepted or done plans
    unless the caller is the user asking for it; the API checks that."""
    built = code_options(plan["kind"], save, user, reserved=reserved)
    extra: dict = {"options": built["options"], "options_prev": plan.get("options") or []}
    if built["actionable"] is False:
        extra["actionable"] = False
        extra["why"] = built["why"]
    if plan["status"] == "proposed":
        return db.plans().find_one_and_update(
            {"_id": plan["_id"]}, {"$set": {**extra, "intent": None, "updated_at": now_utc()}},
            return_document=ReturnDocument.AFTER)
    new = _back_to_proposed(plan, extra)
    db.saves().update_one({"_id": save["_id"]}, {"$set": {"intent": None}})
    return new


def refresh_if_stale(plan: dict | None, save: dict, user: dict) -> dict | None:
    """A proposed plan whose first option has passed gets fresh options, so
    Waiting on you never offers a time in the past."""
    if not plan or plan["status"] != "proposed" or not plan.get("options"):
        return plan
    first = min(as_utc(o["start_utc"]) for o in plan["options"])
    if first > now_utc():
        return plan
    return replan_code(save, plan, user)
