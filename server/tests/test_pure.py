"""Unit tests for the pure functions: URLs, slots, labels, device actions, ICS, RRF.
None of these touch Atlas, Gemini or Instagram."""
from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from realize import actions, planops, ratelimit, search, slots, thumbs, urls, ytdlp
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


def test_demo_limit_follows_the_setting(monkeypatch):
    from realize import config

    class S:
        demo_sessions_per_hour = 3

    monkeypatch.setattr(config, "get_settings", lambda: S())
    ratelimit.reset()
    assert all(ratelimit.allow("demo", "9.9.9.9", now=100.0 + i) for i in range(3))
    assert not ratelimit.allow("demo", "9.9.9.9", now=104.0)
    assert ratelimit.allow("demo", "8.8.8.8", now=104.0)  # someone else on another address


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


# ---------- event dates written as text ----------

@pytest.mark.parametrize("text,first,last", [
    ("November 13th and 14th", date(2026, 11, 13), date(2026, 11, 14)),
    ("13 and 14 November", date(2026, 11, 13), date(2026, 11, 14)),
    ("Nov 28 through Jan 3", date(2026, 11, 28), date(2027, 1, 3)),
    ("Saturday, December 5 at 7:30 pm", date(2026, 12, 5), date(2026, 12, 5)),
    ("Doors at 7, Dec 5", date(2026, 12, 5), date(2026, 12, 5)),
    ("11/21", date(2026, 11, 21), date(2026, 11, 21)),
    ("2026-12-01", date(2026, 12, 1), date(2026, 12, 1)),
    ("January 10", date(2027, 1, 10), date(2027, 1, 10)),   # more than 60 days back means next year
    ("March 3, 2027", date(2027, 3, 3), date(2027, 3, 3)),
])
def test_event_date_range(text, first, last):
    assert actions.event_date_range({"event": {"date_text": text}}, date(2026, 11, 14)) == (first, last)


@pytest.mark.parametrize("text", ["", "this weekend", "every Friday at 8 pm", "February 30"])
def test_event_date_range_gives_up_without_a_day(text):
    assert actions.event_date_range({"event": {"date_text": text}}, date(2026, 11, 14)) is None


def test_event_date_range_uses_the_post_date_for_the_year():
    # Saved in January 2027, posted in November 2026: "November 20" is the one just gone.
    posted = datetime(2026, 11, 12, 15, 0, tzinfo=UTC)
    got = actions.event_date_range({"event": {"date_text": "November 20"}}, date(2027, 1, 20), posted)
    assert got == (date(2026, 11, 20), date(2026, 11, 20))


def _event(date_text, now=NOW):
    f = {"event": {"name": "Carrie: The Musical", "date_text": date_text, "venue": "Bowker Auditorium"}}
    return actions.build_options("event", "Carrie", f, user(), now=now, accepted=[])


def test_event_with_days_but_no_time_that_has_passed():
    b = _event("November 10th to 12th")
    assert b["options"] == [] and b["actionable"] is False
    assert b["why"] == "This was on Nov 10 to Nov 12. It's passed."


def test_event_with_days_but_no_time_gets_a_7_pm_guess():
    b = _event("November 21")
    o = b["options"][0]
    assert o["action"] == "event" and o["label"] == "Add Nov 21, 7 pm" and o["duration_min"] == 120
    assert b["actionable"] is None
    assert b["why"] == "It's on Nov 21. The reel gives no time, so 7 pm is a guess."


def test_event_on_its_last_day():
    # 3:05 am on the 14th: tonight's show is still ahead.
    b = _event("November 13th and 14th")
    assert b["options"][0]["label"] == "Add Today 7 pm" and b["options"][0]["action"] == "event"
    assert b["why"] == "It's on Nov 13 to Nov 14. The reel gives no time, so 7 pm is a guess."
    # 6:45 pm: 7 pm is too close to plan for, and there is no later day.
    late = _event("November 13th and 14th", now=ny(2026, 11, 14, 18, 45))
    assert late["options"] == [] and late["actionable"] is False and late["why"] == "Today was the last day."
    # With a day left, the guess moves to tomorrow.
    more = _event("November 13th to 15th", now=ny(2026, 11, 14, 18, 45))
    assert more["options"][0]["label"] == "Add Tomorrow 7 pm"


