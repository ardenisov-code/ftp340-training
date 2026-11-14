#!/usr/bin/env python3
"""Validate and stage a TriCoach-approved, privacy-safe plan for GitHub Pages."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


MAX_COMPRESSED_BYTES = 55_000
MAX_MANIFEST_BYTES = 1_500_000
MAX_CLOCK_SKEW = timedelta(hours=24)
ALLOWED_TARGET_DATES = {"2027-06-06", "2027-07-11"}
FIXED_TARGET = {
    "ftp_watts": 340,
    "date": "2027-06-06",
    "discipline": "road_cycling",
    "race_distance_km": [15, 100],
}
PRIVATE_KEY_PATTERN = re.compile(
    r"(?:garmin|hrv|sleep|resting_hr|body_battery|training_readiness|"
    r"medical|sacrum|coccyx|крест(?:ец|ц)|копчик|стресс-реакц|encrypted_token|session_token)",
    re.IGNORECASE,
)
PRIVATE_TEXT_PATTERN = re.compile(
    r"(?:hrv\s*[:=]|body\s*battery\s*[:=]|training\s*readiness\s*[:=]|"
    r"resting\s*heart\s*rate\s*[:=]|сон\s*[:=]|пульс\s*[:=]|"
    r"крест(?:ец|ц)|копчик|sacrum|sacral|coccyx|стресс-реакц|медицин\w*|(?:^|\W)garmin(?:\W|$))",
    re.IGNORECASE,
)


class PublishValidationError(ValueError):
    pass


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def event_signature(payload: dict[str, Any], secret: str) -> str:
    unsigned = {key: value for key, value in payload.items() if key != "signature"}
    return hmac.new(secret.encode(), canonical_json(unsigned), hashlib.sha256).hexdigest()


def walk_private_data(value: Any, path: str = "$") -> list[str]:
    errors: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            privacy_indicator = path == "$.privacy" and str(key) in {
                "garmin_metrics_included", "health_metrics_included", "activity_performance_details_included"
            }
            if PRIVATE_KEY_PATTERN.search(str(key)) and not privacy_indicator:
                errors.append(f"private_key:{path}.{key}")
            errors.extend(walk_private_data(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            errors.extend(walk_private_data(child, f"{path}[{index}]"))
    elif isinstance(value, str) and PRIVATE_TEXT_PATTERN.search(value):
        errors.append(f"private_text:{path}")
    return errors


def validate_manifest(manifest: Any, event: dict[str, Any]) -> None:
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise PublishValidationError("unsupported_manifest_schema")
    if int(manifest.get("version_number", -1)) != int(event["version_number"]):
        raise PublishValidationError("version_number_mismatch")
    if int(manifest.get("version_id", -1)) != int(event["version_id"]):
        raise PublishValidationError("version_id_mismatch")
    target = manifest.get("target")
    if (
        not isinstance(target, dict)
        or target.get("ftp_watts") != 340
        or target.get("date") not in ALLOWED_TARGET_DATES
        or target.get("discipline") != "road_cycling"
        or target.get("race_distance_km") != [15, 100]
    ):
        raise PublishValidationError("fixed_target_mismatch")
    privacy = manifest.get("privacy") or {}
    if privacy.get("garmin_metrics_included") is not False:
        raise PublishValidationError("garmin_privacy_flag_missing")
    if privacy.get("health_metrics_included") is not False:
        raise PublishValidationError("health_privacy_flag_missing")
    if privacy.get("activity_performance_details_included") is not False:
        raise PublishValidationError("activity_privacy_flag_missing")
    if not isinstance(manifest.get("baseline_sha256"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", manifest["baseline_sha256"]
    ):
        raise PublishValidationError("baseline_hash_invalid")
    if not isinstance(manifest.get("weeks"), list) or not manifest["weeks"]:
        raise PublishValidationError("plan_weeks_missing")
    session_dates: list[str] = []
    for week in manifest["weeks"]:
        if not isinstance(week, dict) or not isinstance(week.get("days"), list):
            raise PublishValidationError("week_shape_invalid")
        for session in week["days"]:
            if not isinstance(session, dict):
                raise PublishValidationError("session_shape_invalid")
            day = session.get("date")
            if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                raise PublishValidationError("session_date_invalid")
            session_dates.append(day)
    if len(session_dates) != len(set(session_dates)):
        raise PublishValidationError("duplicate_session_date")
    if set(manifest.get("completed_session_dates", [])) - set(session_dates):
        raise PublishValidationError("completion_without_planned_session")
    private_paths = walk_private_data(manifest)
    if private_paths:
        raise PublishValidationError(private_paths[0])


def authenticate_event(event_doc: Any, secret: str, *, now: datetime | None = None) -> dict[str, Any]:
    if not isinstance(event_doc, dict):
        raise PublishValidationError("event_document_invalid")
    if event_doc.get("action") != "tricoach_plan_approved":
        raise PublishValidationError("unsupported_event_type")
    event = event_doc.get("client_payload")
    if not isinstance(event, dict):
        raise PublishValidationError("event_payload_missing")
    required = {"proposal_id", "version_number", "version_id", "generated_at", "nonce", "manifest_gzip_b64", "signature"}
    if not required.issubset(event):
        raise PublishValidationError("event_fields_missing")
    if not hmac.compare_digest(str(event["signature"]), event_signature(event, secret)):
        raise PublishValidationError("signature_invalid")
    try:
        generated_at = datetime.fromisoformat(str(event["generated_at"]).replace("Z", "+00:00"))
        if generated_at.tzinfo is None:
            raise ValueError
    except ValueError as exc:
        raise PublishValidationError("event_timestamp_invalid") from exc
    current = now or datetime.now(timezone.utc)
    if abs(current.astimezone(timezone.utc) - generated_at.astimezone(timezone.utc)) > MAX_CLOCK_SKEW:
        raise PublishValidationError("event_expired")
    if not re.fullmatch(r"[a-f0-9]{32}", str(event["nonce"])):
        raise PublishValidationError("event_nonce_invalid")
    return event


def decode_event(event_doc: Any, secret: str, *, now: datetime | None = None) -> tuple[dict[str, Any], dict[str, Any], str]:
    event = authenticate_event(event_doc, secret, now=now)
    encoded = event["manifest_gzip_b64"]
    if not isinstance(encoded, str) or len(encoded) > MAX_COMPRESSED_BYTES * 2:
        raise PublishValidationError("manifest_compressed_size_invalid")
    try:
        compressed = base64.b64decode(encoded, validate=True)
        if len(compressed) > MAX_COMPRESSED_BYTES:
            raise ValueError
        with gzip.GzipFile(fileobj=__import__("io").BytesIO(compressed)) as stream:
            body = stream.read(MAX_MANIFEST_BYTES + 1)
        if len(body) > MAX_MANIFEST_BYTES:
            raise ValueError
        manifest = json.loads(body)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise PublishValidationError("manifest_encoding_invalid") from exc
    validate_manifest(manifest, event)
    digest = hashlib.sha256(canonical_json(manifest)).hexdigest()
    return event, manifest, digest


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PublishValidationError(f"repository_state_invalid:{path.name}") from exc
    if not isinstance(value, dict):
        raise PublishValidationError(f"repository_state_invalid:{path.name}")
    return value


def _session_map(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(session["date"]): session
        for week in manifest.get("weeks", [])
        for session in week.get("days", [])
    }


def validate_transition(current: dict[str, Any], incoming: dict[str, Any]) -> None:
    if not current or int(current.get("version_number", 0)) == 0:
        baseline = incoming.get("baseline_weeks")
        if not isinstance(baseline, list) or not baseline:
            raise PublishValidationError("approved_baseline_missing")
        # PostgreSQL is authoritative: earlier approved changes may have
        # legitimately altered baseline sessions before the first site sync.
        return

    if incoming.get("baseline_sha256") != current.get("baseline_sha256"):
        raise PublishValidationError("immutable_baseline_hash_changed")
    if int(incoming.get("target", {}).get("ftp_watts", -1)) != 340 or incoming.get("target", {}).get("date") not in ALLOWED_TARGET_DATES:
        raise PublishValidationError("fixed_target_changed")

    before_sessions = _session_map(current)
    after_sessions = _session_map(incoming)
    before_baseline = _session_map(dict(current, weeks=current.get("baseline_weeks", [])))
    after_baseline = _session_map(dict(incoming, weeks=incoming.get("baseline_weeks", [])))
    if set(before_baseline) != set(after_baseline):
        raise PublishValidationError("immutable_baseline_sessions_changed")
    for day, before in before_baseline.items():
        after = after_baseline[day]
        if any(before.get(key) != after.get(key) for key in (
            "title", "discipline", "duration_min", "main_set", "key_numbers", "goal"
        )) or (before.get("completed") is True and after.get("completed") is not True):
            raise PublishValidationError("immutable_baseline_session_changed")
    raw_updated = incoming.get("updated_at", "")
    cutoff = datetime.fromisoformat(raw_updated).date() if "T" in str(raw_updated) else date.fromisoformat(raw_updated)
    for day, before in before_sessions.items():
        parsed_day = date.fromisoformat(day)
        if parsed_day < cutoff:
            after = after_sessions.get(day)
            if not after or any(before.get(key) != after.get(key) for key in (
                "title", "discipline", "duration_min", "main_set", "key_numbers", "goal"
            )):
                raise PublishValidationError("historical_session_changed")
        if before.get("completed") is True:
            after = after_sessions.get(day)
            if not after or after.get("completed") is not True:
                raise PublishValidationError("historical_completion_removed")
    if not set(current.get("completed_session_dates", [])) <= set(incoming.get("completed_session_dates", [])):
        raise PublishValidationError("completed_date_removed")
    prior_tests = {
        (row.get("test_date"), int(row.get("ftp_watts", -1)))
        for row in current.get("confirmed_ftp_tests", []) if isinstance(row, dict)
    }
    next_tests = {
        (row.get("test_date"), int(row.get("ftp_watts", -1)))
        for row in incoming.get("confirmed_ftp_tests", []) if isinstance(row, dict)
    }
    if not prior_tests <= next_tests:
        raise PublishValidationError("confirmed_ftp_history_removed")

    previous_ftp = current.get("current_ftp") or {}
    next_ftp = incoming.get("current_ftp") or {}
    if previous_ftp.get("reported_watts") != next_ftp.get("reported_watts"):
        # Athlete-reported working FTP may be corrected without pretending it
        # was laboratory-confirmed. Keep confirmation state separate and only
        # allow the reported field to change while the incoming status says so.
        if next_ftp.get("status") != "athlete_reported":
            raise PublishValidationError("reported_ftp_change_must_remain_athlete_reported")
        try:
            if int(next_ftp.get("reported_watts")) <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise PublishValidationError("reported_ftp_must_be_positive") from None
    previous_confirmed = previous_ftp.get("confirmed_watts")
    next_confirmed = next_ftp.get("confirmed_watts")
    if previous_confirmed != next_confirmed:
        test_rows = incoming.get("confirmed_ftp_tests") or []
        if not next_confirmed or not any(int(row.get("ftp_watts", -1)) == int(next_confirmed) for row in test_rows):
            raise PublishValidationError("ftp_change_without_confirmed_test")


def stage_event(event: dict[str, Any], manifest: dict[str, Any], digest: str, repo: Path) -> tuple[str, int, str]:
    current = _load_json(repo / "adaptive-plan.json")
    current_state = _load_json(repo / ".ftp340-sync-state.json")
    incoming_version = int(event["version_number"])
    current_version = int(current.get("version_number", 0))
    current_digest = current_state.get("manifest_sha256")
    seen = current_state.get("accepted_events") or []
    matching_nonce = next((row for row in seen if row.get("nonce") == event["nonce"]), None)
    if matching_nonce and (matching_nonce.get("version_number") != incoming_version or matching_nonce.get("manifest_sha256") != digest):
        raise PublishValidationError("event_nonce_replay_mismatch")
    if current_version == incoming_version:
        if current_digest != digest:
            raise PublishValidationError("version_replayed_with_different_content")
        return "duplicate", current_version, str(current_digest)
    if incoming_version <= current_version:
        raise PublishValidationError("stale_version_replay")
    if current_version and incoming_version != current_version + 1:
        raise PublishValidationError("version_gap")
    if incoming_version < 1:
        raise PublishValidationError("invalid_initial_version")

    versions = repo / "versions"
    versions.mkdir(parents=True, exist_ok=True)
    validate_transition(current, manifest)
    if not current_version:
        baseline = {"baseline_sha256": manifest["baseline_sha256"],
                    "baseline_version_id": manifest["baseline_version_id"],
                    "weeks": manifest["baseline_weeks"]}
        baseline_file = versions / ("baseline-" + manifest["baseline_sha256"] + ".json")
        if baseline_file.exists() and _load_json(baseline_file) != baseline:
            raise PublishValidationError("immutable_baseline_conflict")
        baseline_file.write_bytes(canonical_json(baseline) + b"\n")
    if current_version:
        current_file = versions / f"ftp340-plan-v{current_version}.json"
        if current_file.exists():
            existing = _load_json(current_file)
            if hashlib.sha256(canonical_json(existing)).hexdigest() != current_digest:
                raise PublishValidationError("version_history_conflict")
        else:
            current_file.write_bytes(canonical_json(current) + b"\n")
    target = versions / f"ftp340-plan-v{incoming_version}.json"
    if target.exists():
        if hashlib.sha256(canonical_json(_load_json(target))).hexdigest() != digest:
            raise PublishValidationError("immutable_version_conflict")
    else:
        target.write_bytes(canonical_json(manifest) + b"\n")
    (repo / "adaptive-plan.json").write_bytes(canonical_json(manifest) + b"\n")
    events = (seen + [{
        "nonce": event["nonce"], "version_number": incoming_version,
        "manifest_sha256": digest,
    }])[-50:]
    state = {
        "current_version": incoming_version,
        "version_id": int(event["version_id"]),
        "proposal_id": int(event["proposal_id"]),
        "manifest_sha256": digest,
        "accepted_events": events,
    }
    (repo / ".ftp340-sync-state.json").write_bytes(canonical_json(state) + b"\n")
    return "staged", current_version, str(current_digest or "")


def restore_previous_manifest(repo: Path) -> dict[str, Any]:
    """Restore the latest immutable version before the current one for failure recovery tests."""
    current = _load_json(repo / "adaptive-plan.json")
    version = int(current.get("version_number", 0))
    if version <= 1:
        raise PublishValidationError("no_previous_public_version")
    previous_path = repo / "versions" / f"ftp340-plan-v{version - 1}.json"
    previous = _load_json(previous_path)
    if int(previous.get("version_number", -1)) != version - 1:
        raise PublishValidationError("previous_version_missing")
    (repo / "adaptive-plan.json").write_bytes(canonical_json(previous) + b"\n")
    state_path = repo / ".ftp340-sync-state.json"
    state = _load_json(state_path)
    state["current_version"] = version - 1
    state["version_id"] = int(previous.get("version_id", 0))
    state["manifest_sha256"] = hashlib.sha256(canonical_json(previous)).hexdigest()
    state_path.write_bytes(canonical_json(state) + b"\n")
    return previous


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["authorize", "prepare"])
    parser.add_argument("--event-file", required=True)
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    secret = os.environ.get("TRICOACH_DISPATCH_HMAC_SECRET", "")
    if not secret:
        print("TRICOACH_DISPATCH_HMAC_SECRET is missing", file=sys.stderr)
        return 2
    try:
        event_doc = json.loads(Path(args.event_file).read_text(encoding="utf-8"))
        if args.action == "authorize":
            event = authenticate_event(event_doc, secret)
            outputs = {
                "authenticated": "true", "proposal_id": str(int(event["proposal_id"])),
                "version_number": str(int(event["version_number"])),
                "version_id": str(int(event["version_id"])),
            }
            if os.environ.get("GITHUB_OUTPUT"):
                with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                    for key, value in outputs.items():
                        output.write(f"{key}={value}\n")
            print(json.dumps({"result": "authenticated", **outputs}))
            return 0
        event, manifest, digest = decode_event(event_doc, secret)
        result, previous_version, previous_digest = stage_event(event, manifest, digest, Path(args.repo))
    except (OSError, json.JSONDecodeError, PublishValidationError) as exc:
        print(f"Plan publication validation failed: {exc}", file=sys.stderr)
        return 1
    outputs = {
        "result": result, "version_number": str(manifest["version_number"]),
        "proposal_id": str(event["proposal_id"]), "manifest_sha256": digest,
        "previous_version": str(previous_version), "previous_sha256": previous_digest,
    }
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in outputs.items():
                output.write(f"{key}={value}\n")
    print(json.dumps({
        **outputs,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
