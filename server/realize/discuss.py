"""Discussions: saved chats about one reel, kept with that reel.

Ask (ask.py) is a search agent over every save. A discussion already knows which reel it
is about, so the reel goes into the prompt from the first message: no search step, no
fetch, one model call. The person is looking at the reel's page while they type, so the
model is told what they can already see and answers the question instead of restating it.

The model writes the answer and may name the second of the spoken line it relied on.
Code checks that second against the real transcript before the page links to it.

When the reel doesn't answer the question and the web could (a place's hours, a product's
price, what a dish is, nutrition), the first call says so and a second call searches with
Gemini's Google Search tool. That answer carries numbered links to the pages it used.
"""
from __future__ import annotations

import json
import logging
import re

from bson import ObjectId

from . import db, gemini, planops, web_nutrition, websearch
from .config import get_settings
from .runs import Run
from .timeutil import as_utc, big_time, now_utc, prompt_date, tz_of

log = logging.getLogger("realize.discuss")

TIMEOUT_S = 25
MESSAGE_MAX = 1000          # characters of one question
ANSWER_MAX = 1200           # characters of one answer
TITLE_MAX = 60
KEEP_MESSAGES = 80          # a discussion keeps its newest messages; the array stays bounded
HISTORY_TURNS = 12          # messages sent back to the model
PER_SAVE = 30               # discussions listed for one reel
ALL_LIMIT = 40              # chats listed on the Ask page
SNAP_SEC = 3.0              # how far a named second may be from a real line's start
NO_ANSWER = "Ask didn't answer. Try again."

SYSTEM_PROMPT = """You are Ask, inside Realize, talking with someone about one reel they saved.
Today is {today_local} ({timezone}).

They have the reel's page open. They can already see its title, summary, the plan, and the
lists pulled from it (ingredients, steps, exercises, places, products). So:
- Answer the question they asked, first sentence first. Never open by describing the reel
  or repeating its summary, and never list back what is on the page unless they ask for it.
- Keep it short: 1 to 4 sentences. Use a short list only when they ask for steps or options.
- What the reel says comes only from the reel below. Never invent a quantity, a time, a
  price, a place or a name and present it as the reel's.
- You may add general knowledge (a substitution, a technique, how to scale, what to expect).
  When you do, say it isn't from the reel, in plain words such as "The reel doesn't say."
- Plain sentence case. No em dashes. No headings. No markdown except "- " list lines.
- at_sec: when one spoken line in the transcript supports your answer, give that line's
  start second exactly as it is written in the transcript. Otherwise -1.
- from_reel: true when the answer comes from the reel, false when it is general knowledge.
- needs_web: true when the reel doesn't answer the question and a web search would: facts about
  a place, product, person, dish or event named in the reel or the question; prices, opening
  hours, dates, tickets, availability; reviews; nutrition; anything current; how-tos that need
  specifics. Then put a short search query in search_for, and text can be one line saying you'll
  look it up. false when the reel answers it, or it is a matter of taste or small talk.
- follow_ups: up to 2 short questions they would likely ask next about this reel, in their
  voice, under 48 characters each ("Can I freeze it?"). None that the page already answers.

THE REEL
{reel}"""

ANSWER_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "The answer, 1 to 4 short sentences"},
        "at_sec": {"type": "integer", "description": "Start second of the supporting transcript line, or -1"},
        "from_reel": {"type": "boolean"},
        "needs_web": {"type": "boolean"},
        "search_for": {"type": "string", "description": "A short web search query, when needs_web"},
        "follow_ups": {"type": "array", "items": {"type": "string"},
                       "description": "Up to 2 short next questions, under 48 characters each"},
    },
    "required": ["text", "at_sec", "from_reel", "needs_web"],
}

WEB_PROMPT = """You are Ask, inside Realize, talking with someone about one reel they saved.
Today is {today_local} ({timezone}). They asked something the reel doesn't answer, so search
the web for it.
- Answer the question, first sentence first, in 1 to 4 short sentences, specific to this
  reel's place, product, recipe or event. Use a short "- " list only for options or steps.
- Use only what the search results say. If they don't settle it, say so plainly.
- Never present something from the web as something the reel said.
- Plain sentence case. No em dashes. No headings. No markdown except "- " list lines.

THE REEL
{reel}"""


# ---------- what the model is given ----------


def _clock(sec: float) -> str:
    s = max(0, int(sec))
    return f"{s // 60}:{s % 60:02d}"


