"""FastAPI app. Same origin through Caddy (or the Next.js rewrite in dev); no CORS."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ..config import get_settings
from .routers import core, plans, saves

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title=get_settings().app_name, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(core.router)
app.include_router(saves.router)
app.include_router(plans.router)



@app.on_event("startup")
def _warm_up() -> None:
    """Probe the fast model's thinking level off the request path, so the first
    sample save doesn't spend its 10 seconds on it."""
    s = get_settings()
    if s.planner_mode != "fake" and s.gemini_api_key:
        from .. import gemini
        from .deps import background

        background.submit(gemini.lowest_thinking, s.gemini_model_fast)


# Sections 6 and 7: these two always answer HTTP 200 so the Shortcut can show the message.
_SOFT = ("/api/save",)


def _is_soft(path: str) -> bool:
    return path in _SOFT or (path.startswith("/api/saves/") and path.endswith("/confirm"))


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"message": str(exc.detail)})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    if _is_soft(request.url.path):
        return JSONResponse(status_code=200, content={
            "status": "error", "ask": "no",
            "message": "That request wasn't readable. Share a reel from Instagram, or paste its link."})
    return JSONResponse(status_code=422, content={"message": "That request wasn't readable."})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("realize.api").exception("unhandled error on %s", request.url.path)
    if _is_soft(request.url.path):
        return JSONResponse(status_code=200, content={
            "status": "error", "ask": "no", "message": "Something broke on our side. Try again in a minute."})
    return JSONResponse(status_code=500, content={"message": "Something broke on our side. Try again in a minute."})
