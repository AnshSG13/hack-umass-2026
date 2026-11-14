"""Trip plans: the rules code enforces on what the model proposes. No network, no database."""
from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from realize import trip, weather
from realize.models import default_prefs

NY = ZoneInfo("America/New_York")
USER = {"_id": "u_test", "timezone": "America/New_York", "prefs": default_prefs()}
REEL = [{"name": "The Rockaway Hotel", "kind": "stay", "city": "New York", "why": "Winter pool house"}]


def stop(name, **kw):
    base = {"name": name, "kind": "sight", "part": "afternoon", "what": "Walk it.", "minutes": 60,
            "cost": "", "cost_source": 0, "hours": "", "hours_source": 0, "booking": "unknown",
            "booking_source": 0, "added_source": 0}
    base.update(kw)
    return base


def test_cite_marks_each_backed_span_and_numbers_links_once():
    text = "Passes cost $25 to $40. Open 10 am to 6 pm."
    anns = [{"url": "https://a.example/x", "title": "a.example", "end": 23},
            {"url": "https://b.example/y", "title": "b.example", "end": 23},
            {"url": "https://a.example/x", "title": "a.example", "end": 43}]
    sources: list[dict] = []
    out = trip.cite(text, anns, sources)
    assert out == "Passes cost $25 to $40. [1, 2] Open 10 am to 6 pm. [1]"
    assert [(s["n"], s["url"]) for s in sources] == [(1, "https://a.example/x"), (2, "https://b.example/y")]
    # A second research pass keeps counting from where the first stopped.
    more = trip.cite("Ferry runs hourly.", [{"url": "https://c.example", "title": "c", "end": 18}], sources)
    assert more == "Ferry runs hourly. [3]" and len(sources) == 3


def test_same_place_matches_longer_and_shorter_names():
    assert trip.same_place("The Rockaway Hotel", "Rockaway Hotel Winter Pool House")
    assert trip.same_place("Rockaway Beach Boardwalk", "the rockaway beach boardwalk")
    assert not trip.same_place("The Rockaway Hotel", "Rockaway Beach Surf Club")
    assert not trip.same_place("", "Anything")


def test_a_stop_is_from_the_reel_only_when_its_name_matches():
    raw = {"city": "New York", "country": "United States", "days": [{"title": "Day at the beach", "stops": [
        stop("Rockaway Hotel Winter Pool House", part="midday", added_source=2),   # the model said "added"
        stop("Rockaway Beach Boardwalk", part="morning", added_source=1),
    ]}]}
    plan = trip.clean_trip(raw, REEL, n_sources=2)
    stops = plan["days"][0]["stops"]
    assert [s["name"] for s in stops] == ["Rockaway Beach Boardwalk", "The Rockaway Hotel"]   # morning first
    assert stops[1]["from_reel"] is True and stops[1]["source"] == 0
    assert stops[0]["from_reel"] is False and stops[0]["source"] == 1


def test_an_added_stop_without_a_source_is_dropped():
    raw = {"city": "New York", "country": "United States", "days": [{"title": "x", "stops": [
        stop("The Rockaway Hotel"),
        stop("Made-up Taco Stand", added_source=0),
        stop("Another Place", added_source=9),          # 9 is not a source the notes have
    ]}]}
    plan = trip.clean_trip(raw, REEL, n_sources=3)
    assert [s["name"] for s in plan["days"][0]["stops"]] == ["The Rockaway Hotel"]


def test_prices_hours_and_booking_need_a_source():
    raw = {"city": "New York", "country": "United States", "days": [{"title": "x", "stops": [
        stop("The Rockaway Hotel", cost="$25 to $40 per person [1]", cost_source=1,
             hours="10 am to 6 pm", hours_source=0, booking="required", booking_source=7),
    ]}]}
    s = trip.clean_trip(raw, REEL, n_sources=2)["days"][0]["stops"][0]
    assert s["cost"] == "$25 to $40 per person" and s["cost_source"] == 1      # marker stripped
    assert s["hours"] == "" and s["hours_source"] == 0                          # no source, no hours
    assert s["booking"] == "unknown"                                            # source 7 doesn't exist


def test_every_reel_place_is_in_the_plan_even_if_the_model_forgot_it():
    reel = REEL + [{"name": "Margie's", "kind": "food", "city": "New York", "why": "Poolside food"}]
    raw = {"city": "New York", "country": "United States", "days": [{"title": "x", "stops": [
        stop("Rockaway Beach Boardwalk", added_source=1)]}]}
    names = [s["name"] for d in trip.clean_trip(raw, reel, 1)["days"] for s in d["stops"]]
    assert "The Rockaway Hotel" in names and "Margie's" in names
    # and with nothing usable at all, the reel's places still make a day
    empty = trip.clean_trip({"city": "", "country": "", "days": []}, reel, 0)
    assert [s["name"] for s in empty["days"][0]["stops"]] == ["The Rockaway Hotel", "Margie's"]