def test_long_run_with_days_but_no_time_gets_a_reminder():
    running = _event("Nov 13 through Jan 10")
    assert running["options"][0]["action"] == "reminder" and running["options"][0]["label"] == "Remind me Nov 21"
    assert running["why"] == "It runs until Jan 10."
    coming = _event("Nov 28 through Jan 3")
    assert coming["options"][0]["label"] == "Remind me Nov 27" and coming["options"][0]["big_time"] == "Nov 27, 6 pm"
    assert coming["why"] == "It runs Nov 28 to Jan 3."


# ---------- two plans can't take the same time ----------

def test_slot_taken():
    plan = {"_id": "p1", "kind": "recipe"}
    opt = {"action": "event", "start_utc": ny(2026, 11, 18, 18, 30), "duration_min": 60}
    other = {"plan_id": "p2", "start_utc": ny(2026, 11, 18, 18, 30), "end_utc": ny(2026, 11, 18, 19, 30)}
    assert planops.slot_taken(plan, opt, user(), [other])
    assert planops.slot_taken(plan, opt, user(), [{**other, "start_utc": ny(2026, 11, 18, 19, 0),
                                                   "end_utc": ny(2026, 11, 18, 20, 0)}])       # partial overlap
    assert not planops.slot_taken(plan, opt, user(), [])
    assert not planops.slot_taken(plan, opt, user(), [{**other, "plan_id": "p1"}])               # its own booking
    assert not planops.slot_taken(plan, opt, user(), [{**other, "start_utc": ny(2026, 11, 18, 19, 30),
                                                       "end_utc": ny(2026, 11, 18, 20, 30)}])   # back to back
    # A reminder takes no time, and an event keeps its own date.
    assert not planops.slot_taken(plan, {**opt, "action": "reminder"}, user(), [other])
    assert not planops.slot_taken({"_id": "p1", "kind": "event"}, opt, user(), [other])


def test_slot_taken_at_the_daily_cap():
    plan = {"_id": "p1", "kind": "recipe"}
    opt = {"action": "event", "start_utc": ny(2026, 11, 18, 18, 30), "duration_min": 60}
    morning = {"plan_id": "p2", "start_utc": ny(2026, 11, 18, 7, 0), "end_utc": ny(2026, 11, 18, 7, 45)}
    noon = {"plan_id": "p3", "start_utc": ny(2026, 11, 18, 12, 0), "end_utc": ny(2026, 11, 18, 13, 0)}
    assert not planops.slot_taken(plan, opt, user(), [morning])
    assert planops.slot_taken(plan, opt, user(), [morning, noon])          # daily_cap is 2
    assert not planops.slot_taken(plan, opt, user(daily_cap=3), [morning, noon])


def test_search_puts_a_fresh_save_ahead_of_weaker_indexed_results(monkeypatch):
    indexed = [{"_id": 1, "title": "Chickpea curry", "embedding": [1.0, 0.0]},
               {"_id": 2, "title": "Pepper chicken", "embedding": [0.8, 0.6]}]
    fresh = [{"_id": 3, "title": "Tiramisu", "embedding": [0.96, 0.28]},
             {"_id": 4, "title": "Unrelated", "embedding": [0.0, 1.0]}]
    monkeypatch.setattr(search, "_fresh", lambda uid, t, have: [dict(d) for d in fresh])
    out = search._finish([dict(d) for d in indexed], "zzz", [1.0, 0.0], 10, "u_test", None)
    assert [d["_id"] for d in out] == [1, 3, 2]          # 4 is under the relevance floor
    assert all("embedding" not in d for d in out)



