"""Trip plans for travel reels (places and events): a day-by-day itinerary under the plan card.

The same split as the rest of the app. Gemini searches the web and proposes: which other
stops fit, what each costs, when it opens. Code decides everything that has to be right:
which facts are kept (only ones with a source the search returned), which stops came from
the reel (matched by name), the dates, the clock times, the forecast, and every link.

Two levels. Building the trip lays out the days. Opening a day builds more on top of it:
what to do at each stop, where to eat nearby, a rain plan, with the same source rule.
"""
from __future__ import annotations

import logging
import re
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from bson import ObjectId

from . import actions, db, gemini, runs, slots, weather
from .config import get_settings
from .timeutil import as_utc, fmt_time, heading_day, month_day, now_utc, parse_local, tz_of

log = logging.getLogger("realize.trip")

TRIP_TYPES = ("place", "event")
MAX_DAYS = 3
MAX_STOPS_PER_DAY = 5
GAP_MIN = 30                      # minutes left between stops for getting there
DATE_OPTIONS = 4                  # weekends offered when changing the dates
STALE_BUILD_S = 180               # a build older than this is treated as dead
WEATHER_TTL_S = 3 * 3600
KINDS = ["food", "sight", "shop", "activity", "nightlife", "stay", "event"]
PARTS = ["morning", "midday", "afternoon", "evening"]
PART_START = {"morning": time(10, 0), "midday": time(12, 30), "afternoon": time(14, 30), "evening": time(18, 30)}
PART_LABEL = {"morning": "Morning", "midday": "Midday", "afternoon": "Afternoon", "evening": "Evening"}
BUILD_FAILED = "The trip plan didn't build. Try again."
DAY_FAILED = "That day didn't build. Try again."
PLAIN_WORDS = ("Plain words, sentence case, no em dashes. Never use the words leverage, pivotal, intricate, "
               "showcasing, synergy, delve, realm, robust, streamlined, transformative, seamless or game-changer.")

_S = {"type": "string"}
_I = {"type": "integer"}

TRIP_SCHEMA = {
    "type": "object",
    "properties": {
        "city": _S, "region": {"type": "string", "description": "State, province or region"}, "country": _S,
        "weather_place": {"type": "string", "description": "Nearest city or town a weather service would know"},
        "days": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string", "description": "3 to 5 words for the day"},
            "stops": {"type": "array", "items": {"type": "object", "properties": {
                "name": _S, "kind": {"type": "string", "enum": KINDS},
                "part": {"type": "string", "enum": PARTS},
                "area": {"type": "string", "description": "Neighborhood or district"},
                "what": {"type": "string", "description": "One sentence, max 120 characters"},
                "minutes": _I,
                "cost": _S, "cost_source": _I, "hours": _S, "hours_source": _I,
                "booking": {"type": "string", "enum": ["none", "recommended", "required", "unknown"]},
                "booking_source": _I,
                "added_source": {"type": "integer", "description": "0 for a place named in the reel"},
            }, "required": ["name", "kind", "part", "what", "minutes"]}},
        }, "required": ["title", "stops"]}},
        "stay": {"type": "object", "properties": {"area": _S, "why": _S, "source": _I}},
        "heads_up": {"type": "array", "items": {"type": "object", "properties": {"text": _S, "source": _I},
                                                 "required": ["text", "source"]}},
    },
    "required": ["city", "country", "days"],
}

DAY_SCHEMA = {
    "type": "object",
    "properties": {
        "stops": {"type": "array", "items": {"type": "object", "properties": {
            "name": _S,
            "highlights": {"type": "array", "items": {"type": "object", "properties": {"text": _S, "source": _I},
                                                       "required": ["text", "source"]}},
            "book": _S, "book_source": _I,
        }, "required": ["name"]}},
        "eat": {"type": "array", "items": {"type": "object", "properties": {
            "name": _S, "why": _S, "near": _S, "source": _I}, "required": ["name", "why", "source"]}},
        "rain": {"type": "object", "properties": {"text": _S, "source": _I}},
        "around": {"type": "object", "properties": {"text": _S, "source": _I}},
    },
    "required": ["stops"],
}


# ---------- small pure helpers ----------


def norm(text: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(text or "").lower()))


_MARK = re.compile(r"\s*\[\d+(?:\s*,\s*\d+)*\]")


