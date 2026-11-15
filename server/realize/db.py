"""MongoClient singleton and collection handles. Atlas is the only shared state."""
from __future__ import annotations

from functools import lru_cache

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from .config import get_settings


@lru_cache
def get_client() -> MongoClient:
    s = get_settings()
    return MongoClient(
        s.mongodb_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=10000,
        appname=f"{s.app_name.lower()}-server",
    )


def get_db() -> Database:
    return get_client()[get_settings().mongodb_db]


def users() -> Collection:
    return get_db()["users"]


def sessions() -> Collection:
    return get_db()["sessions"]


def saves() -> Collection:
    return get_db()["saves"]


def plans() -> Collection:
    return get_db()["plans"]


def trips() -> Collection:
    return get_db()["trips"]


def bundles() -> Collection:
    return get_db()["bundles"]


def discussions() -> Collection:
    return get_db()["discussions"]


def deliverables() -> Collection:
    return get_db()["deliverables"]


def jobs() -> Collection:
    return get_db()["jobs"]


def agent_runs() -> Collection:
    return get_db()["agent_runs"]


def thumbnails() -> Collection:
    return get_db()["thumbnails"]


def sample_cache() -> Collection:
    return get_db()["sample_cache"]


def workers() -> Collection:
    return get_db()["workers"]


def graph_cache() -> Collection:
    """One document per user: the knowledge graph's cached related map and interest vectors."""
    return get_db()["graph_cache"]


def oid(value: str | ObjectId | None) -> ObjectId | None:
    """Parse an id from a URL; None when it isn't one."""
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        return None
