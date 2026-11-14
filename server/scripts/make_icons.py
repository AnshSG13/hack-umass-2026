"""Draw the web app icons (Home Screen and browser tab) from the DESIGN.md tokens.

Run from server/:
  python -m scripts.make_icons

Writes web/public/apple-touch-icon.png (180), icon-192.png and icon-512.png.
The mark is the ticket stub: a white ticket on highlighter, a tear line with two
notches, and the stub's time as an ink bar.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

INK = (27, 36, 48)
HIGHLIGHTER = (255, 210, 63)
TICKET = (255, 255, 255)
LINE = (125, 135, 148)

OUT = Path(__file__).resolve().parents[2] / "web" / "public"
SIZES = {"apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512}


def draw(size: int) -> Image.Image:
    scale = 4  # draw large, then shrink, so edges are smooth
    s = size * scale
    img = Image.new("RGB", (s, s), HIGHLIGHTER)
    d = ImageDraw.Draw(img)

    def u(v: float) -> int:
        return round(v * s)

    # the ticket
    left, right, top, bottom = u(0.20), u(0.80), u(0.17), u(0.83)
    d.rounded_rectangle([left, top, right, bottom], radius=u(0.07), fill=TICKET, outline=INK, width=u(0.028))

    # tear line with a notch on each edge
    tear = u(0.55)
    notch = u(0.052)
    for cx in (left, right):
        d.ellipse([cx - notch, tear - notch, cx + notch, tear + notch], fill=HIGHLIGHTER, outline=INK, width=u(0.028))
    # hide the half of each notch outline that falls outside the ticket
    d.rectangle([left - notch - u(0.02), tear - notch - u(0.02), left - 1, tear + notch + u(0.02)], fill=HIGHLIGHTER)
    d.rectangle([right + 1, tear - notch - u(0.02), right + notch + u(0.02), tear + notch + u(0.02)], fill=HIGHLIGHTER)
    dash, gap = u(0.045), u(0.035)
    x = left + notch + u(0.03)
    while x + dash < right - notch - u(0.02):
        d.rounded_rectangle([x, tear - u(0.009), x + dash, tear + u(0.009)], radius=u(0.009), fill=LINE)
        x += dash + gap

    # above the tear: the reel (two muted lines)
    d.rounded_rectangle([u(0.29), u(0.27), u(0.63), u(0.315)], radius=u(0.02), fill=INK)
    d.rounded_rectangle([u(0.29), u(0.37), u(0.52), u(0.405)], radius=u(0.018), fill=LINE)

    # below the tear: the time, highlighted
    d.rounded_rectangle([u(0.29), u(0.635), u(0.71), u(0.745)], radius=u(0.025), fill=HIGHLIGHTER)
    d.rounded_rectangle([u(0.33), u(0.672), u(0.60), u(0.708)], radius=u(0.018), fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        draw(size).save(OUT / name, format="PNG", optimize=True)
        print(f"wrote {OUT / name} ({size}x{size})")


if __name__ == "__main__":
    main()