def tidy(text: Any, limit: int) -> str:
    """Model text made safe to show: no source markers, no em dashes, clipped."""
    s = _MARK.sub("", str(text or ""))
    s = s.replace(" — ", ", ").replace("—", "-").replace("**", "")
    s = " ".join(s.split())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def same_place(a: str, b: str) -> bool:
    """True when two names mean the same stop ("The Rockaway Hotel" and "Rockaway Hotel pool house")."""
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    if x in y or y in x:
        return True
    drop = {"the", "at", "of", "and", "a", "in"}
    xs, ys = set(x.split()) - drop, set(y.split()) - drop
    if not xs or not ys:
        return False
    return len(xs & ys) >= max(2, min(len(xs), len(ys)))


def reel_stops(save: dict) -> list[dict]:
    """The places a reel names, as the video pass recorded them."""
    fields = save.get("fields") or {}
    out: list[dict] = []
    if save.get("type") == "event":
        ev = fields.get("event") or {}
        name = ev.get("name") or save.get("title")
        if name:
            out.append({"name": str(name), "kind": "event", "city": ev.get("city") or "",
                        "why": ", ".join(str(x) for x in (ev.get("venue"), ev.get("date_text")) if x),
                        "venue": ev.get("venue") or "", "start_local": ev.get("start_local") or ""})
    for p in (fields.get("place") or {}).get("places") or []:
        if isinstance(p, dict) and p.get("name"):
            out.append({"name": str(p["name"]), "kind": p.get("kind") if p.get("kind") in KINDS else "sight",
                        "city": p.get("city") or "", "why": p.get("why") or "", "tip": p.get("tip") or ""})
    if not out and save.get("title"):
        out.append({"name": str(save["title"]), "kind": "sight", "city": "", "why": save.get("summary") or ""})
    return out


def date_options(user: dict, now: datetime | None = None, n: int = DATE_OPTIONS) -> list[date]:
    """The next n Saturdays in the user's time zone: a trip starts on a weekend unless they say otherwise."""
    today = as_utc(now or now_utc()).astimezone(tz_of(user)).date()
    first = today + timedelta(days=(5 - today.weekday()) % 7 or 7)
    return [first + timedelta(days=7 * i) for i in range(n)]


def default_start(save: dict, user: dict, now: datetime | None = None) -> date:
    """An event keeps its own date. A place trip starts on the first free weekend day."""
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    if save.get("type") == "event":
        start, _ = actions.event_times(save.get("fields"), user)
        if start and start.date() >= now_l.date():
            return start.date()
        days = actions.event_date_range(save.get("fields"), now_l.date(), save.get("posted_at"))
        if days and days[1] >= now_l.date():
            return max(days[0], now_l.date())
    try:
        free = slots.find_free_slot(user, "place", now=now)
    except Exception:  # noqa: BLE001 - a date is still needed
        free = []
    if free:
        return as_utc(free[0]["start_utc"]).astimezone(tz).date()
    return date_options(user, now, 1)[0]


def span_label(start: date, n_days: int) -> str:
    if n_days <= 1:
        return heading_day(start)
    end = start + timedelta(days=n_days - 1)
    return f"{heading_day(start)} to {heading_day(end)}"


def cite(text: str, annotations: list[dict], sources: list[dict]) -> str:
    """Put a [n] marker after each span the search backed, numbering into `sources`
    (extended in place, one entry per distinct link). The marker is how a fact in the
    notes stays tied to where it came from."""
    by_end: dict[int, list[int]] = {}
    known = {s["url"]: s["n"] for s in sources}
    for a in annotations:
        url = a.get("url")
        if not url:
            continue
        if url not in known:
            known[url] = len(sources) + 1
            sources.append({"n": known[url], "title": a.get("title") or "", "url": url})
        end = max(0, min(len(text), int(a.get("end") or 0)))
        marks = by_end.setdefault(end, [])
        if known[url] not in marks:
            marks.append(known[url])
    out = text
    for end in sorted(by_end, reverse=True):
        out = out[:end] + " [" + ", ".join(str(n) for n in sorted(by_end[end])) + "]" + out[end:]
    return out


def _src(n: Any, count: int) -> int:
    """A source number the notes really have, or 0."""
    try:
        v = int(n)
    except (TypeError, ValueError):
        return 0
    return v if 1 <= v <= count else 0


