"""Hybrid search over saves: Atlas Vector Search + Atlas Search (SPEC 11).

Fusion is $rankFusion when the cluster supports it, else reciprocal rank fusion
in code. HYBRID_MODE=auto tries $rankFusion once and falls back for the
lifetime of the process.
"""
from __future__ import annotations

import logging
import re

from pymongo.errors import OperationFailure

from . import db, gemini
from .actions import ingredient_line
from .config import get_settings

log = logging.getLogger("realize.search")

SEARCHABLE = ["planned", "enriching", "ready"]
WEIGHTS = {"vector": 0.6, "text": 0.4}
RRF_K = 60
TEXT_PATHS = ["title", "summary", "caption", "transcript_text", "on_screen_text", "tags",
              "creator.handle", "entities.name"]
PROJECT_OUT = {"embedding": 0, "transcript": 0}
EMBED_BUDGET = 6000

_active_mode: str | None = None


def active_mode() -> str:
    """rankfusion or manual; 'auto' until the first query decides."""
    return _active_mode or get_settings().hybrid_mode


# ---------- embedding text (11.1) ----------


def fields_text(kind: str | None, fields: dict | None) -> str:
    f = (fields or {}).get(kind or "") or {}
    if not isinstance(f, dict):
        return ""
    if kind == "recipe":
        return "Ingredients: " + "; ".join(ingredient_line(i) for i in f.get("ingredients") or []
                                            if isinstance(i, dict))
    if kind == "event":
        return " ".join(str(x) for x in (f.get("name"), f.get("date_text") or f.get("start_local"),
                                         f.get("venue"), f.get("city")) if x)
    if kind == "place":
        return "Places: " + "; ".join(
            ", ".join(str(x) for x in (p.get("name"), p.get("city"), p.get("why")) if x)
            for p in f.get("places") or [] if isinstance(p, dict))
    if kind == "workout":
        return "Exercises: " + "; ".join(str(e.get("name")) for e in f.get("exercises") or []
                                          if isinstance(e, dict) and e.get("name"))
    if kind == "product":
        return "Items: " + "; ".join(
            " ".join(str(x) for x in (i.get("brand"), i.get("name")) if x)
            for i in f.get("items") or [] if isinstance(i, dict))
    if kind == "tip":
        return "Key points: " + "; ".join(str(p) for p in f.get("key_points") or [])
    return ""


def embedding_text(save: dict, full: bool) -> str:
    handle = (save.get("creator") or {}).get("handle") or ""
    parts = [
        save.get("title") or "",
        f"Type: {save.get('type') or 'other'}. Creator: @{handle}.",
        save.get("summary") or "",
        fields_text(save.get("type"), save.get("fields")),
        "Tags: " + ", ".join(save.get("tags") or save.get("hashtags") or []),
    ]
    caption = "Caption: " + (save.get("caption") or "")[:1000]
    head = "\n".join(p for p in parts if p.strip())
    if not full:
        return (head + "\n" + caption)[:EMBED_BUDGET]
    on_screen = "On screen: " + " | ".join(save.get("on_screen_text") or [])[:1000]
    budget = EMBED_BUDGET - len(head) - len(on_screen) - len(caption) - 12
    said = "Said: " + (save.get("transcript_text") or "")[: max(budget, 0)]
    return "\n".join([head, on_screen, said, caption])[:EMBED_BUDGET]


# ---------- fusion ----------


def rrf_merge(ranked: dict[str, list], weights: dict[str, float] = WEIGHTS, k: int = RRF_K) -> list:
    """Reciprocal rank fusion: score = sum(weight / (k + rank)), ranks from 1. Returns ids, best first."""
    scores: dict = {}
    first_seen: dict = {}
    order = 0
    for name, ids in ranked.items():
        w = weights.get(name, 1.0)
        for rank, _id in enumerate(ids, 1):
            scores[_id] = scores.get(_id, 0.0) + w / (k + rank)
            if _id not in first_seen:
                first_seen[_id] = order
                order += 1
    return sorted(scores, key=lambda i: (-scores[i], first_seen[i]))


