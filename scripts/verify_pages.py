#!/usr/bin/env python3
"""Wait until GitHub Pages serves the exact approved adaptive manifest."""

from __future__ import annotations

import argparse
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from .validate_adaptive_plan import validate_manifest
except ImportError:  # direct script execution in GitHub Actions
    from validate_adaptive_plan import validate_manifest


PAGES_MANIFEST_URL = "https://ardenisov-code.github.io/ftp340-training/adaptive-plan.json"


def fetch_manifest(timeout: int = 15) -> dict:
    request = Request(PAGES_MANIFEST_URL + f"?verify={int(time.time())}", headers={
        "Cache-Control": "no-cache", "Pragma": "no-cache", "Accept": "application/json",
        "User-Agent": "FTP340-plan-verification",
    })
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("Pages manifest did not return HTTP 200")
        return json.loads(response.read())


def wait_for_version(expected_version: int, expected_baseline: str, timeout_seconds: int = 240) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            manifest = fetch_manifest()
            validate_manifest(manifest)
            if (manifest.get("version_number") == expected_version
                    and manifest.get("baseline_sha256") == expected_baseline):
                print(f"GitHub Pages serves verified plan v{expected_version}.")
                return
        except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError):
            pass
        time.sleep(10)
    raise TimeoutError("GitHub Pages did not serve the expected approved version in time")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", type=int)
    parser.add_argument("baseline_sha256")
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()
    wait_for_version(args.version, args.baseline_sha256, args.timeout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
