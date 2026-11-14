"""All runtime configuration. Nothing else in the server reads os.environ."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Realize"
    public_base_url: str = "http://localhost:3000"
    domain: str = ""
    debug_endpoints: bool = False

    mongodb_uri: str = ""
    mongodb_db: str = "realize"

    gemini_api_key: str = ""
    gemini_model_fast: str = ""
    gemini_model_video: str = ""
    gemini_embed_model: str = ""
    embed_dim: int = 768
    # Optional, comma separated. Tried in order when the main model answers 429 or 503
    # (free-tier keys have a small per-model daily quota). Never put a Lite model in the fast list.
    gemini_model_fast_fallbacks: str = ""
    gemini_model_video_fallbacks: str = ""

    instagram_cookies_path: str = ""

    planner_mode: str = "live"  # live | fake
    proposal_wait_seconds: int = 20
    hybrid_mode: str = "auto"  # auto | rankfusion | manual
    worker_id: str = "laptop"
    worker_propose_threads: int = 2
    worker_enrich_threads: int = 2
    default_timezone: str = "America/New_York"

    # Trip plans: forecast and place lookup (Open-Meteo, free, no key).
    weather_api_url: str = "https://api.open-meteo.com/v1/forecast"
    geocode_api_url: str = "https://geocoding-api.open-meteo.com/v1/search"
    weather_source_url: str = "https://open-meteo.com/"
    maps_search_url: str = "https://www.google.com/maps/search/"
    maps_directions_url: str = "https://www.google.com/maps/dir/"

    shortcut_url: str = ""
    judge_shortcut_url: str = ""
    first_save_reel_url: str = ""
    demo_enabled: bool = True

    @field_validator("public_base_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def cookies_file(self) -> Path | None:
        """The cookies file if one is configured and exists, else None."""
        raw = (self.instagram_cookies_path or "").strip()
        if not raw:
            return None
        p = Path(raw)
        if not p.is_absolute():
            p = REPO_ROOT / p
        return p if p.is_file() else None

    def model_chain(self, role: str) -> list[str]:
        """The model for a role ("fast" or "video") followed by its fallbacks, no duplicates."""
        if role == "video":
            first, extra = self.gemini_model_video, self.gemini_model_video_fallbacks
        else:
            first, extra = self.gemini_model_fast, self.gemini_model_fast_fallbacks
        chain = [first] + [m.strip() for m in extra.split(",") if m.strip()]
        return list(dict.fromkeys(chain))

    @property
    def wait_cap(self) -> int:
        return 25


@lru_cache
def get_settings() -> Settings:
    return Settings()