# ---------- what a hand-built Shortcut sends ----------

def test_bearer_is_forgiving():
    from realize.api.deps import bearer
    assert bearer("Bearer rl_abc123") == "rl_abc123"
    assert bearer("bearer   rl_abc123  ") == "rl_abc123"
    assert bearer("rl_abc123") == "rl_abc123"           # the word Bearer left out
    assert bearer(' "Bearer rl_abc123" ') == "rl_abc123"
    assert bearer("Bearer: rl_abc123") == "rl_abc123"
    assert bearer(None) is None and bearer("  ") is None
    assert bearer("Basic abc def") is None


def test_save_body_typed_on_a_phone():
    from realize.api.deps import loose_fields, save_request_from
    reel = "https://www.instagram.com/reel/DfiT7-QxmY-/?igsh=abc=="
    # The iOS keyboard capitalises names and values, and numbers arrive as text.
    r = save_request_from(loose_fields(b'{"Input": "%s", "Source": "Shortcut", "Wait": "0"}' % reel.encode(),
                                       "application/json"))
    assert r.input == reel and r.source == "shortcut" and r.wait == 0.0
    # The web app's own body is unchanged.
    r = save_request_from(loose_fields(b'{"input": "x", "source": "web", "wait": 0}', "application/json"))
    assert (r.input, r.source, r.wait) == ("x", "web", 0.0)
    # The prototype's field name, and no wait at all.
    r = save_request_from(loose_fields(b'{"url": "%s", "token": "me"}' % reel.encode(), "application/json"))
    assert r.input == reel and r.source == "shortcut" and r.wait is None
    # Request Body left on Form.
    r = save_request_from(loose_fields(b"input=https%3A%2F%2Fwww.instagram.com%2Freel%2FAbc%2F&source=shortcut&wait=0",
                                       "application/x-www-form-urlencoded"))
    assert r.input == "https://www.instagram.com/reel/Abc/" and r.wait == 0.0
    body = (b'--XX\r\nContent-Disposition: form-data; name="Input"\r\n\r\n' + reel.encode()
            + b'\r\n--XX\r\nContent-Disposition: form-data; name="wait"\r\n\r\n0\r\n--XX--\r\n')
    r = save_request_from(loose_fields(body, "multipart/form-data; boundary=XX"))
    assert r.input == reel and r.wait == 0.0
    # Nothing readable is an empty request, not a crash.
    r = save_request_from(loose_fields(b"\xff\xfe not json", "application/json"))
    assert r.input == "" and r.source == "shortcut"
    assert save_request_from(loose_fields(b'{"input": "x", "wait": "soon"}')).wait is None


def test_confirm_body_typed_on_a_phone():
    from realize.api.deps import confirm_request_from, loose_fields
    c = confirm_request_from(loose_fields(b'{"Choice": "Cook Mon 6:30 pm + 7 groceries", "Source": "Shortcut"}'))
    assert c.choice == "Cook Mon 6:30 pm + 7 groceries" and c.source == "shortcut" and c.start_local is None


# ---------- discussions about one reel ----------


def test_discussion_second_is_checked_against_the_transcript():
    from realize import discuss

    save = {"transcript": [{"start_sec": 0.0, "text": "Hi"}, {"start_sec": 11.0, "text": "Rinse the noodles"},
                           {"start_sec": 30.0, "text": ""}]}
    assert discuss.snap_second(save, 11) == 11
    assert discuss.snap_second(save, 12.4) == 11      # close to a real line: that line
    assert discuss.snap_second(save, 20) is None      # no line there: no link
    assert discuss.snap_second(save, 30) is None      # an empty line doesn't count
    assert discuss.snap_second(save, -1) is None
    assert discuss.snap_second(save, "soon") is None
    assert discuss.snap_second({"transcript": []}, 5) is None


