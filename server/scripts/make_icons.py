"""Draw the web app's icon (Home Screen and browser tab).

Run from server/:
  python -m scripts.make_icons                 # the icon the app uses, into web/public
  python -m scripts.make_icons --all DIR       # every variant at 1024 px into DIR, to compare

The mark is a lowercase serif "r" in the app's own heading face (Hedvig Letters Serif) with
a butter full stop, the colour of the app's highlighter mark. iOS rounds the corners itself,
so the image is a full square with no transparency.

The font is read from the web app's build cache (web/.next), where next/font keeps it. Run
`npm run dev` or `npm run build` in web/ once if it isn't there. Georgia is the fallback.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public"
SIZES = {"apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512, "icon-1024.png": 1024}

TEAL = (31, 78, 82)        # #1F4E52
WHITE = (255, 255, 255)
BUTTER = (255, 226, 138)   # a stronger butter than the page's #FFF3C4, so it holds on teal
INK = (30, 31, 36)         # --ink
PAPER = (248, 246, 242)    # --ticket
HIGHLIGHT = (255, 236, 160)

VARIANTS = {
    # name: (background, letter, dot colour or None, highlight bar colour or None)
    "teal-dot": (TEAL, WHITE, BUTTER, None),
    "teal": (TEAL, WHITE, None, None),
    "paper": (PAPER, INK, None, HIGHLIGHT),
    "ink-dot": (INK, WHITE, BUTTER, None),
}
DEFAULT = "teal-dot"


def find_font() -> tuple[str, str]:
    """The heading face from the web build cache, else Georgia."""
    for f in sorted((ROOT / "web" / ".next").rglob("*.woff2")):
        try:
            family = ImageFont.truetype(str(f), 40).getname()[0]
        except Exception:  # noqa: BLE001 - not a font Pillow can read
            continue
        if family.startswith("Hedvig Letters Serif") and ".p." in f.name:  # the latin subset
            return str(f), family
    for f in ("C:/Windows/Fonts/georgia.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"):
        if Path(f).exists():
            return f, "fallback serif"
    raise SystemExit("No serif font found. Run the web app once so web/.next holds the heading font.")


def draw(size: int, variant: str, font_path: str) -> Image.Image:
    bg, fg, dot, bar = VARIANTS[variant]
    s = size * 4  # draw large, then shrink, so edges are smooth
    img = Image.new("RGB", (s, s), bg)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, round(s * 0.92))
    try:
        font.set_variation_by_axes([144])  # the display cut: finer hairlines at this size
    except Exception:  # noqa: BLE001 - not a variable font
        pass

    left, top, right, bottom = d.textbbox((0, 0), "r", font=font)
    w, h = right - left, bottom - top
    dot_r = round(s * 0.058) if dot else 0
    gap = round(s * 0.035) if dot else 0
    total = w + gap + 2 * dot_r
    x = (s - total) // 2 - left
    # An "r" has no descender and little weight low down, so it sits a touch below centre.
    y = (s - h) // 2 - top + round(s * 0.015)
    baseline = y + bottom

    if bar:
        pad = round(s * 0.05)
        d.rectangle([x + left - pad, baseline - round(h * 0.42), x + left + w + pad, baseline + round(s * 0.03)],
                    fill=bar)
    d.text((x, y), "r", font=font, fill=fg)
    if dot:
        cx = x + left + w + gap + dot_r
        cy = baseline - dot_r
        d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=dot)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--variant", default=DEFAULT, choices=sorted(VARIANTS))
    p.add_argument("--all", metavar="DIR", help="write every variant at 1024 px into DIR and stop")
    a = p.parse_args()
    font_path, family = find_font()
    print("font:", family)
    if a.all:
        out = Path(a.all)
        out.mkdir(parents=True, exist_ok=True)
        for name in VARIANTS:
            draw(1024, name, font_path).save(out / f"icon-{name}.png", format="PNG", optimize=True)
            print("wrote", out / f"icon-{name}.png")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        draw(size, a.variant, font_path).save(OUT / name, format="PNG", optimize=True)
        print(f"wrote {OUT / name} ({size}x{size}, {a.variant})")


if __name__ == "__main__":
    main()