def clean_trip(raw: dict, reel: list[dict], n_sources: int) -> dict:
    """What the model proposed, after the rules: a stop is "from the reel" only when its name
    matches one the reel named; an added stop needs a source or it is dropped; a price, opening
    time or booking note without a source is blanked; every reel stop is in the plan."""
    days: list[dict] = []
    seen: list[str] = []
    for d in (raw.get("days") or [])[:MAX_DAYS]:
        stops: list[dict] = []
        for s in d.get("stops") or []:
            name = tidy(s.get("name"), 70)
            if not name or any(same_place(name, x) for x in seen):
                continue
            match = next((r for r in reel if same_place(name, r["name"])), None)
            added = _src(s.get("added_source"), n_sources)
            if not match and not added:
                continue  # an added stop nobody can check
            cost_src, hours_src = _src(s.get("cost_source"), n_sources), _src(s.get("hours_source"), n_sources)
            book_src = _src(s.get("booking_source"), n_sources)
            booking = s.get("booking") if s.get("booking") in ("none", "recommended", "required") else "unknown"
            try:
                minutes = max(30, min(240, int(s.get("minutes") or 60)))
            except (TypeError, ValueError):
                minutes = 60
            stop = {
                "name": match["name"] if match else name, "from_reel": bool(match),
                "kind": s.get("kind") if s.get("kind") in KINDS else (match or {}).get("kind", "sight"),
                "part": s.get("part") if s.get("part") in PARTS else "afternoon",
                "area": tidy(s.get("area"), 40), "what": tidy(s.get("what"), 140), "minutes": minutes,
                "cost": tidy(s.get("cost"), 60) if cost_src else "", "cost_source": cost_src,
                "hours": tidy(s.get("hours"), 60) if hours_src else "", "hours_source": hours_src,
                "booking": booking if book_src else "unknown", "booking_source": book_src,
                "source": 0 if match else added,
            }
            if match and match.get("start_local"):
                stop["start_local"] = match["start_local"]
            seen.append(stop["name"])
            stops.append(stop)
            if len(stops) >= MAX_STOPS_PER_DAY:
                break
        if stops:
            days.append({"title": tidy(d.get("title"), 40), "stops": stops, "detail_status": "none", "detail": None})

    # A place the reel named is never left out, whatever the model did.
    missing = [r for r in reel if not any(same_place(r["name"], x) for x in seen)]
    if missing:
        if not days:
            days.append({"title": "", "stops": [], "detail_status": "none", "detail": None})
        for r in missing:
            stop = {"name": r["name"], "from_reel": True, "kind": r.get("kind") or "sight", "part": "afternoon",
                    "area": "", "what": tidy(r.get("why"), 140), "minutes": 60, "cost": "", "cost_source": 0,
                    "hours": "", "hours_source": 0, "booking": "unknown", "booking_source": 0, "source": 0}
            if r.get("start_local"):
                stop["start_local"] = r["start_local"]
            days[-1]["stops"].append(stop)
    for d in days:
        d["stops"].sort(key=lambda s: PARTS.index(s["part"]))

    stay = raw.get("stay") or {}
    stay_src = _src(stay.get("source"), n_sources)
    heads = [{"text": tidy(h.get("text"), 160), "source": _src(h.get("source"), n_sources)}
             for h in (raw.get("heads_up") or [])[:4] if isinstance(h, dict)]
    return {
        "city": tidy(raw.get("city"), 60), "region": tidy(raw.get("region"), 60),
        "country": tidy(raw.get("country"), 60),
        "weather_place": tidy(raw.get("weather_place") or raw.get("city"), 60),
        "days": days,
        "stay": {"area": tidy(stay.get("area"), 60), "why": tidy(stay.get("why"), 140), "source": stay_src}
        if stay_src and stay.get("area") else None,
        "heads_up": [h for h in heads if h["text"] and h["source"]],
    }


def clean_day(raw: dict, day: dict, n_sources: int) -> dict:
    """A day's extra detail, keeping only lines with a source."""
    stops = []
    for s in day["stops"]:
        got = next((x for x in raw.get("stops") or [] if same_place(str(x.get("name")), s["name"])), {})
        highlights = [{"text": tidy(h.get("text"), 150), "source": _src(h.get("source"), n_sources)}
                      for h in (got.get("highlights") or [])[:3] if isinstance(h, dict)]
        book_src = _src(got.get("book_source"), n_sources)
        stops.append({"name": s["name"], "highlights": [h for h in highlights if h["text"] and h["source"]],
                      "book": tidy(got.get("book"), 140) if book_src else "", "book_source": book_src})
    names = [s["name"] for s in day["stops"]]
    eat = []
    for e in (raw.get("eat") or [])[:2]:
        src = _src(e.get("source"), n_sources) if isinstance(e, dict) else 0
        name = tidy(e.get("name"), 70) if isinstance(e, dict) else ""
        if src and name and not any(same_place(name, n) for n in names):
            eat.append({"name": name, "why": tidy(e.get("why"), 140), "near": tidy(e.get("near"), 60), "source": src})

    def one(key: str) -> dict | None:
        v = raw.get(key) or {}
        src = _src(v.get("source"), n_sources)
        text = tidy(v.get("text"), 180)
        return {"text": text, "source": src} if src and text else None

    return {"stops": stops, "eat": eat, "rain": one("rain"), "around": one("around")}