def test_discussion_answer_follows_the_copy_rules():
    from realize import discuss

    assert discuss.clean_answer("Use tofu \u2014 it **works**.\n\n\n\nDone.") == "Use tofu, it works.\n\nDone."
    assert len(discuss.clean_answer("x" * 5000)) == discuss.ANSWER_MAX
    assert discuss.title_from("  what   can I swap\nfor fish sauce? ") == "what can I swap for fish sauce?"
    assert len(discuss.title_from("word " * 40)) == discuss.TITLE_MAX


def test_discussion_context_carries_the_reel_and_the_note():
    from realize import discuss

    save = {"title": "Pad thai", "type": "recipe", "creator": {"handle": "cook"}, "summary": "Noodles.",
            "fields": {"recipe": {"steps": ["Soak noodles"]}}, "caption": "Easy pad thai",
            "on_screen_text": ["20 minutes"], "note": "less sugar",
            "transcript": [{"start_sec": 11.0, "text": "Rinse the noodles"}]}
    ctx = discuss.reel_context(save, None, {"timezone": "America/New_York"})
    for piece in ("Title: Pad thai", "@cook", "Soak noodles", "- 20 minutes", "[11] Rinse the noodles", "less sugar"):
        assert piece in ctx
    assert "Transcript: none" in discuss.reel_context({"title": "x"}, None, {"timezone": "UTC"})


# ---------- Ask: moments and follow-ups ----------


def test_a_snippet_said_in_the_video_gets_its_second():
    from realize import search

    lines = [{"start_sec": 0.0, "text": "Today we make pad thai"},
             {"start_sec": 11.4, "text": "rinse the noodles in cold water"},
             {"start_sec": 20.0, "text": "so"}]
    assert search.moment("Then rinse the noodles in cold water so they don't stick.", "A pad thai recipe.", lines) == 11
    assert search.moment("A pad thai recipe.", "A pad thai recipe.", lines) is None      # from the summary
    assert search.moment("Buy a wok on sale", "A pad thai recipe.", lines) is None        # said nowhere
    assert search.moment("", None, lines) is None
    assert search.moment("Today we make pad thai", None, lines) is None                   # the opening line
    assert search.moment("rinse the noodles in cold water", None, []) is None


def test_follow_ups_are_short_and_distinct():
    from realize import ask

    assert ask.clean_follow_ups(["Plan it for Friday", "plan it for friday", "  What do I need to buy? "]) == [
        "Plan it for Friday", "What do I need to buy?"]
    assert ask.clean_follow_ups(["x", "y" * 80]) == []
    assert ask.clean_follow_ups(None) == []
    assert ask.clean_follow_ups(["a b c", "d e f", "g h i"]) == ["a b c", "d e f"]


# ---------- taste boards ----------


def test_board_meta_line_uses_only_what_the_reel_gave():
    from realize import board

    recipe = {"type": "recipe", "fields": {"recipe": {"total_time_min": 20, "ingredients": [{"item": "a"}] * 7}}}
    assert board.meta_line(recipe) == "20 min · 7 ingredients"
    assert board.meta_line({"type": "recipe", "fields": {"recipe": {"ingredients": [{"item": "a"}]}}}) == "1 ingredient"
    assert board.meta_line({"type": "workout", "fields": {"workout": {"duration_min": 15, "exercises": [{}] * 6}}}) == "15 min · 6 moves"
    place = {"type": "place", "fields": {"place": {"places": [{"name": "A", "city": "Lisbon"}, {"name": "B"}]}}}
    assert board.meta_line(place) == "Lisbon · 2 places"
    assert board.meta_line({"type": "product", "fields": {"product": {"items": [{}] * 6}}}) == "6 products"
    # Nothing to say about it: who posted it, or nothing at all.
    assert board.meta_line({"type": "other", "creator": {"handle": "ana"}}) == "@ana"
    assert board.meta_line({"type": "recipe", "fields": {}}) == ""


