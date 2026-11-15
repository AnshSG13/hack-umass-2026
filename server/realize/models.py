"""Pydantic models and the JSON schemas handed to Gemini."""
from __future__ import annotations

import copy
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

TYPES = ["recipe", "event", "place", "workout", "product", "tip", "other"]
SLOT_KINDS = ["recipe", "workout", "place"]
# What a type is called on Home's "Your tastes" and on a reel's category chip.
TASTE_LABELS = {"recipe": "Food", "event": "Events", "place": "Places", "workout": "Fitness",
                "product": "Products", "tip": "Learning", "other": "Just vibes"}
NOTE_MAX = 500
NAME_MAX = 40
PROCESSING_DONE = ["planned", "enriching", "ready", "failed"]

STEP_LABELS = {
    "fetch_metadata": "Reading the caption",
    "search_saves": "Checking your saves",
    "find_free_slot": "Checking your week",
    "propose_plan": "Drafting a plan",
    "download_video": "Grabbing the video",
    "analyze_video": "Watching the video",
    "grounding": "Checking facts against the video",
    "embed": "Filing it",
    "replan": "Updating the plan",
    "trip_research": "Searching the web",
    "trip_layout": "Laying out the days",
    "trip_weather": "Checking the forecast",
    "trip_day": "Planning the day",
    "nutrition_search": "Looking up nutrition",
    "web_search": "Searching the web",
    "get_save": "Opening a save",
    "list_plans": "Checking your plans",
    "propose_plans": "Drafting plans",
    "respond": "Writing the answer",
}

FAILURE_MESSAGES = {
    "private": "Saved, but this reel is private, so I can't read it.",
    "unavailable": "Saved, but Instagram says this post isn't available.",
    "not_video": "Saved, but this post has no video. Reelize reads reels.",
    "blocked": "Saved. Instagram is slowing me down. I'll keep trying.",
    "processing_error": "Saved. Couldn't read this reel yet. Tap Try again in Reelize.",
}
PERMANENT_REASONS = {"private", "unavailable", "not_video"}


def failure_message(reason: str | None, app_name: str = "Reelize") -> str:
    msg = FAILURE_MESSAGES.get(reason or "", FAILURE_MESSAGES["processing_error"])
    return msg.replace("Reelize", app_name)


def default_prefs() -> dict:
    return copy.deepcopy(
        {
            "cook_days": ["mon", "tue", "wed", "thu", "fri"],
            "cook_time": "18:30",
            "workout_days": ["mon", "wed", "fri"],
            "workout_time": "07:00",
            "weekend_time": "12:00",
            "daily_cap": 2,
            "quiet_start": "22:00",
            "quiet_end": "08:00",
            "types_on": {t: True for t in TYPES if t != "other"},
        }
    )


# ---------- request bodies ----------


class SaveRequest(BaseModel):
    input: str = ""
    source: Literal["shortcut", "web", "sample"] = "shortcut"
    wait: float | None = None


class ConfirmRequest(BaseModel):
    choice: str = ""
    source: Literal["shortcut", "web"] = "shortcut"
    start_local: str | None = None


class CreateUserRequest(BaseModel):
    timezone: str | None = None


class SignupRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    name: str | None = Field(default=None, max_length=NAME_MAX)
    timezone: str | None = None


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class PrefsPatch(BaseModel):
    cook_days: list[str] | None = None
    cook_time: str | None = None
    workout_days: list[str] | None = None
    workout_time: str | None = None
    weekend_time: str | None = None
    daily_cap: int | None = Field(default=None, ge=1, le=5)
    quiet_start: str | None = None
    quiet_end: str | None = None
    types_on: dict[str, bool] | None = None

    @field_validator("cook_days", "workout_days")
    @classmethod
    def _days(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        bad = [d for d in v if d not in order]
        if bad:
            raise ValueError("days must be mon..sun")
        return [d for d in order if d in v]

    @field_validator("cook_time", "workout_time", "weekend_time", "quiet_start", "quiet_end")
    @classmethod
    def _hhmm(cls, v: str | None) -> str | None:
        if v is None:
            return v
        h, m = v.split(":")
        if not (0 <= int(h) <= 23 and 0 <= int(m) <= 59):
            raise ValueError("time must be HH:mm")
        return f"{int(h):02d}:{int(m):02d}"


class MePatch(BaseModel):
    timezone: str | None = None
    prefs: PrefsPatch | None = None
    name: str | None = Field(default=None, max_length=NAME_MAX)


class SavePatch(BaseModel):
    """What a person can change on a save: where it's filed, and their own note.
    subcategory "" clears it. category files it under a custom category (type other), new
    or existing; "" takes it out of its category, back to Just vibes."""
    type: Literal["recipe", "event", "place", "workout", "product", "tip", "other"] | None = None
    category: str | None = Field(default=None, max_length=40)
    subcategory: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=NOTE_MAX)


