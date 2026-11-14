"""Extract and normalize Instagram post URLs.

The matching rules started in prototype/server.js (extractInstagramUrl and
reelIdFromUrl): accept www. and m. hosts, an optional username segment, and
text around the link, because share sheets send "Check out this reel https://...".
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_RE = re.compile(
    r"https?://(?:www\.|m\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(reel|reels|p|tv)/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class InstagramLink:
    shortcode: str
    url: str


def extract(text: str | None) -> InstagramLink | None:
    """Return the first Instagram post link in text, canonicalized, or None."""
    m = _RE.search(str(text or ""))
    if not m:
        return None
    kind, code = m.group(1).lower(), m.group(2)
    return InstagramLink(shortcode=code, url=canonical(kind, code))


def canonical(kind: str, code: str) -> str:
    if kind == "p":
        return f"https://www.instagram.com/p/{code}/"
    return f"https://www.instagram.com/reel/{code}/"
