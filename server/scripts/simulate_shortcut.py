"""Do exactly what the iOS Shortcut does (SPEC 10) and check the contract.

Run from server/:
  python -m scripts.simulate_shortcut --url URL [--key KEY] [--choose 1|2|later|none] [--base http://localhost:3000]

Prints the prompt, menu, choice, event and reminders, plus timings.
Exits nonzero if any field from SPEC sections 6 and 7 is missing.
Without --key it creates a throwaway user through POST /api/users.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import httpx

SAVE_FIELDS = ["status", "ask", "save_id", "prompt", "menu", "message", "ticket"]
CONFIRM_FIELDS = ["status", "plan_id", "message", "has_event", "event_title", "event_start_text",
                  "event_end_text", "event_start_iso", "event_end_iso", "event_location", "event_notes",
                  "event", "reminders", "gcal_url", "ics_url", "ticket"]
REMINDER_FIELDS = ["title", "due_text", "due_iso", "notes", "url"]


def missing(obj: dict, fields: list[str]) -> list[str]:
    return [f for f in fields if f not in obj]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--key")
    p.add_argument("--choose", default="1")
    p.add_argument("--base", default="http://localhost:3000")
    p.add_argument("--json", action="store_true", help="print raw responses too")
    a = p.parse_args()
    base = a.base.rstrip("/")
    bad: list[str] = []

    with httpx.Client(timeout=40) as http:
        key = a.key
        if not key:
            r = http.post(f"{base}/api/users", json={})
            r.raise_for_status()
            key = r.json()["api_key"]
            print("created a throwaway user")
        headers = {"Authorization": f"Bearer {key}"}

        t0 = time.monotonic()
        r = http.post(f"{base}/api/save", headers=headers, json={"input": a.url, "source": "shortcut"})
        t_save = time.monotonic() - t0
        print(f"POST /api/save -> HTTP {r.status_code} in {t_save:.1f} s")
        if r.status_code != 200:
            print("  expected HTTP 200 for every handled outcome")
            return 1
        resp = r.json()
        if a.json:
            print(json.dumps(resp, indent=2)[:3000])
        bad += [f"save.{f}" for f in missing(resp, SAVE_FIELDS)]
        print(f"  status: {resp.get('status')}   ask: {resp.get('ask')}   save_id: {resp.get('save_id')}")
        if resp.get("ask") != "yes":
            print(f"  notification: {resp.get('message')}")
            if bad:
                print("MISSING FIELDS:", ", ".join(bad))
            print(f"timings: save_to_response={t_save:.1f}s")
            return 1 if bad else 0

        menu = resp.get("menu") or []
        print(f"  prompt: {resp.get('prompt')}")
        for i, label in enumerate(menu, 1):
            print(f"    {i}. {label}")
        plan = (resp.get("ticket") or {}).get("plan") or {}
        print(f"  type: {(resp.get('ticket') or {}).get('type')}   actionable: {plan.get('actionable')}   "
              f"confidence: {plan.get('confidence')}")
        print(f"  why: {plan.get('why')}")

        c = a.choose.strip().lower()
        if c in ("later", "not now"):
            choice = "Not now"
        elif c in ("none", "just vibes", "just save"):
            choice = menu[-1] if menu else "Just save"
        else:
            idx = int(c) - 1
            if idx < 0 or idx >= len(menu):
                print(f"  --choose {a.choose} is outside the menu")
                return 1
            choice = menu[idx]
        print(f"  choosing: {choice}")

        t1 = time.monotonic()
        r = http.post(f"{base}/api/saves/{resp['save_id']}/confirm", headers=headers,
                      json={"choice": choice, "source": "shortcut"})
        t_conf = time.monotonic() - t1
        print(f"POST /api/saves/<id>/confirm -> HTTP {r.status_code} in {t_conf:.1f} s")
        if r.status_code != 200:
            return 1
        conf = r.json()
        if a.json:
            print(json.dumps(conf, indent=2)[:3000])
        bad += [f"confirm.{f}" for f in missing(conf, CONFIRM_FIELDS)]
        print(f"  status: {conf.get('status')}")
        if conf.get("has_event") == "yes":
            print("  Add New Event:")
            print(f"    title:    {conf.get('event_title')}")
            print(f"    start:    {conf.get('event_start_text')}   ({conf.get('event_start_iso')})")
            print(f"    end:      {conf.get('event_end_text')}   ({conf.get('event_end_iso')})")
            print(f"    location: {conf.get('event_location')}")
            notes = (conf.get("event_notes") or "").replace("\n", " | ")
            print(f"    notes:    {notes[:200]}")
        else:
            print("  no calendar event")
        for i, rem in enumerate(conf.get("reminders") or []):
            bad += [f"confirm.reminders[{i}].{f}" for f in missing(rem, REMINDER_FIELDS)]
            print(f"  Add New Reminder: {rem.get('title')}  due {rem.get('due_text')}")
        print(f"  notification: {conf.get('message')}")
        print(f"timings: save_to_proposal={t_save:.1f}s confirm={t_conf:.1f}s")

    if bad:
        print("MISSING FIELDS:", ", ".join(bad))
        return 1
    print("contract: all fields present")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
