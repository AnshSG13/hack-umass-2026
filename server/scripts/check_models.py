"""List Flash models for the key and confirm the configured model IDs exist.

Run from server/: python -m scripts.check_models
Exits nonzero if any configured model is missing.
"""
from __future__ import annotations

import sys

from google import genai

from realize.config import get_settings


def main() -> int:
    s = get_settings()
    if not s.gemini_api_key:
        print("GEMINI_API_KEY is blank.")
        return 2
    client = genai.Client(api_key=s.gemini_api_key)
    names = sorted(m.name.removeprefix("models/") for m in client.models.list())
    flash = [n for n in names if "flash" in n]
    embed = [n for n in names if "embedding" in n]
    print(f"{len(names)} models listed for this key.")
    print("Flash models:", ", ".join(flash) or "none")
    print("Embedding models:", ", ".join(embed) or "none")
    ok = True
    for label, model in (
        ("GEMINI_MODEL_FAST", s.gemini_model_fast),
        ("GEMINI_MODEL_VIDEO", s.gemini_model_video),
        ("GEMINI_EMBED_MODEL", s.gemini_embed_model),
    ):
        found = model in names
        ok = ok and found
        print(f"{label}={model}: {'ok' if found else 'MISSING'}")
    if "lite" in s.gemini_model_fast.lower():
        print("GEMINI_MODEL_FAST must not be a Lite model.")
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
