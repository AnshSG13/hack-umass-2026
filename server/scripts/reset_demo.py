"""Delete all demo users and their documents (the TTL indexes do this too, within 24 hours).

Run from server/: python -m scripts.reset_demo
"""
from __future__ import annotations

import sys

from realize import demo


def main() -> int:
    counts = demo.reset()
    print("deleted: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
