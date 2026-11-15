"""Health, config, users, search, chat, thumbnails, demo and debug routes (SPEC 15)."""
from __future__ import annotations

import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ... import (accounts, ask, board, db, demo, discuss, intent, jobs, planops, ratelimit, search, subcats, thumbs,
                 tickets, visits)
from ...config import get_settings
from ...models import (
    ChatRequest, CreateUserRequest, DemoSessionRequest, MePatch, TASTE_LABELS, TYPES,
)
from ...timeutil import as_utc, now_utc, tz_of, valid_tz
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
            "quick_shortcut_url": s.quick_shortcut_url,
            "quick_shortcut_keyed": s.quick_shortcut_keyed,
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
            # An email account has a key from sign-up that was never shown. Once one is shown
            # (for the Shortcut), making another replaces the one already pasted somewhere.
            "shortcut_key": bool(user.get("key_shown_at")) or not user.get("email"),
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
    the three newest thumbnails, the three most used tags, and how many are new since the
    last visit. Also the greeting's recap. Counted in code."""
    by_type: dict[str, dict] = {}
    total = 0
    prev = visits.touch(user)
    seen = (user.get("visits") or {}).get("taste_seen") or {}
    week_ago = now_utc() - timedelta(days=visits.RECAP_DAYS)
    new_since: dict[str, int] = {}
    this_week: dict[str, int] = {}
    done_ids = {p["save_id"] for p in db.plans().find({"user_id": user["_id"], "status": "done"}, {"save_id": 1})}
    done: dict[str, int] = {}
    cursor = db.saves().find({"user_id": user["_id"]},
                             {"type": 1, "thumb_id": 1, "tags": 1, "created_at": 1}).sort("created_at", -1)
    for s in cursor:
        total += 1
        t = s.get("type") if s.get("type") in TYPES else None
        if t is None:
            continue  # still being read; it has no type yet
        e = by_type.setdefault(t, {"count": 0, "thumbs": [], "tags": {}})
        e["count"] += 1
        if s["_id"] in done_ids:
            done[t] = done.get(t, 0) + 1
        made = as_utc(s["created_at"])
        line = visits.new_line(prev, seen.get(t))
        if made > line:
            new_since[t] = new_since.get(t, 0) + 1
        if made > week_ago:
            this_week[t] = this_week.get(t, 0) + 1
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
                    "subcategories": subs.get(t, []), "new": new_since.get(t, 0),
                    "done": done.get(t, 0)})
    # The greeting says what was sorted for them: since last time if anything is new,
    # otherwise over the past week.
    fresh = visits.recap_parts({k: v for k, v in new_since.items()})
    parts, window = (fresh, "new") if fresh else (visits.recap_parts(this_week), "week")
    return {"total": total, "tastes": out, "done": sum(done.values()),
            "recap": {"window": window, "parts": parts, "text": visits.join_words(parts)} if parts else None}


@router.get("/api/tastes/{type}")
def taste_board(type: str, user: dict = Depends(current_user)) -> dict:
    """One taste as a board: its saves as cards, and the tags that filter them."""
    if type not in TYPES:
        raise HTTPException(status_code=404, detail="That taste doesn't exist.")
    visits.mark_taste_seen(user, type)
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


def ago_words(days: int) -> str:
    """How long ago, the way a person says it: "yesterday", "9 days ago", "3 weeks ago"."""
    if days <= 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 60:
        return f"{days // 7} weeks ago"
    months = days // 30
    return "a year ago" if months >= 12 else f"{months} months ago"


@router.get("/api/remember")
def remember(user: dict = Depends(current_user)) -> dict:
    """One just-vibes reel saved before today, to bring back on Home: a different one each
    day, picked in code. Not a reminder; nothing is scheduled."""
    import hashlib
    from datetime import datetime as _dt

    tz = tz_of(user)
    today = now_utc().astimezone(tz).date()
    start_of_day = _dt.combine(today, _dt.min.time(), tzinfo=tz)
    docs = list(db.saves().find(
        {"user_id": user["_id"], "type": "other", "status": {"$in": ["planned", "enriching", "ready"]},
         "created_at": {"$lt": start_of_day}},
        {"title": 1, "thumb_id": 1, "created_at": 1}).sort("created_at", -1).limit(60))
    if not docs:
        return {"item": None}
    seed = int(hashlib.sha256(f"{user['_id']}:{today.isoformat()}".encode()).hexdigest()[:8], 16)
    s = docs[seed % len(docs)]
    a = intent.view(planops.get_for_save(s["_id"]), {"type": "other"}) or {}
    line = a.get("cta") if a.get("deliver") == "keep" else None
    saved_l = as_utc(s["created_at"]).astimezone(tz)
    return {"item": {"save_id": str(s["_id"]), "title": s.get("title") or "Saved reel",
                     "thumb_url": tickets.thumb_url(s), "saved_on": tickets.saved_on(s, user),
                     "ago": ago_words((today - saved_l.date()).days), "weekday": saved_l.strftime("%A"),
                     "line": line or intent.WORDS["keep"]["cta"], "day": today.isoformat()}}


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
    chat = None
    if body.chat_id:
        chat = discuss.get_ask(body.chat_id, user)
        if not chat:
            raise HTTPException(status_code=404, detail="That chat isn't here any more.")
        history = [{"role": m.get("role"), "text": m.get("text") or ""} for m in chat.get("messages") or []][-6:]
    else:
        history = [t.model_dump() for t in body.history][-6:]
    return StreamingResponse(ask.stream(user, body.message.strip(), history, chat),
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


@router.get("/api/demo/story")
def demo_story(user: dict = Depends(current_user)) -> dict:
    """The guided first open's pieces: the sample reel to save and, if this account has
    them, its own saves of that reel and of the trip reel. Demo sessions get it on first
    open; any account can watch it again from Settings."""
    return demo.story(user)


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
