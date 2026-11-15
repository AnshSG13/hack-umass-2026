"""Trip plans for travel reels: build one, move its dates, open a day (see realize/trip.py)."""
from __future__ import annotations

import hmac
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ... import db, demo, ratelimit, trip
from ...models import TripRequest
from ...timeutil import now_utc, tz_of
from ..deps import background, current_user

router = APIRouter()

RATE_LIMITED = "Slow down a little. Try again in a minute."
NOT_TRAVEL = "Trip plans are for places and events."
NO_TRIP = "This save has no trip plan yet."


def _own_save(save_id: str, user: dict) -> dict:
    _id = db.oid(save_id)
    save = db.saves().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None
    if not save:
        raise HTTPException(status_code=404, detail="That save isn't in your library.")
    return save


def _start(body: TripRequest, user: dict) -> date | None:
    """The requested first day, which can't be in the past."""
    if not body.start_date:
        return None
    try:
        d = date.fromisoformat(body.start_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="That date isn't one we can read.") from e
    if d < now_utc().astimezone(tz_of(user)).date():
        raise HTTPException(status_code=400, detail="Pick a date that hasn't passed.")
    return d


@router.get("/api/saves/{save_id}/trip")
def get_trip(save_id: str, user: dict = Depends(current_user)) -> dict:
    save = _own_save(save_id, user)
    return trip.view(trip.get_for_save(save["_id"], user["_id"]), save, user)


@router.post("/api/saves/{save_id}/trip")
def build_trip(save_id: str, body: TripRequest | None = None, user: dict = Depends(current_user)) -> dict:
    """Start building (or rebuilding) the trip plan. Poll GET until status is ready or failed."""
    save = _own_save(save_id, user)
    if not trip.can_build(save):
        raise HTTPException(status_code=409, detail=NOT_TRAVEL)
    existing = trip.get_for_save(save["_id"], user["_id"])
    if trip._building(existing):
        return trip.view(existing, save, user)
    if not ratelimit.allow("trip", user["_id"]):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    if user.get("is_demo") and not existing:
        if db.trips().count_documents({"user_id": user["_id"]}) >= demo.TRIP_LIMIT:
            raise HTTPException(status_code=429, detail=demo.TRIP_LIMIT_MESSAGE)
    # Rebuilds count too: a demo session has a budget of paid builds of every kind.
    if not ratelimit.demo_spend(user):
        raise HTTPException(status_code=429, detail=ratelimit.DEMO_BUILD_MESSAGE)
    doc = trip.start_build(save, user, _start(body or TripRequest(), user))
    background.submit(trip.build, save["_id"], user["_id"])
    return trip.view(doc, save, user)


@router.patch("/api/saves/{save_id}/trip")
def move_trip(save_id: str, body: TripRequest, user: dict = Depends(current_user)) -> dict:
    """Other dates for the same plan: new times and forecast, computed in code."""
    save = _own_save(save_id, user)
    doc = trip.get_for_save(save["_id"], user["_id"])
    if not doc or doc.get("status") != "ready":
        raise HTTPException(status_code=409, detail=NO_TRIP)
    start = _start(body, user)
    if not start:
        raise HTTPException(status_code=400, detail="Pick a date first.")
    if save.get("type") == "event":
        raise HTTPException(status_code=409, detail="This one has its own date.")
    return trip.view(trip.redate(doc, user, start), save, user)


@router.post("/api/saves/{save_id}/trip/days/{index}")
def build_trip_day(save_id: str, index: int, user: dict = Depends(current_user)) -> dict:
    """Open a day: build the detail under it. Poll GET until that day's detail_status settles."""
    save = _own_save(save_id, user)
    doc = trip.get_for_save(save["_id"], user["_id"])
    if not doc or doc.get("status") != "ready":
        raise HTTPException(status_code=409, detail=NO_TRIP)
    days = doc.get("days") or []
    if not 0 <= index < len(days):
        raise HTTPException(status_code=404, detail="That day isn't in this trip.")
    current = trip.view(doc, save, user)
    if current["trip"]["days"][index]["detail_status"] == "building":
        return current
    if not ratelimit.allow("trip", user["_id"]):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    if not ratelimit.demo_spend(user):
        raise HTTPException(status_code=429, detail=ratelimit.DEMO_BUILD_MESSAGE)
    trip.start_day(doc, index)
    background.submit(trip.build_day, save["_id"], user["_id"], index)
    return trip.view(trip.get_for_save(save["_id"], user["_id"]), save, user)


@router.get("/api/public/trips/{trip_id}/days/{index}/ics")
def trip_day_ics(trip_id: str, index: int, t: str | None = None) -> Response:
    """A day's stops as a calendar file. Opened in a new tab, so the trip's own token stands in for the key."""
    _id = db.oid(trip_id)
    doc = db.trips().find_one({"_id": _id}) if _id else None
    if not doc or not t or not hmac.compare_digest(str(doc.get("share_token") or "").encode(), str(t).encode()):
        raise HTTPException(status_code=404, detail="This link doesn't open a trip.")
    body = trip.day_ics(doc, index)
    if not body:
        raise HTTPException(status_code=404, detail="That day has nothing to add to a calendar.")
    return Response(content=body.encode("utf-8"), media_type="text/calendar",
                    headers={"Content-Disposition": 'inline; filename="trip-day.ics"'})