def test_days_and_stops_are_capped_and_duplicates_dropped():
    many = [stop(f"Place number {i} unique{i}", added_source=1) for i in range(9)]
    raw = {"city": "X", "country": "Y", "days": [{"title": "d", "stops": [stop("The Rockaway Hotel")] * 2 + many}] * 5}
    plan = trip.clean_trip(raw, REEL, 1)
    assert len(plan["days"]) <= trip.MAX_DAYS
    assert all(len(d["stops"]) <= trip.MAX_STOPS_PER_DAY for d in plan["days"])
    names = [s["name"] for d in plan["days"] for s in d["stops"]]
    assert len(names) == len(set(names))


def test_stay_and_heads_up_need_sources():
    raw = {"city": "X", "country": "Y", "days": [{"title": "d", "stops": [stop("The Rockaway Hotel")]}],
           "stay": {"area": "Rockaway Park", "why": "Close to the ferry", "source": 0},
           "heads_up": [{"text": "The ferry runs a winter schedule.", "source": 1},
                        {"text": "It might be busy.", "source": 0}]}
    plan = trip.clean_trip(raw, REEL, 1)
    assert plan["stay"] is None
    assert [h["text"] for h in plan["heads_up"]] == ["The ferry runs a winter schedule."]


def test_schedule_sets_clock_times_in_code():
    stops = [{"name": "A", "part": "morning", "minutes": 90}, {"name": "B", "part": "morning", "minutes": 60},
             {"name": "C", "part": "evening", "minutes": 120}]
    trip.schedule(stops, date(2026, 11, 21), NY)
    local = [(s["start_utc"].astimezone(NY).strftime("%H:%M"), s["end_utc"].astimezone(NY).strftime("%H:%M"))
             for s in stops]
    assert local == [("10:00", "11:30"), ("12:00", "13:00"), ("18:30", "20:30")]   # 30 min between A and B


def test_schedule_keeps_an_events_own_start_time():
    stops = [{"name": "Dinner", "part": "afternoon", "minutes": 90},
             {"name": "Carrie: The Musical", "part": "evening", "minutes": 150, "start_local": "2026-11-14T19:00"}]
    trip.schedule(stops, date(2026, 11, 14), NY)
    assert stops[1]["start_utc"].astimezone(NY).strftime("%H:%M") == "19:00"
    # on another day the fixed time doesn't apply
    trip.schedule(stops, date(2026, 11, 15), NY)
    assert stops[1]["start_utc"].astimezone(NY).strftime("%H:%M") == "18:30"


def test_date_options_are_the_next_saturdays():
    sat = datetime(2026, 11, 14, 15, 0, tzinfo=NY)   # a Saturday: the next one is a week on
    assert trip.date_options(USER, sat) == [date(2026, 11, 21), date(2026, 11, 28), date(2026, 12, 5), date(2026, 12, 12)]
    wed = datetime(2026, 11, 18, 9, 0, tzinfo=NY)
    assert trip.date_options(USER, wed, 2) == [date(2026, 11, 21), date(2026, 11, 28)]


def test_span_label():
    assert trip.span_label(date(2026, 11, 21), 1) == "Saturday, Nov 21"
    assert trip.span_label(date(2026, 11, 21), 2) == "Saturday, Nov 21 to Sunday, Nov 22"


def test_reel_stops_for_places_and_events():
    place = {"type": "place", "title": "T", "fields": {"place": {"places": [
        {"name": "Somssi", "kind": "food", "city": "New York", "why": "Best new restaurant"}, {"kind": "food"}]}}}
    assert [s["name"] for s in trip.reel_stops(place)] == ["Somssi"]
    event = {"type": "event", "title": "Carrie", "fields": {"event": {
        "name": "Carrie: The Musical", "venue": "Bowker Auditorium", "city": "Amherst",
        "date_text": "November 13th and 14th", "start_local": ""}}}
    got = trip.reel_stops(event)
    assert got[0]["kind"] == "event" and got[0]["why"] == "Bowker Auditorium, November 13th and 14th"
    bare = {"type": "place", "title": "A beach somewhere", "summary": "Waves.", "fields": {}}
    assert trip.reel_stops(bare)[0]["name"] == "A beach somewhere"


