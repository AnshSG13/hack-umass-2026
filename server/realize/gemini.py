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
from functools import lru_cache
from typing import Any, Callable

import numpy as np
from google import genai
from google.genai import types

from .config import get_settings

log = logging.getLogger("realize.gemini")

_thinking_cache: dict[str, str] = {}


class LoopTimeout(Exception):
    pass


@lru_cache
def client() -> genai.Client:
    s = get_settings()
    return genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=120_000))


def fn_tool(name: str, description: str, parameters: dict) -> dict:
    return {"type": "function", "name": name, "description": description, "parameters": parameters}


def lowest_thinking(model: str) -> str:
    """The lowest thinking level the model accepts: minimal where supported, else low.

    The thinking docs list which models take 'minimal'; newer Flash models
    (3.8) and Gemini 4 start at 'low'. Unknown models are probed once.
    """
    if model in _thinking_cache:
        return _thinking_cache[model]
    level = "low"
    try:
        client().interactions.create(
            model=model, store=False, input="ok",
            generation_config={"thinking_level": "minimal", "max_output_tokens": 16}, timeout=20,
        )
        level = "minimal"
    except Exception as e:  # noqa: BLE001 - any rejection means fall back to low
        log.info("thinking_level minimal not accepted by %s (%s); using low", model, str(e)[:80])
    _thinking_cache[model] = level
    return level


def user_step(text: str, image_jpeg: bytes | None = None) -> dict:
    content: list[dict] = [{"type": "text", "text": text}]
    if image_jpeg:
        content.append({"type": "image", "mime_type": "image/jpeg",
                        "data": base64.b64encode(image_jpeg).decode("ascii")})
    return {"type": "user_input", "content": content}


def run_tool_loop(
    *,
    model: str,
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
    level = lowest_thinking(model)
    for turn in range(1, max_turns + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.5:
            raise LoopTimeout(f"tool loop exceeded {timeout_s}s")
        gen: dict[str, Any] = {"thinking_level": level}
        if turn >= force_from_turn:
            gen["tool_choice"] = {"allowed_tools": {"mode": "any", "tools": [force_tool]}}
        interaction = client().interactions.create(
            model=model, store=False, input=history, tools=tools,
            system_instruction=system, generation_config=gen, timeout=remaining,
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


def generate_json(*, model: str, input: Any, schema: dict, system: str | None = None,
                  timeout_s: float = 120, thinking: str | None = None) -> dict:
    """One structured-output call. Returns the parsed JSON object."""
    kwargs: dict[str, Any] = dict(
        model=model, store=False, input=input,
        response_format={"type": "text", "mime_type": "application/json", "schema": schema},
        generation_config={"thinking_level": thinking or lowest_thinking(model)},
        timeout=timeout_s,
    )
    if system:
        kwargs["system_instruction"] = system
    interaction = client().interactions.create(**kwargs)
    text = interaction.output_text or ""
    return json.loads(text)


def embed(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed and L2-normalize. task_type: RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY."""
    s = get_settings()
    res = client().models.embed_content(
        model=s.gemini_embed_model,
        contents=[t if t.strip() else "(empty)" for t in texts],
        config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=s.embed_dim),
    )
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
