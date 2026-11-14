"""Users, passwords, sessions and API keys (SPEC 5.1, 17).

API keys (rl_...) are shown once and stored as sha256; the Shortcut uses them. Web sign-in
uses an email and password (scrypt) and gets a session token (rs_...), also stored as sha256.
Both go in the same Bearer header and resolve to the same user document."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import re
from datetime import datetime, timedelta

from . import db
from .config import get_settings
from .models import default_prefs
from .timeutil import as_utc, now_utc, valid_tz

KEY_PREFIX = "rl_"
SESSION_PREFIX = "rs_"
SESSION_DAYS = 30
PASSWORD_MIN = 8
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# scrypt parameters (n=2^14, r=8, p=1: about 16 MB and tens of ms per check).
_N, _R, _P, _DKLEN = 2 ** 14, 8, 1, 32


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(24)


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and bool(EMAIL_RE.match(email))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, want = (stored or "").split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=int(n), r=int(r),
                            p=int(p), dklen=len(want) // 2)
        return hmac.compare_digest(dk.hex(), want)
    except (ValueError, TypeError):
        return False


# Checked when the email is unknown, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def find_by_email(email: str) -> dict | None:
    return db.users().find_one({"email": normalize_email(email)})


def authenticate(email: str, password: str) -> dict | None:
    user = find_by_email(email)
    ok = verify_password(password, user.get("password_hash") if user else _DUMMY_HASH)
    return user if user and ok else None


def set_credentials(user_id: str, email: str, password: str) -> None:
    db.users().update_one({"_id": user_id}, {"$set": {
        "email": normalize_email(email), "password_hash": hash_password(password)}})


def create_session(user: dict) -> str:
    token = SESSION_PREFIX + secrets.token_urlsafe(32)
    now = now_utc()
    db.sessions().insert_one({"_id": hash_key(token), "user_id": user["_id"], "created_at": now,
                              "expires_at": now + timedelta(days=SESSION_DAYS)})
    return token


def end_session(token: str | None) -> None:
    if token and token.startswith(SESSION_PREFIX):
        db.sessions().delete_one({"_id": hash_key(token)})


def create_user(timezone: str | None = None, *, label: str | None = None, is_demo: bool = False,
                is_judge: bool = False, expires_at: datetime | None = None,
                email: str | None = None, password: str | None = None,
                name: str | None = None) -> tuple[dict, str]:
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
    if email and password:
        user["email"] = normalize_email(email)
        user["password_hash"] = hash_password(password)
    if name:
        user["name"] = " ".join(name.split())
    db.users().insert_one(user)
    return user, key


def find_by_key(key: str | None) -> dict | None:
    """The user for a Bearer value: an API key or a web session token."""
    if key and key.startswith(SESSION_PREFIX):
        session = db.sessions().find_one({"_id": hash_key(key)})
        if not session or as_utc(session["expires_at"]) <= now_utc():
            return None
        return db.users().find_one({"_id": session["user_id"]})
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
                          {"$set": {"api_key_hash": hash_key(key), "key_preview": key[-4:],
                                    "key_shown_at": now_utc()}})
    return key


def delete_user_data(user_id: str) -> dict:
    """Delete a user and everything they own. Sample-owned thumbnails are never touched."""
    counts = {}
    for name, coll in (("saves", db.saves()), ("plans", db.plans()), ("jobs", db.jobs()),
                       ("agent_runs", db.agent_runs()), ("trips", db.trips()),
                       ("sessions", db.sessions()), ("discussions", db.discussions()),
                       ("bundles", db.bundles()), ("deliverables", db.deliverables())):
        counts[name] = coll.delete_many({"user_id": user_id}).deleted_count
    counts["thumbnails"] = db.thumbnails().delete_many({"owner_user_id": user_id}).deleted_count
    counts["users"] = db.users().delete_one({"_id": user_id}).deleted_count
    return counts
