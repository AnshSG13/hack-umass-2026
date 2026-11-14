"""Auth and request helpers. user_id always comes from the key, never from a body."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import Header, HTTPException, Request

from .. import accounts
from ..config import get_settings

# Work the API starts and then polls on (sample planning, fake planner). FastAPI's
# BackgroundTasks run only after the response is sent, and /api/save has to wait
# on the plan before it responds, so these run on a small pool instead.
background = ThreadPoolExecutor(max_workers=8, thread_name_prefix="rl-bg")


def bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


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
