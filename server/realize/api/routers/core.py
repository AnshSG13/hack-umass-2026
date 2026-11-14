"""Health, config, users, search, chat, thumbnails, demo and debug routes (SPEC 15)."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ... import accounts, ask, board, db, demo, jobs, planops, ratelimit, search, subcats, thumbs, tickets
from ...config import get_settings
from ...models import (
    ChatRequest, CreateUserRequest, DemoSessionRequest, MePatch, TASTE_LABELS, TYPES,
)
from ...timeutil import as_utc, valid_tz
from ..deps import client_ip, current_user, optional_user

router = APIRouter()
RATE_LIMITED = "Slow down a little. Try again in a minute."


@router.get("/api/health")
def health() -> dict:
    s = get_settings()
    ok = True
    try:
        db.get_client().admin.command("ping")
        last = jobs.worker_last_seen_s()
    except Exception:  # noqa: BLE001
        ok, last = False, None
    return {
        "ok": ok, "db": "ok" if ok else "down",
        "worker_last_seen_s": round(last, 1) if last is not None else None,
        "hybrid_mode": search.active_mode(), "planner_mode": s.planner_mode,
        "models": {"fast": s.gemini_model_fast, "video": s.gemini_model_video, "embed": s.gemini_embed_model},
    }


@router.get("/api/config")
def config() -> dict:
    s = get_settings()
    return {"app_name": s.app_name, "public_base_url": s.public_base_url, "shortcut_url": s.shortcut_url,
            "judge_shortcut_url": s.judge_shortcut_url, "first_save_reel_url": s.first_save_reel_url,
            "demo_enabled": s.demo_enabled}


@router.post("/api/users")
def create_user(body: CreateUserRequest, request: Request) -> dict:
    if not ratelimit.allow("users", client_ip(request)):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    user, key = accounts.create_user(body.timezone)
    return {"user_id": user["_id"], "api_key": key}


def _counts(user: dict) -> dict:
    uid = user["_id"]
    by_type = {t: 0 for t in TYPES}
    total = 0
    for row in db.saves().aggregate([{"$match": {"user_id": uid}},
                                     {"$group": {"_id": "$type", "n": {"$sum": 1}}}]):
        total += row["n"]
        if row["_id"] in by_type:
            by_type[row["_id"]] = row["n"]
    plans = {r["_id"]: r["n"] for r in db.plans().aggregate(
        [{"$match": {"user_id": uid}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}])}
    return {"saves": total, "by_type": by_type, "plans": plans}


def _me(user: dict) -> dict:
    return {"user_id": user["_id"], "is_demo": bool(user.get("is_demo")), "is_judge": bool(user.get("is_judge")),
            "name": user.get("name") or "", "email": user.get("email"),
            "timezone": user["timezone"], "prefs": user["prefs"], "key_preview": user.get("key_preview"),
            "expires_at": as_utc(user["expires_at"]).isoformat() if user.get("expires_at") else None,
            "counts": _counts(user),
            "profile": user.get("profile"),
            "onboarded": bool(user.get("onboarded_at")) or bool(user.get("is_demo"))}


@router.get("/api/me")
def me(user: dict = Depends(current_user)) -> dict:
    return _me(user)


@router.patch("/api/me")
def patch_me(body: MePatch, user: dict = Depends(current_user)) -> dict:
    update: dict = {}
    if body.timezone is not None:
        tz = valid_tz(body.timezone)
        if not tz:
            raise HTTPException(status_code=400, detail="That time zone isn't one we know.")
        update["timezone"] = tz
    if body.name is not None:
        update["name"] = " ".join(body.name.split())
    if body.prefs is not None:
        prefs = dict(user["prefs"])
        patch = body.prefs.model_dump(exclude_none=True)
        if "types_on" in patch:
            types_on = dict(prefs.get("types_on") or {})
            types_on.update({k: bool(v) for k, v in patch.pop("types_on").items() if k in types_on})
            prefs["types_on"] = types_on
        prefs.update(patch)
        update["prefs"] = prefs
    if update:
        db.users().update_one({"_id": user["_id"]}, {"$set": update})
        user = db.users().find_one({"_id": user["_id"]})
    return _me(user)


@router.post("/api/me/key")
def new_key(user: dict = Depends(current_user)) -> dict:
    return {"api_key": accounts.rotate_key(user)}


@router.get("/api/tastes")
def tastes(user: dict = Depends(current_user)) -> dict:
    """Home's "Your tastes": one entry per type the user has saved, largest first, with
    the three newest thumbnails and the three most used tags. Counted in code."""
    by_type: dict[str, dict] = {}
    total = 0
    cursor = db.saves().find({"user_id": user["_id"]},
                             {"type": 1, "thumb_id": 1, "tags": 1, "created_at": 1}).sort("created_at", -1)
    for s in cursor:
        total += 1
        t = s.get("type") if s.get("type") in TYPES else None
        if t is None:
            continue  # still being read; it has no type yet
        e = by_type.setdefault(t, {"count": 0, "thumbs": [], "tags": {}})
        e["count"] += 1
        if s.get("thumb_id") and len(e["thumbs"]) < 3:
            e["thumbs"].append(f"/api/t/{s['thumb_id']}")
        for tag in {str(x).strip().lower().lstrip("#") for x in (s.get("tags") or []) if str(x).strip()}:
            e["tags"][tag] = e["tags"].get(tag, 0) + 1
    subs = subcats.counts(user["_id"])
    out = []
    for t in sorted(by_type, key=lambda k: (-by_type[k]["count"], TYPES.index(k))):
        e = by_type[t]
        top = sorted(e["tags"].items(), key=lambda kv: (-kv[1], kv[0]))[:3]
        out.append({"type": t, "label": TASTE_LABELS[t], "count": e["count"], "thumbs": e["thumbs"],
                    "tags": [{"tag": k, "count": n} for k, n in top],
                    "subcategories": subs.get(t, [])})
    return {"total": total, "tastes": out}


@router.get("/api/tastes/{type}")
def taste_board(type: str, user: dict = Depends(current_user)) -> dict:
    """One taste as a board: its saves as cards, and the tags that filter them."""
    if type not in TYPES:
        raise HTTPException(status_code=404, detail="That taste doesn't exist.")
    return board.board(user, type)


@router.get("/api/search")
def search_saves(q: str = "", type: str | None = None, sub: str | None = None,
                 user: dict = Depends(current_user)) -> dict:
    t = type if type in TYPES else None
    if not q.strip():
        return {"items": [], "mode": search.active_mode()}
    try:
        docs, mode = search.hybrid_search(user["_id"], q, type=t, limit=40 if t and sub else 20)
        if t and sub:
            docs = [d for d in docs if d.get("subcategory") == sub][:20]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Search didn't answer. Try again.") from e
    items = tickets.tickets_for(docs, user)
    for item, d in zip(items, docs):
        item["snippet"] = search.snippet(d, q)
    return {"items": items, "mode": mode}


@router.get("/api/chips")
def chips(user: dict = Depends(current_user)) -> dict:
    return {"chips": ask.chips(user)}


@router.post("/api/chat")
def chat(body: ChatRequest, user: dict = Depends(current_user)):
    if not ratelimit.allow("chat", user["_id"]):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    if user.get("is_demo"):
        if demo.chats_used(user) >= demo.CHAT_LIMIT:
            raise HTTPException(status_code=429, detail=demo.CHAT_LIMIT_MESSAGE)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Type a question first.")
    history = [t.model_dump() for t in body.history][-6:]
    return StreamingResponse(ask.stream(user, body.message.strip(), history),
                             media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/api/t/{thumb_id}")
def thumbnail(thumb_id: str) -> Response:
    doc = thumbs.get(thumb_id)
    if not doc:
        raise HTTPException(status_code=404, detail="No such image.")
    return Response(content=bytes(doc["data"]), media_type=doc.get("content_type") or "image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400"})


# ---------- demo ----------


@router.post("/api/demo/session")
def demo_session(body: DemoSessionRequest, request: Request) -> dict:
    if not get_settings().demo_enabled:
        raise HTTPException(status_code=404, detail="The demo is switched off.")
    if not ratelimit.allow("demo", client_ip(request)):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    user, key = demo.create_session(body.timezone)
    return {"api_key": key, "expires_at": as_utc(user["expires_at"]).isoformat()}


@router.get("/api/demo/samples")
def demo_samples(user: dict | None = Depends(optional_user)) -> list[dict]:
    return demo.list_samples(user)


@router.get("/api/demo/hero")
def demo_hero() -> dict:
    """A real ticket in the proposed state for the landing page, built from the
    first sample with default preferences. Nothing is written."""
    return {"ticket": demo.hero_ticket()}


@router.get("/api/debug/sleep")
def debug_sleep(s: float = Query(default=1, ge=0, le=60)) -> dict:
    if not get_settings().debug_endpoints:
        raise HTTPException(status_code=404, detail="Not found.")
    time.sleep(s)
    return {"slept": s}


__all__ = ["router", "planops"]
