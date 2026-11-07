#!/usr/bin/env python3
"""Send a signed, idempotent publication result to the configured TriCoach endpoint."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", choices=["published", "failed"], required=True)
    parser.add_argument("--proposal-id", type=int, required=True)
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--version-id", type=int, required=True)
    parser.add_argument("--commit-sha", default="")
    parser.add_argument("--manifest-sha256", default="")
    parser.add_argument("--error-code", default="")
    args = parser.parse_args()
    base_url = os.environ.get("TRICOACH_CALLBACK_URL", "").rstrip("/")
    secret = os.environ.get("LINK_SIGNING_SECRET", "")
    if not base_url or not secret:
        print("TriCoach callback configuration is missing", file=sys.stderr)
        return 2
    payload = {
        "proposal_id": args.proposal_id, "version_number": args.version,
        "version_id": args.version_id,
        "status": args.status, "commit_sha": args.commit_sha or None,
        "manifest_sha256": args.manifest_sha256 or None,
        "error_code": (args.error_code or None),
    }
    body = canonical_json(payload)
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"{base_url}/internal/plan-publish-result", data=body, method="POST",
        headers={"Content-Type": "application/json", "X-TriCoach-Signature": signature},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read(64_000))
            if response.status != 200 or result.get("ok") is not True:
                raise RuntimeError("callback_not_confirmed")
    except (OSError, urllib.error.URLError, ValueError, RuntimeError) as exc:
        print(f"TriCoach callback failed: {type(exc).__name__}", file=sys.stderr)
        return 1
    print(f"PASS: TriCoach recorded {args.status} for version {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
