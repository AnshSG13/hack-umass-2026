"""Unit tests for the pure functions: URLs, slots, labels, device actions, ICS, RRF.
None of these touch Atlas, Gemini or Instagram."""
from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from realize import actions, ratelimit, search, slots, thumbs, urls, ytdlp
from realize.models import default_prefs
from realize.timeutil import big_time, fmt_text, fmt_time, long_day, short_day

NY = ZoneInfo("America/New_York")


def user(**prefs):
    p = default_prefs()
    p.update(prefs)
    return {"_id": "u_test", "timezone": "America/New_York", "prefs": p}


def ny(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=NY)


# Saturday Nov 14 2026, 3:05 am, the moment in the spec's example prompt.
NOW = ny(2026, 11, 14, 3, 5)


# ---------- urls ----------

@pytest.mark.parametrize("text,code,url", [
    ("https://www.instagram.com/reel/ABC123/", "ABC123", "https://www.instagram.com/reel/ABC123/"),
    ("https://instagram.com/reels/Ab-_9/?igsh=xyz", "Ab-_9", "https://www.instagram.com/reel/Ab-_9/"),
    ("Check out this reel https://m.instagram.com/tv/XYZ?utm=1 wow", "XYZ", "https://www.instagram.com/reel/XYZ/"),
    ("https://www.instagram.com/chef.john_1/reel/DfYi19kRNT0/", "DfYi19kRNT0",
     "https://www.instagram.com/reel/DfYi19kRNT0/"),
    ("http://www.instagram.com/p/CODE1/", "CODE1", "https://www.instagram.com/p/CODE1/"),
])
def test_extract(text, code, url):
    link = urls.extract(text)
    assert link and link.shortcode == code and link.url == url


@pytest.mark.parametrize("text", ["", None, "hello", "https://www.tiktok.com/@a/video/1",
                                   "https://www.instagram.com/chefjohn/", "https://evil.com/instagram.com/reel/A/"])
def test_extract_rejects(text):
    assert urls.extract(text) is None


# ---------- time labels ----------

def test_labels():
    assert fmt_time(time(18, 30)) == "6:30 pm"
    assert fmt_time(time(12, 0)) == "12 pm"
    assert fmt_time(time(7, 0)) == "7 am"
    assert fmt_time(time(0, 5)) == "12:05 am"
    assert short_day(ny(2026, 11, 14, 19), NOW) == "Today"
    assert short_day(ny(2026, 11, 15, 12), NOW) == "Tomorrow"
    assert short_day(ny(2026, 11, 19, 18, 30), NOW) == "Thu"
    assert short_day(ny(2026, 11, 20, 18, 30), NOW) == "Fri"       # 6 days out
    assert short_day(ny(2026, 11, 21, 18, 30), NOW) == "Nov 21"    # 7 days out
    assert long_day(ny(2026, 11, 14, 19), NOW) == "today"
    assert long_day(ny(2026, 11, 19, 18, 30), NOW) == "Thursday"
    assert long_day(ny(2026, 11, 26, 18, 30), NOW) == "Nov 26"
    assert big_time(ny(2026, 11, 19, 18, 30), NOW) == "Thu 6:30 pm"
    assert big_time(ny(2026, 11, 26, 18, 30), NOW) == "Nov 26, 6:30 pm"
    assert fmt_text(ny(2026, 11, 19, 18, 30)) == "Nov 19, 2026 at 6:30 PM"
    assert fmt_text(ny(2026, 11, 19, 12, 0)) == "Nov 19, 2026 at 12:00 PM"


# ---------- quiet hours ----------

def test_quiet_across_midnight():
    assert slots.in_quiet(time(23, 0), "22:00", "08:00")
    assert slots.in_quiet(time(2, 0), "22:00", "08:00")
    assert slots.in_quiet(time(22, 0), "22:00", "08:00")
    assert not slots.in_quiet(time(8, 0), "22:00", "08:00")
    assert not slots.in_quiet(time(18, 30), "22:00", "08:00")


def test_quiet_same_day_window():
    assert slots.in_quiet(time(13, 0), "12:00", "14:00")
    assert not slots.in_quiet(time(14, 0), "12:00", "14:00")
    assert not slots.in_quiet(time(9, 0), "00:00", "00:00")


# ---------- slots ----------