def reel_context(save: dict, plan: dict | None, user: dict) -> str:
    """Everything known about the reel, as text. Sizes are capped so one long video
    can't crowd out the question."""
    creator = (save.get("creator") or {}).get("handle")
    parts = [
        f"Title: {save.get('title') or 'Untitled'}",
        f"Type: {save.get('type') or 'unknown'}",
    ]
    if creator:
        parts.append(f"Creator: @{creator}")
    if save.get("summary"):
        parts.append(f"Summary: {save['summary']}")
    if save.get("fields"):
        parts.append("Pulled from the reel (JSON): " + json.dumps(save["fields"], default=str)[:5000])
    if (save.get("caption") or "").strip():
        parts.append("Caption: " + save["caption"].strip()[:1200])
    on_screen = [str(x).strip() for x in save.get("on_screen_text") or [] if str(x).strip()][:40]
    if on_screen:
        parts.append("Written on screen:\n" + "\n".join(f"- {x}" for x in on_screen))
    lines = [ln for ln in save.get("transcript") or [] if (ln.get("text") or "").strip()]
    if lines:
        text = "\n".join(f"[{int(ln.get('start_sec') or 0)}] {ln['text'].strip()}" for ln in lines)
        parts.append("Transcript, each line as [start second] words:\n" + text[:7000])
    elif save.get("transcript_text"):
        parts.append("Transcript: " + save["transcript_text"][:7000])
    else:
        parts.append("Transcript: none. The video has no speech, or it hasn't been watched yet.")
    if save.get("unverified"):
        parts.append("Not confirmed in the video: " + ", ".join(str(u) for u in save["unverified"][:12]))
    if (save.get("note") or "").strip():
        parts.append("Their own note on it: " + save["note"].strip())
    if plan:
        tz = tz_of(user)
        when = (big_time(as_utc(plan["scheduled_for"]).astimezone(tz), now_utc().astimezone(tz))
                if plan.get("scheduled_for") else None)
        parts.append(f"Their plan for it: {plan.get('status')}" + (f", {when}" if when else ""))
    return "\n\n".join(parts)


def snap_second(save: dict, at_sec) -> int | None:
    """The transcript line the model pointed at, or None when there is no such line."""
    try:
        want = float(at_sec)
    except (TypeError, ValueError):
        return None
    if want < 0:
        return None
    starts = [float(ln.get("start_sec") or 0) for ln in save.get("transcript") or []
              if (ln.get("text") or "").strip()]
    if not starts:
        return None
    best = min(starts, key=lambda s: abs(s - want))
    return int(best) if abs(best - want) <= SNAP_SEC else None


def clean_answer(text: str) -> str:
    """The copy rules, enforced: no em dashes, no markdown emphasis, capped length."""
    out = re.sub(r"\s*\u2014\s*", ", ", text or "").replace("\u2013", "-").replace("**", "").replace("__", "")
    # Web answers sometimes come back as markdown: "* " lists and "#" headings become plain lines.
    out = "\n".join(re.sub(r"^\s*[*•]\s+", "- ", re.sub(r"^\s*#+\s*", "", line)).rstrip()
                    for line in out.strip().splitlines())
    while "\n\n\n" in out:
        out = out.replace("\n\n\n", "\n\n")
    return out[:ANSWER_MAX].strip()


def clean_follow_ups(raw) -> list[str]:
    """At most 2 short, distinct questions, sentence case, no em dashes; others are dropped."""
    out: list[str] = []
    for x in raw if isinstance(raw, list) else []:
        q = " ".join(str(x).replace("—", ",").split()).strip(" \"'")
        if q and q[0].islower():
            q = q[0].upper() + q[1:]
        if 3 <= len(q) <= 48 and q.lower() not in [o.lower() for o in out]:
            out.append(q)
    return out[:2]


def title_from(message: str) -> str:
    """A discussion is named after its first question."""
    t = " ".join((message or "").split())
    return t if len(t) <= TITLE_MAX else t[: TITLE_MAX - 1].rstrip() + "…"


