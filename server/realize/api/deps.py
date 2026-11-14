"""Auth and request helpers. user_id always comes from the key, never from a body."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from email import message_from_bytes
from urllib.parse import parse_qs

from fastapi import Header, HTTPException, Request

from .. import accounts
from ..config import get_settings
from ..models import ConfirmRequest, SaveRequest

# Work the API starts and then polls on (sample planning, fake planner). FastAPI's
# BackgroundTasks run only after the response is sent, and /api/save has to wait
# on the plan before it responds, so these run on a small pool instead.
background = ThreadPoolExecutor(max_workers=8, thread_name_prefix="rl-bg")


def bearer(authorization: str | None) -> str | None:
    """The key from an Authorization header. In a Shortcut this is typed by hand on a phone,
    so "Bearer rl_x", "bearer rl_x " and the key alone are all read the same way."""
    if not authorization:
        return None
    value = authorization.strip().strip("\"'").strip()
    parts = value.split(None, 1)
    if len(parts) == 2 and parts[0].lower().rstrip(":") == "bearer":
        value = parts[1]
    elif len(parts) != 1:
        return None
    return value.strip().strip("\"'").strip() or None


# ---------- request bodies typed on a phone ----------
#
# A Shortcut's JSON body is built field by field with the iOS keyboard, which capitalises
# the first letter ("Input", "Source", "Shortcut"), and the body type can be left on Form.
# Rejecting those gives a Shortcut that silently does nothing, so /api/save and confirm
# read their bodies loosely: any letter case for names, JSON or a form, numbers as text.


def loose_fields(raw: bytes, content_type: str = "") -> dict:
    """A request body as a flat dict with lower-case names. Unreadable bodies give {}."""
    data: dict = {}
    ct = (content_type or "").lower()
    try:
        if "multipart/form-data" in ct:
            msg = message_from_bytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + raw)
            for part in msg.walk():
                name = part.get_param("name", header="content-disposition")
                if name and not part.is_multipart():
                    payload = part.get_payload(decode=True) or b""
                    data[str(name)] = payload.decode("utf-8", "replace")
        else:
            try:
                parsed = json.loads(raw.decode("utf-8-sig", "replace"))
                if isinstance(parsed, dict):
                    data = parsed
            except ValueError:
                data = {k: v[-1] for k, v in parse_qs(raw.decode("utf-8", "replace"),
                                                      keep_blank_values=True).items()}
    except Exception:  # noqa: BLE001 - a body nobody can read is an empty body
        data = {}
    return {str(k).strip().lower(): v for k, v in data.items()}


def _text(v) -> str:
    if v is None:
        return ""
    return v if isinstance(v, str) else json.dumps(v) if isinstance(v, (dict, list)) else str(v)


def _source(v, allowed: tuple[str, ...]) -> str:
    s = _text(v).strip().lower()
    return s if s in allowed else "shortcut"


def save_request_from(fields: dict) -> SaveRequest:
    wait = None
    try:
        if _text(fields.get("wait")).strip() != "":
            wait = float(_text(fields.get("wait")).strip())
    except ValueError:
        wait = None
    # "url" is what the original prototype's Shortcut called the field.
    link = next((fields[k] for k in ("input", "url", "link", "text") if fields.get(k)), "")
    return SaveRequest(input=_text(link), source=_source(fields.get("source"), ("shortcut", "web", "sample")),
                       wait=wait)


def confirm_request_from(fields: dict) -> ConfirmRequest:
    start = _text(fields.get("start_local")).strip() or None
    return ConfirmRequest(choice=_text(fields.get("choice")), source=_source(fields.get("source"), ("shortcut", "web")),
                          start_local=start)


async def save_request(request: Request) -> SaveRequest:
    return save_request_from(loose_fields(await request.body(), request.headers.get("content-type", "")))


async def confirm_request(request: Request) -> ConfirmRequest:
    return confirm_request_from(loose_fields(await request.body(), request.headers.get("content-type", "")))


def bad_key_message() -> str:
    s = get_settings()
    return f"Your {s.app_name} key doesn't work. Get a new one at {s.public_base_url}/setup."


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    return accounts.find_by_key(bearer(authorization))


def current_user(authorization: str | None = Header(default=None)) -> dict:
    user = accounts.find_by_key(bearer(authorization))
    if not user:
        raise HTTPException(status_code=401, detail=bad_key_message())
    return user


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
