"""Phase 2 and 3 check: push every reel in fixtures/reels.csv through the Shortcut contract.

Run from server/ with the API and worker up:
  python -m scripts.run_fixtures [--base http://localhost:8000] [--key KEY] [--wait-enrich]

For each fixture: save (as the Shortcut would), print type, menu and timing, pick
the first option (or the last menu item for non-actionable saves), then share it
again and expect a duplicate. Prints the median save-to-proposal time next to
PROPOSAL_WAIT_SECONDS. With --wait-enrich it then waits for every save to reach
ready and reports transcripts and enrich errors.
"""
from __future__ import annotations

import argparse
import csv
import statistics
import sys
import time

import httpx

from realize.config import REPO_ROOT, get_settings


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:8000")
    p.add_argument("--key")
    p.add_argument("--wait-enrich", action="store_true")
    p.add_argument("--only")
    a = p.parse_args()
    base = a.base.rstrip("/")
    s = get_settings()
    rows = list(csv.DictReader((REPO_ROOT / "fixtures" / "reels.csv").open(encoding="utf-8")))
    if a.only:
        rows = [r for r in rows if a.only in r["url"]]
    problems: list[str] = []
    times: list[float] = []
    saved: list[tuple[str, str, str]] = []

    with httpx.Client(timeout=60) as http:
        key = a.key
        if not key:
            key = http.post(f"{base}/api/users", json={"timezone": s.default_timezone}).json()["api_key"]
            print("created a fresh user for this run")
        h = {"Authorization": f"Bearer {key}"}
        for row in rows:
            url, expected = row["url"], row["expected_type"]
            code = url.rstrip("/").split("/")[-1]
            t0 = time.monotonic()
            r = http.post(f"{base}/api/save", headers=h, json={"input": url, "source": "shortcut"}).json()
            dt = time.monotonic() - t0
            ticket = r.get("ticket") or {}
            plan = ticket.get("plan") or {}
            print(f"\n{code}  expected={expected}  got={ticket.get('type')}  status={r['status']}  {dt:.1f} s")
            if r["status"] == "pending":
                # The plan missed the wait window. Keep polling so the rest of the check can run.
                t_end = time.monotonic() + 60
                while time.monotonic() < t_end:
                    time.sleep(1)
                    d = http.get(f"{base}/api/saves/{r['save_id']}", headers=h).json()
                    if d["ticket"]["processing"] not in ("queued", "reading", "planning"):
                        break
                dt = time.monotonic() - t0
                r = http.post(f"{base}/api/save", headers=h, json={"input": url, "source": "shortcut", "wait": 0}).json()
                ticket = r.get("ticket") or {}
                plan = ticket.get("plan") or {}
                print(f"  missed the {s.proposal_wait_seconds} s window; plan arrived after {dt:.1f} s")
                problems.append(f"{code}: proposal took {dt:.1f} s (pending in the Shortcut)")
            if r["status"] != "proposed":
                print(f"  message: {r['message']}")
                problems.append(f"{code}: status {r['status']}: {r['message']}")
                continue
            times.append(dt)
            print(f"  title: {ticket.get('title')}")
            print(f"  prompt: {r['prompt']}")
            print(f"  menu: {r['menu']}")
            print(f"  actionable: {plan.get('actionable')}  confidence: {plan.get('confidence')}  why: {plan.get('why')}")
            if ticket.get("type") != expected:
                problems.append(f"{code}: expected {expected}, got {ticket.get('type')}")
            if expected == "other" and (plan.get("actionable") or r["menu"] != ["Remind me in a week", "Just save"]):
                problems.append(f"{code}: meme menu was {r['menu']} actionable={plan.get('actionable')}")
            choice = r["menu"][0] if plan.get("actionable") else r["menu"][-1]
            c = http.post(f"{base}/api/saves/{r['save_id']}/confirm", headers=h,
                          json={"choice": choice, "source": "shortcut"}).json()
            line = f"  chose: {choice} -> {c['status']}: {c['message']}"
            if c.get("has_event") == "yes":
                line += f" | event {c['event_title']} at {c['event_start_text']}"
            for rem in c.get("reminders") or []:
                line += f" | reminder {rem['title']} due {rem['due_text']}"
            print(line)
            if expected == "recipe" and plan.get("actionable"):
                opt = plan["options"][0]
                ok = opt["start_local"].endswith("T18:30") and "groceries" in opt["label"]
                wd = time.strptime(opt["start_local"][:10], "%Y-%m-%d").tm_wday
                if not ok or wd > 4:
                    problems.append(f"{code}: first recipe option was {opt['label']} ({opt['start_local']})")
            d = http.post(f"{base}/api/save", headers=h, json={"input": url, "source": "shortcut"}).json()
            print(f"  second share: {d['status']}: {d['message']}")
            if d["status"] != "duplicate":
                problems.append(f"{code}: second share gave {d['status']}")
            saved.append((code, r["save_id"], expected))

        if times:
            med = statistics.median(times)
            print(f"\nsave to proposal over {len(times)} reels: median {med:.1f} s, "
                  f"min {min(times):.1f} s, max {max(times):.1f} s; PROPOSAL_WAIT_SECONDS={s.proposal_wait_seconds}")
            print("median is " + ("inside" if med <= s.proposal_wait_seconds else "OUTSIDE") + " the wait window")

        if a.wait_enrich and saved:
            print("\nwaiting for enrichment")
            deadline = time.monotonic() + 600
            pending = {sid for _, sid, _ in saved}
            details: dict[str, dict] = {}
            while pending and time.monotonic() < deadline:
                for sid in list(pending):
                    d = http.get(f"{base}/api/saves/{sid}", headers=h).json()
                    if d["ticket"]["processing"] in ("ready", "failed"):
                        details[sid] = d
                        pending.discard(sid)
                time.sleep(3)
            for code, sid, expected in saved:
                d = details.get(sid)
                if not d:
                    print(f"  {code}: not ready after 10 min")
                    problems.append(f"{code}: enrichment did not finish")
                    continue
                det = d["details"]
                kinds = [r["kind"] + ":" + r["status"] for r in d["runs"]]
                print(f"  {code}: {d['ticket']['processing']}  type={d['ticket']['type']}  "
                      f"transcript_lines={len(det['transcript'])}  on_screen={len(det['on_screen_text'])}  "
                      f"enrich_error={det['enrich_error']}  runs={kinds}")
                if det["enrich_error"]:
                    problems.append(f"{code}: enrich_error {det['enrich_error']}")

    print("\n" + ("PROBLEMS:\n  " + "\n  ".join(problems) if problems else "no problems"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
