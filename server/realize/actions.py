"""Options, menu labels, device actions, ICS and Google Calendar links (SPEC 8.5).

Everything here is deterministic. The planner picks type, fields and slots;
this module turns them into what the user taps and what lands on the device.
"""
from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta
from urllib.parse import quote, urlencode

from .config import get_settings
from .slots import DEFAULT_DURATION, adjust_reminder, load_accepted, reminder_due
from .timeutil import (
    as_utc, big_time, fmt_text, fmt_time, long_day, month_day, now_utc, parse_local,
    short_day, tz_of,
)

LABEL_MAX = 38
EXTRAS_ACTIONABLE = [{"id": "later", "label": "Not now"}, {"id": "none", "label": "Just vibes"}]
EXTRAS_PASSIVE = [{"id": "none", "label": "Just save"}]
CHECK_DATES = "Remind me to check dates"
GUESS_TIME = time(19, 0)   # SPEC planner rule: a date with no time is planned for 7 pm, best guess
LONG_RUN_DAYS = 3          # a run longer than this is a season, not a few performances
IN_A_WEEK = "Remind me in a week"
# The two reasons build_options gives an event whose dates are behind us. The plan keeps
# only actionable False and this reason, so is_missed reads them back from here.
PASSED = "It's passed."
LAST_DAY = "Today was the last day."


# ---------- small field helpers ----------


def _f(fields: dict | None, kind: str) -> dict:
    v = (fields or {}).get(kind)
    return v if isinstance(v, dict) else {}


def ingredients(fields: dict | None) -> list[dict]:
    return [i for i in (_f(fields, "recipe").get("ingredients") or []) if isinstance(i, dict) and i.get("item")]


def fmt_qty(q) -> str:
    if q is None or q == "":
        return ""
    try:
        x = float(q)
    except (TypeError, ValueError):
        return str(q)
    return str(int(x)) if x == int(x) else f"{x:g}"


def ingredient_line(i: dict) -> str:
    parts = [fmt_qty(i.get("qty")), (i.get("unit") or "").strip(), (i.get("item") or "").strip()]
    return " ".join(p for p in parts if p)


def first_place(fields: dict | None) -> dict:
    places = _f(fields, "place").get("places") or []
    return places[0] if places and isinstance(places[0], dict) else {}


def first_item(fields: dict | None) -> dict:
    items = _f(fields, "product").get("items") or []
    return items[0] if items and isinstance(items[0], dict) else {}


def recipe_duration(fields: dict | None) -> int:
    t = _f(fields, "recipe").get("total_time_min")
    try:
        return max(30, min(int(t), 120)) if t else 60
    except (TypeError, ValueError):
        return 60


def workout_duration(fields: dict | None) -> int:
    t = _f(fields, "workout").get("duration_min")
    try:
        return max(10, min(int(t), 180)) if t else 45
    except (TypeError, ValueError):
        return 45


def fix_event_year(fields: dict | None, posted_at: datetime | None) -> dict | None:
    """Models sometimes write an event date in a past year ("2023-11-14" for a reel posted in
    2026). An event can't start years before its own announcement, so a start more than 60
    days before the post is moved to the post's year (or the next, if that is still earlier).
    The end moves by the same number of years. Returns the same fields dict."""
    ev = (fields or {}).get("event")
    if not isinstance(ev, dict) or not ev.get("start_local") or not posted_at:
        return fields
    try:
        start = datetime.fromisoformat(str(ev["start_local"])[:16])
    except ValueError:
        return fields
    post = as_utc(posted_at).replace(tzinfo=None)
    if start >= post - timedelta(days=60):
        return fields
    shift = post.year - start.year
    try:
        if start.replace(year=start.year + shift) < post - timedelta(days=60):
            shift += 1
        ev["start_local"] = start.replace(year=start.year + shift).strftime("%Y-%m-%dT%H:%M")
        if ev.get("end_local"):
            end = datetime.fromisoformat(str(ev["end_local"])[:16])
            ev["end_local"] = end.replace(year=end.year + shift).strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        pass
    return fields