def test_board_tags_drop_the_dull_and_the_universal():
    from realize import board

    assert board.clean_tags({"tags": ["#Thai", "recipe", "thai", " noodles ", "fyp"]}) == ["thai", "noodles"]
    chips = board.top_tags([["thai", "dinner"], ["thai", "dinner", "quick"], ["dinner", "baking"]])
    assert [c["tag"] for c in chips] == ["thai", "baking", "quick"]      # "dinner" is on every save
    assert board.meta_line({"type": "recipe", "fields": {"recipe": {"total_time_min": 250}}}) == "4 h 10 min"
    assert board.meta_line({"type": "recipe", "fields": {"recipe": {"total_time_min": 120}}}) == "2 h"
    assert chips[0] == {"tag": "thai", "count": 2}
    assert board.top_tags([["solo"]]) == [{"tag": "solo", "count": 1}]    # one save: its tags still show


# ---------- bundles: plans from several saves ----------


def test_bundle_signature_ignores_order():
    from realize import bundles

    assert bundles.signature("recipe", ["b", "a"]) == bundles.signature("recipe", ["a", "b"])
    assert bundles.signature("recipe", ["a", "b"]) != bundles.signature("workout", ["a", "b"])
    assert bundles.signature("recipe", ["a", "b"]) != bundles.signature("recipe", ["a", "b", "c"])


def test_groceries_merge_across_recipes():
    from realize import bundles

    out = bundles.merge_groceries([
        {"save_id": "A", "ingredients": [
            {"item": "Garlic, minced", "qty": 2, "unit": "cloves", "aisle": "Produce"},
            {"item": "butter", "qty": 2, "unit": "tablespoons", "aisle": "Dairy & Eggs"},
            {"item": "soy sauce", "aisle": "Pantry"}]},
        {"save_id": "B", "ingredients": [
            {"item": "garlic", "qty": 3, "unit": "cloves", "aisle": "Produce"},
            {"item": "butter", "qty": 100, "unit": "g", "aisle": "Dairy & Eggs"},
            {"item": "", "qty": 1}]},
    ])
    flat = {i["key"]: i for g in out for i in g["items"]}
    assert flat["garlic"]["text"] == "5 cloves garlic" and flat["garlic"]["from"] == ["A", "B"]
    assert flat["butter"]["text"] == "2 tablespoons + 100 g butter"       # units differ: both kept
    assert flat["soy sauce"]["text"] == "soy sauce" and flat["soy sauce"]["from"] == ["A"]
    assert [g["aisle"] for g in out] == ["Produce", "Dairy & Eggs", "Pantry"]   # store order
    assert len(flat) == 3                                                 # the nameless line is dropped


def test_bundle_words_from_the_model_are_checked():
    from realize import bundles

    ids = ["s1", "s2", "s3"]
    good = bundles.checked_polish(
        {"title": "Thai week — easy!", "blurb": "Three fast dinners.", "order": ["s3", "nope", "s3"],
         "notes": [{"save_id": "s3", "note": "Quickest one"}, {"save_id": "zzz", "note": "invented"}],
         "pick_save_id": "s1", "pick_name": "Anything", "pick_why": "because"},
        "recipe", ids, {})
    assert good["title"] == "Thai week, easy."
    assert good["order"] == ["s3", "s1", "s2"]            # reordered, nothing dropped or invented
    assert good["notes"] == {"s3": "Quickest one"}
    assert good["pick"] is None                           # only product bundles have a pick

    names = {"s1": ["Dyson Airwrap"], "s2": ["Shark FlexStyle"]}
    pick = bundles.checked_polish({"title": "t", "blurb": "b", "order": [], "notes": [],
                                   "pick_save_id": "s1", "pick_name": "dyson airwrap", "pick_why": "Six of 35 stood out"},
                                  "product", ids, names)["pick"]
    assert pick == {"save_id": "s1", "name": "dyson airwrap", "why": "Six of 35 stood out"}
    assert bundles.checked_polish({"title": "t", "blurb": "b", "order": [], "notes": [],
                                   "pick_save_id": "s1", "pick_name": "A made up iron"},
                                  "product", ids, names)["pick"] is None
    assert len(bundles.clean("x" * 200, 34)) == 34
    assert bundles.count_label("recipe", 3) == "3 dinners" and bundles.count_label("workout", 1) == "1 workout"


