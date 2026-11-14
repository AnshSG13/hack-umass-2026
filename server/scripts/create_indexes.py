"""Create every index in SPEC section 5, plus both search indexes.

Run from server/: python -m scripts.create_indexes
Polls until both search indexes are queryable (max 5 min), then runs one
$rankFusion test query and prints whether it worked.
"""
from __future__ import annotations

import sys
import time

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from realize import db, search
from realize.config import get_settings

VECTOR_NAME, TEXT_NAME = "saves_vector", "saves_text"


def regular_indexes() -> None:
    ttl = dict(expireAfterSeconds=0)
    db.users().create_index([("api_key_hash", ASCENDING)], unique=True)
    db.users().create_index([("expires_at", ASCENDING)], **ttl)
    db.users().create_index([("email", ASCENDING)], unique=True,
                            partialFilterExpression={"email": {"$type": "string"}})
    db.sessions().create_index([("user_id", ASCENDING)])
    db.sessions().create_index([("expires_at", ASCENDING)], **ttl)

    db.saves().create_index([("user_id", ASCENDING), ("shortcode", ASCENDING)], unique=True)
    db.saves().create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.saves().create_index([("user_id", ASCENDING), ("type", ASCENDING), ("created_at", DESCENDING)])
    db.saves().create_index([("user_id", ASCENDING), ("type", ASCENDING), ("subcategory", ASCENDING),
                             ("created_at", DESCENDING)])
    db.saves().create_index([("expires_at", ASCENDING)], **ttl)

    db.plans().create_index([("user_id", ASCENDING), ("status", ASCENDING), ("scheduled_for", ASCENDING)])
    db.plans().create_index([("save_id", ASCENDING)], unique=True)
    db.plans().create_index([("expires_at", ASCENDING)], **ttl)

    db.deliverables().create_index([("save_id", ASCENDING), ("kind", ASCENDING), ("discussion_id", ASCENDING)],
                                   unique=True)
    db.deliverables().create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    db.deliverables().create_index([("expires_at", ASCENDING)], **ttl)

    db.trips().create_index([("save_id", ASCENDING)], unique=True)
    db.trips().create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    db.trips().create_index([("expires_at", ASCENDING)], **ttl)

    db.bundles().create_index([("user_id", ASCENDING), ("type", ASCENDING), ("signature", ASCENDING)], unique=True)
    db.bundles().create_index([("user_id", ASCENDING), ("status", ASCENDING)])
    db.bundles().create_index([("expires_at", ASCENDING)], **ttl)

    db.discussions().create_index([("user_id", ASCENDING), ("save_id", ASCENDING), ("updated_at", DESCENDING)])
    db.discussions().create_index([("expires_at", ASCENDING)], **ttl)

    db.jobs().create_index([("kind", ASCENDING), ("status", ASCENDING), ("run_after", ASCENDING)])
    db.jobs().create_index([("save_id", ASCENDING)])
    db.jobs().create_index([("updated_at", ASCENDING)], expireAfterSeconds=604800,
                           partialFilterExpression={"status": {"$in": ["done", "failed"]}})
    db.jobs().create_index([("expires_at", ASCENDING)], **ttl)

    db.agent_runs().create_index([("save_id", ASCENDING), ("started_at", DESCENDING)])
    db.agent_runs().create_index([("user_id", ASCENDING), ("started_at", DESCENDING)])
    db.agent_runs().create_index([("expires_at", ASCENDING)], **ttl)

    db.thumbnails().create_index([("expires_at", ASCENDING)], **ttl)
    db.thumbnails().create_index([("owner_user_id", ASCENDING)])


def search_models() -> list[SearchIndexModel]:
    s = get_settings()
    vector = SearchIndexModel(
        name=VECTOR_NAME, type="vectorSearch",
        definition={"fields": [
            {"type": "vector", "path": "embedding", "numDimensions": s.embed_dim, "similarity": "cosine"},
            {"type": "filter", "path": "user_id"},
            {"type": "filter", "path": "status"},
            {"type": "filter", "path": "type"}]})
    text = SearchIndexModel(
        name=TEXT_NAME, type="search",
        definition={"mappings": {"dynamic": False, "fields": {
            "user_id": {"type": "token"}, "status": {"type": "token"}, "type": {"type": "token"},
            "title": {"type": "string"}, "summary": {"type": "string"}, "caption": {"type": "string"},
            "transcript_text": {"type": "string"}, "on_screen_text": {"type": "string"},
            "tags": {"type": "string"},
            "creator": {"type": "document", "fields": {"handle": {"type": "string"}}},
            "entities": {"type": "document", "fields": {"name": {"type": "string"}}}}}})
    return [vector, text]


def main() -> int:
    s = get_settings()
    database = db.get_db()
    if "saves" not in database.list_collection_names():
        database.create_collection("saves")
    regular_indexes()
    print("Regular indexes: ok")

    have = {i["name"]: i for i in db.saves().list_search_indexes()}
    for model in search_models():
        name = model.document["name"]
        if name in have:
            print(f"Search index {name}: exists")
            continue
        try:
            db.saves().create_search_index(model)
            print(f"Search index {name}: created")
        except OperationFailure as e:
            print(f"Search index {name}: FAILED to create: {str(e)[:200]}")
            return 1

    deadline = time.monotonic() + 300
    ready: dict[str, bool] = {}
    while time.monotonic() < deadline:
        ready = {i["name"]: bool(i.get("queryable")) for i in db.saves().list_search_indexes()}
        if ready.get(VECTOR_NAME) and ready.get(TEXT_NAME):
            break
        time.sleep(5)
    for name in (VECTOR_NAME, TEXT_NAME):
        print(f"{name}: {'queryable' if ready.get(name) else 'NOT queryable after 5 min'}")
    if not (ready.get(VECTOR_NAME) and ready.get(TEXT_NAME)):
        return 1

    worked, detail = search.probe_rankfusion()
    version = db.get_client().server_info().get("version")
    if worked:
        print(f"$rankFusion test query: worked (server {version}). HYBRID_MODE={s.hybrid_mode} will use it.")
    else:
        print(f"$rankFusion test query: not available (server {version}): {detail}")
        print("Hybrid search will use manual reciprocal rank fusion (HYBRID_MODE=auto handles this).")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