def test_recipe_slots_are_future_weeknights():
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=[])
    assert [s["start_local"] for s in found] == [
        "2026-11-16T18:30", "2026-11-17T18:30", "2026-11-18T18:30", "2026-11-19T18:30", "2026-11-20T18:30"]
    assert found[0]["big_time"] == "Mon 6:30 pm" and found[0]["long_day"] == "Monday"
    assert len(found) <= 5


def test_slot_needs_an_hour_of_notice():
    now = ny(2026, 11, 16, 18, 0)  # Monday, 30 min before cook time
    found = slots.find_free_slot(user(), "recipe", now=now, accepted=[])
    assert found[0]["start_local"] == "2026-11-17T18:30"


def test_slot_skips_overlap_and_reserved():
    busy = [{"start_utc": ny(2026, 11, 16, 18, 0).astimezone(UTC), "end_utc": ny(2026, 11, 16, 19, 0).astimezone(UTC)}]
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=busy)
    assert found[0]["start_local"] == "2026-11-17T18:30"
    res = [{"start_utc": ny(2026, 11, 17, 18, 30).astimezone(UTC), "end_utc": ny(2026, 11, 17, 19, 30).astimezone(UTC)}]
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=busy, reserved=res)
    assert found[0]["start_local"] == "2026-11-18T18:30"


def test_daily_cap():
    # Two accepted plans on Monday that don't overlap 6:30 pm still fill the day at cap 2.
    day = [
        {"start_utc": ny(2026, 11, 16, 7, 0).astimezone(UTC), "end_utc": ny(2026, 11, 16, 7, 45).astimezone(UTC)},
        {"start_utc": ny(2026, 11, 16, 12, 0).astimezone(UTC), "end_utc": ny(2026, 11, 16, 13, 0).astimezone(UTC)},
    ]
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=day)
    assert found[0]["start_local"] == "2026-11-17T18:30"
    found = slots.find_free_slot(user(daily_cap=3), "recipe", now=NOW, accepted=day)
    assert found[0]["start_local"] == "2026-11-16T18:30"


def test_quiet_hours_block_a_slot_that_runs_into_them():
    # Cooking at 9:30 pm for 60 min ends at 10:30 pm, inside quiet hours that cross midnight.
    u = user(cook_time="21:30")
    assert slots.find_free_slot(u, "recipe", now=NOW, accepted=[]) == []
    assert len(slots.find_free_slot(u, "recipe", duration_min=30, now=NOW, accepted=[])) == 5


def test_preferred_time_inside_quiet_window_is_a_deliberate_choice():
    # Default workouts are 7 am with quiet until 8 am; the user set both, so the slot stands.
    found = slots.find_free_slot(user(), "workout", now=NOW, accepted=[])
    assert found[0]["start_local"] == "2026-11-16T07:00"
    assert found[0]["duration_min"] == 45


def test_place_slots_are_weekends():
    found = slots.find_free_slot(user(), "place", now=NOW, accepted=[])
    assert found[0]["start_local"] == "2026-11-14T12:00"
    assert found[1]["start_local"] == "2026-11-15T12:00"
    assert found[0]["big_time"] == "Today 12 pm"


def test_not_before_and_not_after():
    found = slots.find_free_slot(user(), "recipe", not_before="2026-11-18T00:00",
                                 not_after="2026-11-19T23:00", now=NOW, accepted=[])
    assert [s["start_local"] for s in found] == ["2026-11-18T18:30", "2026-11-19T18:30"]


# ---------- reminder times ----------

def test_reminder_times():
    u = user()
    assert slots.reminder_due("product", u, now=NOW, accepted=[]).astimezone(NY) == ny(2026, 11, 17, 18)
    assert slots.reminder_due("week", u, now=NOW, accepted=[]).astimezone(NY) == ny(2026, 11, 21, 9)
    # NOW is a Saturday: "next Saturday" is a week out, never today.
    assert slots.reminder_due("place", u, now=NOW, accepted=[]).astimezone(NY) == ny(2026, 11, 21, 10)
    assert slots.reminder_due("event_no_date", u, now=NOW, accepted=[]).astimezone(NY) == ny(2026, 11, 16, 18)


def test_reminder_moves_out_of_quiet_hours_and_off_full_days():
    u = user(quiet_start="17:00", quiet_end="20:00")
    assert slots.reminder_due("product", u, now=NOW, accepted=[]).astimezone(NY) == ny(2026, 11, 17, 20)
    full = [{"start_utc": ny(2026, 11, 17, 9).astimezone(UTC), "end_utc": ny(2026, 11, 17, 10).astimezone(UTC)}] * 2
    assert slots.reminder_due("product", user(), now=NOW, accepted=full).astimezone(NY) == ny(2026, 11, 18, 18)