# ---------- visits: what is new since last time ----------


def test_new_line_is_the_later_of_last_visit_and_board_opened():
    from datetime import datetime, timezone

    from realize import visits

    a = datetime(2026, 11, 10, tzinfo=timezone.utc)
    b = datetime(2026, 11, 12, tzinfo=timezone.utc)
    assert visits.new_line(a, b) == b and visits.new_line(b, a) == b
    now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    assert visits.new_line(None, None, now=now) == datetime(2026, 11, 13, 12, tzinfo=timezone.utc)
    assert visits.new_line(a, None) == a


def test_recap_names_what_was_sorted():
    from realize import visits

    parts = visits.recap_parts({"recipe": 3, "workout": 4, "product": 3, "other": 9, "tip": 1})
    assert parts == ["4 workouts", "3 recipes", "3 product picks"]       # largest first, at most 3, no "other"
    assert visits.join_words(parts) == "4 workouts, 3 recipes and 3 product picks"
    assert visits.join_words(["1 recipe"]) == "1 recipe"
    assert visits.recap_parts({"place": 1}) == ["1 place to go"]
    assert visits.recap_parts({}) == []


# ---------- nutrition: the model estimates lines, code does the sums ----------


def test_nutrition_sums_lines_and_divides_by_servings():
    from realize import nutrition

    line = lambda i, kcal, p, c, f, **kw: {"index": i, "kcal": kcal, "protein_g": p, "carbs_g": c, "fat_g": f,
                                           "fiber_g": 0, "sugar_g": 0, "sodium_mg": 0, **kw}
    out = nutrition.total([line(0, 400, 20, 40, 18), line(1, 400, 20, 40, 18, assumed=True)], 2, 2)
    assert out["per_serving"]["kcal"] == 400 and out["per_serving"]["protein_g"] == 20
    assert out["split_pct"] == {"protein": 20, "carbs": 40, "fat": 40} and sum(out["split_pct"].values()) == 100
    assert out["assumed"] == 1 and out["servings"] == 2


def test_nutrition_drops_impossible_and_made_up_lines():
    from realize import nutrition

    good = {"index": 0, "kcal": 100, "protein_g": 5, "carbs_g": 10, "fat_g": 4, "fiber_g": 1, "sugar_g": 1, "sodium_mg": 5}
    bad = [{**good, "index": 1, "kcal": 99999}, {**good, "index": 9}, {**good, "index": 0}, {**good, "index": 2, "fat_g": -3}]
    assert nutrition.total([good, *bad], 3, 1) is None          # 1 of 3 lines is too little to show
    assert nutrition.total([good, {**good, "index": 1}], 3, 1)["lines_counted"] == 2
    # Calories that disagree with the macros are recomputed from them.
    off = nutrition.total([{**good, "kcal": 1000}], 1, 1)
    assert off["per_serving"]["kcal"] == 4 * 5 + 4 * 10 + 9 * 4


# ---------- shopping research: credible sources only, only readable prices ----------


def test_only_trusted_sources_count():
    from realize import shop

    assert shop.trusted("https://www.target.com/p/x", []) == "Target"
    assert shop.trusted("https://www.nytimes.com/wirecutter/reviews/x", []) == "Wirecutter"
    assert shop.trusted("https://shop.dyson.com/hair", ["Dyson"]) == "Dyson"          # the brand's own site
    assert shop.trusted("https://cheap-dyson-deals.xyz/a", []) is None                 # not on the list, no brand
    assert shop.trusted("https://amazon.com.evil.biz/x", []) is None                   # lookalike host
    assert shop.trusted("not a url", []) is None


