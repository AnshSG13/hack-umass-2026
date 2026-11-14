"""Build the sample cache from fixtures/reels.csv rows with sample=yes.

Run from server/: python -m scripts.build_samples [--only SHORTCODE] [--no-reuse] [--plans-only]

For each row: metadata, thumbnail, enrichment (Gemini video), embedding and the
planner run as a template user with default prefs, then an upsert into
sample_cache. Idempotent. Rows that fail are skipped and reported.

Quota care (free-tier Gemini keys allow few requests a day):
- By default a reel that some user already has as a fully enriched save is reused
  instead of being downloaded and watched again (--no-reuse turns this off).
- If the planner is rate limited, the cached plan is derived from the enrichment
  by code and marked source "code". --plans-only reruns just the planner for those.
"""
from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
import tempfile
from datetime import timedelta

from realize import accounts, db, demo, enrich, gemini, planner, planops, search, thumbs, ytdlp
from realize.config import REPO_ROOT
from realize.models import TYPES
from realize.timeutil import now_utc

DAY_WORDS = re.compile(
    r"\b(today|tonight|tomorrow|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|"
    r"thursday|friday|saturday|sunday|weekend|\d{1,2}(:\d{2})?\s?(am|pm))\b", re.I)
GENERIC = {
    "recipe": ("Make this for dinner?", "You cook on weeknights and this slot is free."),
    "workout": ("Do this workout?", "It fits one of your workout mornings."),
    "place": ("Go here this weekend?", "Your weekend has room for it."),
    "event": ("Go to this?", "It has a set date, so it goes on your calendar."),
    "product": ("Look into this?", "A reminder gives you time to think it over."),
    "tip": ("Come back to this?", "A reminder in a week helps it stick."),
    "other": ("Keep this one?", "Nothing to do here. It's in your library."),
}


def dateless(text: str, fallback: str) -> str:
    """cached_plan holds no dates: drop wording that names a day or a time."""
    return fallback if (not text or DAY_WORDS.search(text)) else text


def reuse_source(shortcode: str) -> dict | None:
    return db.saves().find_one({"shortcode": shortcode, "status": "ready", "embedding_source": "full",
                                "enrich_error": None, "from_cache": {"$ne": True},
                                "transcript_text": {"$exists": True}}, sort=[("ready_at", -1)])


def sample_thumb(src_thumb_id: str | None, url: str | None) -> str | None:
    """A sample-owned copy of the thumbnail (owner None, never deleted with a save)."""
    raw = thumbs.get_bytes(src_thumb_id)
    if raw:
        return thumbs.store(raw, None)
    return thumbs.fetch_and_store(url, None)


