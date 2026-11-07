#!/usr/bin/env python3
"""Send a minimal HMAC-authenticated publish status to TriCoach."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("event", type=Path)
    parser.add_argument("status", choices=("published", "failed"))
    parser.add_argument("--commit-sha", default="")
    parser.add_argument("--error-code", default="")
    args = parser.parse_args()
    event = json.loads(args.event.read_text())
    payload = event.get("client_payload") or {}
    body_obj = {
        "proposal_id": int(payload["proposal_id"]),
        "version_number": int(payload["version_number"]),
        "status": args.status,
        "commit_sha": args.commit_sha[:80] or None,
        "error_code": args.error_code[:80] or None,
    }
    raw = json.dumps(body_obj, separators=(",", ":"), sort_keys=True).encode()
    key = os.environ["LINK_SIGNING_SECRET"].encode()
    signature = hmac.new(key, raw, hashlib.sha256).hexdigest()
    base = os.environ["TRICOACH_CALLBACK_URL"].rstrip("/")
    url = base if base.endswith("/internal/plan-publish-result") else base + "/internal/plan-publish-result"
    request = Request(url, data=raw, headers={
        "Content-Type": "application/json", "X-TriCoach-Signature": signature,
        "User-Agent": "FTP340-Pages-publish-status",
    }, method="POST")
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                if response.status != 200:
                    raise RuntimeError("TriCoach callback returned a non-200 response")
                print(f"TriCoach notified: publication {args.status}.")
                return 0
        except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
            last_error = type(exc).__name__
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"TriCoach publish callback failed ({last_error or 'unknown'}).")


if __name__ == "__main__":
    raise SystemExit(main())
