"""Give existing saves a category and sub-category, and the demo samples too.

New saves get both while they're read. This fills in saves made before that, with one
GEMINI_MODEL_FAST call per batch of 40 (titles, summaries and tags only; no video). The
person's categories and intro interests are offered first, so they're reused when they fit.
Labels the person set themselves are never touched.

Run from server/:
  python -m scripts.backfill_subcategories --email you@example.com
  python -m scripts.backfill_subcategories --user u_2577cc094210
  python -m scripts.backfill_subcategories --all-users
  python -m scripts.backfill_subcategories --samples      (demo sample library)
Add --dry-run to print the labels without writing them.
"""
from __future__ import annotations

import argparse
import sys

from realize import db, gemini, subcats

BATCH = 40

SCHEMA = {
    "type": "object",
    "properties": {"assignments": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "category": {"type": "string"},
                       "subcategory": {"type": "string"}},
        "required": ["id", "category", "subcategory"]}}},
    "required": ["assignments"],
}


def _existing_line(tree: dict[str, list[str]]) -> str:
    if not tree:
        return "EXISTING CATEGORIES: none yet"
    parts = [f"{c} ({', '.join(subs)})" if subs else c for c, subs in tree.items()]
    return "EXISTING CATEGORIES (sub-categories in brackets): " + "; ".join(parts)


def ask(items: list[dict], tree: dict[str, list[str]]) -> dict[str, tuple]:
    """{id: (raw category, raw sub-category)} for a batch of saves."""
    lines = [f"- {it['id']} | {it['title']} | {it['summary'][:160]} | tags: {', '.join(it['tags'][:6])}"
             for it in items]
    text = "\n".join([
        "Give each of these saved reels a category and a sub-category.",
        subcats.GUIDE,
        "Group them: prefer a few labels that several saves share over one label per save.",
        _existing_line(tree),
        "SAVES (id | title | summary | tags):",
        *lines,
        "Return one assignment per id, using the ids exactly as given.",
    ])
    out = gemini.generate_json(role="fast", input=[{"type": "text", "text": text}], schema=SCHEMA,
                               timeout_s=60, retries=2)
    return {str(a.get("id")): (a.get("category"), a.get("subcategory"))
            for a in out.get("assignments") or [] if isinstance(a, dict)}


def run_pool(label: str, items: list[dict], tree: dict[str, list[str]], write, dry: bool) -> int:
    """Label items, growing `tree` ({category: [subs]}) as new labels appear."""
    done = 0
    for i in range(0, len(items), BATCH):
        batch = items[i:i + BATCH]
        try:
            raw = ask(batch, tree)
        except Exception as e:  # noqa: BLE001 - report and keep going with the next batch
            print(f"  {label}: Gemini didn't answer ({str(e)[:120]}). Skipped {len(batch)}.")
            continue
        for it in batch:
            rc, rs = raw.get(it["id"], (None, None))
            cat = subcats.snap(subcats.clean(rc), list(tree))
            if not cat:
                continue
            subs = tree.setdefault(cat, [])
            sub = subcats.snap(subcats.clean(rs), subs)
            if sub and sub not in subs:
                subs.append(sub)
            print(f"  {label}: {it['title'][:50]!r} -> {cat} > {sub or '-'}")
            if not dry:
                write(it["key"], cat, sub)
            done += 1
    return done


def backfill_user(user: dict, dry: bool) -> int:
    docs = list(db.saves().find(
        {"user_id": user["_id"], "category": {"$in": [None, ""]}, "user_edited": {"$ne": "category"},
         "status": {"$in": ["planned", "enriching", "ready"]}},
        {"title": 1, "summary": 1, "tags": 1}))
    if not docs:
        return 0
    items = [{"id": str(i), "key": d["_id"], "title": d.get("title") or "Saved reel",
              "summary": d.get("summary") or "", "tags": d.get("tags") or []} for i, d in enumerate(docs)]
    filed = subcats._filed(user["_id"])  # noqa: SLF001 - same module family
    tree = {c: list(filed.get(c, [])) for c in subcats.merge(list(filed), subcats._starters(user["_id"]))}  # noqa: SLF001

    def write(save_id, cat, sub):
        db.saves().update_one({"_id": save_id, "user_id": user["_id"]},
                              {"$set": {"category": cat, "subcategory": sub}})

    return run_pool(user.get("email") or user["_id"], items, tree, write, dry)


def backfill_samples(dry: bool) -> int:
    samples = list(db.sample_cache().find({}, {"enrichment": 1}))
    tree: dict[str, list[str]] = {}
    for s in samples:
        e = s.get("enrichment") or {}
        if e.get("category"):
            subs = tree.setdefault(e["category"], [])
            if e.get("subcategory") and e["subcategory"] not in subs:
                subs.append(e["subcategory"])
    todo = [s for s in samples if not (s.get("enrichment") or {}).get("category")]
    items = [{"id": str(i), "key": s["_id"], "title": s["enrichment"].get("title") or "Sample reel",
              "summary": s["enrichment"].get("summary") or "", "tags": s["enrichment"].get("tags") or []}
             for i, s in enumerate(todo)]

    def write(shortcode, cat, sub):
        db.sample_cache().update_one({"_id": shortcode}, {"$set": {"enrichment.category": cat,
                                                                  "enrichment.subcategory": sub}})

    return run_pool("samples", items, tree, write, dry) if items else 0


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