def build_enrichment(url: str, reuse: bool) -> tuple[dict, dict, str | None, list[float], str]:
    """Returns (metadata, enrichment, thumb_id, embedding, how)."""
    code = url.rstrip("/").split("/")[-1]
    src = reuse_source(code) if reuse else None
    if src:
        meta = {k: src.get(k) for k in ("caption", "hashtags", "creator", "posted_at", "duration_sec")}
        enr = {k: src.get(k) for k in demo.ENRICH_KEYS}
        return meta, enr, sample_thumb(src.get("thumb_id"), None), src["embedding"], "reused an enriched save"
    meta = ytdlp.fetch_metadata(url)
    thumb_id = sample_thumb(None, meta.pop("thumbnail_url", None))
    tmp = tempfile.mkdtemp(prefix="rl_sample_")
    file_name = None
    try:
        path, dl_meta = ytdlp.download(url, tmp)
        if dl_meta.get("duration_sec"):
            meta["duration_sec"] = dl_meta["duration_sec"]
        result, file_name = enrich.analyze_video(str(path), meta["caption"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        gemini.delete_file(file_name)
    grounded = enrich.ground(result, meta["caption"])
    base = {"type": None, "title": None, "summary": "", "fields": {}, "user_edited": []}
    enr = enrich.merge_fields(base, result, grounded)
    enr["caption_sufficient"] = True
    doc = {**meta, **enr}
    emb = gemini.embed_one(search.embedding_text(doc, full=True), "RETRIEVAL_DOCUMENT")
    return meta, enr, thumb_id, emb, "downloaded and watched"


def existing_planner_plan(shortcode: str, kind: str) -> dict | None:
    """A plan the live planner already wrote for this reel (any user), if its run finished normally."""
    for save in db.saves().find({"shortcode": shortcode, "from_cache": {"$ne": True}}, {"_id": 1}):
        plan = db.plans().find_one({"save_id": save["_id"], "kind": kind})
        run = db.agent_runs().find_one({"save_id": save["_id"], "kind": {"$in": ["propose", "replan"]},
                                        "status": "done", "steps.key": "propose_plan"})
        if plan and run and plan.get("question"):
            return plan
    return None


def build_cached_plan(sample: dict, template: dict, reuse: bool = True) -> dict:
    """Run the planner as the template user; fall back to a plan derived by code."""
    enr = sample["enrichment"]
    kind = enr.get("type") if enr.get("type") in TYPES else "other"
    q_fallback, why_fallback = GENERIC[kind]
    base = {"type": kind, "title": enr.get("title"), "summary": enr.get("summary"),
            "fields": enr.get("fields") or {}}
    prior = existing_planner_plan(sample["_id"], kind) if reuse else None
    if prior:
        print("    reused the plan the live planner already wrote for this reel")
        return {**base, "question": dateless(prior.get("question"), q_fallback),
                "why": dateless(prior.get("why"), why_fallback),
                "confidence": prior.get("confidence") or "best_guess",
                "actionable": bool(prior.get("actionable")), "source": "planner"}
    doc = demo.save_doc_from_sample(template, sample, status="planning", source="sample")
    db.saves().delete_many({"user_id": template["_id"], "shortcode": sample["_id"]})
    doc["_id"] = db.saves().insert_one(doc).inserted_id
    try:
        plan, status = planner.run_planner(doc, template, with_enrichment=True, timeout_s=25, raise_busy=True)
        if status != "done":
            raise RuntimeError("planner fell back")
        return {**base, "question": dateless(plan.get("question"), q_fallback),
                "why": dateless(plan.get("why"), why_fallback),
                "confidence": plan.get("confidence") or "best_guess",
                "actionable": bool(plan.get("actionable")), "source": "planner"}
    except Exception as e:  # noqa: BLE001 - rate limits, timeouts
        print(f"    planner not available ({str(e)[:90]}); cached plan derived by code")
        return {**base, "question": q_fallback, "why": why_fallback, "confidence": "best_guess",
                "actionable": kind != "other", "source": "code"}
    finally:
        plan_doc = planops.get_for_save(doc["_id"])
        if plan_doc:
            db.plans().delete_one({"_id": plan_doc["_id"]})
        db.agent_runs().delete_many({"save_id": doc["_id"]})
        db.saves().delete_one({"_id": doc["_id"]})


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--only")
    p.add_argument("--no-reuse", action="store_true")
    p.add_argument("--missing", action="store_true", help="skip reels that are already in the cache")
    p.add_argument("--plans-only", action="store_true",
                   help="only rerun the planner for samples whose cached plan was derived by code")
    a = p.parse_args()
    rows = [r for r in csv.DictReader((REPO_ROOT / "fixtures" / "reels.csv").open(encoding="utf-8"))
            if r.get("sample", "").strip().lower() == "yes"]
    template, _ = accounts.create_user(None, label="template", is_demo=True,
                                       expires_at=now_utc() + timedelta(hours=1))
    done, failed = [], []
    try:
        for order, row in enumerate(rows):
            url = row["url"].strip()
            code = url.rstrip("/").split("/")[-1]
            if a.only and a.only != code:
                continue
            existing = db.sample_cache().find_one({"_id": code})
            if a.missing and existing:
                continue
            print(f"{code} ({row['expected_type']})")
            try:
                if a.plans_only:
                    if not existing:
                        print("    not in the cache yet; skipped")
                        continue
                    if (existing.get("cached_plan") or {}).get("source") == "planner":
                        print("    cached plan already from the planner; skipped")
                        continue
                    sample = existing
                else:
                    meta, enr, thumb_id, emb, how = build_enrichment(url, not a.no_reuse)
                    print(f"    {how}: type={enr.get('type')} title={enr.get('title')!r} "
                          f"transcript_chars={len(enr.get('transcript_text') or '')}")
                    sample = {"_id": code, "url": url, "order": order,
                              "featured": row.get("featured", "").strip().lower() == "yes",
                              "expected_type": row["expected_type"], "metadata": meta,
                              "thumb_id": thumb_id, "enrichment": enr, "embedding": emb}
                    if existing and existing.get("thumb_id") and existing["thumb_id"] != thumb_id:
                        db.thumbnails().delete_one({"_id": existing["thumb_id"], "owner_user_id": None})
                sample["cached_plan"] = build_cached_plan(sample, template, reuse=not a.no_reuse)
                sample["built_at"] = now_utc()
                db.sample_cache().replace_one({"_id": code}, sample, upsert=True)
                cp = sample["cached_plan"]
                print(f"    cached plan ({cp['source']}): {cp['question']} | {cp['why']} | actionable={cp['actionable']}")
                done.append(code)
            except Exception as e:  # noqa: BLE001 - skip the row, keep going
                print(f"    FAILED: {type(e).__name__}: {str(e)[:200]}")
                failed.append(code)
    finally:
        accounts.delete_user_data(template["_id"])
    total = db.sample_cache().count_documents({})
    by_code = db.sample_cache().count_documents({"cached_plan.source": "code"})
    print(f"\nbuilt {len(done)}, failed {len(failed)}{' (' + ', '.join(failed) + ')' if failed else ''}; "
          f"sample_cache now holds {total} reels, {by_code} with a code-derived plan")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
