"""Deliverables: something finished to send, made from one reel (see realize/deliverables.py)."""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, HTTPException

from ... import db, deliverables, discuss, trip
from ...models import DeliverableRequest
from ..deps import current_user

router = APIRouter()

NOT_YOURS = "That save isn't in your library."
NO_DISCUSSION = "That discussion isn't here any more."


def _own_save(save_id: str, user: dict) -> dict:
    _id = db.oid(save_id)
    save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}, {"embedding": 0}) if _id else None
    if not save:
        raise HTTPException(status_code=404, detail=NOT_YOURS)
    return save


def _discussion(discussion_id: str | None, save: dict, user: dict) -> dict | None:
    if not discussion_id:
        return None
    d = discuss.get(discussion_id, user)
    if not d or d["save_id"] != save["_id"]:
        raise HTTPException(status_code=404, detail=NO_DISCUSSION)
    return d


@router.get("/api/saves/{save_id}/deliverables")
def list_options(save_id: str, discussion_id: str | None = None, user: dict = Depends(current_user)) -> dict:
    """What this reel can make to send right now, most useful first, and what was made before."""
    save = _own_save(save_id, user)
    plan = db.plans().find_one({"save_id": save["_id"], "user_id": user["_id"]})
    trip_doc = trip.get_for_save(save["_id"], user["_id"])
    opts = deliverables.options(save, plan, trip_doc, _discussion(discussion_id, save, user), user)
    made = db.deliverables().find({"save_id": save["_id"], "user_id": user["_id"]}).sort("updated_at", -1).limit(10)
    return {"options": opts, "made": [deliverables.view(d) for d in made]}


@router.post("/api/saves/{save_id}/deliverables")
def make(save_id: str, body: DeliverableRequest, user: dict = Depends(current_user)) -> dict:
    """Make one deliverable (or remake it: the link stays the same). Built in code, so it is instant."""
    save = _own_save(save_id, user)
    try:
        d = deliverables.build(save, user, body.kind, discussion=_discussion(body.discussion_id, save, user),
                               servings=body.servings)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"deliverable": deliverables.view(d)}


@router.get("/api/public/deliverables/{deliverable_id}")
def public(deliverable_id: str, t: str | None = None) -> dict:
    """The page someone opens from the message. The link's own token stands in for a key."""
    _id = db.oid(deliverable_id)
    d = db.deliverables().find_one({"_id": _id}) if _id else None
    if not d or not t or not hmac.compare_digest(str(d.get("share_token") or "").encode(), str(t).encode()):
        raise HTTPException(status_code=404, detail="This link doesn't open anything.")
    # user_id comes from the document the token unlocked, never from the request.
    save = db.saves().find_one({"_id": d["save_id"], "user_id": d["user_id"]},
                               {"title": 1, "creator": 1, "url": 1, "thumb_id": 1})
    return {"deliverable": deliverables.public_view(d, save)}
