"""Timezone helpers and the day and time labels used everywhere (SPEC 8.5)."""
from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import get_settings

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def now_utc() -> datetime:
    return datetime.now(UTC)


def valid_tz(name: str | None) -> str | None:
    if not name:
        return None
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None


def tz_of(user: dict | None) -> ZoneInfo:
    name = valid_tz((user or {}).get("timezone")) or get_settings().default_timezone
    return ZoneInfo(name)


def as_utc(dt: datetime) -> datetime:
    """Mongo may hand back naive UTC datetimes; make them aware."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def to_local(dt: datetime, tz: ZoneInfo) -> datetime:
    return as_utc(dt).astimezone(tz)


def parse_hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def parse_local(s: str, tz: ZoneInfo) -> datetime:
    """'YYYY-MM-DDTHH:mm' (seconds optional) in tz to an aware local datetime."""
    s = s.strip().replace(" ", "T")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        return dt.astimezone(tz)
    return dt.replace(tzinfo=tz)


def local_str(dt: datetime, tz: ZoneInfo) -> str:
    return to_local(dt, tz).strftime("%Y-%m-%dT%H:%M")


def fmt_time(dt: datetime | time) -> str:
    """6:30 pm, 12 pm, 7 am."""
    h, m = dt.hour, dt.minute
    suffix = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12} {suffix}" if m == 0 else f"{h12}:{m:02d} {suffix}"


def month_day(d: date | datetime) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}"


def _day_delta(d: date, today: date) -> int:
    return (d - today).days


def short_day(dt_local: datetime, now_local: datetime) -> str:
    delta = _day_delta(dt_local.date(), now_local.date())
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Tomorrow"
    if 2 <= delta <= 6:
        return DAY_SHORT[dt_local.weekday()]
    return month_day(dt_local)


def long_day(dt_local: datetime, now_local: datetime) -> str:
    delta = _day_delta(dt_local.date(), now_local.date())
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if 2 <= delta <= 6:
        return DAY_LONG[dt_local.weekday()]
    return month_day(dt_local)


def big_time(dt_local: datetime, now_local: datetime) -> str:
    """'Thu 6:30 pm', or 'Nov 26, 6:30 pm' for dates."""
    sd = short_day(dt_local, now_local)
    delta = _day_delta(dt_local.date(), now_local.date())
    sep = " " if 0 <= delta <= 6 else ", "
    return f"{sd}{sep}{fmt_time(dt_local)}"


def fmt_text(dt_local: datetime) -> str:
    """'Nov 19, 2026 at 6:30 PM' for the Shortcut's Get Dates action."""
    h12 = dt_local.hour % 12 or 12
    ampm = "AM" if dt_local.hour < 12 else "PM"
    return f"{MONTHS[dt_local.month - 1]} {dt_local.day}, {dt_local.year} at {h12}:{dt_local.minute:02d} {ampm}"


def heading_day(d: date) -> str:
    """'Thursday, Nov 19'."""
    return f"{DAY_LONG[d.weekday()]}, {month_day(d)}"


def prompt_now(now_local: datetime, tz_name: str) -> str:
    """'Sat Nov 14 2026, 3:05 am (America/New_York)'."""
    return (
        f"{DAY_SHORT[now_local.weekday()]} {MONTHS[now_local.month - 1]} {now_local.day} "
        f"{now_local.year}, {fmt_time(now_local)} ({tz_name})"
    )


def prompt_date(d: datetime) -> str:
    return f"{DAY_SHORT[d.weekday()]} {MONTHS[d.month - 1]} {d.day} {d.year}"


def week_bounds(now_local: datetime) -> tuple[datetime, datetime]:
    """"This week" on Plans: today 00:00 through the next 7 days, local time.

    A rolling window, not Monday to Sunday, so a plan made on a Saturday for
    Monday still shows on the home screen instead of hiding under "Coming up".
    """
    start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=7)
