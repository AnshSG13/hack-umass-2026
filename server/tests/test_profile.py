"""The intro profile and starter sub-categories. Gemini and Atlas are stubbed out."""
from __future__ import annotations

import pytest

from realize import profile, subcats
from realize.api.routers.onboarding import Profile, clean_profile, starter_view

# "identity" is an answer stored by the earlier intro's gender question; it must stay harmless.
PROFILE = {"identity": "Woman", "ethnicity": ["Asian"], "age_range": "18 to 24",
           "interests": ["Food and cooking", "Meal prep"], "hobbies": ["Running"]}


def gemini_says(monkeypatch, answer):
    def generate_json(**kwargs):
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(profile.gemini, "generate_json", generate_json)
    monkeypatch.setattr(profile, "live", lambda: True)


def test_taste_lines_never_include_identity_or_ethnicity():
    text = "\n".join(profile.taste_lines(PROFILE))
    assert "Meal prep" in text and "Running" in text and "18 to 24" in text
    assert "Woman" not in text and "Asian" not in text


def test_taste_lines_skip_prefer_not_to_say():
    assert profile.taste_lines({"age_range": "Prefer not to say"}) == []


def test_clean_profile_drops_unknown_choices_and_near_duplicates():
    p = clean_profile(Profile(age_range="25 to 34", ethnicity=["White", "Martian"],
                              interests=["Travel", "travel", "Travels!"], hobbies=[""]))
    assert p["age_range"] == "25 to 34"
    assert p["ethnicity"] == ["White"]
    assert p["interests"] == ["Travel"]
    assert p["hobbies"] == []


def test_no_gender_question_and_an_old_answer_is_dropped():
    from realize.api.routers.onboarding import options
    assert "identities" not in options()
    p = clean_profile(Profile.model_validate({"identity": "Woman", "interests": ["Travel"]}))
    assert "identity" not in p
    assert p["interests"] == ["Travel"]


def test_make_starters_files_each_interest_and_hobby_under_its_kind(monkeypatch):
    gemini_says(monkeypatch, {"folders": [
        {"name": "food and cooking", "type": "recipe"},   # Gemini's casing; the user's wording wins
        {"name": "Meal prep", "type": "recipe"},
        {"name": "Running", "type": "workout"},
        {"name": "Something invented", "type": "recipe"},  # never picked: ignored
    ]})
    got = profile.make_starters(PROFILE)
    assert got == {"recipe": ["Food and cooking", "Meal prep"], "workout": ["Running"]}


def test_make_starters_leaves_out_what_fits_no_kind(monkeypatch):
    gemini_says(monkeypatch, {"folders": [{"name": "Meal prep", "type": "recipe"},
                                          {"name": "Running", "type": "none"},
                                          {"name": "Food and cooking", "type": "bogus"}]})
    assert profile.make_starters(PROFILE) == {"recipe": ["Meal prep"]}


def test_make_starters_is_empty_when_gemini_fails(monkeypatch):
    gemini_says(monkeypatch, RuntimeError("503"))
    assert profile.make_starters(PROFILE) == {}


def test_make_starters_is_empty_without_anything_to_go_on(monkeypatch):
    gemini_says(monkeypatch, {"folders": [{"name": "Dessert", "type": "recipe"}]})
    assert profile.make_starters({"identity": "Man"}) == {}


def test_starter_view_uses_type_labels_in_order():
    view = starter_view({"workout": ["Running"], "recipe": ["Dessert"]})
    assert [v["label"] for v in view] == ["Food", "Fitness"]


@pytest.fixture
def labels(monkeypatch):
    """A user who already uses "Desserts" and was given starters at the intro."""
    monkeypatch.setattr(subcats, "counts", lambda user_id, type=None: {"recipe": [{"name": "Desserts", "count": 3}]})
    monkeypatch.setattr(subcats, "_starters", lambda user_id: {
        "recipe": ["Dessert", "Weeknight dinners"], "workout": ["Running"]})
    monkeypatch.setattr(profile, "about_line", lambda user_id: "ABOUT THE USER (from their intro): Hobbies: Running")


def test_existing_offers_used_labels_then_starters(labels):
    # "Dessert" is the same label as the used "Desserts", so it isn't offered twice.
    assert subcats.existing("u_1", "recipe") == ["Desserts", "Weeknight dinners"]
    assert subcats.existing("u_1", "workout") == ["Running"]


def test_a_new_reel_snaps_onto_a_starter(labels):
    assert subcats.resolve("u_1", "recipe", "weeknight dinner") == "Weeknight dinners"
    assert subcats.resolve("u_1", "recipe", "Thai") == "Thai"  # none fits: a new one


def test_prompt_line_has_the_profile_and_the_starters(labels):
    line = subcats.prompt_line("u_1")
    assert line.startswith("ABOUT THE USER")
    assert "recipe: Desserts, Weeknight dinners" in line
    assert "workout: Running" in line
