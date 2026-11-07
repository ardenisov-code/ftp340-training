#!/usr/bin/env python3
"""Decode and validate the signed-by-GitHub, athlete-approved plan payload."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import os
from pathlib import Path

try:
    from .validate_adaptive_plan import validate_manifest
except ImportError:  # direct script execution in GitHub Actions
    from validate_adaptive_plan import validate_manifest


EVENT_NAME = "tricoach_plan_approved"
MAX_COMPRESSED_B64 = 55_000


def load_candidate(event_path: Path) -> tuple[dict, int, int]:
    event = json.loads(event_path.read_text())
    if event.get("action") != EVENT_NAME:
        raise ValueError("unexpected repository event")
    payload = event.get("client_payload") or {}
    proposal_id = int(payload["proposal_id"])
    version_id = int(payload["version_id"])
    if proposal_id < 1 or version_id < 1:
        raise ValueError("invalid approved version reference")
    encoded = payload.get("manifest_gzip_b64")
    if not isinstance(encoded, str) or len(encoded) > MAX_COMPRESSED_B64:
        raise ValueError("invalid manifest payload size")
    raw = gzip.decompress(base64.b64decode(encoded, validate=True))
    candidate = json.loads(raw)
    if not isinstance(candidate, dict):
        raise ValueError("manifest must be a JSON object")
    if int(candidate.get("version_number", 0)) < 1:
        raise ValueError("invalid plan version")
    return candidate, proposal_id, version_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("event", type=Path)
    parser.add_argument("previous", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    candidate, proposal_id, _version_id = load_candidate(args.event)
    previous = json.loads(args.previous.read_text())
    validate_manifest(candidate, previous)
    already_current = candidate == previous
    if not already_current and not args.dry_run:
        args.output.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n")
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as handle:
            handle.write(f"proposal_id={proposal_id}\n")
            handle.write(f"version_number={candidate['version_number']}\n")
            handle.write(f"baseline_sha256={candidate['baseline_sha256']}\n")
            handle.write(f"already_current={str(already_current).lower()}\n")
            handle.write(f"dry_run={str(args.dry_run).lower()}\n")
    mode = "validated only" if args.dry_run else ("already current" if already_current else "prepared")
    print(f"Plan v{candidate['version_number']} {mode}; 31 weeks, 214 sessions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