def test_ticket_reminder_only_a_day_before():
    u = user()
    far = ny(2026, 11, 20, 20).astimezone(UTC)
    near = ny(2026, 11, 15, 20).astimezone(UTC)
    assert slots.reminder_due("event_ticket", u, now=NOW, event_start=far).astimezone(NY) == ny(2026, 11, 15, 18)
    assert slots.reminder_due("event_ticket", u, now=NOW, event_start=near) is None


# ---------- options and labels ----------

RECIPE = {"recipe": {"total_time_min": 40, "ingredients": [
    {"qty": 2, "unit": "tbsp", "item": "gochujang"}, {"qty": 1, "unit": "", "item": "butternut squash"},
    {"qty": 0.5, "unit": "cup", "item": "butter"}], "steps": ["Roast the squash.", "Toss with butter."]}}


def recipe_options():
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=[])
    return actions.build_options("recipe", "Gochujang butter squash", RECIPE, user(), slots=found,
                                 now=NOW, accepted=[])


def test_recipe_options():
    built = recipe_options()
    o1, o2 = built["options"]
    assert o1["label"] == "Cook Mon 6:30 pm + 3 groceries"
    assert o1["web_label"] == "Add to Monday" and o1["big_time"] == "Mon 6:30 pm"
    assert o1["secondary"] == "+3 groceries" and o1["action"] == "event" and o1["duration_min"] == 40
    assert o2["label"] == "Cook Tue 6:30 pm + 3 groceries" and o2["id"] == "opt_2"
    plan = {"options": built["options"], "actionable": True}
    assert actions.menu_for(plan) == [o1["label"], o2["label"], "Not now", "Just vibes"]


def test_meme_menu():
    built = actions.build_options("other", "Potato to polar bear", {}, user(), now=NOW, accepted=[])
    plan = {"options": built["options"], "actionable": False}
    assert actions.menu_for(plan) == ["Remind me in a week", "Just save"]
    assert built["options"][0]["action"] == "reminder"


def test_workout_place_product_options():
    w = actions.build_options("workout", "Sculpt", {"workout": {"duration_min": 20}}, user(),
                              slots=slots.find_free_slot(user(), "workout", now=NOW, accepted=[]),
                              now=NOW, accepted=[])["options"]
    assert w[0]["label"] == "Train Mon 7 am" and w[0]["secondary"] == "20 min"
    p = actions.build_options("place", "Somssi", {"place": {"places": [{"name": "Somssi", "city": "New York"}]}},
                              user(), slots=slots.find_free_slot(user(), "place", now=NOW, accepted=[]),
                              now=NOW, accepted=[])["options"]
    assert p[0]["label"] == "Visit Today 12 pm" and p[0]["action"] == "event" and p[0]["secondary"] == "Somssi"
    assert p[1]["label"] == "Remind me Nov 21" and p[1]["action"] == "reminder"
    pr = actions.build_options("product", "Curling iron", {}, user(), now=NOW, accepted=[])["options"]
    assert pr[0]["label"] == "Remind me Tue" and pr[0]["web_label"] == "Remind me Tuesday"


def test_event_options():
    future = {"event": {"name": "Carrie: The Musical", "start_local": "2026-11-14T19:00", "venue": "Bowker Auditorium"}}
    b = actions.build_options("event", "Carrie", future, user(), now=NOW, accepted=[])
    assert b["options"][0]["label"] == "Add Today 7 pm" and b["options"][0]["web_label"] == "Add to calendar"
    assert b["options"][0]["duration_min"] == 120 and b["actionable"] is None
    past = {"event": {"name": "Old show", "start_local": "2026-11-10T19:00"}}
    b = actions.build_options("event", "Old show", past, user(), now=NOW, accepted=[])
    assert b["options"] == [] and b["actionable"] is False and b["why"] == "This was on Nov 10. It's passed."
    undated = actions.build_options("event", "Some show", {"event": {"name": "Some show"}}, user(), now=NOW, accepted=[])
    assert undated["options"][0]["label"] == "Remind me to check dates"


