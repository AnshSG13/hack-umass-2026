"""Web search when someone asks for it in so many words ("search the web for...", "look it
up online", "google..."), in Ask and in a reel's chat.

The search is Gemini's Google Search tool. Code keeps the answer only when the search came
back with at least one source it can link, puts [n] markers where the model cited them, and
resolves Google's redirect links to the real pages.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

from . import gemini, trip
from .config import get_settings
from .timeutil import now_utc, prompt_date, tz_of

TIMEOUT_S = 50

# Plain words people use when they want the internet, not their saves or the reel.
EXPLICIT = re.compile(
    r"\b(search|look|check|find|browse)\b[^.?!]{0,20}\b(the\s+)?(web|internet|online|google)\b"
    r"|\bweb\s*search\b|\bgoogle\s+(it|this|that|for|what|how|where|when|who|the|a|an)\b|^\s*google\b"
    r"|\blook\s+(it|this|that)\s+up\b|\bon\s+the\s+(web|internet)\b"
    r"|\bwhat\s+(does|do|is)\s+the\s+(web|internet)\b|\b(the\s+)?(web|internet)\s+says?\b",
    re.I)
LEAD = re.compile(
    r"^\s*(can you |could you |please |pls )*(do a )?(web search|search (the )?(web|internet|online)|"
    r"look (it |this |that )?up( online| on the (web|internet))?|google|check online|search online)"
    r"( for| about| on| to see| whether| if)?[\s,:]*", re.I)

ASK_PROMPT = """You are Ask, inside Reelize. The person asked you to search the web.
Today is {today_local} ({timezone}).
- Search with Google and answer what they asked, first sentence first, in 1 to 5 short
  sentences. Use a short "- " list only for options or steps.
- Use only what the search results say. If they don't settle it, say so plainly.
- The saved reels below are only context for what they mean ("the place I saved"). Never
  present something from the web as something a reel said.
- Plain sentence case. No em dashes. No headings. No markdown except "- " list lines.

SAVES THAT MAY BE WHAT THEY MEAN
{saves}"""

NOT_FOUND = "I searched the web but didn't find a source I can link for that, so I won't guess."


def wants_web(message: str) -> bool:
    """They asked for a web search in so many words."""
    return bool(EXPLICIT.search(message or ""))


def query_from(message: str) -> str:
    """The thing to search for, without "search the web for" in front."""
    q = LEAD.sub("", " ".join((message or "").split())).strip(" ?.!")
    return (q or message or "")[:200]


def grounded(system: str, prompt: str) -> tuple[str, list[dict]]:
    """One Google Search grounded answer: its text with [n] markers, and the sources those
    markers point at (real page links, not Google redirects)."""
    sources: list[dict] = []
    it = gemini.create_interaction(TIMEOUT_S, role="fast", store=False, system_instruction=system,
                                   input=prompt, tools=[{"type": "google_search"}],
                                   generation_config={"thinking_level": "low"})
    parts: list[str] = []
    for step in getattr(it, "steps", None) or []:
        if getattr(step, "type", None) != "model_output":
            continue
        for block in getattr(step, "content", None) or []:
            if getattr(block, "type", None) != "text":
                continue
            raw = getattr(block, "text", "") or ""
            anns = [{"url": getattr(a, "url", None), "title": getattr(a, "title", None),
                     "end": getattr(a, "end_index", None)}
                    for a in (getattr(block, "annotations", None) or [])
                    if getattr(a, "type", None) == "url_citation"]
            cited = trip.cite(raw, anns, sources).strip()
            # The same text can come back in more than one block: keep it once.
            if cited and not any(cited == p or cited in p for p in parts):
                parts = [p for p in parts if p not in cited] + [cited]
    if sources:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for src, real in zip(sources, pool.map(trip._resolve, [x["url"] for x in sources])):
                src["url"] = real
    return "\n".join(parts).strip(), [{"n": x["n"], "title": x.get("title") or "", "url": x["url"]}
                                      for x in sources]


def ask_answer(user: dict, message: str, history: list[dict], clean, saves: list[dict] | None = None) -> dict:
    """Ask's answer to an explicit web search: {"text", "sources"}. With no linkable source the
    text says so and sources is empty. `clean` tidies the model's text (discuss.clean_answer).
    `saves` are their closest saves, so "the place I saved" means something to the search."""
    s = get_settings()
    tz = tz_of(user)
    listed = "\n".join(f"- {d.get('title') or 'Saved reel'}: {' '.join(str(d.get('summary') or '').split())[:240]}"
                       for d in (saves or [])[:3])
    system = ASK_PROMPT.replace("Reelize", s.app_name).format(
        today_local=prompt_date(now_utc().astimezone(tz)), timezone=str(tz), saves=listed or "(none)")
    earlier = "\n".join(f"{'Them' if t.get('role') == 'user' else 'You'}: {str(t.get('text') or '')[:600]}"
                        for t in history[-4:])
    prompt = (f"Earlier in this chat:\n{earlier}\n\n" if earlier else "") + \
        f"Their message: {message[:1000]}\n\n(Search for: {query_from(message)})"
    text, sources = grounded(system, prompt)
    body = clean(text)
    if not body or not sources:
        return {"text": NOT_FOUND, "sources": []}
    return {"text": body, "sources": sources}