class DeliverableRequest(BaseModel):
    """Make something to send from one reel."""
    kind: Literal["itinerary", "invite", "grocery_list", "recipe_card", "workout_card", "shortlist",
                  "places_list", "key_points", "chat_notes"]
    discussion_id: str | None = None
    servings: int | None = Field(default=None, ge=1, le=24)


class TripRequest(BaseModel):
    """Build a trip plan, or move it to other dates."""
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class PlanStatusRequest(BaseModel):
    status: Literal["done", "skipped", "accepted"]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []
    # A kept Ask chat to continue; its own messages are the history then.
    chat_id: str | None = None


class DiscussRequest(BaseModel):
    """One question about one reel. No discussion_id starts a new discussion."""
    message: str = Field(max_length=2000)
    discussion_id: str | None = None


class DemoSessionRequest(BaseModel):
    timezone: str | None = None


# ---------- Gemini schemas (plain JSON Schema: no unions, no free-form dicts) ----------

AISLES = [
    "Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Pantry",
    "International", "Spices", "Frozen", "Beverages", "Other",
]


def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict:
    out: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


def _arr(items: dict, **kw: Any) -> dict:
    return {"type": "array", "items": items, **kw}


_S = {"type": "string"}
_I = {"type": "integer"}
_N = {"type": "number"}
_B = {"type": "boolean"}

FIELDS_SCHEMA: dict = _obj(
    {
        "recipe": _obj(
            {
                "servings": _I,
                "total_time_min": _I,
                "ingredients": _arr(
                    _obj(
                        {"qty": _N, "unit": _S, "item": _S,
                         "aisle": {"type": "string", "enum": AISLES}},
                        ["item"],
                    )
                ),
                "steps": {**_arr(_S), "description": "Short imperative steps, in order"},
                "tips": _arr(_S),
            }
        ),
        "event": _obj(
            {
                "name": _S,
                "start_local": {"type": "string", "description": "YYYY-MM-DDTHH:mm, local time"},
                "end_local": {"type": "string", "description": "YYYY-MM-DDTHH:mm, local time"},
                "date_text": {"type": "string", "description": "The date as written, e.g. this Friday 8pm"},
                "venue": _S, "city": _S, "ticket_url": _S, "price_hint": _S,
            }
        ),
        "place": _obj(
            {
                "places": _arr(
                    _obj(
                        {"name": _S,
                         "kind": {"type": "string",
                                  "enum": ["food", "sight", "shop", "activity", "nightlife", "stay"]},
                         "city": _S, "why": _S, "tip": _S},
                        ["name"],
                    )
                )
            }
        ),
        "workout": _obj(
            {
                "goal": _S, "duration_min": _I, "equipment": _arr(_S),
                "exercises": _arr(
                    _obj(
                        {"name": _S, "sets": _I, "reps": _S, "duration_sec": _I,
                         "rest_sec": _I, "cues": _arr(_S)},
                        ["name"],
                    )
                ),
            }
        ),
        "product": _obj(
            {
                "items": _arr(
                    _obj(
                        {"name": _S, "brand": _S, "price_hint": _S, "why": _S,
                         "where_to_buy": _S, "url": _S},
                        ["name"],
                    )
                )
            }
        ),
        "tip": _obj({"topic": _S, "key_points": _arr(_S), "takeaway": _S}),
    }
)

_TYPE = {"type": "string", "enum": TYPES}

