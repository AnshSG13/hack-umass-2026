"""The knowledge graph: how a person's saves, sub-categories and kinds connect.

Nodes
  type      a kind of save ("Food"), the top of the hierarchy
  sub       a sub-category inside a type ("Food > Baking")
  save      one reel
            Interests and hobbies from the intro are sub-categories too (profile.starters),
            drawn even before a reel lands in them, marked from_intro.

Edges
  has       type -> sub (the hierarchy)
  holds     sub -> save, or type -> save when the save has no sub-category yet
  related   sub <-> sub, when the centroids of their saves' embeddings are close. This is the
            part a flat list can't show: "Food > Baking" sits next to "Places > Bakeries".

Every number here is computed in code from embeddings already stored on the saves; the only
model calls happen elsewhere (embedding saves, filing interests under a type at the intro).

Retrieval uses the same graph (`expand`): after hybrid search, saves in the top hits'
sub-categories and their related sub-categories are added when they are still close to the
query, to fill the result list past what the vector index returned.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

import numpy as np

from . import db, subcats
from .models import TASTE_LABELS

log = logging.getLogger("realize.graph")

SEARCHABLE = ["planned", "enriching", "ready"]
# Gemini embeddings of short reels sit close together (on a 16-reel sample library the median
# centroid-to-centroid cosine was 0.717), so a fixed cutoff links unrelated things. Edges are
# relative instead: mutual nearest neighbours.
RELATED_K = 2           # "related" when each is among the other's K closest sub-categories
RELATED_MIN = 0.75      # and their centroid cosine is at least this
MAX_SAVES = 300         # newest saves drawn as nodes
EXPAND_ANCHORS = 3      # top hits whose sub-categories seed expansion
EXPAND_RELATED = 2      # related sub-categories followed from each anchor
EXPAND_MIN = 0.55       # query cosine a graph neighbour still needs
ROUTE_MARGIN = 0.03     # a neighbouring sub-category's centroid must match the query within this
                        # of the best anchor's centroid, so expansion stays on topic


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n else v


def sub_key(type_: str | None, sub: str | None) -> str | None:
    return f"{type_}/{sub}" if type_ and sub else None


# ---------- loading and caching ----------


def _signature(user_id: str) -> str:
    """Changes whenever a searchable save is added, removed, re-filed or re-embedded."""
    rows = db.saves().find({"user_id": user_id, "status": {"$in": SEARCHABLE}},
                           {"type": 1, "subcategory": 1, "embedding_source": 1}).sort("_id", 1)
    h = hashlib.sha1()
    for r in rows:
        h.update(f"{r['_id']}|{r.get('type')}|{r.get('subcategory')}|{r.get('embedding_source')};".encode())
    return h.hexdigest()


def _load(user_id: str) -> list[dict]:
    return list(db.saves().find(
        {"user_id": user_id, "status": {"$in": SEARCHABLE}, "embedding": {"$type": "array"}},
        {"type": 1, "subcategory": 1, "title": 1, "thumb_id": 1, "embedding": 1, "created_at": 1}))


def centroids(saves: list[dict]) -> dict[str, dict]:
    """{sub_key: {type, name, count, vec}} from the saves' embeddings."""
    groups: dict[str, list] = {}
    meta: dict[str, tuple[str, str]] = {}
    for s in saves:
        k = sub_key(s.get("type"), s.get("subcategory"))
        if not k or not s.get("embedding"):
            continue
        groups.setdefault(k, []).append(s["embedding"])
        meta[k] = (s["type"], s["subcategory"])
    out = {}
    for k, vecs in groups.items():
        out[k] = {"type": meta[k][0], "name": meta[k][1], "count": len(vecs),
                  "vec": _unit(np.asarray(vecs, dtype=float).mean(axis=0))}
    return out


def related_edges(cents: dict[str, dict]) -> list[tuple[str, str, float]]:
    """Undirected sub-to-sub edges between mutual nearest neighbours, closest first."""
    keys = list(cents)
    if len(keys) < 2:
        return []
    m = np.stack([cents[k]["vec"] for k in keys])
    sims = m @ m.T
    np.fill_diagonal(sims, -np.inf)
    top = [set(np.argsort(-sims[i])[:RELATED_K].tolist()) for i in range(len(keys))]
    pairs = []
    for i in range(len(keys)):
        for j in top[i]:
            if i < j and i in top[j] and sims[i, j] >= RELATED_MIN:
                a, b = sorted((keys[i], keys[j]))
                pairs.append((a, b, round(float(sims[i, j]), 3)))
    return sorted(pairs, key=lambda p: -p[2])


def related_map(user_id: str) -> dict[str, list[str]]:
    """{sub_key: [related sub_keys, closest first]}, cached until the saves change."""
    sig = _signature(user_id)
    cache = db.graph_cache().find_one({"_id": user_id}, {"sig": 1, "related": 1}) or {}
    if cache.get("sig") == sig and isinstance(cache.get("related"), list):
        pairs = cache["related"]
    else:
        # Stored as [a, b] pairs, not a dict: labels can hold "." and can't be field names.
        pairs = [[a, b] for a, b, _ in related_edges(centroids(_load(user_id)))]
        update: dict[str, Any] = {"sig": sig, "related": pairs}
        u = db.users().find_one({"_id": user_id}, {"expires_at": 1}) or {}
        if u.get("expires_at"):
            update["expires_at"] = u["expires_at"]  # demo accounts: the TTL index removes it too
        db.graph_cache().update_one({"_id": user_id}, {"$set": update}, upsert=True)
    rel: dict[str, list[str]] = {}
    for a, b in pairs:  # closest first, as related_edges sorted them
        rel.setdefault(a, []).append(b)
        rel.setdefault(b, []).append(a)
    return rel