def schedule(stops: list[dict], day: date, tz) -> None:
    """Clock times, set in code: each part of the day has a start, a stop runs for its
    minutes, and GAP_MIN is left to get to the next one. A stop with its own start time
    (an event) keeps it."""
    cursor: datetime | None = None
    for s in stops:
        begin = datetime.combine(day, PART_START[s["part"]], tzinfo=tz)
        fixed = None
        if s.get("start_local"):
            try:
                fixed = parse_local(s["start_local"], tz)
            except (ValueError, TypeError):
                fixed = None
        if fixed and fixed.date() == day:
            begin = fixed
        elif cursor and cursor > begin:
            begin = cursor
        end = begin + timedelta(minutes=int(s.get("minutes") or 60))
        s["start_utc"], s["end_utc"] = as_utc(begin), as_utc(end)
        cursor = end + timedelta(minutes=GAP_MIN)


def apply_dates(trip: dict, start: date, user: dict) -> None:
    tz = tz_of(user)
    trip["start_date"] = start.isoformat()
    for i, d in enumerate(trip["days"]):
        day = start + timedelta(days=i)
        d["date"] = day.isoformat()
        schedule(d["stops"], day, tz)


# ---------- links (all built in code) ----------


def maps_url(name: str, city: str) -> str:
    q = ", ".join(x for x in (name, city) if x)
    return get_settings().maps_search_url + "?" + urlencode({"api": 1, "query": q}, quote_via=quote)


def directions_url(origin: str, destination: str, city: str) -> str:
    def full(n: str) -> str:
        return ", ".join(x for x in (n, city) if x)
    return get_settings().maps_directions_url + "?" + urlencode(
        {"api": 1, "origin": full(origin), "destination": full(destination)}, quote_via=quote)


def _stop_notes(stop: dict) -> str:
    return "\n".join(x for x in (stop.get("what"), stop.get("hours") and f"Open: {stop['hours']}",
                                 stop.get("cost") and f"Cost: {stop['cost']}") if x)


def stop_gcal(stop: dict, city: str) -> str | None:
    if not stop.get("start_utc"):
        return None
    return actions.gcal_url({"device_actions": {"event": {
        "title": stop["name"], "start_utc": stop["start_utc"], "end_utc": stop["end_utc"],
        "notes": _stop_notes(stop), "location": ", ".join(x for x in (stop["name"], city) if x)}}})


def day_ics(trip: dict, index: int, *, now: datetime | None = None) -> str | None:
    """One calendar file for a day: an event per stop, at the suggested times."""
    days = trip.get("days") or []
    if not 0 <= index < len(days):
        return None
    s = get_settings()
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:-//{s.app_name}//Trips//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    n = 0
    for i, stop in enumerate(days[index]["stops"]):
        if not stop.get("start_utc"):
            continue
        n += 1
        loc = ", ".join(x for x in (stop["name"], trip.get("city")) if x)
        lines += ["BEGIN:VEVENT", f"UID:{trip['_id']}-{index}-{i}@{s.app_name.lower()}",
                  f"DTSTAMP:{actions._z(now or now_utc())}",
                  f"DTSTART:{actions._z(stop['start_utc'])}", f"DTEND:{actions._z(stop['end_utc'])}",
                  f"SUMMARY:{actions._ics_escape(stop['name'])}",
                  f"LOCATION:{actions._ics_escape(loc)}",
                  f"DESCRIPTION:{actions._ics_escape(_stop_notes(stop))}", "END:VEVENT"]
    if not n:
        return None
    lines.append("END:VCALENDAR")
    folded: list[str] = []
    for line in lines:
        folded += actions._fold(line)
    return "\r\n".join(folded) + "\r\n"


# ---------- Gemini ----------


def _resolve(url: str) -> str:
    """Search results come back as redirect links. Follow one hop so the saved link is the
    real page; keep the redirect if that fails."""
    try:
        r = httpx.head(url, follow_redirects=False, timeout=4.0)
        loc = r.headers.get("location")
        if loc and loc.startswith("http"):
            return loc
    except Exception:  # noqa: BLE001
        pass
    return url


