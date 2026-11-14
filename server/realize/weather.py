"""Forecast for a trip's days, from Open-Meteo (free, no key).

Only real forecast days are returned. A date beyond the forecast window gets nothing,
so the app never shows a made-up temperature.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import httpx

from .config import get_settings

log = logging.getLogger("realize.weather")

FORECAST_DAYS = 15  # Open-Meteo forecasts 16 days counting today
TIMEOUT_S = 8.0

# WMO weather interpretation codes, in plain words.
WMO = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Thunderstorms with hail",
}
WET = {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99}


def describe(code: int | None) -> str:
    return WMO.get(int(code), "") if code is not None else ""


def in_window(day: date, today: date) -> bool:
    return today <= day <= today + timedelta(days=FORECAST_DAYS)


def pick_place(results: list[dict], region: str = "", country: str = "") -> dict | None:
    """The geocoder's best match for a name. "Rockaway Beach" exists in Oregon, Missouri and
    New York, so a match on country and then on state or region wins over the first hit."""
    if not results:
        return None

    def norm(s: object) -> str:
        return str(s or "").strip().lower()

    c, r = norm(country), norm(region)
    pool = results
    if c:
        same = [x for x in pool if norm(x.get("country")) == c or norm(x.get("country_code")) == c]
        pool = same or pool
    if r:
        same = [x for x in pool if r in (norm(x.get("admin1")), norm(x.get("admin2")), norm(x.get("name")))]
        pool = same or pool
    return pool[0]


def geocode(name: str, region: str = "", country: str = "") -> dict | None:
    """{"name", "latitude", "longitude", "timezone", "label"} for a town or city, or None."""
    name = (name or "").strip()
    if not name:
        return None
    s = get_settings()
    try:
        r = httpx.get(s.geocode_api_url, timeout=TIMEOUT_S,
                      params={"name": name, "count": 10, "language": "en", "format": "json"})
        r.raise_for_status()
        hit = pick_place(r.json().get("results") or [], region, country)
    except Exception as e:  # noqa: BLE001 - weather is optional; the trip still builds
        log.warning("geocoding %r failed: %s", name, str(e)[:120])
        return None
    if not hit:
        return None
    label = ", ".join(str(x) for x in (hit.get("name"), hit.get("admin1"), hit.get("country")) if x)
    return {"name": hit.get("name"), "latitude": hit["latitude"], "longitude": hit["longitude"],
            "timezone": hit.get("timezone"), "label": label}


def forecast(place: dict | None, days: list[date], *, fahrenheit: bool, today: date) -> dict[str, dict]:
    """Forecast per ISO date for the days inside the forecast window. Missing days are absent."""
    wanted = [d for d in days if in_window(d, today)]
    if not place or not wanted:
        return {}
    s = get_settings()
    try:
        r = httpx.get(s.weather_api_url, timeout=TIMEOUT_S, params={
            "latitude": place["latitude"], "longitude": place["longitude"],
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto", "temperature_unit": "fahrenheit" if fahrenheit else "celsius",
            "start_date": min(wanted).isoformat(), "end_date": max(wanted).isoformat()})
        r.raise_for_status()
        daily = r.json().get("daily") or {}
    except Exception as e:  # noqa: BLE001
        log.warning("forecast failed: %s", str(e)[:120])
        return {}
    return parse_daily(daily, fahrenheit=fahrenheit)


def parse_daily(daily: dict, *, fahrenheit: bool) -> dict[str, dict]:
    out: dict[str, dict] = {}
    times = daily.get("time") or []

    def at(key: str, i: int):
        vals = daily.get(key) or []
        return vals[i] if i < len(vals) else None

    for i, iso in enumerate(times):
        code, hi, lo = at("weather_code", i), at("temperature_2m_max", i), at("temperature_2m_min", i)
        if code is None or hi is None or lo is None:
            continue
        rain = at("precipitation_probability_max", i)
        out[str(iso)] = {
            "text": describe(code), "wet": int(code) in WET,
            "high": round(float(hi)), "low": round(float(lo)), "unit": "F" if fahrenheit else "C",
            "rain_chance": int(rain) if rain is not None else None,
        }
    return out
