"""Shopping research for product reels: where to buy what the reel shows, at a good price,
from stores people trust. Runs only when the person asks for it.

Gemini searches the web and reports prices with the page each came from. Code decides what
is shown: a price is kept only when a dollar amount can be read from it and the page it came
from passes `source_of`. Any ordinary store or brand site passes, big or small (a specialist
paddle maker counts as much as Target). What is dropped is what a careful shopper would skip:
coupon and deal aggregators, marketplaces of unknown sellers, social posts, link shorteners,
plain http, bare IP addresses, lookalike hosts and domain endings mostly used for spam.
Well-known stores and review sites keep their familiar names; any other site shows its own
domain, so the person always sees where a price came from.
"""
from __future__ import annotations

import logging
import re
from datetime import timedelta
from urllib.parse import urlparse

from . import db, gemini, trip
from .timeutil import as_utc, month_day, now_utc, tz_of

log = logging.getLogger("realize.shop")

STALE_BUILD_S = 150
MAX_PRODUCTS = 4
MAX_OFFERS = 12

# Stores and review sites a person would recognise. Matched on the end of the host name.
STORES = {
    "amazon.com": "Amazon", "target.com": "Target", "walmart.com": "Walmart", "bestbuy.com": "Best Buy",
    "costco.com": "Costco", "samsclub.com": "Sam's Club", "homedepot.com": "Home Depot", "lowes.com": "Lowe's",
    "sephora.com": "Sephora", "ulta.com": "Ulta", "nordstrom.com": "Nordstrom", "macys.com": "Macy's",
    "rei.com": "REI", "dickssportinggoods.com": "Dick's", "kohls.com": "Kohl's", "wayfair.com": "Wayfair",
    "ikea.com": "IKEA", "apple.com": "Apple", "bhphotovideo.com": "B&H", "newegg.com": "Newegg",
    "williams-sonoma.com": "Williams Sonoma", "crateandbarrel.com": "Crate & Barrel", "zappos.com": "Zappos",
    "nike.com": "Nike", "adidas.com": "Adidas", "lululemon.com": "Lululemon", "uniqlo.com": "Uniqlo",
    "dyson.com": "Dyson", "sharkninja.com": "SharkNinja", "kitchenaid.com": "KitchenAid", "ebay.com": "eBay",
    "chewy.com": "Chewy", "cvs.com": "CVS", "walgreens.com": "Walgreens", "traderjoes.com": "Trader Joe's",
    "wholefoodsmarket.com": "Whole Foods", "instacart.com": "Instacart", "anthropologie.com": "Anthropologie",
    "urbanoutfitters.com": "Urban Outfitters", "gap.com": "Gap", "hm.com": "H&M", "zara.com": "Zara",
}
REVIEWS = {
    "nytimes.com": "Wirecutter", "rtings.com": "RTINGS", "consumerreports.org": "Consumer Reports",
    "goodhousekeeping.com": "Good Housekeeping", "seriouseats.com": "Serious Eats", "cnet.com": "CNET",
    "theverge.com": "The Verge", "techradar.com": "TechRadar", "tomsguide.com": "Tom's Guide",
    "allure.com": "Allure", "byrdie.com": "Byrdie", "foodandwine.com": "Food & Wine",
    "bonappetit.com": "Bon Appetit", "outdoorgearlab.com": "OutdoorGearLab", "runnersworld.com": "Runner's World",
    "travelandleisure.com": "Travel + Leisure", "cntraveler.com": "Condé Nast Traveler",
}

# Never a source of a price: deal and coupon aggregators, cashback portals, marketplaces of
# unknown third-party sellers, social and forum posts, link shorteners, search redirects.
BLOCKED = {
    "retailmenot.com", "slickdeals.net", "joinhoney.com", "honey.com", "rakuten.com", "groupon.com",
    "dealnews.com", "couponfollow.com", "knoji.com", "dontpayfull.com", "capitaloneshopping.com",
    "coupons.com", "offers.com", "dealspotr.com", "wethrift.com", "couponbirds.com", "savings.com",
    "aliexpress.com", "alibaba.com", "temu.com", "wish.com", "dhgate.com", "banggood.com",
    "reddit.com", "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "pinterest.com",
    "x.com", "twitter.com", "quora.com", "medium.com",
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "linktr.ee", "amzn.to",
    "vertexaisearch.cloud.google.com",
}
# Domain endings that are mostly spam or throwaway shops.
RISKY_TLDS = {
    "xyz", "top", "icu", "buzz", "click", "cfd", "sbs", "monster", "cyou", "quest", "bond", "biz",
    "loan", "work", "gq", "ml", "tk", "ga", "cf", "zip", "mov", "country", "kim", "rest", "lol",
}
# Words in a host name that say "deal site" or "fake", not "store".
RISKY_WORDS = ("coupon", "promocode", "promo-code", "deals", "cheap", "replica", "knockoff", "discount-")
IP_HOST = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$|:")


