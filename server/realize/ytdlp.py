"""yt-dlp wrapper: metadata, download and error mapping (SPEC 8.2).

Only the worker (and build_samples) import this. The API never talks to Instagram.
The option sets grew out of docs/archive/fetch_reel.py.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadError

from .config import get_settings
from .urls import extract

log = logging.getLogger("realize.ytdlp")

PERMANENT = {"private", "unavailable", "not_video"}
MAX_BYTES = 100 * 1024 * 1024
_logged_no_cookies = False


class ReelError(Exception):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}"[:400])
        self.reason = reason
        self.detail = detail
        self.permanent = reason in PERMANENT


def map_error(message: str) -> str:
    """Map a yt-dlp error message to a failure reason."""
    m = (message or "").lower()
    if "private" in m:
        return "private"
    if any(x in m for x in ("login required", "rate", "429", "wait a few minutes", "checkpoint")):
        return "blocked"
    if any(x in m for x in ("not available", "unavailable", "404")):
        return "unavailable"
    if "no video" in m:
        return "not_video"
    if any(x in m for x in ("timed out", "timeout", "connection", "network", "temporary failure",
                            "name resolution", "ssl")):
        return "network"
    return "processing_error"


def _base_opts(tmp: str) -> dict:
    global _logged_no_cookies
    opts: dict = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 15,
                  "noprogress": True}
    cookies = get_settings().cookies_file
    if cookies:
        # yt-dlp writes cookies back, threads must not share a file, and the
        # original is mounted read-only in Docker: every call gets its own copy.
        copy = os.path.join(tmp, "cookies.txt")
        shutil.copyfile(cookies, copy)
        opts["cookiefile"] = copy
    elif not _logged_no_cookies:
        log.info("No Instagram cookies; public access only.")
        _logged_no_cookies = True
    return opts


def _raise(e: Exception) -> None:
    reason = map_error(str(e))
    if reason == "blocked":
        if get_settings().cookies_file:
            log.error("Instagram is blocking this worker. Refresh cookies or run the worker on another IP.")
        else:
            log.error("Instagram wants a login. Add a throwaway account's cookies at INSTAGRAM_COOKIES_PATH.")
    raise ReelError(reason, str(e)) from e


def _check(url: str) -> str:
    link = extract(url)
    if not link or link.url != url:
        raise ReelError("processing_error", "not a canonical instagram.com URL")
    return link.url


def map_info(info: dict) -> dict:
    caption = (info.get("description") or info.get("title") or "").strip()
    tags = [t.lstrip("#").lower() for t in re.findall(r"#\w+", caption)]
    tags += [str(t).lstrip("#").lower() for t in info.get("tags") or []]
    seen: list[str] = []
    for t in tags:
        if t and t not in seen:
            seen.append(t)
    # Instagram's uploader_id is a numeric account id; the @handle is in channel.
    uid = str(info.get("uploader_id") or "")
    handle = info.get("channel") if (not uid or uid.isdigit()) and info.get("channel") else uid
    ts = info.get("timestamp")
    dur = info.get("duration")
    return {
        "caption": caption,
        "hashtags": seen[:30],
        "creator": {"handle": (handle or "").lstrip("@") or None, "name": info.get("uploader")},
        "posted_at": datetime.fromtimestamp(ts, UTC) if ts else None,
        "duration_sec": int(round(dur)) if dur else None,
        "thumbnail_url": info.get("thumbnail"),
    }


def fetch_metadata(url: str) -> dict:
    url = _check(url)
    with tempfile.TemporaryDirectory(prefix="rl_meta_") as tmp:
        opts = {**_base_opts(tmp), "skip_download": True}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as e:
            _raise(e)
        except Exception as e:  # noqa: BLE001 - network and extractor errors
            _raise(e)
    if not info:
        raise ReelError("unavailable", "no info returned")
    if info.get("_type") == "playlist" and not info.get("entries"):
        raise ReelError("not_video", "no video in this post")
    if info.get("_type") == "playlist":
        first = next((e for e in info["entries"] if e), None)
        if not first:
            raise ReelError("not_video", "no video in this post")
        merged = {**first, "description": info.get("description") or first.get("description")}
        info = merged
    return map_info(info)


def download(url: str, tmpdir: str) -> tuple[Path, dict]:
    """Download the video into tmpdir. Returns (path, mapped metadata)."""
    url = _check(url)
    opts = {
        **_base_opts(tmpdir),
        "format": "b[ext=mp4]/bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
        "max_filesize": MAX_BYTES,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as e:
        _raise(e)
    except Exception as e:  # noqa: BLE001
        _raise(e)
    files = [p for p in Path(tmpdir).iterdir()
             if p.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv", ".m4v")]
    if not files:
        raise ReelError("not_video", "no video file was downloaded")
    if info and info.get("_type") == "playlist":
        info = next((e for e in info.get("entries") or [] if e), info)
    return max(files, key=lambda p: p.stat().st_size), map_info(info or {})