def test_any_credible_store_counts_but_risky_sites_do_not():
    from realize import shop

    # Smaller real stores and brand sites pass and show their own name or domain.
    assert shop.source_of("https://www.pickleballcentral.com/paddle", []) == ("pickleballcentral.com", "site")
    assert shop.source_of("https://joola.com/products/x", ["JOOLA"]) == ("JOOLA", "brand")
    assert shop.source_of("https://www.selkirk.com/p", ["Selkirk Sport"]) == ("Selkirk Sport", "brand")
    # Coupon sites, unknown-seller marketplaces, social posts, shorteners, http, IPs, spam endings.
    for bad in ("https://www.retailmenot.com/view/joola.com", "https://www.aliexpress.com/item/1",
                "https://www.reddit.com/r/Pickleball/x", "https://bit.ly/abc", "http://smallshop.com/p",
                "https://192.168.0.1/p", "https://paddles.shop.xyz/p", "https://best-paddle-deals.com/p",
                "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", "https://localhost/p"):
        assert shop.source_of(bad, []) is None, bad


def test_offers_keep_only_backed_readable_prices():
    from realize import shop

    sources = [{"n": 1, "url": "https://www.target.com/p/1", "title": "t"},
               {"n": 2, "url": "https://sketchy-store.biz/x", "title": "s"},
               {"n": 3, "url": "https://www.pickleballcentral.com/p", "title": "p"}]
    raw = [{"product": "Hulken bag", "store": "Target", "price_text": "$79.99", "source": 1, "alternative": False},
           {"product": "Hulken bag", "store": "Target", "price_text": "$79.99", "source": 1, "alternative": False},
           {"product": "Hulken bag", "store": "Sketchy", "price_text": "$20", "source": 2, "alternative": False},
           {"product": "Tote", "store": "Target", "price_text": "about forty dollars", "source": 1, "alternative": True},
           {"product": "Tote", "store": "Target", "price_text": "$1,299.00", "source": 9, "alternative": True},
           {"product": "Costco tote", "store": "Target", "price_text": "Now $39", "source": 1, "alternative": True,
            "note": "Alternative: half the price"}]
    out = shop.keep_offers(raw, sources, [])
    assert [(o["product"], o["price"]) for o in out] == [("Hulken bag", 79.99), ("Costco tote", 39.0)]
    assert out[1]["note"] == "half the price" and out[1]["price_text"] == "$39"
    assert shop.best_by_product(out) == [out[0]]
    assert shop.parse_price("$1,299.50 on sale") == 1299.5 and shop.parse_price("free") is None
    # A store's page sets the store name, even when the notes named another.
    moved = shop.keep_offers([{"product": "X", "store": "Walmart", "price_text": "$5", "source": 1, "alternative": False}], sources, [])
    assert moved[0]["store"] == "Target"
    # A smaller store's page is named by its own domain, not by what the notes claimed.
    small = shop.keep_offers([{"product": "Paddle", "store": "Amazon", "price_text": "$149.99", "source": 3, "alternative": False}], sources, [])
    assert small[0]["store"] == "pickleballcentral.com" and small[0]["via"] == "pickleballcentral.com"


def test_out_of_stock_prices_are_dropped():
    from realize import shop

    sources = [{"n": 1, "url": "https://www.target.com/p/1", "title": "t"}]
    raw = [{"product": "Paddle", "store": "Target", "price_text": "$99", "source": 1, "alternative": False,
            "note": "Out of stock online"},
           {"product": "Paddle", "store": "Target", "price_text": "$120", "source": 1, "alternative": False,
            "note": "Pre-order, ships in May"},
           {"product": "Paddle", "store": "Target", "price_text": "$139", "source": 1, "alternative": False,
            "note": "In stock"}]
    assert [o["price"] for o in shop.keep_offers(raw, sources, [])] == [139.0]


