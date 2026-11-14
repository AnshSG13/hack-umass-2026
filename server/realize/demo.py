"""Demo sessions and sample saves (SPEC 8.6, 14). None of this needs Instagram or the worker."""
from __future__ import annotations

import logging
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from . import accounts, db, planner, planops
from .timeutil import now_utc

log = logging.getLogger("realize.demo")

ENRICH_KEYS = ["type", "title", "summary", "fields", "caption_sufficient", "transcript",
               "transcript_text", "on_screen_text", "visual_summary", "entities", "tags",
               "unverified", "language"]
DEMO_HOURS = 24
LIVE_LIMIT = 3
CHAT_LIMIT = 20
LIVE_LIMIT_MESSAGE = "That's the live limit for this demo. The samples still work."
CHAT_LIMIT_MESSAGE = "That's the chat limit for this demo."
TRIP_LIMIT = 3  # trip plans per demo session; each one is paid searches
TRIP_LIMIT_MESSAGE = "That's the trip limit for this demo."


def sample_for(shortcode: str) -> dict | None:
    return db.sample_cache().find_one({"_id": shortcode})


def save_doc_from_sample(user: dict, sample: dict, *, status: str, source: str) -> dict:
    """A save pre-filled from the cache: metadata, enrichment, embedding and thumbnail."""
    now = now_utc()
    meta = sample.get("metadata") or {}
    enr = sample.get("enrichment") or {}
    doc = {
        "user_id": user["_id"], "url": sample["url"], "shortcode": sample["_id"], "source": source,
        "status": status, "failure_reason": None, "failure_message": None,
        "caption": meta.get("caption") or "", "hashtags": meta.get("hashtags") or [],
        "creator": meta.get("creator") or {}, "posted_at": meta.get("posted_at"),
        "duration_sec": meta.get("duration_sec"), "thumb_id": sample.get("thumb_id"),
        **{k: enr.get(k) for k in ENRICH_KEYS},
        "embedding": sample.get("embedding"), "embedding_source": "full",
        "intent": None, "plan_id": None, "enrich_error": None, "user_edited": [],
        "from_cache": True, "created_at": now, "planned_at": None,
        "ready_at": now if status == "ready" else None,
    }
    if user.get("expires_at"):
        doc["expires_at"] = user["expires_at"]
    return doc


def plan_sample(save_id, user_id: str) -> None:
    """Run the planner for a cache-backed save with the cached enrichment as context.
    On any error or timeout the cached plan is used with options recomputed by code."""
    save = db.saves().find_one({"_id": save_id, "user_id": user_id})
    user = db.users().find_one({"_id": user_id})
    if not save or not user:
        return
    sample = sample_for(save["shortcode"]) or {}
    try:
        planner.run_planner(save, user, run_kind="propose", with_enrichment=True,
                            timeout_s=planner.SAMPLE_TIMEOUT_S, cached_plan=sample.get("cached_plan") or {})
    except Exception as e:  # noqa: BLE001 - run_planner already falls back; this is the last net
        log.exception("sample planning failed: %s", e)
        planner.cached_plan_fallback(save, user, sample.get("cached_plan"))
    now = now_utc()
    db.saves().update_one({"_id": save_id}, {"$set": {"status": "ready", "planned_at": now, "ready_at": now}})