def answer(user: dict, save: dict, history: list[dict], message: str) -> dict:
    """One model call. Returns {"text", "at_sec", "from_reel"}. Raises when Gemini doesn't answer."""
    s = get_settings()
    tz = tz_of(user)
    plan = planops.get_for_save(save["_id"])
    system = SYSTEM_PROMPT.replace("Realize", s.app_name).format(
        today_local=prompt_date(now_utc().astimezone(tz)), timezone=str(tz),
        reel=reel_context(save, plan, user))
    lines = []
    for turn in history[-HISTORY_TURNS:]:
        who = "Them" if turn.get("role") == "user" else "You"
        lines.append(f"{who}: {str(turn.get('text') or '')[:800]}")
    text = (("Earlier in this discussion:\n" + "\n".join(lines) + "\n\nTheir new message: ") if lines else "") \
        + message[:MESSAGE_MAX]
    run = Run(user, None, "discuss", s.gemini_model_fast)
    if web_nutrition.wants_nutrition(save, message):
        # Reels almost never give nutrition: look it up, and keep only sourced numbers.
        try:
            reply = web_nutrition.answer(save, message, run.step)
            run.finish("done")
            return reply
        except Exception as e:  # noqa: BLE001
            log.warning("nutrition lookup failed: %s", str(e)[:200])
            run.finish("failed", str(e))
            raise
    if websearch.wants_web(message):
        # They asked for a web search in so many words: go straight there, about this reel.
        title = " ".join(str(save.get("title") or "").split())
        query = websearch.query_from(message)
        if title and title.lower() not in query.lower():
            query = f"{title}: {query}"
        try:
            web = web_answer(user, save, plan, text, query, run)
        except Exception as e:  # noqa: BLE001
            log.warning("web search failed: %s", str(e)[:200])
            run.finish("failed", str(e))
            raise
        run.finish("done")
        return web or {"text": websearch.NOT_FOUND, "at_sec": None, "from_reel": False, "web": True,
                       "sources": [], "macros": None}
    try:
        out = gemini.generate_json(role="fast", input=[gemini.user_step(text)], schema=ANSWER_SCHEMA,
                                   system=system, timeout_s=TIMEOUT_S)
        body = clean_answer(str(out.get("text") or ""))
        if out.get("needs_web"):
            try:
                web = web_answer(user, save, plan, text, str(out.get("search_for") or message), run)
            except Exception as e:  # noqa: BLE001 - fall back to what the reel-only call said
                log.warning("web answer failed: %s", str(e)[:200])
                web = None
            if web:
                run.finish("done")
                return web
        if not body:
            raise RuntimeError("empty answer")
        run.finish("done")
        return {"text": body, "at_sec": snap_second(save, out.get("at_sec")),
                "from_reel": bool(out.get("from_reel")),
                "follow_ups": clean_follow_ups(out.get("follow_ups"))}
    except Exception as e:  # noqa: BLE001
        log.warning("discussion failed: %s", str(e)[:200])
        run.finish("failed", str(e))
        raise


def web_answer(user: dict, save: dict, plan: dict | None, text: str, query: str, run: Run) -> dict | None:
    """Search the web for what the reel doesn't say. Returns None when the search gave no
    source to link, so nothing unsourced is shown as found on the web."""
    s = get_settings()
    tz = tz_of(user)
    system = WEB_PROMPT.replace("Realize", s.app_name).format(
        today_local=prompt_date(now_utc().astimezone(tz)), timezone=str(tz),
        reel=reel_context(save, plan, user)[:6000])
    with run.step("web_search", {"query": query[:200]}) as h:
        raw, sources = websearch.grounded(system, f"{text}\n\n(Search for: {query[:200]})")
        h["result"] = {"sources": len(sources)}
    body = clean_answer(raw)
    if not body or not sources:
        return None
    return {"text": body, "at_sec": None, "from_reel": False, "web": True, "sources": sources,
            "macros": None}


# ---------- storage ----------


def list_for_save(save: dict, user: dict) -> list[dict]:
    cur = db.discussions().find(
        {"user_id": user["_id"], "save_id": save["_id"]},
        {"title": 1, "updated_at": 1, "count": 1, "messages": {"$slice": -1}},
    ).sort("updated_at", -1).limit(PER_SAVE)
    return [summary_view(d) for d in cur]


def get(discussion_id: str, user: dict) -> dict | None:
    _id = db.oid(discussion_id)
    return db.discussions().find_one({"_id": _id, "user_id": user["_id"]}) if _id else None


def append(user: dict, save: dict, discussion: dict | None, message: str, reply: dict) -> dict:
    """Write one question and its answer. Both go in together, so a failed call leaves nothing."""
    now = now_utc()
    pair = [
        {"role": "user", "text": message, "at": now},
        {"role": "assistant", "text": reply["text"], "at": now,
         "at_sec": reply.get("at_sec"), "from_reel": reply.get("from_reel", True),
         "follow_ups": reply.get("follow_ups") or []},
    ]
    if reply.get("web"):
        # Looked up on the web: the links its numbers came from travel with the answer.
        pair[1].update({"web": True, "sources": reply.get("sources") or [], "macros": reply.get("macros")})
    if discussion is None:
        doc: dict = {"_id": ObjectId(), "user_id": user["_id"], "save_id": save["_id"],
                     "title": title_from(message), "messages": pair, "count": 2,
                     "created_at": now, "updated_at": now}
        if user.get("expires_at"):
            doc["expires_at"] = user["expires_at"]
        db.discussions().insert_one(doc)
        return doc
    db.discussions().update_one(
        {"_id": discussion["_id"], "user_id": user["_id"]},
        {"$push": {"messages": {"$each": pair, "$slice": -KEEP_MESSAGES}},
         "$inc": {"count": 2}, "$set": {"updated_at": now}})
    return db.discussions().find_one({"_id": discussion["_id"], "user_id": user["_id"]})