_MONTH_NUM = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_CLOCK = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b", re.I)
_ISO_DATE = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
_SLASH_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
_DATE_TOKEN = re.compile(
    r"\b(?P<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b"
    r"|\b(?P<year>20\d{2})\b"
    r"|\b(?P<day>\d{1,2})(?:st|nd|rd|th)?\b", re.I)


_JOINS_DAYS = re.compile(r"^\.?\s*(?:,|and|&|[-–—]|to|through|thru|until|till|the)?\s*$", re.I)
_BEFORE_MONTH = re.compile(r"^\s*(?:of)?\s*$", re.I)


def event_date_range(fields: dict | None, today: date, posted_at: datetime | None = None,
                     ) -> tuple[date, date] | None:
    """First and last day named in an event's date_text ("November 13th and 14th",
    "Nov 28 through Jan 3", "11/14"), or None when no day can be read.

    Used when the event has no start_local. A date with no year is read in the year of the
    post (or of today); if that lands more than 60 days before it, the next year is meant.
    A later date that falls before an earlier one has crossed into the next year.
    """
    text = str(_f(fields, "event").get("date_text") or "")
    if not text.strip():
        return None
    ref = as_utc(posted_at).date() if posted_at else today
    found: list[tuple[int | None, int, int]] = []  # (year or None, month, day)

    def take_iso(m: re.Match) -> str:
        found.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
        return " "

    def take_slash(m: re.Match) -> str:
        year = int(m.group(3)) if m.group(3) else None
        if year is not None and year < 100:
            year += 2000
        found.append((year, int(m.group(1)), int(m.group(2))))
        return " "

    text = _CLOCK.sub(" ", text)
    text = _ISO_DATE.sub(take_iso, text)
    text = _SLASH_DATE.sub(take_slash, text)

    # A number is a day only when it sits right next to a month or is joined to another day
    # ("13th and 14th", "13, 14"). That keeps "doors at 7" and "ages 12 and up" out.
    month: int | None = None
    waiting: list[int] = []  # days written before their month ("13 and 14 November")
    year: int | None = None
    named: list[tuple[int, int]] = []
    prev_end: int | None = None  # where the last month or day token ended
    for m in _DATE_TOKEN.finditer(text):
        gap = text[prev_end:m.start()] if prev_end is not None else None
        if m.group("month"):
            if waiting and not _BEFORE_MONTH.match(gap or ""):
                waiting = []
            month = _MONTH_NUM[m.group("month")[:3].lower()]
            named += [(month, d) for d in waiting]
            waiting = []
            prev_end = m.end()
        elif m.group("year"):
            year = year or int(m.group("year"))
        else:
            d = int(m.group("day"))
            if not 1 <= d <= 31:
                continue
            joined = gap is not None and bool(_JOINS_DAYS.match(gap))
            if month is not None and joined:
                named.append((month, d))
            else:
                # Not attached to the month before it: maybe the start of "13 and 14 November".
                waiting = waiting + [d] if (waiting and joined) else [d]
                month = None
            prev_end = m.end()
    found += [(year, mo, d) for mo, d in named]

    days: list[date] = []
    for y, mo, d in found:
        try:
            day = date(y or ref.year, mo, d)
            if y is None and day < ref - timedelta(days=60):
                day = date(ref.year + 1, mo, d)
            if y is None and days and day < days[-1]:
                day = date(day.year + 1, mo, d)
        except ValueError:
            continue
        days.append(day)
    if not days:
        return None
    return min(days), max(days)


def event_has_end(fields: dict | None) -> bool:
    return bool(_f(fields, "event").get("end_local"))


def event_times(fields: dict | None, user: dict) -> tuple[datetime | None, datetime | None]:
    """Event start and end as aware local datetimes, or (None, None)."""
    ev = _f(fields, "event")
    tz = tz_of(user)
    try:
        start = parse_local(ev["start_local"], tz) if ev.get("start_local") else None
    except (ValueError, TypeError):
        start = None
    if start is None:
        return None, None
    try:
        end = parse_local(ev["end_local"], tz) if ev.get("end_local") else None
    except (ValueError, TypeError):
        end = None
    if end is None or end <= start:
        end = start + timedelta(hours=2)
    return start, end


