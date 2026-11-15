"""Build the demo story's results once and keep them on the samples.

Run from server/:
  python -m scripts.build_demo_story            # build both
  python -m scripts.build_demo_story --check    # print what is stored, build nothing

The guided first open shows two finished things without waiting on a model: the answer to
"What are the macros per serving?" on the story recipe (a web search with sources), and a
trip plan with day one planned in detail on the story place reel. This script makes them
for real, once, in a throwaway demo account, copies them onto the samples, then deletes the
account. Paid: about 6 Gemini calls plus a few web searches.
"""
from __future__ import annotations

import argparse
import sys
import time

from realize import accounts, db, demo, discuss, trip
from realize.timeutil import now_utc

QUESTION = "What are the macros per serving?"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    a = p.parse_args()
    recipe = demo.sample_for(demo.STORY_RECIPE)
    place = demo.sample_for(demo.STORY_TRIP)
    if not recipe or not place:
        print("The story samples aren't in sample_cache. Run python -m scripts.build_samples first.")
        return 1
    if a.check:
        msgs = recipe.get("story_discussion") or []
        st = place.get("story_trip") or {}
        print("story_discussion:", len(msgs), "messages;", (msgs[-1].get("text") or "")[:120] if msgs else "")
        print("story_trip:", len(st.get("days") or []), "days,", len(st.get("sources") or []), "sources")
        return 0

    user, _ = accounts.create_user(None, is_demo=True, label="story-builder")
    try:
        # 1. The macros answer, through the same chat code people use.
        save = demo.save_doc_from_sample(user, recipe, status="ready", source="sample")
        save["_id"] = db.saves().insert_one(save).inserted_id
        t0 = time.monotonic()
        reply = discuss.answer(user, save, [], QUESTION)
        print(f"answer in {time.monotonic() - t0:.1f}s: {reply['text'][:160]}")
        if not reply.get("web") or not reply.get("sources"):
            print("The answer came back without sources; not storing it.")
            return 1
        msgs = [{"role": "user", "text": QUESTION},
                {"role": "assistant", "text": reply["text"], "at_sec": reply.get("at_sec"),
                 "from_reel": False, "web": True, "sources": reply["sources"], "macros": reply.get("macros")}]
        db.sample_cache().update_one({"_id": demo.STORY_RECIPE}, {"$set": {"story_discussion": msgs}})

        # 2. The trip plan, with day one planned in detail.
        psave = demo.save_doc_from_sample(user, place, status="ready", source="sample")
        psave["_id"] = db.saves().insert_one(psave).inserted_id
        t1 = time.monotonic()
        trip.start_build(psave, user)
        trip.build(psave["_id"], user["_id"])
        doc = trip.get_for_save(psave["_id"], user["_id"])
        if not doc or doc.get("status") != "ready":
            print("The trip didn't build; not storing it.", (doc or {}).get("error"))
            return 1
        trip.start_day(doc, 0)
        trip.build_day(psave["_id"], user["_id"], 0)
        doc = trip.get_for_save(psave["_id"], user["_id"])
        print(f"trip in {time.monotonic() - t1:.1f}s: {len(doc['days'])} days, {len(doc['sources'])} sources, "
              f"day one detail {doc['days'][0].get('detail_status')}")
        keep = {k: doc[k] for k in ("days", "sources", "city", "region", "country", "weather_place",
                                    "stay", "heads_up") if k in doc}
        keep["built_at"] = now_utc()
        db.sample_cache().update_one({"_id": demo.STORY_TRIP}, {"$set": {"story_trip": keep}})
        print("stored on the samples")
        return 0
    finally:
        accounts.delete_user_data(user["_id"])


if __name__ == "__main__":
    raise SystemExit(main())