def _pipelines(uid: str, query: str, qvec: list[float], t: str | None) -> tuple[list, list]:
    vfilter: dict = {"user_id": uid, "status": {"$in": SEARCHABLE}}
    if t:
        vfilter["type"] = t
    vector = [{"$vectorSearch": {"index": "saves_vector", "path": "embedding", "queryVector": qvec,
                                 "numCandidates": 150, "limit": 20, "filter": vfilter}}]
    tfilter: list = [{"equals": {"path": "user_id", "value": uid}},
                     {"in": {"path": "status", "value": SEARCHABLE}}]
    if t:
        tfilter.append({"equals": {"path": "type", "value": t}})
    text = [{"$search": {"index": "saves_text", "compound": {
        "must": [{"text": {"query": query, "path": TEXT_PATHS, "fuzzy": {"maxEdits": 1}}}],
        "filter": tfilter}}}, {"$limit": 20}]
    return vector, text


def _rankfusion(uid: str, query: str, qvec: list[float], t: str | None, limit: int) -> list[dict]:
    vector, text = _pipelines(uid, query, qvec, t)
    pipeline = [
        {"$rankFusion": {"input": {"pipelines": {"vector": vector, "text": text}},
                         "combination": {"weights": WEIGHTS}}},
        {"$limit": limit}, {"$project": PROJECT_OUT},
    ]
    return list(db.saves().aggregate(pipeline))


def _manual(uid: str, query: str, qvec: list[float], t: str | None, limit: int) -> list[dict]:
    vector, text = _pipelines(uid, query, qvec, t)
    docs: dict = {}
    ranked: dict[str, list] = {}
    for name, pipe in (("vector", vector), ("text", text)):
        ids = []
        try:
            for d in db.saves().aggregate(pipe + [{"$project": PROJECT_OUT}]):
                docs[d["_id"]] = d
                ids.append(d["_id"])
        except OperationFailure as e:
            log.warning("search leg %s failed: %s", name, str(e)[:160])
        ranked[name] = ids
    return [docs[i] for i in rrf_merge(ranked)[:limit]]


def hybrid_search(user_id: str, query: str, type: str | None = None, limit: int = 10) -> tuple[list[dict], str]:
    """Returns (saves, mode). Always filtered by user_id."""
    global _active_mode
    query = (query or "").strip()
    if not query:
        return [], active_mode()
    try:
        qvec = gemini.embed_one(query, "RETRIEVAL_QUERY")
    except Exception as e:  # noqa: BLE001 - no embedding (quota, outage): keyword search still works
        log.warning("query embedding failed (%s); text search only", str(e)[:120])
        _, text = _pipelines(user_id, query, [0.0], type)
        try:
            return list(db.saves().aggregate(text + [{"$limit": limit}, {"$project": PROJECT_OUT}])), "text"
        except OperationFailure:
            return [], "text"
    mode = _active_mode or get_settings().hybrid_mode
    if mode in ("auto", "rankfusion"):
        try:
            out = _rankfusion(user_id, query, qvec, type, limit)
            _active_mode = "rankfusion"
            return out, "rankfusion"
        except OperationFailure as e:
            if mode == "rankfusion":
                raise
            log.warning("$rankFusion unavailable (%s); using manual RRF for this process", str(e)[:120])
            _active_mode = "manual"
    return _manual(user_id, query, qvec, type, limit), "manual"


def probe_rankfusion(user_id: str = "u_probe") -> tuple[bool, str]:
    """One $rankFusion test query. Returns (worked, detail)."""
    s = get_settings()
    qvec = [0.0] * s.embed_dim
    qvec[0] = 1.0
    try:
        _rankfusion(user_id, "probe", qvec, None, 1)
        return True, "ok"
    except OperationFailure as e:
        return False, str(e)[:200]


# ---------- snippets ----------

_SENT = re.compile(r"(?<=[.!?])\s+|\n+")
_TOK = re.compile(r"[a-z0-9']+")


def snippet(save: dict, query: str, max_len: int = 140) -> str:
    """The sentence from summary, transcript or on-screen text with the most query-token overlap."""
    q = set(_TOK.findall((query or "").lower()))
    candidates: list[str] = []
    for src in (save.get("summary"), save.get("transcript_text")):
        if src:
            candidates += [c.strip() for c in _SENT.split(src) if c.strip()]
    candidates += [str(x).strip() for x in save.get("on_screen_text") or [] if str(x).strip()]
    if not candidates:
        return ""
    best = max(candidates, key=lambda c: len(q & set(_TOK.findall(c.lower()))))
    return best if len(best) <= max_len else best[: max_len - 1].rstrip() + "…"