def test_labels_are_short_and_unique():
    found = slots.find_free_slot(user(), "recipe", now=NOW, accepted=[])
    same = [found[0], found[0]]
    opts = actions.build_options("recipe", "T", RECIPE, user(), slots=same, now=NOW, accepted=[])["options"]
    labels = [o["label"] for o in opts]
    assert len(set(labels)) == 2 and all(len(x) <= 38 for x in labels)


def test_match_choice():
    plan = {"options": recipe_options()["options"], "options_prev": [
        {"id": "opt_1", "label": "Cook Sun 6:30 pm", "action": "event", "start_utc": NOW, "duration_min": 60}],
        "actionable": True}
    assert actions.match_choice(plan, "opt_2")[1]["label"].startswith("Cook Tue")
    assert actions.match_choice(plan, "  cook mon 6:30 PM + 3 groceries ")[1]["id"] == "opt_1"
    assert actions.match_choice(plan, "Cook Sun 6:30 pm")[0] == "option"
    assert actions.match_choice(plan, "Not now")[0] == "later"
    assert actions.match_choice(plan, "Just vibes")[0] == "none"
    assert actions.match_choice(plan, "Just save")[0] == "none"
    assert actions.match_choice(plan, "nonsense")[0] == "nomatch"


def test_custom_option_must_be_future():
    with pytest.raises(ValueError):
        actions.custom_option("recipe", "2026-11-13T18:00", "T", RECIPE, user(), now=NOW)
    o = actions.custom_option("recipe", "2026-11-15T17:00", "T", RECIPE, user(), now=NOW)
    assert o["id"] == "opt_custom" and o["web_label"] == "Add to tomorrow" and o["action"] == "event"
    r = actions.custom_option("tip", "2026-11-15T17:00", "T", {}, user(), now=NOW)
    assert r["action"] == "reminder"


# ---------- device actions ----------

def plan_doc(kind):
    return {"_id": ObjectId("64b000000000000000000001"), "kind": kind, "share_token": "tok_tok_tok_tok_tok_22"}


def test_recipe_device_actions():
    opt = recipe_options()["options"][0]
    save = {"title": "Gochujang butter squash", "fields": RECIPE}
    da = actions.build_device_actions(plan_doc("recipe"), save, opt, user(), now=NOW)
    ev = da["event"]
    assert ev["title"] == "Cook: Gochujang butter squash"
    assert ev["start_utc"].astimezone(NY) == ny(2026, 11, 16, 18, 30)
    assert ev["end_utc"].astimezone(NY) == ny(2026, 11, 16, 19, 10)   # 40 min, within 30..120
    assert "• 2 tbsp gochujang" in ev["notes"] and "1. Roast the squash." in ev["notes"]
    assert ev["notes"].rstrip().endswith("/p/64b000000000000000000001?t=tok_tok_tok_tok_tok_22")
    groceries, followup = da["reminders"]
    assert groceries["title"] == "Groceries for Gochujang butter squash"
    assert groceries["due_utc"].astimezone(NY) == ny(2026, 11, 16, 12, 0)   # slot is after 3 pm: noon same day
    assert groceries["notes"].splitlines() == ["• 2 tbsp gochujang", "• 1 butternut squash", "• 0.5 cup butter"]
    assert followup["title"] == "Did you make Gochujang butter squash?"
    assert followup["due_utc"].astimezone(NY) == ny(2026, 11, 16, 21, 10)   # ends_at + 2 h
    assert da["followup_at"] == followup["due_utc"]
    assert len(da["reminders"]) <= 2


def test_morning_slot_groceries_go_the_evening_before():
    opt = actions.custom_option("recipe", "2026-11-16T11:00", "Brunch", RECIPE, user(), now=NOW)
    da = actions.build_device_actions(plan_doc("recipe"), {"title": "Brunch", "fields": RECIPE}, opt, user(), now=NOW)
    assert da["reminders"][0]["due_utc"].astimezone(NY) == ny(2026, 11, 15, 18, 0)


def test_followup_moves_out_of_quiet_hours():
    opt = actions.custom_option("recipe", "2026-11-16T19:30", "Late", {"recipe": {"total_time_min": 60}}, user(), now=NOW)
    da = actions.build_device_actions(plan_doc("recipe"), {"title": "Late", "fields": {}}, opt, user(), now=NOW)
    # ends 8:30 pm, +2 h is 10:30 pm, inside quiet hours: moved to 8 am the next day.
    assert da["followup_at"].astimezone(NY) == ny(2026, 11, 17, 8, 0)