def test_clean_day_keeps_only_sourced_lines():
    day = {"stops": [{"name": "The Rockaway Hotel"}, {"name": "Rockaway Beach Boardwalk"}]}
    raw = {"stops": [{"name": "Rockaway Hotel", "highlights": [
        {"text": "The pool is heated to 90 degrees. [2]", "source": 2}, {"text": "Probably nice.", "source": 0}],
        "book": "Book a day pass on ResortPass.", "book_source": 1}],
        "eat": [{"name": "Tacoway Beach", "why": "Fish tacos", "near": "Boardwalk", "source": 2},
                {"name": "The Rockaway Hotel", "why": "Already a stop", "source": 2},
                {"name": "No Source Cafe", "why": "x", "source": 0}],
        "rain": {"text": "The surf museum is indoors.", "source": 5},
        "around": {"text": "Everything is a short walk.", "source": 1}}
    d = trip.clean_day(raw, day, n_sources=2)
    assert d["stops"][0]["highlights"] == [{"text": "The pool is heated to 90 degrees.", "source": 2}]
    assert d["stops"][0]["book"] == "Book a day pass on ResortPass."
    assert d["stops"][1] == {"name": "Rockaway Beach Boardwalk", "highlights": [], "book": "", "book_source": 0}
    assert [e["name"] for e in d["eat"]] == ["Tacoway Beach"]
    assert d["rain"] is None and d["around"] == {"text": "Everything is a short walk.", "source": 1}


def test_tidy_strips_markers_and_em_dashes():
    assert trip.tidy("Open daily [1, 3] — book ahead [2]", 80) == "Open daily, book ahead"
    assert trip.tidy("**Bold** claim", 80) == "Bold claim"
    assert trip.tidy("x" * 50, 20).endswith("…") and len(trip.tidy("x" * 50, 20)) == 20


def test_day_ics_has_one_event_per_stop():
    stops = [{"name": "The Rockaway Hotel", "part": "midday", "minutes": 120, "what": "Swim.", "hours": "10 am to 6 pm",
              "cost": "$25 to $40"}, {"name": "Boardwalk", "part": "afternoon", "minutes": 60, "what": "Walk."}]
    trip.schedule(stops, date(2026, 11, 21), NY)
    doc = {"_id": "t1", "city": "New York", "days": [{"stops": stops}]}
    ics = trip.day_ics(doc, 0, now=datetime(2026, 11, 14, 12, 0, tzinfo=UTC))
    assert ics.count("BEGIN:VEVENT") == 2 and ics.startswith("BEGIN:VCALENDAR") and ics.endswith("END:VCALENDAR\r\n")
    assert "DTSTART:20261121T173000Z" in ics            # 12:30 pm in New York
    assert "SUMMARY:The Rockaway Hotel" in ics and "Cost: $25 to $40" in ics.replace("\r\n ", "")
    assert trip.day_ics(doc, 3) is None


def test_links_are_built_in_code():
    assert trip.maps_url("The Rockaway Hotel", "New York").endswith("?api=1&query=The%20Rockaway%20Hotel%2C%20New%20York")
    d = trip.directions_url("A", "B", "Queens")
    assert "origin=A%2C%20Queens" in d and "destination=B%2C%20Queens" in d


# ---------- weather ----------

def test_pick_place_prefers_the_right_country_and_state():
    results = [{"name": "Rockaway Beach", "admin1": "Oregon", "country": "United States", "country_code": "US"},
               {"name": "Rockaway Beach", "admin1": "Missouri", "country": "United States", "country_code": "US"},
               {"name": "Rockaway Beach", "admin1": "New York", "country": "United States", "country_code": "US"}]
    assert weather.pick_place(results, "New York", "United States")["admin1"] == "New York"
    assert weather.pick_place(results, "", "United States")["admin1"] == "Oregon"       # nothing to tell them apart
    assert weather.pick_place(results, "Ontario", "Canada")["admin1"] == "Oregon"       # no match: first hit
    assert weather.pick_place([], "New York", "United States") is None


def test_forecast_window_and_parsing():
    today = date(2026, 11, 14)
    assert weather.in_window(date(2026, 11, 29), today) and not weather.in_window(date(2026, 11, 30), today)
    assert not weather.in_window(date(2026, 11, 13), today)
    daily = {"time": ["2026-11-21", "2026-11-22"], "weather_code": [1, 63],
             "temperature_2m_max": [59.0, 60.2], "temperature_2m_min": [49.4, None],
             "precipitation_probability_max": [0, 70]}
    got = weather.parse_daily(daily, fahrenheit=True)
    assert got == {"2026-11-21": {"text": "Mostly clear", "wet": False, "high": 59, "low": 49, "unit": "F",
                                  "rain_chance": 0}}                                     # the incomplete day is left out
    assert weather.forecast(None, [date(2026, 11, 21)], fahrenheit=True, today=today) == {}
    assert weather.describe(63) == "Rain" and weather.describe(None) == ""