def research(prompt: str, sources: list[dict], timeout_s: float = 75) -> str:
    """One search-grounded call. Returns the notes with [n] markers; new sources are appended."""
    it = gemini.create_interaction(timeout_s, role="fast", store=False, input=prompt,
                                   tools=[{"type": "google_search"}],
                                   generation_config={"thinking_level": "low"})
    before = len(sources)
    parts: list[str] = []
    for step in getattr(it, "steps", None) or []:
        if getattr(step, "type", None) != "model_output":
            continue
        for block in getattr(step, "content", None) or []:
            if getattr(block, "type", None) != "text":
                continue
            text = getattr(block, "text", "") or ""
            anns = [{"url": getattr(a, "url", None), "title": getattr(a, "title", None),
                     "end": getattr(a, "end_index", None)}
                    for a in (getattr(block, "annotations", None) or [])
                    if getattr(a, "type", None) == "url_citation"]
            parts.append(cite(text, anns, sources))
    new = sources[before:]
    if new:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for s, real in zip(new, pool.map(_resolve, [s["url"] for s in new])):
                s["url"] = real
    return "\n".join(parts).strip()


def _reel_block(save: dict, reel: list[dict]) -> str:
    handle = (save.get("creator") or {}).get("handle")
    lines = [f"REEL: {save.get('title') or ''}" + (f" (by @{handle})" if handle else ""),
             f"SUMMARY: {save.get('summary') or ''}", "PLACES NAMED IN THE REEL:"]
    for r in reel:
        bits = [r["name"], f"({r['kind']})"]
        if r.get("city"):
            bits.append(f"in {r['city']}")
        if r.get("why"):
            bits.append(f": {r['why']}")
        lines.append("- " + " ".join(bits))
    return "\n".join(lines)


def _source_block(sources: list[dict]) -> str:
    return "\n".join(f"[{s['n']}] {s['title']}" for s in sources) or "(none)"


def propose_trip(save: dict, reel: list[dict], when: str, sources: list[dict]) -> tuple[dict, str]:
    notes = research(
        "You are researching a short trip for someone who saved an Instagram reel.\n"
        f"{_reel_block(save, reel)}\nWHEN: {when}\n\n"
        "Use Google Search and report short factual notes, one fact per line:\n"
        "1. Where this is: city, state or region, country.\n"
        "2. For each place named in the reel: the entry price or typical spend per person, the opening "
        "hours on those days, and whether booking is needed and where.\n"
        "3. Four to six other well-known places within a short walk or ride that fit the same trip: "
        "what each is, why go, price or typical spend, hours.\n"
        "4. The neighborhood to stay in for an overnight visit, and anything a visitor should know for "
        "those dates (closures, seasonal changes).\n"
        "Only report what the search results say. Write \"not found\" for anything you can't find. "
        "No introduction and no closing remarks.", sources)
    raw = gemini.generate_json(
        role="fast", schema=TRIP_SCHEMA, timeout_s=60,
        system=("You turn research notes into a day-by-day trip plan. Rules:\n"
                "- Include every place named in the reel, with added_source 0.\n"
                "- Add other places only if the notes describe them. Put the [n] number that backs the "
                "place in added_source.\n"
                "- One day for up to four stops, two days for five to eight, three days for more. Group "
                "stops that are near each other and order each day so it flows from morning to evening.\n"
                "- cost, hours and booking: copy them from the notes, kept short (\"$25 to $40 per person\", "
                "\"10 am to 6 pm\"), with the [n] number that backs each in its _source field. When the "
                "notes don't say, leave the text empty and the source 0. Never estimate.\n"
                "- what: one sentence, at most 120 characters, on what to do there.\n"
                "- minutes: how long a visit usually takes, 30 to 240.\n"
                "- Do not put [n] markers inside any text field.\n- " + PLAIN_WORDS),
        input=f"{_reel_block(save, reel)}\nWHEN: {when}\n\nRESEARCH NOTES:\n{notes}\n\nSOURCES:\n{_source_block(sources)}")
    return raw, notes


