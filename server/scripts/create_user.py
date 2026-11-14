"""Create a user and print the key once.

Run from server/: python -m scripts.create_user [--label NAME] [--tz ZONE] [--judge]
"""
from __future__ import annotations

import argparse
import sys

from realize import accounts
from realize.config import get_settings


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--label")
    p.add_argument("--tz")
    p.add_argument("--judge", action="store_true")
    a = p.parse_args()
    user, key = accounts.create_user(a.tz, label=a.label, is_judge=a.judge)
    s = get_settings()
    print(f"user_id: {user['_id']}")
    print(f"timezone: {user['timezone']}")
    print(f"key (shown once): {key}")
    print(f"phone setup link: {s.public_base_url}/setup#k={key}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
