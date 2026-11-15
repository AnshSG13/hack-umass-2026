"""A waiting event whose dates have passed is "missed" (Actions lists it apart).
The rule is build_options' own: no options, not actionable, and its passed reason."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from realize import actions
from realize.models import default_prefs

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 11, 14, 3, 5, tzinfo=NY)


def _user():
    return {"_id": "u_test", "timezone": "America/New_York", "prefs": default_prefs()}


def _plan(fields: dict, **over) -> dict:
    b = actions.build_options("event", "Show", fields, _user(), now=NOW, accepted=[])
    plan = {"status": "proposed", "kind": "event", "actionable": b["actionable"] is not False,
            "why": b["why"] or "", "options": b["options"]}
    plan.update(over)
    return plan


def test_passed_event_is_missed():
    assert actions.is_missed(_plan({"event": {"name": "Old show", "start_local": "2026-11-10T19:00"}}))
    assert actions.is_missed(_plan({"event": {"name": "Old run", "date_text": "November 10th to 12th"}}))


def test_future_event_is_not_missed():
    assert not actions.is_missed(_plan({"event": {"name": "Carrie", "start_local": "2026-11-14T19:00"}}))


def test_missed_only_while_waiting():
    past = {"event": {"name": "Old show", "start_local": "2026-11-10T19:00"}}
    assert not actions.is_missed(_plan(past, status="declined"))
    assert not actions.is_missed(_plan(past, kind="place"))
