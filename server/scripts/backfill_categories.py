"""Give reels already in Just vibes a category of their own (categories.py).

New reels that fit none of the kinds get a category while they're read. This sorts the
ones saved before that. For each account:
  1. A reel whose folder already exists inside one of the account's categories joins it
     ("Just vibes > Memes" next to "Comedy > Memes" becomes "Comedy > Memes"). No model call.
  2. The rest go to GEMINI_MODEL_FAST in one call per account (titles, summaries and tags
     only; no video), shown the account's categories so it reuses them.
A category the person set or cleared themselves is never touched.

Run from server/:
  python -m scripts.backfill_categories --email you@example.com
  python -m scripts.backfill_categories --user u_2577cc094210
  python -m scripts.backfill_categories --all-users
Add --dry-run to print the categories without writing them.
"""
from __future__ import annotations

import argparse
import sys

from realize import categories, db, gemini

BATCH = 40
SEARCHABLE = ["planned", "enriching", "ready"]

SCHEMA = {
    "type": "object",
    "properties": {"assignments": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "category": {"type": "string"}},
        "required": ["id", "category"]}}},
    "required": ["assignments"],
}


def ask(items: list[dict], existing: list[str]) -> dict[str, str]:
    """{id: raw category} for a batch of reels that fit none of the fixed kinds."""
    lines = [f"- {it['id']} | {it['title']} | {it['summary'][:160]} | tags: {', '.join(it['tags'][:6])}"
             for it in items]
    text = "\n".join([
        "These saved reels fit none of the fixed kinds (Food, Events, Places, Fitness, Products, "
        "Learning). Give each one a category, as if it were of type other.",
        categories.GUIDE,
        "Group them: prefer a few categories that several reels share over one per reel.",
        f"EXISTING CATEGORIES: {', '.join(existing) or 'none yet'}",
        "REELS (id | title | summary | tags):",
        *lines,
        "Return one assignment per id, using the ids exactly as given.",
    ])
    out = gemini.generate_json(role="fast", input=[{"type": "text", "text": text}], schema=SCHEMA,
                               timeout_s=60, retries=2)
    return {str(a.get("id")): a.get("category") for a in out.get("assignments") or [] if isinstance(a, dict)}


def backfill_user(user: dict, dry: bool) -> int:
    uid = user["_id"]
    docs = list(db.saves().find(
        {"user_id": uid, "type": "other", "status": {"$in": SEARCHABLE},
         "category": {"$not": {"$type": "string"}}, "user_edited": {"$ne": "category"}},
        {"title": 1, "summary": 1, "tags": 1, "subcategory": 1}))
    if not docs:
        return 0
    label = user.get("email") or uid
    existing = categories.existing(uid)
    # 1. Folders that already live inside a category: {subcategory: category}, only when
    #    exactly one category has that folder.
    homes: dict[str, set[str]] = {}
    for r in db.saves().aggregate([
        {"$match": {"user_id": uid, "type": "other", "category": {"$type": "string"},
                    "subcategory": {"$type": "string"}}},
        {"$group": {"_id": {"c": "$category", "s": "$subcategory"}}},
    ]):
        homes.setdefault(r["_id"]["s"], set()).add(r["_id"]["c"])
    done = 0
    rest = []
    for d in docs:
        home = homes.get(d.get("subcategory") or "")
        if home and len(home) == 1:
            cat = next(iter(home))
            print(f"  {label}: {(d.get('title') or '')[:50]!r} -> {cat} (its folder {d.get('subcategory')!r} is there)")
            if not dry:
                db.saves().update_one({"_id": d["_id"]}, {"$set": {"category": cat}})
            done += 1
        else:
            rest.append({"id": str(d["_id"]), "key": d["_id"], "user_id": uid, "title": d.get("title") or "",
                         "summary": d.get("summary") or "", "tags": d.get("tags") or []})
    # 2. The rest, named by the model.
    for i in range(0, len(rest), BATCH):
        batch = rest[i:i + BATCH]
        try:
            raw = ask(batch, existing)
        except Exception as e:  # noqa: BLE001 - report and keep going with the next batch
            print(f"  {label}: Gemini didn't answer ({str(e)[:120]}). Skipped {len(batch)}.")
            continue
        for it in batch:
            cat = categories.snap(categories.clean(raw.get(it["id"])), existing)
            if not cat:
                print(f"  {label}: {it['title'][:50]!r} stays in Just vibes (no usable category)")
                continue
            if cat not in existing:
                existing.append(cat)
            print(f"  {label}: {it['title'][:50]!r} -> {cat}")
            if not dry:
                db.saves().update_one({"_id": it["key"]}, {"$set": {"category": cat}})
            done += 1
    return done


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--email")
    who.add_argument("--user")
    who.add_argument("--all-users", action="store_true", help="every account that isn't a demo session")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.all_users:
        users = list(db.users().find({"is_demo": {"$ne": True}}, {"email": 1}))
    else:
        q = {"email": args.email.strip().lower()} if args.email else {"_id": args.user}
        users = list(db.users().find(q, {"email": 1}))
        if not users:
            sys.exit("No account like that.")
    total = sum(backfill_user(u, args.dry_run) for u in users)
    print(f"{'Would sort' if args.dry_run else 'Sorted'} {total} reel{'s' if total != 1 else ''} into categories.")


if __name__ == "__main__":
    main()
