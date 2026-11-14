#!/usr/bin/env python3
"""Validates adaptive-plan.json integrity and sync state for deployment."""
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import publish_plan


def main() -> None:
    plan_file = ROOT / "adaptive-plan.json"
    state_file = ROOT / ".ftp340-sync-state.json"

    if not plan_file.exists():
        print("No adaptive-plan.json found, skipping manifest checks.")
        return

    manifest = json.loads(plan_file.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError(f"Invalid schema version: {manifest.get('schema_version')}")
    if manifest.get("version_number", 0) < 1:
        raise ValueError(f"Invalid version number: {manifest.get('version_number')}")
    if not manifest.get("weeks"):
        raise ValueError("Empty weeks array")

    digest = hashlib.sha256(publish_plan.canonical_json(manifest)).hexdigest()

    if state_file.exists():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        expected = state.get("manifest_sha256")
        if expected and expected != digest:
            raise ValueError(f"Manifest sha256 mismatch: calculated {digest} vs sync state {expected}")
        print(f"Verified manifest digest: {digest} matches sync state.")
    else:
        print(f"Verified manifest schema & structure. Digest: {digest}")

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"version_number={manifest.get('version_number')}\n")
            f.write(f"manifest_sha256={digest}\n")


if __name__ == "__main__":
    main()