def propose_day(save: dict, trip: dict, day: dict, sources: list[dict]) -> dict:
    stops = "\n".join(f"- {s['name']} ({PART_LABEL[s['part']].lower()}): {s['what']}" for s in day["stops"])
    where = ", ".join(x for x in (trip.get("city"), trip.get("region"), trip.get("country")) if x)
    when = heading_day(date.fromisoformat(day["date"]))
    notes = research(
        f"Someone is spending {when} in {where}. Their stops, in order:\n{stops}\n\n"
        "Use Google Search and report short factual notes, one fact per line:\n"
        "1. For each stop: two or three specific things to see, do or order there, and how to book "
        "if booking is needed.\n"
        "2. Two places to eat or get a drink between or near these stops, with what they're known for.\n"
        "3. What to do nearby instead if it rains.\n"
        "4. The easiest way to get between these stops (walk, a transit line, a ferry, a short ride).\n"
        "Only report what the search results say. No introduction and no closing remarks.", sources)
    return gemini.generate_json(
        role="fast", schema=DAY_SCHEMA, timeout_s=60,
        system=("You turn research notes into the detail for one day of a trip. Rules:\n"
                "- stops: the same stops, same names, same order. For each, up to three highlights from "
                "the notes, each one sentence with the [n] number that backs it in source.\n"
                "- book: how to book, only if the notes say, with its [n] number in book_source.\n"
                "- eat: up to two places from the notes that are not already stops.\n"
                "- rain and around: one sentence each from the notes, with source.\n"
                "- Leave out anything the notes don't back. Never estimate prices or times.\n"
                "- Do not put [n] markers inside any text field.\n- " + PLAIN_WORDS),
        input=f"DAY: {when} in {where}\nSTOPS:\n{stops}\n\nRESEARCH NOTES:\n{notes}\n\nSOURCES:\n{_source_block(sources)}")


# ---------- storage and the two builds ----------


def get_for_save(save_id: ObjectId, user_id: str) -> dict | None:
    return db.trips().find_one({"save_id": save_id, "user_id": user_id})


def can_build(save: dict) -> bool:
    return save.get("type") in TRIP_TYPES and save.get("status") in ("planned", "enriching", "ready")


def _building(trip: dict | None) -> bool:
    if not trip or trip.get("status") != "building":
        return False
    return (now_utc() - as_utc(trip["updated_at"])).total_seconds() < STALE_BUILD_S


def _weather_into(trip: dict, user: dict) -> None:
    """Refresh the forecast for the trip's days. Failure leaves the trip without weather."""
    today = now_utc().astimezone(tz_of(user)).date()
    days = [date.fromisoformat(d["date"]) for d in trip["days"]]
    place = trip.get("weather_at")
    if not place and trip.get("weather_place"):
        place = weather.geocode(trip["weather_place"], trip.get("region") or "", trip.get("country") or "")
        if not place and trip.get("city") and trip["city"] != trip["weather_place"]:
            place = weather.geocode(trip["city"], trip.get("region") or "", trip.get("country") or "")
        trip["weather_at"] = place
    fahrenheit = str(user.get("timezone") or "").startswith(("America/", "US/"))
    trip["weather"] = weather.forecast(place, days, fahrenheit=fahrenheit, today=today)
    trip["weather_checked"] = now_utc()


def start_build(save: dict, user: dict, start: date | None = None) -> dict:
    """Mark the trip as building and return it; the caller runs build() in the background."""
    now = now_utc()
    doc = {"status": "building", "error": None, "updated_at": now,
           "start_date": (start or default_start(save, user)).isoformat()}
    insert = {"user_id": user["_id"], "save_id": save["_id"], "created_at": now,
              "share_token": secrets.token_urlsafe(16)[:22], "days": [], "sources": []}
    if user.get("expires_at"):
        insert["expires_at"] = user["expires_at"]
    db.trips().update_one({"save_id": save["_id"], "user_id": user["_id"]},
                          {"$set": doc, "$setOnInsert": insert}, upsert=True)
    return get_for_save(save["_id"], user["_id"])


def build(save_id: ObjectId, user_id: str) -> None:
    """Research, lay out the days, date them, fetch the forecast. Runs in the background."""
    save = db.saves().find_one({"_id": save_id, "user_id": user_id})
    user = db.users().find_one({"_id": user_id})
    trip = get_for_save(save_id, user_id) if save and user else None
    if not save or not user or not trip:
        return
    run = runs.Run(user, save_id, "trip", get_settings().gemini_model_fast)
    try:
        reel = reel_stops(save)
        start = date.fromisoformat(trip["start_date"])
        sources: list[dict] = []
        with run.step("trip_research", {"places": [r["name"] for r in reel]}) as h:
            raw, _notes = propose_trip(save, reel, f"around {heading_day(start)}, {start.year}", sources)
            h["result"] = {"sources": len(sources)}
        with run.step("trip_layout") as h:
            plan = clean_trip(raw, reel, len(sources))
            if not plan["days"]:
                raise ValueError("no days")
            plan.update({"sources": sources})
            apply_dates(plan, start, user)
            h["result"] = {"days": len(plan["days"]), "stops": sum(len(d["stops"]) for d in plan["days"])}
        with run.step("trip_weather") as h:
            _weather_into(plan, user)
            h["result"] = {"days_with_forecast": len(plan.get("weather") or {})}
        db.trips().update_one({"_id": trip["_id"], "user_id": user_id},
                              {"$set": {**plan, "status": "ready", "error": None, "updated_at": now_utc()}})
        run.finish("done")
    except Exception as e:  # noqa: BLE001 - the person sees one line and can try again
        log.warning("trip build failed for save %s: %s", save_id, str(e)[:200])
        db.trips().update_one({"_id": trip["_id"], "user_id": user_id},
                              {"$set": {"status": "failed", "error": BUILD_FAILED, "updated_at": now_utc()}})
        run.finish("failed", str(e)[:300])