def create_session(timezone: str | None) -> tuple[dict, str]:
    """A demo user that deletes itself in 24 hours, holding every featured sample.

    The first two actionable recipe or workout samples are accepted into the first
    free slots, one other actionable sample stays proposed, and the rest are declined.
    """
    expires = now_utc() + timedelta(hours=DEMO_HOURS)
    user, key = accounts.create_user(timezone, is_demo=True, expires_at=expires)
    samples = list(db.sample_cache().find({"featured": True}).sort("order", 1))
    made: list[tuple[dict, dict, dict]] = []
    base = now_utc() - timedelta(minutes=len(samples) + 1)
    for i, sample in enumerate(samples):
        doc = save_doc_from_sample(user, sample, status="ready", source="sample")
        doc["created_at"] = base + timedelta(minutes=i)  # stable library order
        doc["planned_at"] = doc["created_at"]
        try:
            doc["_id"] = db.saves().insert_one(doc).inserted_id
        except DuplicateKeyError:
            continue
        made.append((doc, sample, {}))

    def actionable(sample: dict) -> bool:
        return bool((sample.get("cached_plan") or {}).get("actionable"))

    accept_ids, waiting_id = [], None
    for doc, sample, _ in made:
        t = (sample.get("enrichment") or {}).get("type")
        if t in ("recipe", "workout") and actionable(sample) and len(accept_ids) < 2:
            accept_ids.append(doc["_id"])
    for doc, sample, _ in made:
        if doc["_id"] not in accept_ids and actionable(sample):
            waiting_id = doc["_id"]
            break

    # Accept first so later proposals see those slots as taken.
    ordered = sorted(made, key=lambda m: 0 if m[0]["_id"] in accept_ids else 1)
    for doc, sample, _ in ordered:
        plan = planner.cached_plan_fallback(doc, user, sample.get("cached_plan") or {})
        if doc["_id"] in accept_ids and plan.get("options"):
            planops.accept(plan, doc, plan["options"][0], user, "web")
        elif doc["_id"] != waiting_id:
            planops.decline(plan)
    return user, key


def list_samples(user: dict | None) -> list[dict]:
    """Non-featured samples for the demo feed."""
    saved: set[str] = set()
    if user:
        saved = {s["shortcode"] for s in db.saves().find({"user_id": user["_id"]}, {"shortcode": 1})}
    out = []
    for s in db.sample_cache().find({"featured": {"$ne": True}}).sort("order", 1):
        meta = s.get("metadata") or {}
        enr = s.get("enrichment") or {}
        handle = (meta.get("creator") or {}).get("handle")
        caption = " ".join((meta.get("caption") or "").split())
        out.append({
            "shortcode": s["_id"], "url": s["url"], "title": enr.get("title"),
            "creator": f"@{handle}" if handle else None,
            "caption_excerpt": caption[:160] + ("…" if len(caption) > 160 else ""),
            "thumb_url": f"/api/t/{s['thumb_id']}" if s.get("thumb_id") else None,
            "type": enr.get("type"), "saved": s["_id"] in saved,
        })
    return out


def hero_ticket() -> dict | None:
    """A proposed ticket for the landing page from the first actionable sample. Writes nothing."""
    from bson import ObjectId

    from . import tickets
    from .config import get_settings
    from .models import default_prefs

    samples = list(db.sample_cache().find().sort("order", 1))
    if not samples:
        return None
    sample = next((s for s in samples if (s.get("cached_plan") or {}).get("actionable")
                   and (s.get("enrichment") or {}).get("type") == "recipe"), samples[0])
    user = {"_id": "u_template", "timezone": get_settings().default_timezone, "prefs": default_prefs()}
    save = save_doc_from_sample(user, sample, status="ready", source="sample")
    save["_id"] = ObjectId()
    cached = sample.get("cached_plan") or {}
    kind = cached.get("type") or save.get("type") or "other"
    built = planops.code_options(kind, save, user)
    plan = {
        "_id": ObjectId(), "save_id": save["_id"], "user_id": user["_id"], "kind": kind,
        "actionable": bool(cached.get("actionable")) and built["actionable"] is not False,
        "question": cached.get("question") or "", "why": built["why"] or cached.get("why") or "",
        "confidence": cached.get("confidence") or "best_guess", "options": built["options"],
        "status": "proposed", "intent": None, "chosen": None, "scheduled_for": None, "ends_at": None,
        "device_actions": {"event": None, "reminders": []}, "confirmed_via": None, "share_token": "",
    }
    t = tickets.ticket(save, plan, user)
    t["save_id"], t["plan_id"] = "", None
    return t


def reset() -> dict:
    """Delete all demo users and their documents (TTL does this too)."""
    total = {"users": 0, "saves": 0, "plans": 0, "jobs": 0, "agent_runs": 0, "trips": 0, "thumbnails": 0}
    for u in list(db.users().find({"is_demo": True}, {"_id": 1})):
        counts = accounts.delete_user_data(u["_id"])
        for k, v in counts.items():
            total[k] += v
    return total
