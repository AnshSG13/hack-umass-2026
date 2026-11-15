"""The action for a save: what the person wants from the reel, and how the app gives it to them.

Reelize is an action app, not a reminder app. A recipe reel wants cooking, so the action opens
cook mode. A product reel wants a good one at a good price, so the action finds the best prices and similar products worth a look.
A travel reel wants an itinerary. A calendar entry is offered only when the reel itself is tied
to a time (an event with a date still ahead).

The planner model names the need and writes the call to action in its own words, and picks one
way to deliver it from DELIVERS: each is something the app can actually do. Code checks that the
pick fits the save (cook needs a recipe, a calendar entry needs a dated event) and falls back to
the type's default when it doesn't. Plans written before this existed get the default at read
time, so every save shows an action.
"""
from __future__ import annotations

from datetime import datetime

from .timeutil import as_utc, now_utc

# One way to deliver per action. Each maps to a screen that already exists.
DELIVERS = ["cook", "shop", "itinerary", "calendar", "workout", "learn", "keep"]

CTA_MAX = 40
PITCH_MAX = 90
NEED_MAX = 60

# Plain words for each delivery, used when the model gives none or its pick is replaced.
WORDS: dict[str, dict[str, str]] = {
    "cook": {"cta": "Let's cook this", "pitch": "Step by step, with a shopping list"},
    "shop": {"cta": "Shop this and similar picks", "pitch": "Best prices at real stores, plus similar products"},
    "itinerary": {"cta": "Plan a visit", "pitch": "A day plan with hours, prices and what's nearby"},
    "calendar": {"cta": "Save the date", "pitch": "One calendar entry at the event's own time"},
    "workout": {"cta": "Do this workout", "pitch": "The moves, sets and reps from the reel"},
    "learn": {"cta": "Try this today", "pitch": "The key points and one thing to try"},
    # Vibes are never a reminder or a calendar entry: the reel just comes back on Home now and
    # then, with a line like "Remember this puppy growing up".
    "keep": {"cta": "Remember this one", "pitch": ""},
}

# Which types each delivery can serve. A pick outside this falls back to the type's default.
FITS: dict[str, set[str]] = {
    "cook": {"recipe"},
    "shop": {"product"},
    "itinerary": {"place", "event"},
    "calendar": {"event"},
    "workout": {"workout"},
    "learn": {"tip", "workout", "recipe", "product", "other"},
    "keep": {"recipe", "event", "place", "workout", "product", "tip", "other"},
}

DEFAULT_DELIVER = {"recipe": "cook", "product": "shop", "place": "itinerary", "event": "itinerary",
                   "workout": "workout", "tip": "learn", "other": "keep"}
DEFAULT_NEED = {"recipe": "make this dish", "product": "get a good one at a good price",
                "place": "go there", "event": "go to this", "workout": "do this workout",
                "tip": "use this tip", "other": "nothing, it was fun"}


def dated(plan_options: list[dict] | None, now: datetime | None = None) -> bool:
    """True when code built a calendar option (an event with a readable date) still ahead."""
    now = as_utc(now or now_utc())
    return any(o.get("action") == "event" and as_utc(o["start_utc"]) > now for o in plan_options or [])


def fits(deliver: str, kind: str, *, is_dated: bool) -> bool:
    if deliver not in DELIVERS or kind not in FITS[deliver]:
        return False
    return deliver != "calendar" or is_dated


def default_for(kind: str, *, is_dated: bool = False) -> dict:
    kind = kind if kind in DEFAULT_DELIVER else "other"
    deliver = "calendar" if kind == "event" and is_dated else DEFAULT_DELIVER[kind]
    return {"deliver": deliver, "need": DEFAULT_NEED[kind], **WORDS[deliver],
            "schedule": deliver == "calendar", "source": "default"}


def _text(value, limit: int) -> str:
    text = " ".join(str(value or "").replace("—", ",").replace("–", "-").split()).rstrip("!").strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return text


def clean(raw: dict | None, kind: str, *, is_dated: bool) -> dict:
    """The model's action, checked. A delivery that doesn't fit is replaced by the default."""
    raw = raw if isinstance(raw, dict) else {}
    need = _text(raw.get("need"), NEED_MAX)
    deliver = str(raw.get("deliver") or "").strip().lower()
    if not fits(deliver, kind, is_dated=is_dated):
        base = default_for(kind, is_dated=is_dated)
        return {**base, "need": need or base["need"]}
    return {
        "deliver": deliver,
        "need": need or DEFAULT_NEED.get(kind, ""),
        "cta": _text(raw.get("cta"), CTA_MAX) or WORDS[deliver]["cta"],
        "pitch": "" if deliver == "keep" else (_text(raw.get("pitch"), PITCH_MAX) or WORDS[deliver]["pitch"]),
        # A time is offered only when the reel is tied to one, or the model says the thing
        # itself is best done at a set time (a long weekend cook, a class).
        "schedule": deliver == "calendar" or (bool(raw.get("schedule")) and kind in ("recipe", "workout", "place")),
        "source": "model",
    }


def view(plan: dict | None, save: dict) -> dict | None:
    """The action a ticket shows: the stored one, or the type's default for older plans."""
    kind = save.get("type")
    if kind not in DEFAULT_DELIVER:
        return None
    is_dated = kind == "event" and dated((plan or {}).get("options"))
    stored = (plan or {}).get("action")
    # A stored action stays only while it still fits (the person may have moved the save to
    # another type since).
    ok = isinstance(stored, dict) and fits(str(stored.get("deliver")), kind, is_dated=is_dated)
    a = stored if ok else default_for(kind, is_dated=is_dated)
    out = {k: a.get(k) for k in ("deliver", "need", "cta", "pitch", "schedule")}
    if out["deliver"] == "keep":
        out["pitch"] = ""   # vibes get one line, nothing under it
    return out
