"""Ready for you: plans built from several saves (see realize/bundles.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ... import bundles
from ..deps import background, current_user

router = APIRouter()

NO_BUNDLE = "That plan isn't here any more."


def _own(bundle_id: str, user: dict) -> dict:
    b = bundles.get(bundle_id, user)
    if not b:
        raise HTTPException(status_code=404, detail=NO_BUNDLE)
    return b


@router.get("/api/bundles")
def list_bundles(user: dict = Depends(current_user)) -> dict:
    """What is ready and what was started. Grouping is code and happens here; the words
    for a new bundle are asked of the model after the response, so this never waits on it."""
    for bundle_id in bundles.ensure(user):
        background.submit(bundles.polish, bundle_id, user["_id"])
    return bundles.listing(user)


@router.get("/api/bundles/{bundle_id}")
def get_bundle(bundle_id: str, user: dict = Depends(current_user)) -> dict:
    return {"bundle": bundles.view(_own(bundle_id, user), user, full=True)}


@router.post("/api/bundles/{bundle_id}/start")
def start_bundle(bundle_id: str, user: dict = Depends(current_user)) -> dict:
    b = _own(bundle_id, user)
    if b["status"] != "ready":
        return {"bundle": bundles.view(b, user, full=True), "message": "Already started."}
    b, message = bundles.start(b, user)
    return {"bundle": bundles.view(b, user, full=True), "message": message}


@router.post("/api/bundles/{bundle_id}/dismiss")
def dismiss_bundle(bundle_id: str, user: dict = Depends(current_user)) -> dict:
    bundles.dismiss(_own(bundle_id, user), user)
    return {"ok": True}