def start_day(trip: dict, index: int) -> None:
    db.trips().update_one({"_id": trip["_id"], "user_id": trip["user_id"]},
                          {"$set": {f"days.{index}.detail_status": "building",
                                    f"days.{index}.detail_started": now_utc()}})


def build_day(save_id: ObjectId, user_id: str, index: int) -> None:
    """Tap a day: research that day's stops and add the detail under it."""
    save = db.saves().find_one({"_id": save_id, "user_id": user_id})
    user = db.users().find_one({"_id": user_id})
    trip = get_for_save(save_id, user_id) if save and user else None
    if not save or not user or not trip or not 0 <= index < len(trip.get("days") or []):
        return
    run = runs.Run(user, save_id, "trip", get_settings().gemini_model_fast)
    try:
        sources = list(trip.get("sources") or [])
        day = trip["days"][index]
        with run.step("trip_day", {"day": day["date"], "stops": [s["name"] for s in day["stops"]]}) as h:
            detail = clean_day(propose_day(save, trip, day, sources), day, len(sources))
            h["result"] = {"highlights": sum(len(s["highlights"]) for s in detail["stops"]),
                           "eat": len(detail["eat"])}
        db.trips().update_one({"_id": trip["_id"], "user_id": user_id},
                              {"$set": {f"days.{index}.detail": detail, f"days.{index}.detail_status": "ready",
                                        "sources": sources, "updated_at": now_utc()}})
        run.finish("done")
    except Exception as e:  # noqa: BLE001
        log.warning("trip day build failed for save %s day %s: %s", save_id, index, str(e)[:200])
        db.trips().update_one({"_id": trip["_id"], "user_id": user_id},
                              {"$set": {f"days.{index}.detail_status": "failed", "updated_at": now_utc()}})
        run.finish("failed", str(e)[:300])


def redate(trip: dict, user: dict, start: date) -> dict:
    """Move the trip to other dates: new clock times and a new forecast, no model call."""
    apply_dates(trip, start, user)
    _weather_into(trip, user)
    db.trips().update_one({"_id": trip["_id"], "user_id": user["_id"]},
                          {"$set": {"start_date": trip["start_date"], "days": trip["days"],
                                    "weather": trip.get("weather") or {}, "weather_at": trip.get("weather_at"),
                                    "weather_checked": trip["weather_checked"], "updated_at": now_utc()}})
    return trip


# ---------- what the API returns ----------


def _source_view(n: int, by_n: dict[int, dict]) -> dict | None:
    s = by_n.get(n)
    return {"n": s["n"], "title": s.get("title") or "", "url": s["url"]} if s else None


