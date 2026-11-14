"""Gemini client, the manual tool loop, embeddings and the video File API.

Uses the google-genai SDK's Interactions API in stateless mode (store=False):
we keep the history ourselves and resend every model step unchanged, so thought
signatures round-trip. Function calling is always manual; code runs the tools.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from functools import lru_cache
from typing import Any, Callable

import numpy as np
from google import genai
from google.genai import types

from .config import get_settings

log = logging.getLogger("realize.gemini")



class LoopTimeout(Exception):
    pass


class RateLimited(Exception):
    """Gemini answered 429. Callers decide whether to retry later or fall back."""


_io = ThreadPoolExecutor(max_workers=24, thread_name_prefix="rl-gemini")


@lru_cache
def client() -> genai.Client:
    s = get_settings()
    c = genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=120_000))
    # The SDK retries 429 and 5xx up to 4 times with backoff by default, which silently
    # blows through our deadlines. Turn that off: jobs.py owns retries and backoff.
    try:
        from google.genai._gaos import utils as _gaos_utils

        c.interactions.sdk_configuration.retry_config = _gaos_utils.RetryConfig("none", None, False)
    except Exception as e:  # noqa: BLE001 - private API; the hard deadline below still holds
        log.warning("could not disable SDK retries: %s", str(e)[:120])
    return c


def _is_rate_limit(e: Exception) -> bool:
    text = str(e)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "Too Many Requests" in text


def _deadline(fn: Callable[[], Any], timeout_s: float) -> Any:
    """Run a blocking SDK call with a hard wall-clock limit. On timeout the call is
    abandoned (its thread ends when the HTTP request does) and LoopTimeout is raised."""
    fut = _io.submit(fn)
    try:
        return fut.result(timeout=max(0.1, timeout_s))
    except FutureTimeout as e:
        fut.cancel()
        raise LoopTimeout(f"Gemini call exceeded {timeout_s:.0f}s") from e
    except LoopTimeout:
        raise
    except Exception as e:  # noqa: BLE001
        if _is_rate_limit(e):
            raise RateLimited(str(e)[:300]) from e
        raise


class Unavailable(Exception):
    """Every model in the chain was rate limited or overloaded."""


_cooldown: dict[str, float] = {}   # model -> monotonic time it may be tried again
_no_minimal: set[str] = set()      # models that rejected thinking_level "minimal"
last_model: dict[str, str] = {}    # role -> the model that answered most recently


def _cooldown_for(e: Exception) -> float:
    text = str(e).lower()
    if "per day" in text:
        return 3600.0
    if "429" in text or "rate limit" in text:
        return 60.0
    return 45.0  # 503 high demand


def _overloaded(e: Exception) -> bool:
    text = str(e)
    return "503" in text or "service_unavailable" in text or "high demand" in text or "UNAVAILABLE" in text


def create_interaction(timeout_s: float, *, role: str | None = None, model: str | None = None, **kwargs: Any):
    """One interactions.create call with a hard deadline.

    With role ("fast" or "video") the configured model is tried first, then its
    fallbacks, skipping models that recently answered 429 or 503. The thinking
    level starts at "minimal" and drops to "low" for models that reject it,
    using the real request, so no quota is spent on probing.
    """
    models = get_settings().model_chain(role) if role else [model]
    deadline = time.monotonic() + timeout_s
    last_err: Exception | None = None
    tried = 0
    for m in models:
        now = time.monotonic()
        if len(models) > 1 and _cooldown.get(m, 0) > now:
            continue
        remaining = deadline - now
        if remaining <= 0.5:
            break
        tried += 1
        gen = dict(kwargs.get("generation_config") or {})
        if gen.get("thinking_level") in (None, "lowest"):
            gen["thinking_level"] = "low" if m in _no_minimal else "minimal"
        call = {**kwargs, "generation_config": gen}
        try:
            try:
                out = _deadline(lambda: client().interactions.create(model=m, timeout=remaining, **call),
                                remaining + 0.5)
            except (LoopTimeout, RateLimited):
                raise
            except Exception as e:  # noqa: BLE001
                if gen["thinking_level"] == "minimal" and "400" in str(e) and "thinking" in str(e).lower():
                    _no_minimal.add(m)
                    call["generation_config"] = {**gen, "thinking_level": "low"}
                    remaining = deadline - time.monotonic()
                    out = _deadline(lambda: client().interactions.create(model=m, timeout=remaining, **call),
                                    remaining + 0.5)
                else:
                    raise
            if role:
                last_model[role] = m
            return out
        except LoopTimeout:
            raise
        except Exception as e:  # noqa: BLE001
            if isinstance(e, RateLimited) or _overloaded(e):
                _cooldown[m] = time.monotonic() + _cooldown_for(e)
                log.warning("%s unavailable (%s); %s", m, str(e)[:110],
                            "trying the next model" if m != models[-1] else "no more models")
                last_err = e
                continue
            raise
    if last_err is None and tried == 0:
        raise Unavailable("every configured model is cooling down after 429 or 503")
    if isinstance(last_err, RateLimited):
        raise last_err
    if last_err is not None:
        raise Unavailable(str(last_err)[:300])
    raise LoopTimeout(f"Gemini call exceeded {timeout_s:.0f}s")


def fn_tool(name: str, description: str, parameters: dict) -> dict:
    return {"type": "function", "name": name, "description": description, "parameters": parameters}


def user_step(text: str, image_jpeg: bytes | None = None) -> dict:
    content: list[dict] = [{"type": "text", "text": text}]
    if image_jpeg:
        content.append({"type": "image", "mime_type": "image/jpeg",
                        "data": base64.b64encode(image_jpeg).decode("ascii")})
    return {"type": "user_input", "content": content}


def run_tool_loop(
    *,
    role: str = "fast",
    system: str,
    history: list[dict],
    tools: list[dict],
    execute: Callable[[str, dict], tuple[dict, bool]],
    max_turns: int,
    force_tool: str,
    force_from_turn: int,
    timeout_s: float,
) -> bool:
    """Manual function-calling loop.

    execute(name, args) returns (result, done). The loop ends when a call
    reports done=True. From force_from_turn on, the model may only call
    force_tool. Returns True if a terminal call succeeded.
    Raises LoopTimeout when the total budget runs out.
    """
    deadline = time.monotonic() + timeout_s
    for turn in range(1, max_turns + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.5:
            raise LoopTimeout(f"tool loop exceeded {timeout_s}s")
        gen: dict[str, Any] = {"thinking_level": "lowest"}
        if turn >= force_from_turn:
            gen["tool_choice"] = {"allowed_tools": {"mode": "any", "tools": [force_tool]}}
        interaction = create_interaction(
            remaining, role=role, store=False, input=history, tools=tools,
            system_instruction=system, generation_config=gen,
        )
        steps = interaction.steps or []
        calls = []
        for step in steps:
            history.append(step.model_dump(exclude_none=True))
            if step.type == "function_call":
                calls.append(step)
        finished = False
        for call in calls:
            if time.monotonic() > deadline:
                raise LoopTimeout(f"tool loop exceeded {timeout_s}s")
            result, done = execute(call.name, dict(call.arguments or {}))
            history.append({
                "type": "function_result", "name": call.name, "call_id": call.id,
                "result": [{"type": "text", "text": json.dumps(result, default=str)}],
            })
            finished = finished or done
        if finished:
            return True
        if not calls:
            history.append(user_step(f"Use the tools. Finish by calling {force_tool}."))
    return False


def generate_json(*, role: str, input: Any, schema: dict, system: str | None = None,
                  timeout_s: float = 120, thinking: str | None = None, retries: int = 0) -> dict:
    """One structured-output call. Returns the parsed JSON object."""
    kwargs: dict[str, Any] = dict(
        role=role, store=False, input=input,
        response_format={"type": "text", "mime_type": "application/json", "schema": schema},
        generation_config={"thinking_level": thinking or "lowest"},
    )
    if system:
        kwargs["system_instruction"] = system
    interaction = None
    for attempt in range(retries + 1):
        try:
            interaction = create_interaction(timeout_s, **kwargs)
            break
        except Unavailable:
            # 503 "high demand" spikes are short: wait, forget the cooldowns, go again.
            if attempt == retries:
                raise
            time.sleep(6 * (attempt + 1))
            for m in get_settings().model_chain(role):
                if _cooldown.get(m, 0) - time.monotonic() < 120:
                    _cooldown.pop(m, None)
    text = interaction.output_text or ""
    return json.loads(text)


def embed(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed and L2-normalize. task_type: RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY."""
    s = get_settings()
    res = _deadline(lambda: client().models.embed_content(
        model=s.gemini_embed_model,
        contents=[t if t.strip() else "(empty)" for t in texts],
        config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=s.embed_dim),
    ), 20)
    out = []
    for e in res.embeddings:
        v = np.asarray(e.values, dtype=np.float64)
        n = np.linalg.norm(v)
        out.append((v / n if n else v).tolist())
    return out


def embed_one(text: str, task_type: str) -> list[float]:
    return embed([text], task_type)[0]


# ---------- video File API ----------


def upload_video(path: str, max_wait_s: float = 120):
    """Upload and wait until the file is ACTIVE. Returns the File."""
    f = client().files.upload(file=path)
    deadline = time.monotonic() + max_wait_s
    while not f.state or f.state.name != "ACTIVE":
        if f.state and f.state.name == "FAILED":
            raise RuntimeError("Gemini could not process the video file")
        if time.monotonic() > deadline:
            raise TimeoutError("Gemini file was not ACTIVE after 120 s")
        time.sleep(2)
        f = client().files.get(name=f.name)
    return f


def delete_file(name: str | None) -> None:
    if not name:
        return
    try:
        client().files.delete(name=name)
    except Exception as e:  # noqa: BLE001
        log.warning("could not delete Gemini file %s: %s", name, str(e)[:120])


def list_files() -> list[str]:
    return [f.name for f in client().files.list()]


def list_models() -> list[str]:
    return sorted(m.name.removeprefix("models/") for m in client().models.list())
