"""Sub-category labels: cleaning and snapping onto existing ones (pure, no database)."""
from realize.subcats import clean, key, snap


def test_clean_tidies_case_and_punctuation():
    assert clean("dessert") == "Dessert"
    assert clean("  quick   dinners! ") == "Quick dinners"
    assert clean("#thai") == "Thai"
    assert clean("DESSERT") == "Dessert"
    assert clean("BBQ") == "BBQ"
    assert clean("Thai food") == "Thai food"
    assert clean("date_night") == "Date night"


def test_clean_rejects_empty_long_and_non_strings():
    assert clean("") is None
    assert clean("   #  ") is None
    assert clean(None) is None
    assert clean(42) is None
    assert clean("a label that is much too long to be a group") is None
    assert clean("one two three four five") is None


def test_key_ignores_case_spacing_and_plural():
    assert key("Desserts") == key("dessert") == key("DESSERT!")
    assert key("Quick dinners") == key("quick dinner")
    assert key("Glass") == "glass"  # a double s is not a plural
    assert key("Mac & cheese") == key("mac and cheese")


def test_snap_reuses_existing_label():
    existing = ["Dessert", "Thai", "Quick dinners"]
    assert snap("Desserts", existing) == "Dessert"
    assert snap("quick dinner", existing) == "Quick dinners"
    assert snap("Italian", existing) == "Italian"
    assert snap(None, existing) is None
    assert snap("Thai", []) == "Thai"
