"""The intro profile and the first categories. Gemini and Atlas are stubbed out."""
from __future__ import annotations

import pytest

from realize import profile, subcats
from realize.api.routers.onboarding import Profile, clean_profile

PROFILE = {"identity": "Woman", "ethnicity": ["Asian"], "age_range": "18 to 24",
           "interests": ["Food and cooking", "Meal prep"], "hobbies": ["Running"]}


def test_taste_lines_never_include_identity_or_ethnicity():
    text = "\n".join(profile.taste_lines(PROFILE))
    assert "Meal prep" in text and "Running" in text and "18 to 24" in text
    assert "Woman" not in text and "Asian" not in text


def test_taste_lines_skip_prefer_not_to_say():
    assert profile.taste_lines({"age_range": "Prefer not to say"}) == []


def test_clean_profile_drops_unknown_choices_and_near_duplicates():
    p = clean_profile(Profile(identity="Robot", age_range="25 to 34", ethnicity=["White", "Martian"],
                              interests=["Travel", "travel", "Travels!"], hobbies=[""]))
    assert p["identity"] is None
    assert p["age_range"] == "25 to 34"
    assert p["ethnicity"] == ["White"]
    assert p["interests"] == ["Travel"]
    assert p["hobbies"] == []


def test_make_starters_uses_interests_and_hobbies_as_written():
    assert profile.make_starters(PROFILE) == ["Food and cooking", "Meal prep", "Running"]
    assert profile.make_starters({"interests": ["baking", "Baking!"], "hobbies": ["Pottery"]}) == ["Baking", "Pottery"]
    assert profile.make_starters({"identity": "Man"}) == []


def test_starters_reads_the_first_version_too(monkeypatch):
    class Users:
        def __init__(self, starters):
            self.doc = {"profile": {"starters": starters}}

        def find_one(self, *a, **k):
            return self.doc

    monkeypatch.setattr(profile.db, "users", lambda: Users(["Baking", "Travel"]))
    assert profile.starters("u_1") == ["Baking", "Travel"]
    monkeypatch.setattr(profile.db, "users", lambda: Users({"recipe": ["Dessert"], "event": ["Theater"]}))
    assert profile.starters("u_1") == ["Dessert", "Theater"]


@pytest.fixture
def labels(monkeypatch):
    """A user who files under "Desserts" (with "Cakes" inside) and picked Baking and Travel."""
    monkeypatch.setattr(subcats, "_filed", lambda user_id: {"Desserts": ["Cakes"], "Pottery": []})
    monkeypatch.setattr(subcats, "_starters", lambda user_id: ["Dessert", "Baking", "Travel"])
    monkeypatch.setattr(profile, "about_line", lambda user_id: "ABOUT THE USER (from their intro): Hobbies: Running")


def test_categories_are_used_ones_then_the_intro(labels):
    # "Dessert" from the intro is the same as the used "Desserts", so it isn't offered twice.
    assert subcats.categories("u_1") == ["Desserts", "Pottery", "Baking", "Travel"]


def test_a_reel_snaps_onto_existing_labels_or_makes_new_ones(labels):
    assert subcats.resolve("u_1", "baking", "cake") == ("Baking", "Cake")       # intro category, new sub
    assert subcats.resolve("u_1", "Dessert", "cake") == ("Desserts", "Cakes")   # both reused
    assert subcats.resolve("u_1", "Knitting", "Scarves") == ("Knitting", "Scarves")  # none fits: new
    assert subcats.resolve("u_1", None, "Cakes") == (None, None)


def test_prompt_line_has_the_profile_and_the_categories(labels):
    line = subcats.prompt_line("u_1")
    assert line.startswith("ABOUT THE USER")
    assert "Desserts (Cakes); Pottery; Baking; Travel" in line


def test_old_saves_show_under_their_type_name():
    assert subcats.category_of({"type": "recipe", "category": None}) == "Food"
    assert subcats.category_of({"type": "recipe", "category": "Baking"}) == "Baking"
    assert subcats.category_query("Food") == {"$or": [{"category": "Food"},
                                                      {"category": {"$in": [None, ""]}, "type": {"$in": ["recipe"]}}]}
    assert subcats.category_query("Baking") == {"category": "Baking"}
