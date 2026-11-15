"""Shopping research stays on the reel's topic: who the reel is for, and dropping picks that
don't fit. No network."""
from realize import shop


def test_who_a_reel_is_for():
    assert shop.audience("10/10 SoCal Asian Male Fashion Recommendations Products > Fashion") == "men"
    assert shop.audience("Fall jackets every woman needs. Best picks for women") == "women"
    assert shop.audience("Best budget skincare for dry skin") is None
    assert shop.audience("Gifts for him and her") is None  # both: no rule


def test_off_topic_picks_are_dropped():
    assert shop.off_topic({"product": "Wide Leg Pants", "note": "Women's Smart Wide Pants"}, "men")
    assert not shop.off_topic({"product": "Unisex Ultra Stretch Active Wide Pants", "note": ""}, "men")
    assert not shop.off_topic({"product": "Men's Stretch Easy Ankle Pants", "note": ""}, "men")
    assert shop.off_topic({"product": "Men's Oxford Shirt", "note": ""}, "women")
    assert shop.off_topic({"product": "Tote Bag", "note": "", "fits_reel": False}, None)  # the model's call
    assert not shop.off_topic({"product": "Women's Parka", "note": ""}, None)  # no audience: no rule


def test_keep_offers_drops_a_womens_item_on_a_mens_reel():
    sources = [{"n": 1, "title": "Uniqlo", "url": "https://www.uniqlo.com/us/en/products/E1"},
               {"n": 2, "title": "New Balance", "url": "https://www.newbalance.com/pd/550/BB550.html"}]
    raw = [
        {"product": "Wide Leg Pants", "store": "Uniqlo", "price_text": "$39.90", "note": "Women's Smart Wide Pants",
         "alternative": False, "source": 1, "fits_reel": True},
        {"product": "550 Sneakers", "store": "New Balance", "price_text": "$59.99", "note": "Sale",
         "alternative": False, "source": 2, "fits_reel": True},
    ]
    kept = shop.keep_offers(raw, sources, ["Uniqlo", "New Balance"], "men")
    assert [o["product"] for o in kept] == ["550 Sneakers"]


def test_the_search_is_told_what_the_reel_is_about():
    save = {"title": "10/10 SoCal Asian Male Fashion Recommendations", "summary": "Fashion picks for men.",
            "subcategory": "Fashion"}
    ctx = shop.reel_context(save)
    prompt = shop.RESEARCH_PROMPT.format(products="- Wide Leg Pants (brand: Uniqlo)", **ctx)
    assert "Male Fashion" in prompt and "Products > Fashion" in prompt and "never the women's version" in prompt
