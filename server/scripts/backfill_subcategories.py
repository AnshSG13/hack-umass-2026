"""Give existing saves a sub-category, and the demo samples too.

New saves get one while they're read. This fills in saves made before that, with one
GEMINI_MODEL_FAST call per user and type (titles, summaries and tags only; no video).
Labels the person set themselves are never touched.

Run from server/:
  python -m scripts.backfill_subcategories --email you@example.com   (once email sign-in is merged)
  python -m scripts.backfill_subcategories --user u_2577cc094210
  python -m scripts.backfill_subcategories --all-users
  python -m scripts.backfill_subcategories --samples      (demo sample library)
Add --dry-run to print the labels without writing them.
"""
from __future__ import annotations

import argparse
import sys

from realize import db, gemini, subcats
from realize.models import TYPES

BATCH = 40

SCHEMA = {
    "type": "object",
    "properties": {"assignments": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "subcategory": {"type": "string"}},
        "required": ["id", "subcategory"]}}},
    "required": ["assignments"],
}


def ask(kind: str, items: list[dict], existing: list[str]) -> dict[str, str]:
    """{id: raw label} for a batch of saves of one type."""
    lines = [f"- {it['id']} | {it['title']} | {it['summary'][:160]} | tags: {', '.join(it['tags'][:6])}"
             for it in items]
    text = "\n".join([
        f"These saved reels are all of type {kind}. Give each one a sub-category.",
        subcats.GUIDE,
        "Group them: prefer a few labels that several saves share over one label per save.",
        f"EXISTING SUB-CATEGORIES for {kind}: {', '.join(existing) or 'none yet'}",
        "SAVES (id | title | summary | tags):",
        *lines,
        "Return one assignment per id, using the ids exactly as given.",
    ])
    out = gemini.generate_json(role="fast", input=[{"type": "text", "text": text}], schema=SCHEMA,
                               timeout_s=60, retries=2)
    return {str(a.get("id")): a.get("subcategory") for a in out.get("assignments") or [] if isinstance(a, dict)}


def run_pool(label: str, kind: str, items: list[dict], existing: list[str], write, dry: bool) -> int:
    done = 0
    for i in range(0, len(items), BATCH):
        batch = items[i:i + BATCH]
        try:
            raw = ask(kind, batch, existing)
        except Exception as e:  # noqa: BLE001 - report and keep going with the next batch
            print(f"  {label} {kind}: Gemini didn't answer ({str(e)[:120]}). Skipped {len(batch)}.")
            continue
        for it in batch:
            sub = subcats.snap(subcats.clean(raw.get(it["id"])), existing)
            if not sub:
                continue
            if sub not in existing:
                existing.append(sub)
            print(f"  {label} {kind}: {it['title'][:50]!r} -> {sub}")
            if not dry:
                write(it["key"], sub)
            done += 1
    return done


def backfill_user(user: dict, dry: bool) -> int:
    total = 0
    for kind in TYPES:
        if kind == "other":
            continue
        docs = list(db.saves().find(
            {"user_id": user["_id"], "type": kind, "subcategory": {"$in": [None, ""]},
             "user_edited": {"$ne": "subcategory"}, "status": {"$in": ["planned", "enriching", "ready"]}},
            {"title": 1, "summary": 1, "tags": 1}))
        if not docs:
            continue
        items = [{"id": str(i), "key": d["_id"], "title": d.get("title") or "Saved reel",
                  "summary": d.get("summary") or "", "tags": d.get("tags") or []} for i, d in enumerate(docs)]

        def write(save_id, sub):
            db.saves().update_one({"_id": save_id, "user_id": user["_id"]}, {"$set": {"subcategory": sub}})

        total += run_pool(user.get("email") or user["_id"], kind, items,
                          subcats.existing(user["_id"], kind), write, dry)
    return total


def backfill_samples(dry: bool) -> int:
    total = 0
    samples = list(db.sample_cache().find({}, {"enrichment": 1}))
    for kind in TYPES:
        if kind == "other":
            continue
        pool = [s for s in samples if (s.get("enrichment") or {}).get("type") == kind]
        existing = sorted({s["enrichment"]["subcategory"] for s in pool if s["enrichment"].get("subcategory")})
        todo = [s for s in pool if not s["enrichment"].get("subcategory")]
        items = [{"id": str(i), "key": s["_id"], "title": s["enrichment"].get("title") or "Sample reel",
                  "summary": s["enrichment"].get("summary") or "", "tags": s["enrichment"].get("tags") or []}
                 for i, s in enumerate(todo)]

        def write(shortcode, sub):
            db.sample_cache().update_one({"_id": shortcode}, {"$set": {"enrichment.subcategory": sub}})

        if items:
            total += run_pool("samples", kind, items, existing, write, dry)
    return total


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--email", help="one account, by sign-in email")
    who.add_argument("--user", help="one account, by user id (u_...)")
    who.add_argument("--all-users", action="store_true", help="every account, demo accounts included")
    who.add_argument("--samples", action="store_true", help="the demo sample library")
    ap.add_argument("--dry-run", action="store_true", help="print the labels, write nothing")
    args = ap.parse_args()

    if args.samples:
        n = backfill_samples(args.dry_run)
        print(f"{'Would label' if args.dry_run else 'Labelled'} {n} samples. "
              "New demo sessions pick them up; existing ones expire in 24 hours.")
        return 0
    if args.email or args.user:
        q = {"email": args.email.strip().lower()} if args.email else {"_id": args.user}
        user = db.users().find_one(q)
        if not user:
            print(f"No account with {'the email ' + args.email if args.email else 'the id ' + args.user}.")
            return 1
        users = [user]
    else:
        users = list(db.users().find({}))
    n = sum(backfill_user(u, args.dry_run) for u in users)
    print(f"{'Would label' if args.dry_run else 'Labelled'} {n} saves across {len(users)} account(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
