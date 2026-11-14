"""Measure search recall on fixtures/queries.csv and write eval/results.md.

Run from server/: python -m scripts.eval_recall [--user UID]

Default: creates a temporary demo user holding every reel in the sample cache,
runs each query through hybrid search, prints hit@1 and hit@3, writes
eval/results.md (date, hybrid mode, counts, per-query result) and deletes the
temporary user. Queries whose expected reel is not in the cache are listed as
skipped and are not counted. Needs the embedding model (one request per query).
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from realize import accounts, db, demo, search
from realize.config import REPO_ROOT, get_settings
from realize.timeutil import now_utc


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--user")
    a = p.parse_args()
    s = get_settings()
    queries = list(csv.DictReader((REPO_ROOT / "fixtures" / "queries.csv").open(encoding="utf-8")))
    temp = None
    if a.user:
        user = db.users().find_one({"_id": a.user})
        if not user:
            print("no such user")
            return 2
    else:
        user, _ = accounts.create_user(None, label="eval", is_demo=True, expires_at=now_utc() + timedelta(hours=1))
        temp = user
        for sample in db.sample_cache().find():
            doc = demo.save_doc_from_sample(user, sample, status="ready", source="sample")
            try:
                db.saves().insert_one(doc)
            except DuplicateKeyError:
                pass
    try:
        have = {x["shortcode"] for x in db.saves().find(
            {"user_id": user["_id"], "status": {"$in": search.SEARCHABLE}}, {"shortcode": 1})}
        if temp:
            # Atlas Search and Vector Search index new documents asynchronously.
            probe = next(iter(have), None)
            deadline = time.monotonic() + 90
            while probe and time.monotonic() < deadline:
                n_text = len(list(db.saves().aggregate([{"$search": {"index": "saves_text", "compound": {
                    "filter": [{"equals": {"path": "user_id", "value": user["_id"]}}]}}}, {"$project": {"_id": 1}}])))
                n_vec = len(list(db.saves().aggregate([{"$vectorSearch": {
                    "index": "saves_vector", "path": "embedding", "queryVector": [0.01] * s.embed_dim,
                    "numCandidates": 200, "limit": 100, "filter": {"user_id": user["_id"]}}},
                    {"$project": {"_id": 1}}])))
                if n_text >= len(have) and n_vec >= len(have):
                    break
                time.sleep(3)
        rows, skipped = [], []
        mode = "auto"
        for q in queries:
            query, expected = q["query"].strip(), q["expected_shortcode"].strip()
            if expected not in have:
                skipped.append((query, expected))
                continue
            docs, mode = search.hybrid_search(user["_id"], query, limit=5)
            codes = [d["shortcode"] for d in docs]
            rank = codes.index(expected) + 1 if expected in codes else None
            rows.append((query, expected, rank, codes[:3]))
            print(f"{'hit@1' if rank == 1 else 'hit@3' if rank and rank <= 3 else 'miss ':5}  {query!r} -> "
                  f"rank {rank}  top3 {codes[:3]}")
        n = len(rows)
        h1 = sum(1 for r in rows if r[2] == 1)
        h3 = sum(1 for r in rows if r[2] and r[2] <= 3)
        if n:
            print(f"\nhit@1 {h1}/{n} ({h1 / n:.0%})   hit@3 {h3}/{n} ({h3 / n:.0%})   mode {mode}   "
                  f"library {len(have)} reels   skipped {len(skipped)}")
        else:
            print("no query could be scored")
        out = REPO_ROOT / "eval" / "results.md"
        out.parent.mkdir(exist_ok=True)
        lines = [
            "# Search recall", "",
            f"- Date: {now_utc().strftime('%Y-%m-%d %H:%M UTC')}",
            "- Command: `python -m scripts.eval_recall` (from `server/`)",
            f"- Hybrid mode: {mode} (vector weight {search.WEIGHTS['vector']}, text weight {search.WEIGHTS['text']})",
            f"- Embedding model: {s.gemini_embed_model}, {s.embed_dim} dimensions",
            f"- Library searched: {len(have)} reels from the sample cache",
            f"- Queries scored: {n} of {len(queries)} in `fixtures/queries.csv`"
            + (f" ({len(skipped)} skipped because their reel is not in the cache yet)" if skipped else ""),
        ]
        if n:
            lines += [f"- hit@1: {h1}/{n} ({h1 / n:.0%})", f"- hit@3: {h3}/{n} ({h3 / n:.0%})"]
        lines += ["", "A hit means the expected reel is at that rank or better in the hybrid search results.",
                  "The set is small, so read these as a smoke test, not a benchmark.", "",
                  "| query | expected | rank | top 3 |", "|---|---|---|---|"]
        for query, expected, rank, top in rows:
            lines.append(f"| {query} | {expected} | {rank or 'miss'} | {', '.join(top)} |")
        if skipped:
            lines += ["", "Skipped (expected reel not in the sample cache):", ""]
            lines += [f"- {query} (expects {expected})" for query, expected in skipped]
        out.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
        print(f"wrote {out.relative_to(REPO_ROOT)}")
        return 0 if n else 1
    finally:
        if temp:
            accounts.delete_user_data(temp["_id"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
