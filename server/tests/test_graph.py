"""The knowledge graph: edges and graph-assisted retrieval. Atlas and Gemini are stubbed out."""
from __future__ import annotations

import numpy as np
import pytest
from bson import ObjectId

from realize import graph


def unit(*xs: float) -> list[float]:
    v = np.asarray(xs, dtype=float)
    return (v / np.linalg.norm(v)).tolist()


def save(type_: str, sub: str | None, vec: list[float], title: str = "reel") -> dict:
    return {"_id": ObjectId(), "type": type_, "subcategory": sub, "embedding": vec, "title": title}


def test_centroids_group_by_type_and_sub_category():
    c = graph.centroids([save("recipe", "Desserts", unit(1, 0, 0)), save("recipe", "Desserts", unit(0, 1, 0)),
                         save("recipe", None, unit(0, 0, 1)), save("place", "Desserts", unit(0, 0, 1))])
    assert set(c) == {"recipe/Desserts", "place/Desserts"}  # same label, different type: two nodes
    assert c["recipe/Desserts"]["count"] == 2
    assert np.allclose(c["recipe/Desserts"]["vec"], unit(1, 1, 0))


def cents(**vecs: list[float]) -> dict:
    return {k.replace("__", "/"): {"type": k.split("__")[0], "name": k.split("__")[1], "count": 1,
                                   "vec": np.asarray(v)} for k, v in vecs.items()}


def test_related_edges_need_mutual_neighbours_above_the_floor():
    c = cents(recipe__Desserts=unit(1, 0.1, 0, 0), recipe__Baking=unit(1, 0.2, 0, 0),
              product__Bags=unit(0.8, 0, 0.6, 0), tip__Focus=unit(0, 0, 0, 1))
    edges = {(a, b) for a, b, _ in graph.related_edges(c)}
    assert ("recipe/Baking", "recipe/Desserts") in edges
    assert not any("tip/Focus" in e for e in edges)  # far from everything


def test_related_edges_drop_one_sided_neighbours(monkeypatch):
    monkeypatch.setattr(graph, "RELATED_K", 1)
    # Bags' closest is Desserts, but Desserts' closest is Baking: not mutual, no edge.
    c = cents(recipe__Desserts=unit(1, 0.05, 0), recipe__Baking=unit(1, 0.1, 0), product__Bags=unit(1, -0.4, 0.1))
    edges = {(a, b) for a, b, _ in graph.related_edges(c)}
    assert edges == {("recipe/Baking", "recipe/Desserts")}


def test_build_shows_interests_and_hobbies_as_folders(monkeypatch):
    from datetime import datetime, timezone
    reel = save("recipe", "Desserts", unit(1, 0, 0), "Tiramisu")
    reel["created_at"] = datetime.now(timezone.utc)
    monkeypatch.setattr(graph, "_load", lambda uid: [reel])
    user = {"_id": "u_1", "profile": {"starters": {"recipe": ["Dessert"], "workout": ["Pickleball"]}}}
    g = graph.build(user)
    subs = {n["label"]: n for n in g["nodes"] if n["kind"] == "sub"}
    assert set(subs) == {"Desserts", "Pickleball"}         # "Dessert" is the same folder as "Desserts"
    assert subs["Desserts"]["from_intro"] and subs["Desserts"]["count"] == 1
    assert subs["Pickleball"]["from_intro"] and subs["Pickleball"]["count"] == 0
    assert any(n["id"] == "type:workout" for n in g["nodes"])  # its kind is drawn with no reels yet
    assert {"source": "type:workout", "target": "sub:workout/Pickleball", "kind": "has"} in g["links"]
    assert not any(n["kind"] == "interest" for n in g["nodes"])


class FakeSaves:
    def __init__(self, docs):
        self.docs = docs

    def find(self, q, projection=None):
        pairs = {(p["type"], p["subcategory"]) for p in q["$or"]}
        skip = set(q["_id"]["$nin"])
        out = [d for d in self.docs if (d["type"], d["subcategory"]) in pairs and d["_id"] not in skip]
        return type("Cursor", (), {"limit": lambda self, n: out[:n]})()


@pytest.fixture
def library(monkeypatch):
    docs = {
        "hit": save("recipe", "Quick dinners", unit(1, 0, 0), "Chickpea curry"),
        "sibling": save("recipe", "Quick dinners", unit(0.9, 0.44, 0), "Chicken au poivre"),
        "neighbour": save("recipe", "Desserts", unit(0.2, 0.98, 0), "Tiramisu"),
    }
    monkeypatch.setattr(graph.db, "saves", lambda: FakeSaves(list(docs.values())))
    monkeypatch.setattr(graph, "related_map", lambda uid: {"recipe/Quick dinners": ["recipe/Desserts"]})
    return docs


def test_expand_adds_on_topic_siblings_after_the_hits(library):
    out = graph.expand("u_1", [dict(library["hit"])], unit(1, 0.2, 0), None, room=4)
    assert [d["title"] for d in out] == ["Chicken au poivre"]
    assert out[0]["via_graph"] is True


def test_expand_skips_a_neighbour_sub_category_that_is_off_topic(library):
    # The query is about dinners; Desserts is related to Quick dinners in the graph, but its
    # centroid is far from the query, so its reel isn't added.
    titles = [d["title"] for d in graph.expand("u_1", [dict(library["hit"])], unit(1, 0.2, 0), None, room=4)]
    assert "Tiramisu" not in titles


def test_expand_does_nothing_without_room_hits_or_a_query_vector(library):
    hit = dict(library["hit"])
    assert graph.expand("u_1", [hit], unit(1, 0, 0), None, room=0) == []
    assert graph.expand("u_1", [], unit(1, 0, 0), None, room=3) == []
    assert graph.expand("u_1", [hit], [0.0, 0.0, 0.0], None, room=3) == []


def test_expand_respects_the_type_filter(library):
    assert graph.expand("u_1", [dict(library["hit"])], unit(1, 0.2, 0), "workout", room=3) == []