def append_ask(user: dict, chat: dict | None, message: str, answer: dict, cards: list[dict]) -> dict:
    """Keep one Ask turn (a question about all their saves): the answer, the reels it showed
    and its next questions. Same collection as reel chats, with no save_id."""
    now = now_utc()
    pair = [
        {"role": "user", "text": message[:MESSAGE_MAX], "at": now},
        {"role": "assistant", "text": str(answer.get("text") or "")[:ANSWER_MAX], "at": now,
         "confidence": answer.get("confidence"), "follow_ups": answer.get("follow_ups") or [],
         "cards": cards[:6]},
    ]
    if answer.get("web"):
        # A web search they asked for: the pages it used travel with the answer.
        pair[1].update({"web": True, "sources": answer.get("sources") or [], "macros": None})
    if chat is None:
        doc: dict = {"_id": ObjectId(), "user_id": user["_id"], "save_id": None, "kind": "ask",
                     "title": title_from(message), "messages": pair, "count": 2,
                     "created_at": now, "updated_at": now}
        if user.get("expires_at"):
            doc["expires_at"] = user["expires_at"]
        db.discussions().insert_one(doc)
        return doc
    db.discussions().update_one(
        {"_id": chat["_id"], "user_id": user["_id"]},
        {"$push": {"messages": {"$each": pair, "$slice": -KEEP_MESSAGES}},
         "$inc": {"count": 2}, "$set": {"updated_at": now}})
    return db.discussions().find_one({"_id": chat["_id"], "user_id": user["_id"]})


def get_ask(chat_id: str | None, user: dict) -> dict | None:
    """An Ask chat of this user's (not a reel chat), or None."""
    d = get(chat_id, user) if chat_id else None
    return d if d and d.get("save_id") is None else None


def list_all(user: dict, limit: int = ALL_LIMIT) -> list[dict]:
    """Every chat, Ask and reel ones together, newest first, each with its reel when it has one."""
    docs = list(db.discussions().find(
        {"user_id": user["_id"]},
        {"title": 1, "updated_at": 1, "count": 1, "save_id": 1, "kind": 1, "messages": {"$slice": -1}},
    ).sort("updated_at", -1).limit(limit))
    ids = [d["save_id"] for d in docs if d.get("save_id")]
    reels = {s["_id"]: s for s in db.saves().find({"_id": {"$in": ids}, "user_id": user["_id"]},
                                                 {"title": 1, "thumb_id": 1, "type": 1})} if ids else {}
    from . import tickets  # late: tickets imports a lot

    out = []
    for d in docs:
        row = summary_view(d)
        s = reels.get(d.get("save_id"))
        if d.get("save_id") and not s:
            continue  # the reel was deleted; its chats go with it
        row["kind"] = "reel" if s else "ask"
        row["reel"] = ({"save_id": str(s["_id"]), "title": s.get("title") or "Saved reel",
                        "type": s.get("type"), "thumb_url": tickets.thumb_url(s)} if s else None)
        out.append(row)
    return out


def delete(discussion_id: str, user: dict) -> bool:
    _id = db.oid(discussion_id)
    if not _id:
        return False
    return db.discussions().delete_one({"_id": _id, "user_id": user["_id"]}).deleted_count == 1


# ---------- views ----------


def _message_view(m: dict) -> dict:
    out = {"role": m.get("role"), "text": m.get("text") or "",
           "at": as_utc(m["at"]).isoformat() if m.get("at") else None}
    if m.get("role") == "assistant":
        sec = m.get("at_sec")
        out["at_sec"] = sec if isinstance(sec, int) else None
        out["at_label"] = _clock(sec) if isinstance(sec, int) else None
        out["from_reel"] = bool(m.get("from_reel", True))
        out["follow_ups"] = [str(q) for q in m.get("follow_ups") or []][:2]
        if "cards" in m:  # an Ask turn: the reels it showed, as they were then
            out["cards"] = m.get("cards") or []
            out["confidence"] = m.get("confidence")
        if m.get("web"):
            out["web"] = True
            out["sources"] = m.get("sources") or []
            out["macros"] = m.get("macros")
    return out


def summary_view(d: dict) -> dict:
    last = (d.get("messages") or [{}])[-1]
    count = int(d.get("count") or len(d.get("messages") or []))
    return {"id": str(d["_id"]), "title": d.get("title") or "Chat",
            "questions": max(1, count // 2),
            "updated_at": as_utc(d["updated_at"]).isoformat(),
            "preview": (last.get("text") or "")[:140]}


def view(d: dict) -> dict:
    return {**summary_view(d), "save_id": str(d["save_id"]) if d.get("save_id") else None,
            "kind": "reel" if d.get("save_id") else "ask",
            "messages": [_message_view(m) for m in d.get("messages") or []]}
