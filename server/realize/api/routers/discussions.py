"""Discussions: chats about one reel, saved with it (see realize/discuss.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ... import db, demo, discuss, ratelimit, search
from ...models import DiscussRequest
from ..deps import current_user

router = APIRouter()

RATE_LIMITED = "Slow down a little. Try again in a minute."
NOT_YOURS = "That save isn't in your library."
NO_DISCUSSION = "That discussion isn't here any more."
STILL_READING = "This reel is still being read. Ask again in a moment."


def _own_save(save_id: str, user: dict) -> dict:
    _id = db.oid(save_id)
    save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}, {"embedding": 0}) if _id else None
    if not save:
        raise HTTPException(status_code=404, detail=NOT_YOURS)
    return save


@router.get("/api/saves/{save_id}/discussions")
def list_discussions(save_id: str, user: dict = Depends(current_user)) -> dict:
    return {"discussions": discuss.list_for_save(_own_save(save_id, user), user)}


@router.post("/api/saves/{save_id}/discussions")
def ask_about(save_id: str, body: DiscussRequest, user: dict = Depends(current_user)) -> dict:
    """Ask one question about this reel. Without discussion_id a new discussion starts.
    Returns the whole discussion, with the new question and its answer at the end."""
    save = _own_save(save_id, user)
    message = " ".join(body.message.split())
    if not message:
        raise HTTPException(status_code=400, detail="Type a question first.")
    if save.get("status") not in search.SEARCHABLE:
        raise HTTPException(status_code=409, detail=STILL_READING)
    if not ratelimit.allow("chat", user["_id"]):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    if user.get("is_demo") and demo.chats_used(user) >= demo.CHAT_LIMIT:
        raise HTTPException(status_code=429, detail=demo.CHAT_LIMIT_MESSAGE)
    existing = None
    if body.discussion_id:
        existing = discuss.get(body.discussion_id, user)
        if not existing or existing["save_id"] != save["_id"]:
            raise HTTPException(status_code=404, detail=NO_DISCUSSION)
    history = [{"role": m.get("role"), "text": m.get("text")} for m in (existing or {}).get("messages") or []]
    try:
        reply = discuss.answer(user, save, history, message)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=discuss.NO_ANSWER) from e
    return {"discussion": discuss.view(discuss.append(user, save, existing, message, reply))}


@router.get("/api/chats")
def all_chats(user: dict = Depends(current_user)) -> dict:
    """Every chat, Ask and reel ones together, newest first: the list on the Ask page."""
    return {"chats": discuss.list_all(user)}


@router.get("/api/discussions/{discussion_id}")
def get_discussion(discussion_id: str, user: dict = Depends(current_user)) -> dict:
    d = discuss.get(discussion_id, user)
    if not d:
        raise HTTPException(status_code=404, detail=NO_DISCUSSION)
    return {"discussion": discuss.view(d)}


@router.delete("/api/discussions/{discussion_id}")
def delete_discussion(discussion_id: str, user: dict = Depends(current_user)) -> dict:
    if not discuss.delete(discussion_id, user):
        raise HTTPException(status_code=404, detail=NO_DISCUSSION)
    return {"ok": True}
