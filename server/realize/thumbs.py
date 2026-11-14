"""Thumbnails: fetch from Instagram's CDN, resize, store in Atlas (SPEC 5.6)."""
from __future__ import annotations

import io
import logging
import secrets
from datetime import datetime
from urllib.parse import urlparse

import httpx
from bson.binary import Binary
from PIL import Image

from . import db

log = logging.getLogger("realize.thumbs")

ALLOWED_SUFFIXES = ("cdninstagram.com", "fbcdn.net")
WIDTH = 480


def allowed(url: str | None) -> bool:
    """Only Instagram CDN hosts are ever fetched."""
    if not url:
        return False
    p = urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme == "https" and any(host == s or host.endswith("." + s) for s in ALLOWED_SUFFIXES)


def resize_jpeg(raw: bytes) -> tuple[bytes, int, int]:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.width > WIDTH:
        img = img.resize((WIDTH, max(1, round(img.height * WIDTH / img.width))), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue(), img.width, img.height


def store(raw: bytes, owner_user_id: str | None, expires_at: datetime | None = None) -> str:
    data, w, h = resize_jpeg(raw)
    doc = {"_id": secrets.token_hex(8), "content_type": "image/jpeg", "data": Binary(data),
           "width": w, "height": h, "owner_user_id": owner_user_id}
    if expires_at:
        doc["expires_at"] = expires_at
    db.thumbnails().insert_one(doc)
    return doc["_id"]


def fetch_and_store(url: str | None, owner_user_id: str | None,
                    expires_at: datetime | None = None) -> str | None:
    if not allowed(url):
        return None
    try:
        r = httpx.get(url, timeout=10, follow_redirects=False)
        r.raise_for_status()
        return store(r.content, owner_user_id, expires_at)
    except Exception as e:  # noqa: BLE001 - a missing thumbnail never fails a save
        log.warning("thumbnail fetch failed: %s", str(e)[:120])
        return None


def get(thumb_id: str | None) -> dict | None:
    return db.thumbnails().find_one({"_id": thumb_id}) if thumb_id else None


def get_bytes(thumb_id: str | None) -> bytes | None:
    doc = get(thumb_id)
    return bytes(doc["data"]) if doc else None