def view(trip: dict | None, save: dict, user: dict) -> dict:
    """The trip as the Reel page shows it. Every label, time and link is made here."""
    base = {"status": "none", "can_build": can_build(save), "error": None, "steps": [], "trip": None}
    if not trip:
        return base
    status = trip.get("status") or "none"
    if status == "building" and not _building(trip):
        status, trip = "failed", {**trip, "error": BUILD_FAILED}
    run = db.agent_runs().find_one({"save_id": save["_id"], "user_id": user["_id"], "kind": "trip"},
                                   sort=[("started_at", -1)])
    base.update({"status": status, "error": trip.get("error"),
                 "steps": runs.step_views(run) if status == "building" else []})
    if status != "ready" and not trip.get("days"):
        return base

    tz = tz_of(user)
    today = now_utc().astimezone(tz).date()
    checked = trip.get("weather_checked")
    if status == "ready" and (not checked or (now_utc() - as_utc(checked)).total_seconds() > WEATHER_TTL_S):
        try:
            _weather_into(trip, user)
            db.trips().update_one({"_id": trip["_id"], "user_id": user["_id"]},
                                  {"$set": {"weather": trip.get("weather") or {},
                                            "weather_at": trip.get("weather_at"),
                                            "weather_checked": trip["weather_checked"]}})
        except Exception:  # noqa: BLE001
            pass

    s = get_settings()
    by_n = {x["n"]: x for x in trip.get("sources") or []}
    used: set[int] = set()

    def src(n: int) -> dict | None:
        v = _source_view(n, by_n)
        if v:
            used.add(n)
        return v

    city = trip.get("city") or ""
    forecast = trip.get("weather") or {}
    days = []
    for i, d in enumerate(trip.get("days") or []):
        day = date.fromisoformat(d["date"])
        stops = []
        for j, st in enumerate(d["stops"]):
            begin = as_utc(st["start_utc"]).astimezone(tz) if st.get("start_utc") else None
            nxt = d["stops"][j + 1] if j + 1 < len(d["stops"]) else None
            stops.append({
                "name": st["name"], "from_reel": st["from_reel"], "kind": st["kind"],
                "part": PART_LABEL[st["part"]], "time": fmt_time(begin) if begin else "",
                "area": st.get("area") or "", "what": st.get("what") or "",
                "cost": st.get("cost") or "", "cost_source": src(st.get("cost_source") or 0),
                "hours": st.get("hours") or "", "hours_source": src(st.get("hours_source") or 0),
                "booking": st.get("booking") or "unknown", "booking_source": src(st.get("booking_source") or 0),
                "source": src(st.get("source") or 0),
                "maps_url": maps_url(st["name"], city), "gcal_url": stop_gcal(st, city),
                "next_directions_url": directions_url(st["name"], nxt["name"], city) if nxt else None,
            })
        dstatus = d.get("detail_status") or "none"
        started = d.get("detail_started")
        if dstatus == "building" and started and (now_utc() - as_utc(started)).total_seconds() > STALE_BUILD_S:
            dstatus = "failed"
        detail = None
        if d.get("detail"):
            dd = d["detail"]

            def one(v: dict | None) -> dict | None:
                return {"text": v["text"], "source": src(v["source"])} if v else None

            detail = {
                "stops": [{"name": x["name"], "book": x.get("book") or "", "book_source": src(x.get("book_source") or 0),
                           "highlights": [{"text": h["text"], "source": src(h["source"])} for h in x["highlights"]]}
                          for x in dd["stops"]],
                "eat": [{"name": e["name"], "why": e["why"], "near": e.get("near") or "",
                         "source": src(e["source"]), "maps_url": maps_url(e["name"], city)} for e in dd["eat"]],
                "rain": one(dd.get("rain")), "around": one(dd.get("around")),
            }
        days.append({
            "index": i, "date": d["date"], "label": heading_day(day), "title": d.get("title") or "",
            "weather": forecast.get(d["date"]),
            "stops": stops, "detail_status": dstatus,
            "detail_error": DAY_FAILED if dstatus == "failed" else None, "detail": detail,
            "ics_url": f"/api/public/trips/{trip['_id']}/days/{i}/ics?t={trip.get('share_token')}",
        })

    n_days = len(days)
    start = date.fromisoformat(trip["start_date"])
    is_event = save.get("type") == "event"
    options = [] if is_event else [{"start_date": o.isoformat(), "label": span_label(o, n_days)}
                                   for o in date_options(user)]
    dates = [date.fromisoformat(d["date"]) for d in days]
    weather_note = None
    if not forecast and dates and max(dates) >= today:
        opens = min(dates) - timedelta(days=weather.FORECAST_DAYS)
        weather_note = (f"The forecast opens on {month_day(opens)}." if opens > today
                        else "No forecast for these dates right now.")
    stay = trip.get("stay")
    base["trip"] = {
        "id": str(trip["_id"]), "city": ", ".join(x for x in (city, trip.get("region")) if x),
        "start_date": trip["start_date"], "date_label": span_label(start, n_days),
        "date_options": options, "dates_fixed": is_event, "days": days,
        "stay": {"area": stay["area"], "why": stay["why"], "source": src(stay["source"]),
                 "maps_url": maps_url("hotels near " + stay["area"], city)} if stay else None,
        "heads_up": [{"text": h["text"], "source": src(h["source"])} for h in trip.get("heads_up") or []],
        "weather_note": weather_note,
        "weather_source": {"title": "Open-Meteo", "url": s.weather_source_url} if forecast else None,
        "times_note": "Times are suggestions. Check opening hours before you go.",
    }
    base["trip"]["sources"] = [_source_view(n, by_n) for n in sorted(used)]
    return base
