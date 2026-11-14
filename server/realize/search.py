"""Hybrid search over saves: Atlas Vector Search + Atlas Search (SPEC 11).

Fusion is $rankFusion when the cluster supports it, else reciprocal rank fusion
in code. HYBRID_MODE=auto tries $rankFusion once and falls back for the
lifetime of the process.
"""
from __future__ import annotations

import logging
import re
from datetime import timedelta

from pymongo.errors import OperationFailure

from . import db, gemini
from .actions import ingredient_line
from .config import get_settings
from .timeutil import now_utc

log = logging.getLogger("realize.search")

SEARCHABLE = ["planned", "enriching", "ready"]
WEIGHTS = {"vector": 0.6, "text": 0.4}
RRF_K = 60
TEXT_PATHS = ["title", "summary", "caption", "transcript_text", "on_screen_text", "tags",
              "creator.handle", "entities.name"]
PROJECT_OUT = {"embedding": 0, "transcript": 0}
PROJECT_FUSED = {"transcript": 0}  # the embedding stays until the relevance check, then is dropped
# Vector search always returns its nearest neighbours, even for nonsense. Measured on the
# sample library (scripts/eval_recall queries, gemini-embedding-001 at 768 dims): the right
# reel scored 0.565 to 0.80 cosine, unrelated queries topped out at 0.578. A result is kept
# when it shares a word with the query or clears this floor.
MIN_COSINE = 0.60
STOP = {"the", "and", "for", "with", "that", "this", "what", "which", "from", "how", "can", "did",
        "you", "your", "should", "make", "one", "ever", "got", "are", "was", "where", "want", "reel"}
EMBED_BUDGET = 6000
# Atlas Search indexes a document a few seconds after it is written (about 5 s measured on
# a fresh demo session). Saves newer than this are read straight from the collection, so a
# reel saved a moment ago is already in its owner's search.
FRESH_SECONDS = 120
FRESH_LIMIT = 40

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


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def _relevant(doc: dict, query: str, qvec: list[float]) -> bool:
    emb = doc.get("embedding")
    if emb and len(emb) == len(qvec) and sum(a * b for a, b in zip(emb, qvec)) >= MIN_COSINE:
        return True
    words = {_stem(w) for w in _TOK.findall(query.lower()) if len(w) >= 3 and w not in STOP}
    if not words:
        return False
    blob = " ".join(str(x) for x in (
        doc.get("title"), doc.get("summary"), doc.get("caption"), doc.get("transcript_text"),
        " ".join(doc.get("on_screen_text") or []), " ".join(doc.get("tags") or []),
        (doc.get("creator") or {}).get("handle"),
        " ".join(e.get("name", "") for e in doc.get("entities") or [] if isinstance(e, dict))) if x)
    have = {_stem(w) for w in _TOK.findall(blob.lower())}
    return bool(words & have)


def _cosine(doc: dict, qvec: list[float]) -> float:
    emb = doc.get("embedding")
    if not emb or len(emb) != len(qvec):
        return 0.0
    return sum(a * b for a, b in zip(emb, qvec))


def _fresh(uid: str, t: str | None, have: set) -> list[dict]:
    """This user's saves written in the last FRESH_SECONDS that the index didn't return."""
    cutoff = now_utc() - timedelta(seconds=FRESH_SECONDS)
    q: dict = {"user_id": uid, "status": {"$in": SEARCHABLE},
               "$or": [{"created_at": {"$gte": cutoff}}, {"planned_at": {"$gte": cutoff}},
                       {"ready_at": {"$gte": cutoff}}]}
    if t:
        q["type"] = t
    if have:
        q["_id"] = {"$nin": list(have)}
    return list(db.saves().find(q, PROJECT_FUSED).sort("created_at", -1).limit(FRESH_LIMIT))


def _finish(docs: list[dict], query: str, qvec: list[float], limit: int,
            uid: str | None = None, t: str | None = None) -> list[dict]:
    """Drop results that aren't relevant, then add this user's just-written saves."""
    out = [d for d in docs if _relevant(d, query, qvec)]
    if uid:
        fresh = [d for d in _fresh(uid, t, {d["_id"] for d in docs}) if _relevant(d, query, qvec)]
        fresh.sort(key=lambda d: -_cosine(d, qvec))
        for f in fresh:
            # Indexed results keep their fused order; a fresh save goes ahead of the first
            # one it beats on similarity.
            score = _cosine(f, qvec)
            at = next((i for i, d in enumerate(out) if _cosine(d, qvec) < score), len(out))
            out.insert(at, f)
    for d in out:
        d.pop("embedding", None)
    return out[:limit]


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
        {"$limit": max(limit, 20)}, {"$project": PROJECT_FUSED},
    ]
    return _finish(list(db.saves().aggregate(pipeline)), query, qvec, limit, uid, t)


def _manual(uid: str, query: str, qvec: list[float], t: str | None, limit: int) -> list[dict]:
    vector, text = _pipelines(uid, query, qvec, t)
    docs: dict = {}
    ranked: dict[str, list] = {}
    for name, pipe in (("vector", vector), ("text", text)):
        ids = []
        try:
            for d in db.saves().aggregate(pipe + [{"$project": PROJECT_FUSED}]):
                docs[d["_id"]] = d
                ids.append(d["_id"])
        except OperationFailure as e:
            log.warning("search leg %s failed: %s", name, str(e)[:160])
        ranked[name] = ids
    return _finish([docs[i] for i in rrf_merge(ranked)], query, qvec, limit, uid, t)


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
            found = list(db.saves().aggregate(text + [{"$limit": limit}, {"$project": PROJECT_OUT}]))
        except OperationFailure:
            found = []
        # No query vector: just-written saves are matched on words alone.
        recent = [d for d in _fresh(user_id, type, {d["_id"] for d in found}) if _relevant(d, query, [])]
        for d in recent:
            d.pop("embedding", None)
        return (found + recent)[:limit], "text"
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
