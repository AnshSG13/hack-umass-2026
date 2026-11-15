"""Web search on request: which messages ask for it, what gets searched, and how Ask routes and
keeps it. No network."""
import json

from bson import ObjectId

from realize import ask, discuss, search, websearch

ASKED = ["search the web for the best time to visit the Rockaway Hotel", "Can you look it up online?",
         "google how long chickpeas keep", "do a web search on Somssi reviews",
         "what does the internet say about this", "check online if tickets are sold out",
         "find it on the web", "Search online for a cheaper tote"]
NOT_ASKED = ["what can I cook this week", "Can I make this ahead?", "How long does it take?",
             "Is this place open on mondays", "I bought it online last week?"]


def test_only_plain_requests_for_the_web_count():
    assert all(websearch.wants_web(m) for m in ASKED)
    assert not any(websearch.wants_web(m) for m in NOT_ASKED)


def test_the_search_drops_the_request_words():
    assert websearch.query_from("search the web for the best time to visit the Rockaway Hotel") == \
        "the best time to visit the Rockaway Hotel"
    assert websearch.query_from("google how long chickpeas keep") == "how long chickpeas keep"
    assert websearch.query_from("Can you look it up online?") == "Can you look it up online?"  # nothing left


def test_ask_sends_a_web_request_to_the_web_and_keeps_the_sources(monkeypatch):
    src = [{"n": 1, "title": "therockawayhotel.com", "url": "https://www.therockawayhotel.com/pool"}]
    seen = {}

    def fake_answer(user, message, history, clean, saves=None):
        seen["saves"] = saves
        return {"text": "The pool is open year round [1].", "sources": src}

    monkeypatch.setattr(websearch, "ask_answer", fake_answer)
    monkeypatch.setattr(search, "hybrid_search", lambda uid, q, limit=3: ([{"title": "Rockaway"}], None))
    monkeypatch.setattr(ask, "_run", lambda *a: (_ for _ in ()).throw(AssertionError("searched the saves")))
    kept = {}

    def append_ask(user, chat, message, answer, cards):
        kept.update(answer=answer)
        return {"_id": ObjectId(), "title": message}

    monkeypatch.setattr(discuss, "append_ask", append_ask)
    lines = [json.loads(x) for x in ask.stream({"_id": "u"}, "search the web for the Rockaway pool hours", [])]
    answer = next(x for x in lines if x["type"] == "answer")
    assert answer["web"] is True and answer["sources"] == src and answer["save_ids"] == []
    assert lines[-1]["type"] == "saved" and kept["answer"]["sources"] == src
    assert seen["saves"] == [{"title": "Rockaway"}]


def test_a_kept_web_answer_shows_its_sources():
    from datetime import datetime, timezone

    at = datetime(2026, 11, 15, tzinfo=timezone.utc)
    d = {"_id": ObjectId(), "save_id": None, "title": "Pool hours", "count": 2, "updated_at": at,
         "messages": [{"role": "assistant", "text": "Open [1].", "at": at, "cards": [], "web": True,
                       "sources": [{"n": 1, "title": "x", "url": "https://x.example/"}]}]}
    m = discuss.view(d)["messages"][0]
    assert m["web"] is True and m["sources"][0]["url"] == "https://x.example/"


def test_text_that_comes_back_twice_is_kept_once(monkeypatch):
    class Block:
        def __init__(self, text):
            self.type, self.text, self.annotations = "text", text, []

    class Step:
        def __init__(self, *texts):
            self.type, self.content = "model_output", [Block(t) for t in texts]

    class It:
        steps = [Step("It has no pool."), Step("It has no pool.", "It opens at 5 pm.")]

    monkeypatch.setattr(websearch.gemini, "create_interaction", lambda *a, **k: It())
    text, sources = websearch.grounded("system", "prompt")
    assert text == "It has no pool.\nIt opens at 5 pm." and sources == []
