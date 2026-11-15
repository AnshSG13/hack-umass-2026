"""Slow path: watch the video with Gemini, ground it, merge, replan, embed (SPEC 9)."""
from __future__ import annotations

import logging
import re
import shutil
import tempfile

from . import actions, db, gemini, planner, planops, search, subcats
from .config import get_settings
from .models import ENRICH_SCHEMA, TYPES, clean_fields
from .runs import Run
from .timeutil import now_utc

log = logging.getLogger("realize.enrich")

MAX_DURATION_S = 600

PROMPT = """Transcribe all speech verbatim with timestamps. List every on-screen text overlay exactly as
written, including quantities and units. Describe what is physically shown, step by step,
in at most 120 words. Then fill type, title, summary, fields, entities and tags using only what
appears in the video or the caption below. When they disagree, trust speech and on-screen text
over the caption. Write card text in English; if the video is in another language, translate
and set language to the original language code. Write the title and summary in plain words:
say what the video is, the way a friend would. Never use the words leverage, leveraging,
pivotal, intricate, showcasing, synergy, delve, realm, robust, streamlined, transformative,
seamless or game-changer. If there is no speech, return an empty
transcript and has_speech=false; if the audio is only music, set music_only=true.
{subcategory_guide}
{existing}
CAPTION: \"\"\"{caption}\"\"\""""

STOPWORDS = {"a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "at", "by", "from",
             "de", "la", "le", "el", "s"}


# ---------- grounding (pure) ----------


def normalize(text: str) -> str:
    """Lowercase, strip punctuation, drop a trailing 's' from each word."""
    words = re.findall(r"[a-z0-9]+", (text or "").lower().replace("'", "").replace("’", ""))
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words)


def is_grounded(name: str, corpus_norm: str) -> bool:
    n = normalize(name)
    if not n:
        return False
    if n in corpus_norm:
        return True
    tokens = [t for t in n.split() if t not in STOPWORDS]
    words = set(corpus_norm.split())
    return bool(tokens) and all(t in words for t in tokens)


def ground(result: dict, caption: str) -> dict:
    """Drop entities the caption, transcript and on-screen text don't support.
    Place and product names that aren't found are kept but listed as unverified."""
    transcript_text = " ".join(t.get("text", "") for t in result.get("transcript") or [])
    corpus = normalize(" ".join([caption or "", transcript_text, " ".join(result.get("on_screen_text") or [])]))
    kept, dropped = [], []
    for e in result.get("entities") or []:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        (kept if is_grounded(e["name"], corpus) else dropped).append(e)
    unverified: list[str] = []
    fields = result.get("fields") or {}
    for p in ((fields.get("place") or {}).get("places") or []):
        if isinstance(p, dict) and p.get("name") and not is_grounded(p["name"], corpus):
            unverified.append(p["name"])
    for it in ((fields.get("product") or {}).get("items") or []):
        if isinstance(it, dict) and it.get("name") and not is_grounded(it["name"], corpus):
            unverified.append(it["name"])
    return {"entities": kept, "dropped": [e["name"] for e in dropped], "unverified": unverified,
            "transcript_text": transcript_text.strip()}


# ---------- Gemini video call ----------


def analyze_video(path: str, caption: str, existing: str = "") -> tuple[dict, str | None]:
    """Upload, wait for ACTIVE, one structured-output call. Returns (result, gemini_file_name).
    The caller deletes the file."""
    s = get_settings()
    f = gemini.upload_video(path)
    try:
        result = gemini.generate_json(
            role="video",
            input=[{"type": "video", "uri": f.uri, "mime_type": f.mime_type or "video/mp4"},
                   {"type": "text", "text": PROMPT.format(
                       caption=(caption or "")[:3000], subcategory_guide=subcats.GUIDE,
                       existing=existing or "EXISTING CATEGORIES: none yet")}],
            schema=ENRICH_SCHEMA, timeout_s=180, thinking="low", retries=2)
    except Exception:
        gemini.delete_file(f.name)
        raise
    return result, f.name


def merge_fields(save: dict, result: dict, grounded: dict) -> dict:
    """The $set for a save, never overwriting fields the user edited."""
    kind = result.get("type") if result.get("type") in TYPES else (save.get("type") or "other")
    update = {
        "type": kind,
        "title": " ".join(str(result.get("title") or "").split())[:60] or save.get("title"),
        "summary": str(result.get("summary") or "")[:500] or save.get("summary"),
        "fields": clean_fields(kind, result.get("fields")) or (save.get("fields") if kind == save.get("type") else {}),
        "transcript": [{"start_sec": float(t.get("start_sec") or 0), "text": str(t.get("text") or "")}
                       for t in (result.get("transcript") or []) if isinstance(t, dict) and t.get("text")],
        "transcript_text": grounded["transcript_text"],
        "on_screen_text": [str(x) for x in (result.get("on_screen_text") or []) if str(x).strip()][:60],
        "visual_summary": str(result.get("visual_summary") or "")[:1200],
        "entities": grounded["entities"][:40],
        "tags": [str(t).lower().lstrip("#") for t in (result.get("tags") or []) if str(t).strip()][:8],
        "unverified": grounded["unverified"],
        "language": result.get("language") or "en",
        "category": subcats.clean(result.get("category")) or save.get("category"),
        "subcategory": subcats.clean(result.get("subcategory")) or (
            save.get("subcategory") if not subcats.clean(result.get("category")) else None),
    }
    edited = set(save.get("user_edited") or [])
    return {k: v for k, v in update.items() if k not in edited}


