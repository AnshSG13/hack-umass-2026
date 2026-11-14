"""Onboarding: the intro screens, their "More for you" chips, and the starter sub-categories."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ... import db, profile, ratelimit, subcats
from ...models import TASTE_LABELS
from ...timeutil import now_utc
from ..deps import current_user

router = APIRouter()

IDENTITIES = ["Woman", "Man", "Non-binary", profile.PREFER_NOT]
AGE_RANGES = ["Under 18", "18 to 24", "25 to 34", "35 to 44", "45 to 54", "55 or older", profile.PREFER_NOT]
ETHNICITIES = ["Asian", "Black or African", "Hispanic or Latino", "Middle Eastern or North African",
               "Native American or Alaska Native", "Pacific Islander", "White", "Another background",
               profile.PREFER_NOT]
HOBBY_IDEAS = ["Cooking", "Running", "Gym", "Yoga", "Hiking", "Photography", "Reading", "Gaming",
               "Drawing", "Music", "Dancing", "Travel", "Gardening", "Thrifting", "Baking", "Cycling"]
SKILL_IDEAS = ["Coding", "Design", "Writing", "Public speaking", "Languages", "Cooking", "Video editing",
               "Marketing", "Investing", "Instruments", "Sewing", "Woodworking", "Teaching", "Sales"]


class Profile(BaseModel):
    identity: str | None = Field(default=None, max_length=40)
    age_range: str | None = Field(default=None, max_length=40)
    ethnicity: list[str] = Field(default_factory=list, max_length=9)
    interests: list[str] = Field(default_factory=list, max_length=40)
    hobbies: list[str] = Field(default_factory=list, max_length=30)
    skills: list[str] = Field(default_factory=list, max_length=30)


class FinishRequest(BaseModel):
    profile: Profile


class SuggestRequest(BaseModel):
    picked: list[str] = Field(default_factory=list, max_length=40)
    age_range: str | None = None


def _tags(values: list[str], limit: int) -> list[str]:
    out: list[str] = []
    for v in values:
        name = subcats.snap(subcats.clean(v), out)
        if name and name not in out:
            out.append(name)
    return out[:limit]


def clean_profile(p: Profile) -> dict:
    return {
        "identity": p.identity if p.identity in IDENTITIES else None,
        "age_range": p.age_range if p.age_range in AGE_RANGES else None,
        "ethnicity": [e for e in ETHNICITIES if e in p.ethnicity],
        "interests": _tags(p.interests, 40),
        "hobbies": _tags(p.hobbies, 30),
        "skills": _tags(p.skills, 30),
    }


def starter_view(starters: dict[str, list[str]]) -> list[dict]:
    """[{type, label, subcategories}] in the app's type order."""
    return [{"type": t, "label": TASTE_LABELS[t], "subcategories": starters[t]}
            for t in profile.STARTER_TYPES if starters.get(t)]


@router.get("/api/onboarding/options")
def options() -> dict:
    return {"identities": IDENTITIES, "age_ranges": AGE_RANGES, "ethnicities": ETHNICITIES,
            "interests": profile.INTERESTS, "hobbies": HOBBY_IDEAS, "skills": SKILL_IDEAS}


@router.post("/api/onboarding/suggest")
def suggest(body: SuggestRequest, user: dict = Depends(current_user)) -> dict:
    if not ratelimit.allow("suggest", user["_id"]):
        return {"suggestions": []}
    age = body.age_range if body.age_range in AGE_RANGES else None
    return {"suggestions": profile.suggest_interests(body.picked, age)}


@router.post("/api/onboarding/finish")
def finish(body: FinishRequest, user: dict = Depends(current_user)) -> dict:
    """Store the profile and the starter sub-categories Gemini makes from it."""
    p = clean_profile(body.profile)
    p["starters"] = {} if user.get("is_demo") else profile.make_starters(p)
    db.users().update_one({"_id": user["_id"]}, {"$set": {"profile": p, "onboarded_at": now_utc()}})
    return {"profile": p, "starters": starter_view(p["starters"])}
