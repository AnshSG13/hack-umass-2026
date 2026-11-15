"""Nutrition answers: when the web search runs, and which numbers are kept. No network."""
from realize import web_nutrition as nu

RECIPE = {"type": "recipe"}
SOURCES = [{"n": 1, "title": "budgetbytes.com", "url": "https://www.budgetbytes.com/curry/"},
           {"n": 2, "title": "usda.gov", "url": "https://fdc.nal.usda.gov/x"},
           {"n": 3, "title": "unused.example", "url": "https://unused.example/"}]


def test_which_questions_trigger_the_search():
    for q in ["What are the macros?", "how many calories per serving", "Is it high protein?",
              "carbs in this?", "Nutrition facts please", "is this keto", "How much sodium is in it"]:
        assert nu.wants_nutrition(RECIPE, q), q
    for q in ["Can I use chicken instead?", "How long does it take?", "What pan should I use?"]:
        assert not nu.wants_nutrition(RECIPE, q), q
    assert not nu.wants_nutrition({"type": "place"}, "how many calories is the burger")


def test_only_sourced_plausible_numbers_are_kept_and_sources_renumbered():
    raw = {"basis": "published", "per": "serving", "servings": 4,
           "calories": 451.6, "calories_source": 2, "protein_g": 14, "protein_g_source": 2,
           "carbs_g": 52, "carbs_g_source": 0,            # no source: dropped
           "fat_g": 21, "fat_g_source": 9,                # not a real source: dropped
           "sodium_mg": 99999, "sodium_mg_source": 1,   # implausible: dropped
           "fiber_g": 11, "fiber_g_source": 1}
    m = nu.clean(raw, SOURCES, 2)
    assert m["values"] == {"calories": {"value": 452, "source": 1}, "protein_g": {"value": 14, "source": 1},
                           "fiber_g": {"value": 11, "source": 2}}
    assert [s["url"] for s in m["sources"]] == [SOURCES[1]["url"], SOURCES[0]["url"]]
    assert m["servings"] == 4


def test_nothing_usable_means_no_numbers():
    assert nu.clean({"basis": "none", "per": "serving"}, SOURCES, 4) is None
    only_fiber = {"basis": "estimated", "per": "serving", "fiber_g": 9, "fiber_g_source": 1}
    assert nu.clean(only_fiber, SOURCES, 4) is None          # needs calories or a main macro
    no_source = {"basis": "estimated", "per": "serving", "calories": 400, "calories_source": 0}
    assert nu.clean(no_source, SOURCES, 4) is None


def test_note_with_a_number_is_dropped():
    raw = {"basis": "estimated", "per": "recipe", "calories": 1800, "calories_source": 1,
           "note": "Light coconut milk cuts about 200 calories."}
    assert nu.clean(raw, SOURCES, None)["note"] == ""
    ok = {**raw, "note": "Light coconut milk would lower the fat."}
    assert nu.clean(ok, SOURCES, None)["note"] == "Light coconut milk would lower the fat."


def test_the_sentence_is_written_from_the_kept_numbers():
    m = nu.clean({"basis": "published", "per": "serving", "servings": 4, "calories": 450, "calories_source": 1,
                  "protein_g": 14, "protein_g_source": 1, "carbs_g": 52, "carbs_g_source": 1, "fat_g": 21,
                  "fat_g_source": 1}, SOURCES, None)
    assert nu.sentence(m) == ("Per serving (the recipe makes 4): about 450 calories, 14 g protein, 52 g carbs, "
                              "21 g fat. These are the numbers published for this recipe.")
    est = nu.clean({"basis": "estimated", "per": "recipe", "protein_g": 60, "protein_g_source": 2}, SOURCES, None)
    assert nu.sentence(est) == ("For the whole recipe: about 60 g protein. This is an estimate from the "
                                "ingredients. The reel doesn't give nutrition.")