# ---------- enrich job (worker, enrich lane) ----------


def run_enrich_job(save: dict, user: dict) -> None:
    """Raises ReelError on a transient download failure so the lane can retry.
    Permanent failures and too-long videos finish the save as ready with enrich_error."""
    from . import ytdlp

    sid = save["_id"]
    s = get_settings()
    db.saves().update_one({"_id": sid}, {"$set": {"status": "enriching"}})
    run = Run(user, sid, "enrich", s.gemini_model_video)
    tmpdir = tempfile.mkdtemp(prefix="rl_enrich_")
    file_name: str | None = None

    def finish(enrich_error: str | None = None, extra: dict | None = None) -> None:
        db.saves().update_one({"_id": sid}, {"$set": {
            "status": "ready", "ready_at": now_utc(), "enrich_error": enrich_error, **(extra or {})}})

    try:
        if save.get("duration_sec") and save["duration_sec"] > MAX_DURATION_S:
            finish("too_long")
            run.finish("done")
            return
        try:
            with run.step("download_video", {"url": save["url"]}) as h:
                path, meta = ytdlp.download(save["url"], tmpdir)
                h["result"] = {"bytes": path.stat().st_size, "duration_sec": meta.get("duration_sec")}
        except ytdlp.ReelError as e:
            if e.permanent:
                finish(e.reason)
                run.finish("failed", str(e))
                return
            run.finish("failed", str(e))
            raise
        duration = meta.get("duration_sec") or save.get("duration_sec")
        if duration and duration > MAX_DURATION_S:
            finish("too_long", {"duration_sec": duration})
            run.finish("done")
            return

        with run.step("analyze_video", {"model": s.gemini_model_video}) as h:
            result, file_name = analyze_video(str(path), save.get("caption") or "",
                                              subcats.prompt_line(save["user_id"]))
            used = gemini.last_model.get("video")
            if used and used != s.gemini_model_video:
                db.agent_runs().update_one({"_id": run.id}, {"$set": {"model": used}})
            h["result"] = {"type": result.get("type"), "title": result.get("title"),
                           "has_speech": result.get("has_speech"), "music_only": result.get("music_only"),
                           "transcript_lines": len(result.get("transcript") or []),
                           "on_screen": len(result.get("on_screen_text") or [])}

        with run.step("grounding") as h:
            grounded = ground(result, save.get("caption") or "")
            h["result"] = {"kept": len(grounded["entities"]), "dropped": len(grounded["dropped"]),
                           "dropped_names": grounded["dropped"][:10], "unverified": grounded["unverified"]}

        update = merge_fields(save, result, grounded)
        if "category" in update:
            # Snap both onto this person's labels; a category they set themselves stays.
            cat, sub_ = subcats.resolve(save["user_id"], update["category"], update.get("subcategory"))
            update["category"] = cat
            if "subcategory" in update:
                update["subcategory"] = sub_
        actions.fix_event_year(update.get("fields"), save.get("posted_at"))
        if duration and not save.get("duration_sec"):
            update["duration_sec"] = duration
        db.saves().update_one({"_id": sid}, {"$set": update})
        was_caption_sufficient = save.get("caption_sufficient", True)
        save = db.saves().find_one({"_id": sid})

        # Replan only while the plan is still proposed, and only if the video changed the picture.
        plan = planops.get_for_save(sid)
        if plan and plan["status"] == "proposed" and (not was_caption_sufficient or save.get("type") != plan["kind"]):
            with run.step("replan", {"reason": "caption was not enough" if not was_caption_sufficient
                                     else f"type changed from {plan['kind']} to {save.get('type')}"}) as h:
                new_plan, status = planner.run_planner(save, user, run_kind="replan", with_enrichment=True,
                                                       timeout_s=planner.PROPOSE_TIMEOUT_S)
                h["result"] = {"status": status, "kind": new_plan.get("kind"),
                               "options": [o["label"] for o in new_plan.get("options") or []]}

        with run.step("embed") as h:
            text = search.embedding_text(save, full=True)
            vec = gemini.embed_one(text, "RETRIEVAL_DOCUMENT")
            db.saves().update_one({"_id": sid}, {"$set": {"embedding": vec, "embedding_source": "full"}})
            h["result"] = {"chars": len(text), "dims": len(vec)}

        finish(None)
        run.finish("done")
    except Exception as e:
        if not isinstance(e, ytdlp.ReelError):
            run.finish("failed", str(e))
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        gemini.delete_file(file_name)
