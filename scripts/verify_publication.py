#!/usr/bin/env python3
"""Poll the public Pages JSON and verify its version and canonical digest."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request

from publish_plan import canonical_json


def fetch_verified(url: str, version: int, digest: str, *, attempts: int = 30, delay: float = 5.0) -> bool:
    for _ in range(attempts):
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                doc = json.loads(response.read(2_000_000))
            if (
                int(doc.get("version_number", -1)) == version
                and hashlib.sha256(canonical_json(doc)).hexdigest() == digest
            ):
                return True
        except (OSError, urllib.error.URLError, ValueError, json.JSONDecodeError):
            pass
        time.sleep(delay)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--attempts", type=int, default=30)
    parser.add_argument("--delay", type=float, default=5)
    args = parser.parse_args()
    if not fetch_verified(args.url, args.version, args.sha256, attempts=args.attempts, delay=args.delay):
        print("FAIL: Pages did not serve the expected approved plan version")
        return 1
    print(f"PASS: Pages serves approved plan version {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
