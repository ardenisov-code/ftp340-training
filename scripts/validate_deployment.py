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
    state = json.loads(state_file.read_text(encoding="utf-8"))
    event = {"version_number": state["current_version"], "version_id": state["version_id"]}
    publish_plan.validate_manifest(manifest, event)
    digest = hashlib.sha256(publish_plan.canonical_json(manifest)).hexdigest()
    if digest != state.get("manifest_sha256"):
        raise ValueError("The calendar does not match the approved publication ledger")
    archive = ROOT / "versions" / f"ftp340-plan-v{manifest['version_number']}.json"
    if json.loads(archive.read_text(encoding="utf-8")) != manifest:
        raise ValueError("The active calendar does not match its archived version")
    print(f"Verified approved manifest digest: {digest}")

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"version_number={manifest.get('version_number')}\n")
            f.write(f"manifest_sha256={digest}\n")


if __name__ == "__main__":
    main()