def _matches(h: str, dom: str) -> bool:
    return h == dom or h.endswith("." + dom)


PRICE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")

RESEARCH_PROMPT = """Someone saved an Instagram reel about these products and wants to buy one at a good price.
{products}

Use Google Search. Look at the brand's own website, established retailers big or small (including
specialist stores for this kind of product, like a sports, outdoor or beauty shop), and review sites.
A store does not need to be famous; it needs to be a real business selling the real product. Skip
coupon and deal sites, marketplaces of unknown third-party sellers, social posts, knockoffs and anything
that looks unsafe. Prefer pages that show the price directly.

Report short factual lines, one per price found, in this form:
PRODUCT | STORE | PRICE | what is notable (sale, size, bundle, refurbished)
For each product, also report up to two cheaper alternatives that review sites recommend for the same
use, in the same form, starting the note with "Alternative:".
Only report prices the search results show. Write "not found" when you find none. No introduction."""

OFFER_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "offers": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "product": {"type": "string", "description": "As the reel names it, or the alternative's name"},
                "store": {"type": "string"},
                "price_text": {"type": "string", "description": "The price exactly as the notes give it, e.g. $49.99"},
                "note": {"type": "string", "description": "At most 60 characters, or empty"},
                "alternative": {"type": "boolean", "description": "true for a cheaper alternative, not the reel's product"},
                "source": {"type": "integer", "description": "The [n] that backs this price, or 0"},
            },
            "required": ["product", "store", "price_text", "alternative", "source"]}},
    },
    "required": ["offers"],
}