PROPOSE_PLAN_SCHEMA: dict = _obj(
    {
        "type": _TYPE,
        "title": {"type": "string", "description": "Max 60 chars, specific: 'Gochujang butter squash', not 'Recipe video'"},
        "summary": {"type": "string", "description": "Max 2 sentences"},
        "caption_sufficient": _B,
        "actionable": _B,
        "fields": {**FIELDS_SCHEMA, "description": (
            "Fill only the key that matches type. Keep it brief: the video is read in full later. "
            "Recipe: every ingredient, at most 6 steps of under 12 words each, at most 2 tips.")},
        "question": {"type": "string", "description": "Yes/no question, max 50 chars, action first"},
        "why": {"type": "string", "description": "One plain sentence, max 90 chars, the real reason"},
        "confidence": {"type": "string", "enum": ["sure", "best_guess"]},
        "option_starts_local": _arr(
            {"type": "string", "description": "YYYY-MM-DDTHH:mm"}, maxItems=3
        ),
        "similar_save_id": {"type": "string", "description": "save_id of a similar save, if any"},
        "highlight": {"type": "string", "description": "The one thing the reel is about, max 60 chars"},
        "need": {"type": "string", "description": "What the person wants from it, from their side, max 60 chars"},
        "action": {
            "type": "object",
            "description": "How the app gives them that need",
            "properties": {
                "deliver": {"type": "string", "enum": ["cook", "shop", "itinerary", "calendar", "workout", "learn", "keep"]},
                "cta": {"type": "string", "description": "Call to action, max 40 chars, verb first, specific to this reel"},
                "pitch": {"type": "string", "description": "What is ready for them, max 90 chars, facts from the reel only"},
                "schedule": {"type": "boolean", "description": "True only when the action needs a set time"},
            },
            "required": ["deliver", "cta", "pitch", "schedule"],
        },
        "subcategory": {"type": "string", "description": (
            "1 to 3 words grouping this save inside its type, e.g. Dessert, Thai, Strength, Skincare. "
            "Reuse an existing one for the same type when it fits. Never the title.")},
        "category": {"type": "string", "description": (
            "Only when type is other: 1 or 2 words naming the kind of thing this is, broad enough "
            "for more reels like it (Pets, Fashion, Comedy, Music). Reuse an existing category when "
            "it fits. Never Food, Events, Places, Fitness, Products or Learning.")},
    },
    ["type", "title", "summary", "caption_sufficient", "actionable", "need", "action", "question", "why",
     "confidence"],
)

ENTITY_KINDS = ["ingredient", "product", "brand", "place", "person", "exercise", "topic", "event"]

ENRICH_SCHEMA: dict = _obj(
    {
        "has_speech": _B,
        "music_only": _B,
        "language": {"type": "string", "description": "Original language code, e.g. en"},
        "transcript": _arr(_obj({"start_sec": _N, "text": _S}, ["start_sec", "text"])),
        "on_screen_text": _arr(_S),
        "visual_summary": _S,
        "type": _TYPE,
        "title": _S,
        "summary": _S,
        "fields": FIELDS_SCHEMA,
        "entities": _arr(
            _obj({"name": _S, "kind": {"type": "string", "enum": ENTITY_KINDS}}, ["name", "kind"])
        ),
        "tags": _arr(_S, minItems=3, maxItems=8),
        "subcategory": {"type": "string", "description": (
            "1 to 3 words grouping this save inside its type, e.g. Dessert, Thai, Strength, Skincare. "
            "Reuse an existing one for the same type when it fits. Never the title.")},
        "category": {"type": "string", "description": (
            "Only when type is other: 1 or 2 words naming the kind of thing this is, broad enough "
            "for more reels like it (Pets, Fashion, Comedy, Music). Reuse an existing category when "
            "it fits. Never Food, Events, Places, Fitness, Products or Learning.")},
    },
    ["has_speech", "music_only", "language", "transcript", "on_screen_text", "visual_summary",
     "type", "title", "summary", "fields", "entities", "tags"],
)


def clean_fields(kind: str | None, fields: Any) -> dict:
    """Keep exactly the one key matching type; drop empties."""
    if not kind or kind == "other" or not isinstance(fields, dict):
        return {}
    val = fields.get(kind)
    return {kind: val} if isinstance(val, dict) and val else {}
