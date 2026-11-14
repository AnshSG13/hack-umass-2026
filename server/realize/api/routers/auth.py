"""Email and password accounts for the web app.

Sign up and sign in return a session token (rs_...). The web keeps it where it used to keep
the API key and sends it as the Bearer value, so every other route works unchanged and every
query still filters by the user_id the token resolves to.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from ... import accounts, ratelimit
from ...models import LoginRequest, SignupRequest
from ..deps import bearer, client_ip, current_user

router = APIRouter()

RATE_LIMITED = "Too many tries. Wait a few minutes and try again."
BAD_LOGIN = "That email and password don't match."
EMAIL_TAKEN = "There's already an account with that email. Sign in instead."


def _check(email: str, password: str) -> str:
    email = accounts.normalize_email(email)
    if not accounts.valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a real email address.")
    if len(password) < accounts.PASSWORD_MIN:
        raise HTTPException(status_code=400,
                            detail=f"Use at least {accounts.PASSWORD_MIN} characters for your password.")
    return email


@router.post("/api/auth/signup")
def signup(body: SignupRequest, request: Request) -> dict:
    if not ratelimit.allow("users", client_ip(request)):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    email = _check(body.email, body.password)
    if accounts.find_by_email(email):
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN)
    try:
        user, _key = accounts.create_user(body.timezone, email=email, password=body.password, name=body.name)
    except DuplicateKeyError as e:  # two signups racing for one email
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN) from e
    return {"user_id": user["_id"], "token": accounts.create_session(user)}


@router.post("/api/auth/login")
def login(body: LoginRequest, request: Request) -> dict:
    email = accounts.normalize_email(body.email)
    if not (ratelimit.allow("login", client_ip(request)) and ratelimit.allow("login_email", email)):
        raise HTTPException(status_code=429, detail=RATE_LIMITED)
    user = accounts.authenticate(email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail=BAD_LOGIN)
    return {"user_id": user["_id"], "token": accounts.create_session(user)}


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)) -> dict:
    accounts.end_session(bearer(authorization))
    return {"ok": True}


@router.post("/api/auth/credentials")
def add_credentials(body: SignupRequest, user: dict = Depends(current_user),
                    authorization: str | None = Header(default=None)) -> dict:
    """Give an account made with a key (no password) an email and password. Answers with a
    session token so the browser can switch from the key to a normal sign-in."""
    if user.get("is_demo"):
        raise HTTPException(status_code=400, detail="Demo accounts delete themselves. Create a real account instead.")
    if user.get("email"):
        raise HTTPException(status_code=400, detail="This account already has an email and password.")
    email = _check(body.email, body.password)
    other = accounts.find_by_email(email)
    if other and other["_id"] != user["_id"]:
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN)
    try:
        accounts.set_credentials(user["_id"], email, body.password)
    except DuplicateKeyError as e:
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN) from e
    return {"user_id": user["_id"], "token": accounts.create_session(user)}
