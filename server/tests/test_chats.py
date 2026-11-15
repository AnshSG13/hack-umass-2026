"""Saved chats: follow-up questions, Ask turns kept as chats, and how chats are shown. No network."""
import json
from datetime import datetime, timezone

from bson import ObjectId

from realize import ask, discuss


def test_follow_ups_are_short_distinct_and_sentence_case():
    raw = ["can I freeze it?", "Can I freeze it?", "What if I don't have coconut milk or any canned milk at all?",
           "Swap the spinach — kale?", "", 7, "How long does it keep?"]
    assert discuss.clean_follow_ups(raw) == ["Can I freeze it?", "Swap the spinach , kale?"]
    assert discuss.clean_follow_ups("not a list") == []


def _lines(gen) -> list[dict]:
    return [json.loads(x) for x in gen]


def test_an_answered_ask_turn_is_kept_and_named(monkeypatch):
    def run(user, message, history, emit):
        emit({"type": "step", "text": "Searching"})
        emit({"type": "cards", "cards": [{"save_id": "a1", "title": "Curry"}]})
        emit({"type": "answer", "text": "The curry.", "confidence": "high", "follow_ups": ["Swap?"], "save_ids": ["a1"]})
        emit({"type": "done"})

    kept = {}

    def append_ask(user, chat, message, answer, cards):
        kept.update(chat=chat, message=message, answer=answer, cards=cards)
        return {"_id": ObjectId("6af835a1bf52d67d611aed4b"), "title": "What can I cook?"}

    monkeypatch.setattr(ask, "_run", run)
    monkeypatch.setattr(discuss, "append_ask", append_ask)
    out = _lines(ask.stream({"_id": "u"}, "What can I cook?", []))
    assert [x["type"] for x in out] == ["step", "cards", "answer", "done", "saved"]
    assert out[-1]["chat_id"] == "6af835a1bf52d67d611aed4b"
    assert kept["chat"] is None and kept["cards"] == [{"save_id": "a1", "title": "Curry"}]
    assert kept["answer"]["text"] == "The curry."


def test_a_turn_without_an_answer_is_not_kept(monkeypatch):
    monkeypatch.setattr(ask, "_run", lambda user, message, history, emit: emit(ask.ERROR_LINE))
    monkeypatch.setattr(discuss, "append_ask", lambda *a: (_ for _ in ()).throw(AssertionError("kept")))
    out = _lines(ask.stream({"_id": "u"}, "hello", []))
    assert all(x.get("type") != "saved" for x in out)


def test_views_tell_ask_chats_from_reel_chats():
    at = datetime(2026, 11, 15, tzinfo=timezone.utc)
    ask_chat = {"_id": ObjectId(), "save_id": None, "title": "What can I cook?", "count": 2, "updated_at": at,
                "messages": [{"role": "user", "text": "What can I cook?", "at": at},
                             {"role": "assistant", "text": "The curry.", "at": at, "confidence": "high",
                              "follow_ups": ["Swap?"], "cards": [{"save_id": "a1"}]}]}
    v = discuss.view(ask_chat)
    assert v["kind"] == "ask" and v["save_id"] is None
    assert v["messages"][1]["cards"] == [{"save_id": "a1"}] and v["messages"][1]["follow_ups"] == ["Swap?"]
    reel_chat = {**ask_chat, "save_id": ObjectId(), "messages": [
        {"role": "assistant", "text": "Yes.", "at": at, "at_sec": 4}]}
    r = discuss.view(reel_chat)
    assert r["kind"] == "reel" and "cards" not in r["messages"][0] and r["messages"][0]["follow_ups"] == []