def _clip(s: str, n: int) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _unique(options: list[dict]) -> list[dict]:
    seen: dict[str, int] = {}
    for o in options:
        o["label"] = _clip(o["label"], LABEL_MAX)
        key = o["label"].lower()
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            suffix = f" ({seen[key]})"
            o["label"] = _clip(o["label"], LABEL_MAX - len(suffix)) + suffix
    return options


def _opt(i: int, action: str, start_utc: datetime, duration_min: int, label: str,
         web_label: str, big: str, secondary: str) -> dict:
    return {
        "id": f"opt_{i}", "action": action, "start_utc": as_utc(start_utc),
        "duration_min": int(duration_min), "label": label, "web_label": web_label,
        "big_time": big, "secondary": secondary,
    }


# ---------- options ----------


def build_options(
    kind: str,
    title: str,
    fields: dict | None,
    user: dict,
    *,
    slots: list[dict] | None = None,
    now: datetime | None = None,
    accepted: list[dict] | None = None,
    posted_at: datetime | None = None,
) -> dict:
    """Options for a plan. Returns {options, actionable, why}; actionable and why
    are None unless the code has to override the planner (a past event)."""
    tz = tz_of(user)
    now_u = as_utc(now or now_utc())
    now_l = now_u.astimezone(tz)
    if accepted is None:
        accepted = load_accepted(user["_id"])
    slots = slots or []
    out: list[dict] = []
    override: dict = {"actionable": None, "why": None}

    def local(dt: datetime) -> datetime:
        return as_utc(dt).astimezone(tz)

    def rem(case: str) -> datetime:
        return reminder_due(case, user, now=now_u, accepted=accepted)

    if kind == "recipe":
        n = len(ingredients(fields))
        dur = recipe_duration(fields)
        for i, s in enumerate(slots[:2], 1):
            st = local(s["start_utc"])
            label = f"Cook {short_day(st, now_l)} {fmt_time(st)}" + (f" + {n} groceries" if n else "")
            out.append(_opt(i, "event", st, dur, label, f"Add to {long_day(st, now_l)}",
                            big_time(st, now_l), f"+{n} groceries" if n else ""))
    elif kind == "workout":
        dur = workout_duration(fields)
        for i, s in enumerate(slots[:2], 1):
            st = local(s["start_utc"])
            out.append(_opt(i, "event", st, dur, f"Train {short_day(st, now_l)} {fmt_time(st)}",
                            f"Add to {long_day(st, now_l)}", big_time(st, now_l), f"{dur} min"))
    elif kind == "place":
        name = first_place(fields).get("name") or title
        i = 1
        if slots:
            st = local(slots[0]["start_utc"])
            out.append(_opt(i, "event", st, DEFAULT_DURATION["place"],
                            f"Visit {short_day(st, now_l)} {fmt_time(st)}",
                            f"Add to {long_day(st, now_l)}", big_time(st, now_l), _clip(name, 40)))
            i += 1
        due = local(rem("place"))
        out.append(_opt(i, "reminder", due, 15, f"Remind me {short_day(due, now_l)}",
                        f"Remind me {long_day(due, now_l)}", big_time(due, now_l), _clip(name, 40)))
    elif kind == "event":
        start, end = event_times(fields, user)
        ev = _f(fields, "event")
        days = event_date_range(fields, now_l.date(), posted_at) if start is None else None
        if start is None and days is not None:
            # The video read the days but no start time ("November 13th and 14th"), so the
            # code works from the days alone instead of asking to "check dates".
            first, last = days
            today = now_l.date()
            venue = _clip(ev.get("venue") or "", 40)
            span = month_day(first) if first == last else f"{month_day(first)} to {month_day(last)}"

            def remind(due: datetime, why: str) -> dict:
                moved = adjust_reminder(due, user, [])  # out of quiet hours
                if moved.date() <= last:
                    due = moved
                out.append(_opt(1, "reminder", due, 15, f"Remind me {short_day(due, now_l)}",
                                f"Remind me {long_day(due, now_l)}", big_time(due, now_l), venue or "Reminder"))
                return {"actionable": None, "why": why}

            if last < today:
                override = {"actionable": False, "why": f"This was on {span}. {PASSED}"}
            elif (last - first).days > LONG_RUN_DAYS:
                # A long run (a market, a holiday show) has no single evening to book.
                if first > today:
                    due = datetime.combine(first - timedelta(days=1), time(18, 0), tzinfo=tz)
                    if due < now_l + timedelta(hours=1):
                        due = datetime.combine(first, time(9, 0), tzinfo=tz)
                    override = remind(due, f"It runs {span}.")
                else:
                    due = local(rem("place"))  # next Saturday
                    if due.date() > last:
                        due = datetime.combine(today + timedelta(days=1), time(10, 0), tzinfo=tz)
                    override = remind(due, f"It runs until {month_day(last)}.")
            else:
                # One to a few days: same rule the planner follows for a date with no time,
                # 7 pm as a best guess, on the next of its days that is still ahead.
                day = max(first, today)
                guess = datetime.combine(day, GUESS_TIME, tzinfo=tz)
                if guess <= now_l + timedelta(minutes=30):
                    day += timedelta(days=1)
                    guess = datetime.combine(day, GUESS_TIME, tzinfo=tz)
                if day > last:
                    override = {"actionable": False, "why": LAST_DAY}
                else:
                    out.append(_opt(1, "event", guess, 120, f"Add {big_time(guess, now_l)}",
                                    "Add to calendar", big_time(guess, now_l), venue))
                    override = {"actionable": None,
                                "why": f"It's on {span}. The reel gives no time, so 7 pm is a guess."}
        elif start is None:
            due = local(rem("event_no_date"))
            out.append(_opt(1, "reminder", due, 15, CHECK_DATES, CHECK_DATES,
                            big_time(due, now_l), "Reminder"))
        elif start <= now_l and event_has_end(fields) and end > now_l + timedelta(days=1):
            # Already open and still running (a show, a market): no single start to put on the
            # calendar, so offer a weekend reminder and say how long it runs.
            due = local(rem("place"))
            out.append(_opt(1, "reminder", due, 15, f"Remind me {short_day(due, now_l)}",
                            f"Remind me {long_day(due, now_l)}", big_time(due, now_l),
                            _clip(ev.get("venue") or "Reminder", 40)))
            override = {"actionable": None, "why": f"It runs until {month_day(end)}."}
        elif start <= now_l:
            override = {"actionable": False, "why": f"This was on {month_day(start)}. {PASSED}"}
        else:
            dur = int((end - start).total_seconds() // 60)
            out.append(_opt(1, "event", start, dur, f"Add {big_time(start, now_l)}",
                            "Add to calendar", big_time(start, now_l), _clip(ev.get("venue") or "", 40)))
    elif kind == "product":
        due = local(rem("product"))
        out.append(_opt(1, "reminder", due, 15, f"Remind me {short_day(due, now_l)}",
                        f"Remind me {long_day(due, now_l)}", big_time(due, now_l), "Reminder"))
    else:  # tip, other
        due = local(rem("week"))
        out.append(_opt(1, "reminder", due, 15, IN_A_WEEK, IN_A_WEEK, big_time(due, now_l), "Reminder"))
    return {"options": _unique(out), **override}


def custom_option(kind: str, start_local: str, title: str, fields: dict | None, user: dict,
                  *, now: datetime | None = None) -> dict:
    """An option at a time the user picked on the web (Change). Raises ValueError if not in the future."""
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    st = parse_local(start_local, tz)
    if st <= now_l:
        raise ValueError("That time has passed. Pick a later one.")
    if kind in ("recipe", "workout", "place", "event"):
        if kind == "recipe":
            dur, verb, sec = recipe_duration(fields), "Cook", ""
        elif kind == "workout":
            dur = workout_duration(fields)
            verb, sec = "Train", f"{dur} min"
        elif kind == "place":
            dur, verb = DEFAULT_DURATION["place"], "Visit"
            sec = _clip(first_place(fields).get("name") or title, 40)
        else:
            start, end = event_times(fields, user)
            dur = int((end - start).total_seconds() // 60) if start else 120
            verb, sec = "Add", _clip(_f(fields, "event").get("venue") or "", 40)
        o = _opt(0, "event", st, dur, f"{verb} {short_day(st, now_l)} {fmt_time(st)}",
                 "Add to calendar" if kind == "event" else f"Add to {long_day(st, now_l)}",
                 big_time(st, now_l), sec)
    else:
        o = _opt(0, "reminder", st, 15, f"Remind me {short_day(st, now_l)}",
                 f"Remind me {long_day(st, now_l)}", big_time(st, now_l), "Reminder")
    o["id"] = "opt_custom"
    o["label"] = _clip(o["label"], LABEL_MAX)
    return o


def menu_for(plan: dict) -> list[str]:
    labels = [o["label"] for o in plan.get("options") or []]
    if plan.get("actionable"):
        return labels + ["Not now", "Just vibes"]
    return labels + ["Just save"]


def is_missed(plan: dict) -> bool:
    """A still-proposed event whose dates have passed (build_options said so): there is
    nothing left to plan, so Actions shows it under Missed instead of Waiting on you."""
    why = plan.get("why") or ""
    return (plan.get("status") == "proposed" and plan.get("kind") == "event"
            and not plan.get("actionable") and not plan.get("options")
            and (why.endswith(PASSED) or why == LAST_DAY))


def extras_for(plan: dict) -> list[dict]:
    return list(EXTRAS_ACTIONABLE if plan.get("actionable") else EXTRAS_PASSIVE)


def option_view(o: dict, kind: str, user: dict, *, now: datetime | None = None) -> dict:
    """Option as the web sees it, with day words recomputed for today."""
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    st = as_utc(o["start_utc"]).astimezone(tz)
    web = o.get("web_label") or o["label"]
    if o["action"] == "event":
        web = "Add to calendar" if kind == "event" else f"Add to {long_day(st, now_l)}"
    elif web not in (CHECK_DATES, IN_A_WEEK):
        web = f"Remind me {long_day(st, now_l)}"
    return {
        "id": o["id"], "label": o["label"], "web_label": web, "big_time": big_time(st, now_l),
        "secondary": o.get("secondary") or "", "action": o["action"],
        "start_local": st.strftime("%Y-%m-%dT%H:%M"),
    }


def match_choice(plan: dict, choice: str) -> tuple[str, dict | None]:
    """Resolve a confirm choice to ('option', opt) | ('later', None) | ('none', None) | ('nomatch', None)."""
    c = (choice or "").strip()
    cl = c.lower()
    for group in ("options", "options_prev"):
        for o in plan.get(group) or []:
            if o["id"] == c and group == "options":
                return "option", o
        for o in plan.get(group) or []:
            if o["label"].strip().lower() == cl:
                return "option", o
    if plan.get("chosen") and plan["chosen"].get("id") == c:
        return "option", plan["chosen"]
    if cl in ("later", "not now"):
        return "later", None
    if cl in ("none", "just vibes", "just save"):
        return "none", None
    return "nomatch", None


# ---------- device actions ----------


def plan_link(plan: dict) -> str:
    return f"{get_settings().public_base_url}/p/{plan['_id']}?t={plan['share_token']}"


def _followup(title: str, kind: str) -> str:
    return {"recipe": f"Did you make {title}?", "workout": f"Did you do {title}?"}.get(
        kind, f"Did you go to {title}?"
    )


def build_device_actions(plan: dict, save: dict, option: dict, user: dict,
                         *, now: datetime | None = None) -> dict:
    """What accepting this option puts on the device: at most 1 event and 2 reminders.

    Returns {event, reminders, scheduled_for, ends_at, followup_at}.
    """
    tz = tz_of(user)
    now_u = as_utc(now or now_utc())
    kind = plan["kind"]
    fields = save.get("fields") or {}
    title = save.get("title") or "Saved reel"
    link = plan_link(plan)
    start = as_utc(option["start_utc"])
    end = start + timedelta(minutes=int(option.get("duration_min") or 60))
    event: dict | None = None
    reminders: list[dict] = []
    followup_at: datetime | None = None

    def quiet_safe(dt: datetime) -> datetime:
        return as_utc(adjust_reminder(as_utc(dt).astimezone(tz), user, []))

    def add_followup(text: str) -> None:
        nonlocal followup_at
        followup_at = quiet_safe(end + timedelta(hours=2))
        reminders.append({"title": _clip(text, 120), "due_utc": followup_at, "notes": "",
                          "url": link, "short": "Check-in"})

    if option["action"] == "reminder":
        if kind == "place":
            p = first_place(fields)
            name = p.get("name") or title
            notes = "\n".join(x for x in (p.get("why"), p.get("tip")) if x)
            reminders.append({"title": f"Try {name}", "due_utc": start, "notes": notes, "url": link,
                              "short": "Reminder"})
        elif kind == "product":
            it = first_item(fields)
            name = it.get("name") or title
            notes = "\n".join(x for x in (it.get("price_hint"), it.get("where_to_buy"), it.get("url")) if x)
            reminders.append({"title": f"Look at {name}", "due_utc": start, "notes": notes, "url": link,
                              "short": "Reminder"})
        elif kind == "event":
            ev = _f(fields, "event")
            verb = "Check dates" if option.get("label") == CHECK_DATES else "Go to"
            notes = "\n".join(x for x in (ev.get("date_text"), ev.get("venue"), ev.get("ticket_url")) if x)
            reminders.append({"title": f"{verb}: {ev.get('name') or title}", "due_utc": start,
                              "notes": notes, "url": link, "short": "Reminder"})
        else:
            points = _f(fields, "tip").get("key_points") or []
            notes = "\n".join(f"• {p}" for p in points[:8])
            reminders.append({"title": f"Revisit: {title}", "due_utc": start, "notes": notes, "url": link,
                              "short": "Reminder"})
        end = start + timedelta(minutes=15)
    elif kind == "recipe":
        r = _f(fields, "recipe")
        ings = ingredients(fields)
        body = []
        if ings:
            body.append("Ingredients:\n" + "\n".join(f"• {ingredient_line(i)}" for i in ings))
        if r.get("steps"):
            body.append("Steps:\n" + "\n".join(f"{n}. {s}" for n, s in enumerate(r["steps"], 1)))
        notes = "\n\n".join(body)[:1500]
        event = {"title": f"Cook: {title}", "start_utc": start, "end_utc": end, "location": "",
                 "notes": (notes + "\n" if notes else "") + f"Open: {link}", "url": link}
        if ings:
            st_l = start.astimezone(tz)
            if st_l.hour >= 15:
                due_l = st_l.replace(hour=12, minute=0, second=0, microsecond=0)
            else:
                due_l = (st_l - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
            due = as_utc(due_l)
            if due <= now_u:
                due = now_u + timedelta(minutes=15)
            reminders.append({"title": f"Groceries for {title}", "due_utc": due,
                              "notes": "\n".join(f"• {ingredient_line(i)}" for i in ings),
                              "url": link, "short": "Groceries"})
        add_followup(_followup(title, "recipe"))
    elif kind == "workout":
        w = _f(fields, "workout")
        lines = []
        for ex in w.get("exercises") or []:
            if not isinstance(ex, dict) or not ex.get("name"):
                continue
            bits = [ex["name"]]
            if ex.get("sets") and ex.get("reps"):
                bits.append(f"{ex['sets']} × {ex['reps']}")
            elif ex.get("duration_sec"):
                bits.append(f"{ex['duration_sec']} s")
            if ex.get("rest_sec"):
                bits.append(f"rest {ex['rest_sec']} s")
            lines.append("• " + " · ".join(bits))
        notes = "\n".join(lines)[:1500]
        event = {"title": f"Workout: {title}", "start_utc": start, "end_utc": end, "location": "",
                 "notes": (notes + "\n" if notes else "") + f"Open: {link}", "url": link}
        add_followup(_followup(title, "workout"))
    elif kind == "place":
        p = first_place(fields)
        name = p.get("name") or title
        loc = ", ".join(x for x in (p.get("name"), p.get("city")) if x)
        notes = "\n".join(x for x in (p.get("why"), p.get("tip")) if x)
        event = {"title": f"Visit {name}", "start_utc": start, "end_utc": end, "location": loc,
                 "notes": (notes + "\n" if notes else "") + f"Open: {link}", "url": link}
        add_followup(_followup(name, "place"))
    elif kind == "event":
        ev = _f(fields, "event")
        name = ev.get("name") or title
        loc = ", ".join(x for x in (ev.get("venue"), ev.get("city")) if x)
        notes = "\n".join(x for x in (ev.get("price_hint"), ev.get("ticket_url")) if x)
        event = {"title": name, "start_utc": start, "end_utc": end, "location": loc,
                 "notes": (notes + "\n" if notes else "") + f"Open: {link}", "url": link}
        if ev.get("ticket_url"):
            due = reminder_due("event_ticket", user, now=now_u, accepted=[], event_start=start)
            if due:
                reminders.append({"title": f"Get tickets: {name}", "due_utc": due,
                                  "notes": ev["ticket_url"], "url": ev["ticket_url"], "short": "Tickets"})
    else:  # custom event-style option on a kind without one
        event = {"title": title, "start_utc": start, "end_utc": end, "location": "",
                 "notes": f"Open: {link}", "url": link}

    return {
        "event": event,
        "reminders": reminders[:2],
        "scheduled_for": start,
        "ends_at": end,
        "followup_at": followup_at,
    }


# ---------- calendar links and files ----------


def _z(dt: datetime) -> str:
    return as_utc(dt).astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _calendar_core(plan: dict) -> dict | None:
    """The single event a calendar link or file describes, or None."""
    da = plan.get("device_actions") or {}
    ev = da.get("event")
    if ev:
        return {"title": ev["title"], "start": as_utc(ev["start_utc"]), "end": as_utc(ev["end_utc"]),
                "details": ev.get("notes") or "", "location": ev.get("location") or ""}
    rems = da.get("reminders") or []
    if rems:
        r = rems[0]
        start = as_utc(r["due_utc"])
        details = "\n".join(x for x in (r.get("notes"), r.get("url")) if x)
        return {"title": r["title"], "start": start, "end": start + timedelta(minutes=15),
                "details": details, "location": ""}
    return None


def gcal_url(plan: dict) -> str | None:
    core = _calendar_core(plan)
    if not core:
        return None
    q = {"action": "TEMPLATE", "text": core["title"],
         "dates": f"{_z(core['start'])}/{_z(core['end'])}",
         "details": core["details"], "location": core["location"]}
    return "https://calendar.google.com/calendar/render?" + urlencode(q, quote_via=quote)


def ics_url(plan: dict) -> str:
    return f"/api/public/plans/{plan['_id']}/ics?t={plan['share_token']}"


def _ics_escape(s: str) -> str:
    return (str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> list[str]:
    """RFC 5545 folding at 75 octets."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return [line]
    out, cur, size = [], "", 0
    for ch in line:
        b = len(ch.encode("utf-8"))
        limit = 75 if not out else 74
        if size + b > limit:
            out.append(cur)
            cur, size = "", 0
        cur += ch
        size += b
    out.append(cur)
    return [out[0]] + [" " + x for x in out[1:]]


def build_ics(plan: dict, *, now: datetime | None = None) -> str | None:
    """One VEVENT (UTC); each reminder is a VALARM with an absolute trigger. CRLF line endings."""
    core = _calendar_core(plan)
    if not core:
        return None
    s = get_settings()
    da = plan.get("device_actions") or {}
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:-//{s.app_name}//Plans//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
        f"UID:{plan['_id']}@{s.app_name.lower()}",
        f"DTSTAMP:{_z(now or now_utc())}",
        f"DTSTART:{_z(core['start'])}", f"DTEND:{_z(core['end'])}",
        f"SUMMARY:{_ics_escape(core['title'])}",
    ]
    if core["details"]:
        lines.append(f"DESCRIPTION:{_ics_escape(core['details'])}")
    if core["location"]:
        lines.append(f"LOCATION:{_ics_escape(core['location'])}")
    lines.append(f"URL:{plan_link(plan)}")
    for r in da.get("reminders") or []:
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_escape(r['title'])}",
                  f"TRIGGER;VALUE=DATE-TIME:{_z(r['due_utc'])}", "END:VALARM"]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    folded: list[str] = []
    for ln in lines:
        folded += _fold(ln)
    return "\r\n".join(folded) + "\r\n"


# ---------- messages and response payloads ----------


def accepted_message(plan: dict, option: dict, user: dict, source: str,
                     *, now: datetime | None = None) -> str:
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    day = long_day(as_utc(option["start_utc"]).astimezone(tz), now_l)
    if source == "shortcut":
        if option["action"] == "reminder":
            return f"Reminder set for {day}."
        if plan["kind"] == "event":
            return f"Added to your calendar for {day}."
    return f"Added to {day}."


def state_phrase(plan: dict | None, user: dict, *, now: datetime | None = None) -> str:
    """'Plan: Thu 6:30 pm.', 'No plan.', 'Done.' or 'Skipped.' for duplicate messages."""
    if not plan:
        return "No plan."
    st = plan.get("status")
    if st == "accepted" and plan.get("scheduled_for"):
        tz = tz_of(user)
        now_l = as_utc(now or now_utc()).astimezone(tz)
        return f"Plan: {big_time(as_utc(plan['scheduled_for']).astimezone(tz), now_l)}."
    if st == "done":
        return "Done."
    if st == "skipped":
        return "Skipped."
    return "No plan."


def device_payload(plan: dict, user: dict) -> dict:
    """The flat event_* fields, event object and reminders for ConfirmResponse."""
    tz = tz_of(user)
    da = plan.get("device_actions") or {}
    ev = da.get("event")
    out: dict = {
        "has_event": "yes" if ev else "no",
        "event_title": "", "event_start_text": "", "event_end_text": "",
        "event_start_iso": "", "event_end_iso": "", "event_location": "", "event_notes": "",
        "event": None,
    }
    if ev:
        st, en = as_utc(ev["start_utc"]).astimezone(tz), as_utc(ev["end_utc"]).astimezone(tz)
        flat = {
            "event_title": ev["title"], "event_start_text": fmt_text(st), "event_end_text": fmt_text(en),
            "event_start_iso": st.isoformat(timespec="seconds"),
            "event_end_iso": en.isoformat(timespec="seconds"),
            "event_location": ev.get("location") or "", "event_notes": ev.get("notes") or "",
        }
        out.update(flat)
        out["event"] = {"title": ev["title"], "start_text": flat["event_start_text"],
                        "end_text": flat["event_end_text"], "start_iso": flat["event_start_iso"],
                        "end_iso": flat["event_end_iso"], "location": flat["event_location"],
                        "notes": flat["event_notes"]}
    rems = []
    for r in da.get("reminders") or []:
        due = as_utc(r["due_utc"]).astimezone(tz)
        rems.append({"title": r["title"], "due_text": fmt_text(due),
                     "due_iso": due.isoformat(timespec="seconds"),
                     "notes": r.get("notes") or "", "url": r.get("url") or ""})
    out["reminders"] = rems
    out["gcal_url"] = gcal_url(plan) or ""
    out["ics_url"] = ics_url(plan) if _calendar_core(plan) else ""
    return out


def reminders_preview(plan: dict, user: dict, *, now: datetime | None = None) -> list[str]:
    tz = tz_of(user)
    now_l = as_utc(now or now_utc()).astimezone(tz)
    out = []
    for r in (plan.get("device_actions") or {}).get("reminders") or []:
        due = as_utc(r["due_utc"]).astimezone(tz)
        out.append(f"{r.get('short') or 'Reminder'}, {big_time(due, now_l)}")
    return out