def host(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def source_of(url: str, brands: list[str]) -> tuple[str, str] | None:
    """(name to show, kind) for a page a price may come from, or None to drop it.
    kind is "store", "review", "brand" or "site" (any other credible-looking shop)."""
    try:
        scheme = (urlparse(url).scheme or "").lower()
    except ValueError:
        return None
    h = host(url)
    if scheme != "https" or not h or "." not in h or IP_HOST.search(h) or h.startswith("xn--") or ".xn--" in h:
        return None
    for table, kind in ((STORES, "store"), (REVIEWS, "review")):
        for dom, name in table.items():
            if _matches(h, dom):
                return name, kind
    if any(_matches(h, dom) for dom in BLOCKED):
        return None
    # A familiar store's name followed by more labels is a lookalike (amazon.com.deals.net).
    if any(f"{dom}." in h for dom in (*STORES, *REVIEWS)):
        return None
    if h.rsplit(".", 1)[-1] in RISKY_TLDS or any(w in h for w in RISKY_WORDS):
        return None
    flat = h.replace("-", "").replace(".", "")
    for b in brands:
        for token in {re.sub(r"[^a-z0-9]", "", b.lower()), *(re.sub(r"[^a-z0-9]", "", w) for w in b.lower().split())}:
            if len(token) >= 4 and token in flat:
                return b, "brand"
    return h, "site"


def trusted(url: str, brands: list[str]) -> str | None:
    """The name to show for a source a price may come from, or None."""
    got = source_of(url, brands)
    return got[0] if got else None


def parse_price(text: str) -> float | None:
    m = PRICE.search(text or "")
    if not m:
        return None
    try:
        v = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    return v if 0 < v < 100000 else None


def keep_offers(raw: list[dict], sources: list[dict], brands: list[str]) -> list[dict]:
    """Only offers whose source is real and trusted and whose price can be read."""
    by_n = {s["n"]: s for s in sources}
    out, seen = [], set()
    for o in raw:
        try:
            n = int(o.get("source") or 0)
        except (TypeError, ValueError):
            continue
        src = by_n.get(n)
        price = parse_price(str(o.get("price_text") or ""))
        if not src or price is None:
            continue
        got = source_of(src["url"], brands)
        if not got:
            continue
        via, kind = got
        product = " ".join(str(o.get("product") or "").split())[:80]
        # When the page is a store's or brand's own, the price is that site's, whatever the
        # notes said. From a review site, the store the review names is kept.
        store = (" ".join(str(o.get("store") or "").split())[:40] or via) if kind == "review" else via
        key = (product.lower(), store.lower(), price)
        if not product or key in seen:
            continue
        seen.add(key)
        out.append({"product": product, "store": store, "price": price, "price_text": f"${price:,.2f}".replace(".00", ""),
                    "note": " ".join(str(o.get("note") or "").replace("Alternative:", "").split())[:70],
                    "alternative": bool(o.get("alternative")), "url": src["url"], "via": via})
    out.sort(key=lambda x: (x["alternative"], x["product"].lower(), x["price"]))
    return out[:MAX_OFFERS]


def best_by_product(offers: list[dict]) -> list[dict]:
    """The lowest trusted price for each product the reel names (alternatives aside)."""
    best: dict[str, dict] = {}
    for o in offers:
        if o["alternative"]:
            continue
        k = o["product"].lower()
        if k not in best or o["price"] < best[k]["price"]:
            best[k] = o
    return sorted(best.values(), key=lambda o: o["price"])


def products_of(save: dict) -> list[dict]:
    items = ((save.get("fields") or {}).get("product") or {}).get("items") or []
    out = [{"name": str(i["name"]), "brand": str(i.get("brand") or "")} for i in items if i.get("name")]
    return out[:MAX_PRODUCTS] or [{"name": save.get("title") or "the product in the reel", "brand": ""}]


def can_research(save: dict) -> bool:
    return save.get("type") == "product"


def building(save: dict) -> bool:
    s = save.get("shop") or {}
    return s.get("status") == "building" and s.get("started_at") and \
        now_utc() - as_utc(s["started_at"]) < timedelta(seconds=STALE_BUILD_S)


def start(save: dict) -> bool:
    """Mark the research as started. False when another request already started it."""
    res = db.saves().update_one(
        {"_id": save["_id"], "user_id": save["user_id"],
         "$or": [{"shop.status": {"$ne": "building"}},
                 {"shop.started_at": {"$lt": now_utc() - timedelta(seconds=STALE_BUILD_S)}}]},
        {"$set": {"shop.status": "building", "shop.started_at": now_utc(), "shop.error": None}})
    return res.modified_count == 1


def build(save_id, user_id: str) -> None:
    save = db.saves().find_one({"_id": save_id, "user_id": user_id})
    if not save:
        return
    try:
        products = products_of(save)
        brands = [p["brand"] for p in products if p["brand"]]
        lines = "\n".join(f"- {p['name']}" + (f" (brand: {p['brand']})" if p["brand"] else "") for p in products)
        sources: list[dict] = []
        notes = trip.research(RESEARCH_PROMPT.format(products=lines), sources, timeout_s=70)
        raw = gemini.generate_json(
            role="fast", schema=OFFER_SCHEMA, timeout_s=40,
            system=("You turn price research notes into a list. Copy prices exactly as the notes give them. "
                    "Put the [n] number that backs each price in source; 0 when no number backs it. "
                    "Never estimate a price. Plain words, no em dashes."),
            input=f"PRODUCTS:\n{lines}\n\nNOTES:\n{notes}\n\nSOURCES:\n" +
                  "\n".join(f"[{s['n']}] {s['title']} {s['url']}" for s in sources))
        offers = keep_offers(raw.get("offers") or [], sources, brands)
        used = {o["url"] for o in offers}
        db.saves().update_one({"_id": save_id, "user_id": user_id}, {"$set": {
            "shop.status": "ready", "shop.done_at": now_utc(), "shop.offers": offers,
            "shop.dropped": max(0, len(raw.get("offers") or []) - len(offers)),
            "shop.sources": [{"title": s["title"], "url": s["url"], "via": trusted(s["url"], brands)}
                             for s in sources if s["url"] in used]}})
    except Exception as e:  # noqa: BLE001
        log.warning("shop research failed: %s", str(e)[:200])
        db.saves().update_one({"_id": save_id, "user_id": user_id},
                              {"$set": {"shop.status": "failed", "shop.error": "Price research didn't finish. Try again."}})


def view(save: dict, user: dict) -> dict | None:
    s = save.get("shop")
    if not s:
        return None
    status = s.get("status")
    if status == "building" and not building(save):
        status = "failed"
    offers = s.get("offers") or []
    when = month_day(as_utc(s["done_at"]).astimezone(tz_of(user))) if s.get("done_at") else None
    return {"status": status, "offers": offers, "best": best_by_product(offers),
            "alternatives": [o for o in offers if o["alternative"]],
            "checked_on": when, "dropped": int(s.get("dropped") or 0),
            "error": s.get("error") if status == "failed" else None}