def test_event_and_reminder_device_actions():
    fields = {"event": {"name": "Carrie: The Musical", "start_local": "2026-11-20T19:00", "venue": "Bowker Auditorium",
                        "city": "Amherst", "ticket_url": "https://example.org/t", "price_hint": "$10"}}
    opt = actions.build_options("event", "Carrie", fields, user(), now=NOW, accepted=[])["options"][0]
    da = actions.build_device_actions(plan_doc("event"), {"title": "Carrie", "fields": fields}, opt, user(), now=NOW)
    assert da["event"]["title"] == "Carrie: The Musical" and da["event"]["location"] == "Bowker Auditorium, Amherst"
    assert da["event"]["end_utc"] - da["event"]["start_utc"] == timedelta(hours=2)
    assert da["reminders"][0]["title"] == "Get tickets: Carrie: The Musical" and da["followup_at"] is None
    tip = actions.build_options("tip", "Focus", {}, user(), now=NOW, accepted=[])["options"][0]
    da = actions.build_device_actions(plan_doc("tip"), {"title": "Focus", "fields": {"tip": {"key_points": ["Move first"]}}},
                                      tip, user(), now=NOW)
    assert da["event"] is None and da["reminders"][0]["title"] == "Revisit: Focus"
    assert da["reminders"][0]["notes"] == "• Move first"


# ---------- ICS and Google Calendar ----------

def accepted_plan():
    opt = recipe_options()["options"][0]
    plan = plan_doc("recipe")
    da = actions.build_device_actions(plan, {"title": "Gochujang butter squash", "fields": RECIPE}, opt, user(), now=NOW)
    plan["device_actions"] = {"event": da["event"], "reminders": da["reminders"]}
    return plan


def test_ics():
    ics = actions.build_ics(accepted_plan(), now=NOW)
    assert ics.endswith("\r\n") and "\n" not in ics.replace("\r\n", "")
    lines = ics.split("\r\n")
    assert lines[0] == "BEGIN:VCALENDAR" and "END:VCALENDAR" in lines
    assert ics.count("BEGIN:VEVENT") == 1 and ics.count("BEGIN:VALARM") == 2
    assert "DTSTART:20261116T233000Z" in lines and "DTEND:20261117T001000Z" in lines   # 6:30 pm EST in UTC
    assert "TRIGGER;VALUE=DATE-TIME:20261116T170000Z" in lines                          # groceries, noon EST
    assert "SUMMARY:Cook: Gochujang butter squash" in lines
    assert all(len(l.encode("utf-8")) <= 75 for l in lines)
    unfolded = ics.replace("\r\n ", "")
    assert "\\n• 2 tbsp gochujang" in unfolded


def test_ics_reminder_only_is_a_15_minute_event():
    plan = plan_doc("tip")
    due = ny(2026, 11, 21, 9).astimezone(UTC)
    plan["device_actions"] = {"event": None, "reminders": [{"title": "Revisit: Focus", "due_utc": due, "notes": "", "url": "u"}]}
    ics = actions.build_ics(plan, now=NOW)
    assert "DTSTART:20261121T140000Z" in ics and "DTEND:20261121T141500Z" in ics and ics.count("BEGIN:VALARM") == 1
    assert "dates=20261121T140000Z%2F20261121T141500Z" in actions.gcal_url(plan)


def test_gcal_url():
    url = actions.gcal_url(accepted_plan())
    assert url.startswith("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Cook%3A%20Gochujang")
    assert "dates=20261116T233000Z%2F20261117T001000Z" in url


def test_device_payload_text_format():
    payload = actions.device_payload(accepted_plan(), user())
    assert payload["has_event"] == "yes"
    assert payload["event_start_text"] == "Nov 16, 2026 at 6:30 PM"
    assert payload["event_end_text"] == "Nov 16, 2026 at 7:10 PM"
    assert payload["event_start_iso"] == "2026-11-16T18:30:00-05:00"
    assert payload["reminders"][0]["due_text"] == "Nov 16, 2026 at 12:00 PM"
    assert set(payload["reminders"][0]) == {"title", "due_text", "due_iso", "notes", "url"}


# ---------- RRF ----------

