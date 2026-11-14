"""Users and API keys (SPEC 5.1, 17). Keys are shown once and stored as sha256."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime

from . import db
from .config import get_settings
from .models import default_prefs
from .timeutil import now_utc, valid_tz

KEY_PREFIX = "rl_"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(24)


def create_user(timezone: str | None = None, *, label: str | None = None, is_demo: bool = False,
                is_judge: bool = False, expires_at: datetime | None = None) -> tuple[dict, str]:
    key = new_key()
    user = {
        "_id": "u_" + secrets.token_hex(6),
        "api_key_hash": hash_key(key), "key_preview": key[-4:], "label": label,
        "is_demo": is_demo, "is_judge": is_judge,
        "timezone": valid_tz(timezone) or get_settings().default_timezone,
        "prefs": default_prefs(), "created_at": now_utc(),
    }
    if expires_at:
        user["expires_at"] = expires_at
    db.users().insert_one(user)
    return user, key


def find_by_key(key: str | None) -> dict | None:
    if not key or not key.startswith(KEY_PREFIX):
        return None
    h = hash_key(key)
    user = db.users().find_one({"api_key_hash": h})
    if user and hmac.compare_digest(user["api_key_hash"], h):
        return user
    return None


def rotate_key(user: dict) -> str:
    key = new_key()
    db.users().update_one({"_id": user["_id"]},
                          {"$set": {"api_key_hash": hash_key(key), "key_preview": key[-4:]}})
    return key


def delete_user_data(user_id: str) -> dict:
    """Delete a user and everything they own. Sample-owned thumbnails are never touched."""
    counts = {}
    for name, coll in (("saves", db.saves()), ("plans", db.plans()), ("jobs", db.jobs()),
                       ("agent_runs", db.agent_runs())):
        counts[name] = coll.delete_many({"user_id": user_id}).deleted_count
    counts["thumbnails"] = db.thumbnails().delete_many({"owner_user_id": user_id}).deleted_count
    counts["users"] = db.users().delete_one({"_id": user_id}).deleted_count
    return counts