def test_price_list_is_the_top_four_stores_and_three_similar_products():
    from realize import shop

    def o(store, price, alt=False, product="Paddle"):
        return {"product": product, "store": store, "price": price, "alternative": alt}
    offers = [o("A", 50), o("B", 40), o("B", 45), o("C", 60), o("D", 70), o("E", 30), o("F", 90),
              o("G", 20, True, "Cheap one"), o("H", 25, True, "Cheap one"), o("I", 22, True, "Other"),
              o("J", 28, True, "Third"), o("K", 26, True, "Fourth")]
    out = shop.top_offers(offers)
    main = [(x["store"], x["price"]) for x in out if not x["alternative"]]
    assert main == [("E", 30), ("B", 40), ("A", 50), ("C", 60)]            # lowest 4, one per store
    assert [x["product"] for x in out if x["alternative"]] == ["Cheap one", "Other", "Fourth"]


# ---------- actions: what the person wants from the reel, delivered ----------


def test_action_keeps_a_fitting_model_pick_in_its_own_words():
    from realize import intent

    a = intent.clean({"deliver": "cook", "need": "make this tiramisu", "cta": "Cook this tiramisu tonight!",
                      "pitch": "7 ingredients — 15 minutes", "schedule": False}, "recipe", is_dated=False)
    assert a["deliver"] == "cook" and a["cta"] == "Cook this tiramisu tonight" and a["source"] == "model"
    assert "—" not in a["pitch"] and a["schedule"] is False


def test_action_falls_back_when_the_pick_does_not_fit():
    from realize import intent

    # A product never gets cook mode, and a reminder-ish calendar entry needs a dated event.
    assert intent.clean({"deliver": "cook", "cta": "x"}, "product", is_dated=False)["deliver"] == "shop"
    undated = intent.clean({"deliver": "calendar", "cta": "Save the date"}, "event", is_dated=False)
    assert undated["deliver"] == "itinerary" and undated["source"] == "default"
    assert intent.clean({"deliver": "calendar"}, "event", is_dated=True)["deliver"] == "calendar"
    assert intent.clean(None, "tip", is_dated=False)["deliver"] == "learn"
    assert intent.clean({"deliver": "teleport"}, "other", is_dated=False)["deliver"] == "keep"
    # schedule only sticks where a set time can mean something
    assert intent.clean({"deliver": "shop", "schedule": True}, "product", is_dated=False)["schedule"] is False
    long_cta = intent.clean({"deliver": "shop", "cta": "Compare every single one of these lovely curling irons now"},
                            "product", is_dated=False)["cta"]
    assert len(long_cta) <= intent.CTA_MAX and not long_cta.endswith(" ")


def test_action_view_defaults_for_old_plans_and_stale_types():
    from datetime import timedelta

    from realize import intent
    from realize.timeutil import now_utc

    assert intent.view(None, {"type": "recipe"})["deliver"] == "cook"
    assert intent.view(None, {"type": None}) is None
    soon = [{"action": "event", "start_utc": now_utc() + timedelta(days=2)}]
    assert intent.view({"options": soon}, {"type": "event"})["deliver"] == "calendar"
    # A stored cook action on a save since moved to products becomes the product default.
    assert intent.view({"action": {"deliver": "cook", "cta": "Cook it"}}, {"type": "product"})["deliver"] == "shop"


def test_done_on_labels():
    from datetime import datetime, timedelta, timezone

    from realize.tickets import done_on

    tz = timezone.utc
    now = datetime(2026, 11, 14, 15, 0, tzinfo=tz)  # a Saturday
    assert done_on({"done_at": now - timedelta(hours=2)}, tz, now) == "today"
    assert done_on({"done_at": now - timedelta(days=1)}, tz, now) == "yesterday"
    assert done_on({"done_at": now - timedelta(days=2)}, tz, now) == "Thursday"
    assert done_on({"done_at": now - timedelta(days=11)}, tz, now) == "Nov 3"
    assert done_on({"updated_at": now}, tz, now) == "today"  # done before done_at existed
    assert done_on({}, tz, now) is None