def test_rrf_merge():
    ranked = {"vector": ["a", "b", "c"], "text": ["b", "d"]}
    merged = search.rrf_merge(ranked)
    assert merged[0] == "b"                        # in both lists
    assert merged.index("a") < merged.index("d")   # vector rank 1 (0.6/61) beats text rank 2 (0.4/62)
    assert set(merged) == {"a", "b", "c", "d"}
    assert search.rrf_merge({"vector": [], "text": []}) == []


def test_rrf_scores():
    merged = search.rrf_merge({"vector": ["x"], "text": ["y"]})
    assert merged == ["x", "y"]                    # 0.6/61 > 0.4/61


# ---------- small guards ----------

def test_error_mapping():
    assert ytdlp.map_error("This account is private") == "private"
    assert ytdlp.map_error("HTTP Error 404: Not Found") == "unavailable"
    assert ytdlp.map_error("There is no video in this post") == "not_video"
    assert ytdlp.map_error("Requested content is not available, rate-limit reached or login required") == "blocked"
    assert ytdlp.map_error("HTTP Error 429") == "blocked"
    assert ytdlp.map_error("something odd") == "processing_error"


def test_thumbnail_hosts():
    assert thumbs.allowed("https://scontent-bos5-1.cdninstagram.com/v/x.jpg")
    assert thumbs.allowed("https://instagram.fbos1-1.fna.fbcdn.net/x.jpg")
    assert not thumbs.allowed("https://evilcdninstagram.com/x.jpg")
    assert not thumbs.allowed("http://scontent.cdninstagram.com/x.jpg")
    assert not thumbs.allowed("https://example.com/cdninstagram.com/x.jpg")


def test_rate_limit_window():
    ratelimit.reset()
    assert all(ratelimit.allow("users", "1.2.3.4", now=100.0 + i) for i in range(5))
    assert not ratelimit.allow("users", "1.2.3.4", now=110.0)
    assert ratelimit.allow("users", "5.6.7.8", now=110.0)
    assert ratelimit.allow("users", "1.2.3.4", now=100.0 + 3601)


def test_snippet_picks_the_matching_sentence():
    save = {"summary": "A creamy dessert. It uses Greek yogurt instead of mascarpone.",
            "transcript_text": "Dip the ladyfingers in espresso.", "on_screen_text": ["1 cup Greek yogurt"]}
    assert search.snippet(save, "ladyfingers espresso") == "Dip the ladyfingers in espresso."


# ---------- event date sanity, ongoing events, search relevance ----------

def test_event_year_is_pulled_to_the_post_year():
    posted = datetime(2026, 11, 12, 15, 0, tzinfo=UTC)
    f = {"event": {"name": "Holiday Train Show", "start_local": "2023-11-14T00:00", "end_local": "2024-01-10T00:00"}}
    actions.fix_event_year(f, posted)
    assert f["event"]["start_local"] == "2026-11-14T00:00" and f["event"]["end_local"] == "2027-01-10T00:00"
    ok = {"event": {"start_local": "2026-11-20T19:00"}}
    actions.fix_event_year(ok, posted)
    assert ok["event"]["start_local"] == "2026-11-20T19:00"
    jan = {"event": {"start_local": "2025-01-05T19:00"}}   # posted in November, happens in January
    actions.fix_event_year(jan, posted)
    assert jan["event"]["start_local"] == "2027-01-05T19:00"


def test_event_already_open_and_still_running_gets_a_reminder():
    f = {"event": {"name": "Holiday Train Show", "start_local": "2026-11-13T10:00", "end_local": "2027-01-10T18:00",
                   "venue": "New York Botanical Garden"}}
    b = actions.build_options("event", "Train show", f, user(), now=NOW, accepted=[])
    assert b["actionable"] is None and b["why"] == "It runs until Jan 10."
    assert b["options"][0]["action"] == "reminder" and b["options"][0]["label"] == "Remind me Nov 21"


def test_search_relevance_floor():
    doc = {"title": "Easy Greek Yogurt Tiramisu", "summary": "A lighter tiramisu.", "tags": ["dessert"],
           "embedding": [1.0, 0.0]}
    assert search._relevant(dict(doc), "zebra unicycle", [0.7, 0.714])        # cosine 0.7 clears the floor
    assert not search._relevant(dict(doc), "zebra unicycle", [0.5, 0.866])    # 0.5 and no shared word
    assert search._relevant(dict(doc), "desserts for friday", [0.5, 0.866])   # shares "dessert"