# ---------- the graph for the page ----------


def _starters(user: dict) -> dict[str, list[str]]:
    raw = ((user.get("profile") or {}).get("starters")) or {}
    return {t: [x for x in v if isinstance(x, str) and x.strip()]
            for t, v in raw.items() if t in TASTE_LABELS and isinstance(v, list)}


def build(user: dict) -> dict[str, Any]:
    """Nodes and links for react-force-graph, plus counts for the page's header."""
    uid = user["_id"]
    saves = _load(uid)
    cents = centroids(saves)
    rel = related_edges(cents)
    starters = _starters(user)

    nodes: list[dict] = []
    links: list[dict] = []
    type_counts: dict[str, int] = {t: 0 for t in starters}
    for s in saves:
        if s.get("type") in TASTE_LABELS:
            type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1
    for t, n in type_counts.items():
        nodes.append({"id": f"type:{t}", "kind": "type", "type": t, "label": TASTE_LABELS[t], "count": n})

    # Folders with reels, then the intro's interests and hobbies that don't have one yet.
    intro = {(t, subcats.key(x)) for t, xs in starters.items() for x in xs}
    subs = [(k, c["type"], c["name"], c["count"]) for k, c in cents.items() if c["type"] in type_counts]
    have = {(t, subcats.key(name)) for _, t, name, _ in subs}
    for t, xs in starters.items():
        for x in xs:
            if (t, subcats.key(x)) not in have:
                have.add((t, subcats.key(x)))
                subs.append((sub_key(t, x), t, x, 0))
    for k, t, name, count in subs:
        nodes.append({"id": f"sub:{k}", "kind": "sub", "type": t, "label": name, "count": count,
                      "from_intro": (t, subcats.key(name)) in intro})
        links.append({"source": f"type:{t}", "target": f"sub:{k}", "kind": "has"})

    newest = sorted(saves, key=lambda s: s["created_at"], reverse=True)[:MAX_SAVES]
    for s in newest:
        t = s.get("type")
        if t not in type_counts:
            continue
        nid = f"save:{s['_id']}"
        nodes.append({"id": nid, "kind": "save", "type": t, "label": s.get("title") or "Untitled reel",
                      "save_id": str(s["_id"]),
                      "thumb_url": f"/api/t/{s['thumb_id']}" if s.get("thumb_id") else None})
        k = sub_key(t, s.get("subcategory"))
        links.append({"source": f"sub:{k}" if k in cents else f"type:{t}", "target": nid, "kind": "holds"})
    for a, b, sim in rel:
        links.append({"source": f"sub:{a}", "target": f"sub:{b}", "kind": "related", "weight": sim})
    return {
        "nodes": nodes, "links": links,
        "counts": {"saves": len(saves), "types": sum(1 for n in type_counts.values() if n),
                   "subcategories": len(subs), "related": len(rel),
                   "from_intro": sum(1 for n in nodes if n.get("from_intro"))},
    }


# ---------- graph-assisted retrieval ----------


def expand(user_id: str, hits: list[dict], qvec: list[float], type_: str | None, room: int) -> list[dict]:
    """Saves next to the top hits in the graph that are still close to the query.

    Hits must still carry their embeddings and sub-categories. Returns at most `room`
    docs, closest first, each marked `via_graph`, with embeddings left on for the caller.
    """
    if room <= 0 or not hits or not qvec or not any(qvec):
        return []
    anchors = [k for k in (sub_key(h.get("type"), h.get("subcategory")) for h in hits[:EXPAND_ANCHORS]) if k]
    if not anchors:
        return []
    rel = related_map(user_id)
    keys: list[str] = []
    for k in anchors:
        for x in [k, *rel.get(k, [])[:EXPAND_RELATED]]:
            if x not in keys:
                keys.append(x)
    pairs = [{"type": k.split("/", 1)[0], "subcategory": k.split("/", 1)[1]} for k in keys]
    if type_:
        pairs = [p for p in pairs if p["type"] == type_]
    if not pairs:
        return []
    have = [h["_id"] for h in hits]
    cands = list(db.saves().find(
        {"user_id": user_id, "status": {"$in": SEARCHABLE}, "_id": {"$nin": have}, "$or": pairs,
         "embedding": {"$type": "array"}},
        {"transcript": 0}).limit(60))
    if not cands:
        return []
    q = _unit(np.asarray(qvec, dtype=float))
    # How well each sub-category as a whole matches the query: its centroid, from the hits
    # and candidates in it. Neighbours only count when they're about as on-topic as the anchors.
    route = {k: float(c["vec"] @ q) for k, c in centroids(
        [h for h in hits if h.get("embedding")] + cands).items()}
    best = max((route[k] for k in anchors if k in route), default=None)
    if best is None:
        return []
    scored = []
    for c in cands:
        k = sub_key(c.get("type"), c.get("subcategory"))
        if route.get(k, -1.0) < best - ROUTE_MARGIN:
            continue
        s = float(_unit(np.asarray(c["embedding"], dtype=float)) @ q)
        if s >= EXPAND_MIN:
            c["via_graph"] = True
            scored.append((s, c))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:room]]
