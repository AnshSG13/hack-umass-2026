"""Deliverables: which ones a reel can make, and what each says. No network, no database."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from realize import deliverables as dv
from realize.models import default_prefs

NY = ZoneInfo("America/New_York")
USER = {"_id": "u_test", "timezone": "America/New_York", "prefs": default_prefs()}

RECIPE = {"type": "recipe", "status": "ready", "title": "Chickpea Curry", "url": "https://www.instagram.com/reel/X/",
          "fields": {"recipe": {"servings": 4, "total_time_min": 30, "ingredients": [
              {"qty": 2, "unit": "cans", "item": "chickpeas", "aisle": "Pantry"},
              {"qty": 1, "unit": "", "item": "onion", "aisle": "Produce"},
              {"qty": 0.5, "unit": "cup", "item": "coconut milk", "aisle": "International"},
              {"item": "salt", "aisle": "Nowhere"}],
              "steps": ["Toast the spices.", "Simmer."], "tips": ["Low and slow."]}}}
PLACE = {"type": "place", "status": "ready", "title": "Winter Pool House", "fields": {"place": {"places": [
    {"name": "The Rockaway Hotel", "kind": "stay", "city": "New York", "why": "Heated pool"}]}}}
EVENT = {"type": "event", "status": "ready", "title": "Carrie: The Musical", "fields": {"event": {
    "name": "Carrie: The Musical", "venue": "Bowker Auditorium", "city": "Amherst",
    "date_text": "November 13th and 14th", "price_hint": "$19", "ticket_url": "https://tickets.example/carrie"}}}


def kinds(save, plan=None, trip_doc=None, discussion=None):
    return [(o["kind"], o["needs"]) for o in dv.options(save, plan, trip_doc, discussion, USER)]


def test_options_follow_the_reels_type_and_data():
    assert kinds(RECIPE) == [("grocery_list", None), ("recipe_card", None)]
    assert kinds(PLACE) == [("itinerary", "trip"), ("places_list", None)]
    assert kinds(EVENT) == [("itinerary", "trip"), ("invite", None)]
    ready = {"status": "ready", "days": [{"stops": []}]}
    assert kinds(PLACE, trip_doc=ready)[0] == ("itinerary", None)
    assert kinds({"type": "other", "status": "ready", "title": "Puppy", "fields": {}}) == []
    assert kinds({"type": "recipe", "status": "ready", "title": "x", "fields": {}}) == []
    workout = {"type": "workout", "status": "ready", "fields": {"workout": {"exercises": [{"name": "Squat"}]}}}
    assert kinds(workout) == [("workout_card", None)]


def test_an_accepted_plan_with_a_time_can_be_sent_as_an_invite():
    plan = {"status": "accepted", "scheduled_for": datetime(2026, 11, 18, 18, 30, tzinfo=NY),
            "chosen": {"action": "event"}, "_id": "p1", "share_token": "tok"}
    assert kinds(RECIPE, plan=plan) == [("grocery_list", None), ("recipe_card", None), ("invite", None)]
    reminder = {**plan, "chosen": {"action": "reminder"}}
    assert ("invite", None) not in kinds(RECIPE, plan=reminder)
    assert ("invite", None) not in kinds(RECIPE, plan={**plan, "status": "proposed"})


def test_chat_notes_need_an_answered_question():
    asked = {"messages": [{"role": "user", "text": "How long?"}]}
    assert ("chat_notes", None) not in kinds(RECIPE, discussion=asked)
    answered = {"messages": asked["messages"] + [{"role": "assistant", "text": "About 30 minutes."}]}
    assert ("chat_notes", None) in kinds(RECIPE, discussion=answered)
    body = dv._chat_notes(RECIPE, answered)
    assert body["blocks"][0]["items"] == [{"text": "How long?", "sub": "About 30 minutes."}]


def test_grocery_list_is_by_aisle_and_scales():
    body = dv._grocery_list(RECIPE, None)
    assert [b["heading"] for b in body["blocks"]] == ["Produce", "Pantry", "International", "Other"]
    assert body["blocks"][1]["items"] == [{"text": "2 cans chickpeas"}] and body["lede"] == ["Serves 4"]
    assert body["blocks"][3]["items"] == [{"text": "salt"}]              # an unknown aisle goes under Other
    double = dv._grocery_list(RECIPE, 8)
    assert double["lede"] == ["Scaled to serve 8"]
    assert double["blocks"][1]["items"] == [{"text": "4 cans chickpeas"}]
    assert double["blocks"][2]["items"] == [{"text": "1 cup coconut milk"}]
    assert double["blocks"][3]["items"] == [{"text": "salt"}]            # no amount, nothing to scale


def test_recipe_card_has_ingredients_steps_and_tips():
    body = dv._recipe_card(RECIPE, None)
    assert [b["heading"] for b in body["blocks"]] == ["Ingredients", "Steps", "Tips"]
    assert body["blocks"][1]["numbered"] is True and body["lede"] == ["Serves 4 · 30 min"]


def test_invite_for_an_event_uses_what_the_reel_says():
    body = dv._invite(EVENT, None, USER)
    assert body["title"] == "Want to come to Carrie: The Musical?"
    items = body["blocks"][0]["items"]
    assert {"text": "When", "sub": "November 13th and 14th"} in items
    assert {"text": "Where", "sub": "Bowker Auditorium, Amherst"} in items
    assert {"text": "Get tickets", "url": "https://tickets.example/carrie", "url_label": "Tickets"} in items
    assert not any(i["text"] == "Add it to your calendar" for i in items)   # no accepted plan, no calendar link


def test_invite_for_an_accepted_plan_has_its_time_and_calendar_link():
    plan = {"status": "accepted", "scheduled_for": datetime(2026, 11, 18, 18, 30, tzinfo=NY),
            "chosen": {"action": "event"}, "_id": "p1", "share_token": "tok"}
    body = dv._invite(RECIPE, plan, USER)
    assert body["title"] == "I'm cooking Chickpea Curry. Join me?"
    items = body["blocks"][0]["items"]
    assert items[0] == {"text": "When", "sub": "Wednesday, Nov 18 at 6:30 pm"}
    assert items[-1]["url"].endswith("/p/p1?t=tok")


def test_other_cards():
    w = {"type": "workout", "title": "Sculpt", "fields": {"workout": {"goal": "Full body", "duration_min": 20,
         "equipment": ["dumbbells"], "exercises": [
             {"name": "Squat", "sets": 3, "reps": "12", "rest_sec": 30, "cues": ["Chest up"]}, {"sets": 2}]}}}
    body = dv._workout_card(w)
    assert body["lede"] == ["Full body · 20 min · Needs: dumbbells"]
    assert body["blocks"][0]["items"] == [{"text": "Squat", "sub": "3 x 12, rest 30 s · Chest up"}]
    p = {"type": "product", "title": "Best Curling Irons", "fields": {"product": {"items": [
        {"name": "Curl Secret", "brand": "Conair", "price_hint": "$60", "why": "Winds itself",
         "url": "javascript:alert(1)"}]}}}
    row = dv._shortlist(p)["blocks"][0]["items"][0]
    assert row == {"text": "Conair Curl Secret", "sub": "$60 · Winds itself"}     # a non-http link is dropped
    places = dv._places_list(PLACE)["blocks"][0]["items"][0]
    assert places["text"] == "The Rockaway Hotel" and places["url_label"] == "Map"
    assert places["url"].startswith("https://www.google.com/maps/search/")
    tip = {"type": "tip", "title": "T", "fields": {"tip": {"topic": "Focus", "key_points": ["Move first."],
                                                             "takeaway": "Do real work daily."}}}
    k = dv._key_points(tip)
    assert k["title"] == "Focus" and k["closing"] == ["Do real work daily."]


def test_to_text_reads_like_a_message():
    text = dv.to_text(dv._recipe_card(RECIPE, None), RECIPE["url"], "https://app.example/d/1?t=x")
    assert text.splitlines()[0] == "Chickpea Curry" and "Serves 4 · 30 min" in text
    assert "\nIngredients\n- 2 cans chickpeas\n" in text
    assert "\nSteps\n1. Toast the spices.\n2. Simmer.\n" in text
    assert text.endswith("Full version: https://app.example/d/1?t=x\nThe reel: https://www.instagram.com/reel/X/")
    assert "—" not in text
    place = dv.to_text(dv._places_list(PLACE), "", "https://app.example/d/2?t=y")
    assert "- The Rockaway Hotel (New York · Heated pool)" in place          # map links stay on the page
    assert "google.com/maps" not in place and "The reel:" not in place
    invite = dv.to_text(dv._invite(EVENT, None, USER), "", "https://app.example/d/3?t=z")
    assert "- When: November 13th and 14th" in invite
    assert "- Get tickets https://tickets.example/carrie" in invite
    long = {"title": "T", "blocks": [{"heading": "", "items": [{"text": "x" * 200}] * 40}]}
    assert len(dv.to_text(long, "", "u").split("\n\nFull version")[0]) <= dv.TEXT_MAX
