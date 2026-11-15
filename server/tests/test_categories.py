"""Custom categories (pure, no database): names, grouping, and how the graph files them."""
import numpy as np

from realize import categories, graph


def test_clean_tidies_names_and_refuses_fixed_kinds():
    assert categories.clean("pets") == "Pets"
    assert categories.clean("  home   decor! ") == "Home decor"
    assert categories.clean("#comedy") == "Comedy"
    # A fixed kind's name, or a catch-all, isn't a category: those reels belong elsewhere.
    for name in ["Food", "events", "Places", "Fitness", "Products", "Learning", "Just vibes", "other", "Misc"]:
        assert categories.clean(name) is None, name
    assert categories.clean("") is None
    assert categories.clean(None) is None
    assert categories.clean("far too many words for one") is None


def test_snap_reuses_an_existing_category():
    assert categories.snap("pet", ["Pets", "Fashion"]) == "Pets"
    assert categories.snap("FASHION!", ["Pets", "Fashion"]) == "Fashion"
    assert categories.snap("Cars", ["Pets"]) == "Cars"


def test_group_split_label_and_query():
    assert categories.group({"type": "recipe", "category": "Pets"}) == "recipe"  # only other has one
    assert categories.group({"type": "other", "category": "Pets"}) == "other:Pets"
    assert categories.group({"type": "other"}) == "other"
    assert categories.group({"type": None}) is None
    assert categories.split("other:Home decor") == ("other", "Home decor")
    assert categories.split("place") == ("place", None)
    assert categories.label("other:Pets") == "Pets"
    assert categories.label("other") == "Just vibes"
    assert categories.label("recipe") == "Food"
    assert categories.query("other:Pets") == {"type": "other", "category": "Pets"}
    assert categories.query("recipe") == {"type": "recipe"}
    assert categories.query("other") == {"type": "other", "category": {"$not": {"$type": "string"}}}
    assert categories.seen_key("other:St. Louis") == "other:St_ Louis"


def test_graph_files_folders_under_their_category():
    v = [1.0, 0.0, 0.0]
    saves = [
        {"type": "other", "category": "Pets", "subcategory": "Dogs", "embedding": v},
        {"type": "other", "category": "Pets", "subcategory": "Dogs", "embedding": v},
        {"type": "other", "subcategory": "Memes", "embedding": v},
        {"type": "recipe", "subcategory": "Dessert", "embedding": v},
    ]
    cents = graph.centroids(saves)
    assert set(cents) == {"other:Pets/Dogs", "other/Memes", "recipe/Dessert"}
    dogs = cents["other:Pets/Dogs"]
    assert (dogs["group"], dogs["type"], dogs["category"], dogs["name"], dogs["count"]) == (
        "other:Pets", "other", "Pets", "Dogs", 2)
    assert np.allclose(dogs["vec"], v)
    assert graph.key_filter("other:Pets/Dogs") == {"type": "other", "category": "Pets", "subcategory": "Dogs"}
    assert graph.key_filter("recipe/Dessert") == {"type": "recipe", "subcategory": "Dessert"}


def test_sub_counts_add_up_rows_for_the_same_name():
    # Mongo groups a missing category apart from a null one: one folder, two rows.
    rows = [("recipe", "Weeknight dinners", 2), ("recipe", "Dessert", 1), ("recipe", "Weeknight dinners", 1),
            ("other:Comedy", "Memes", 6), (None, "Lost", 1)]
    assert categories.merge_sub_rows(rows) == {
        "recipe": [{"name": "Weeknight dinners", "count": 3}, {"name": "Dessert", "count": 1}],
        "other:Comedy": [{"name": "Memes", "count": 6}],
    }
