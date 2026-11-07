#!/usr/bin/env python3
"""Validate a public FTP340 plan manifest before a Pages update."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any


TARGET = {"ftp_watts": 340, "date": "2027-06-06", "discipline": "road_cycling",
          "race_distance_km": [15, 100]}
EXPECTED_SESSIONS = 214
EXPECTED_WEEKS = 31
POWER_VALUE = re.compile(r"(?<!\d)(\d{2,3})\s*(?:Вт|W)\b", re.IGNORECASE)
PRIVATE_TEXT = re.compile(
    r"(?:не\s+скакалка\s*[—–-]\s*удар|Арт[её]м\s+Денисов|\b38\s*лет\b|\b187\s*см\b|\b83\s*кг\b|"
    r"крестц|копчик|\b(?:боль|боли|больно|болит)\b|болезнен\w*|дискомфорт|"
    r"\bHRV\b|heart\s*rate|resting\s*hr|\bпульс\b|\bсон\b|\bsleep\b|"
    r"\bgarmin\b|\bstrava\b|\bмрт\b|медицин\w*|readiness|body\s*battery|"
    r"stress[- ]*reaction|стресс-реакц|red-s|ферритин|тестостерон|денситометр)",
    re.IGNORECASE,
)


def _sessions(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for week in manifest.get("weeks", []):
        for session in week.get("days", []):
            session_date = str(session.get("date", ""))
            if session_date in rows:
                raise ValueError("a calendar date occurs more than once")
            rows[session_date] = session
    return rows


def _scan_private_text(value: Any) -> None:
    if isinstance(value, str):
        if PRIVATE_TEXT.search(value):
            raise ValueError("public plan contains personal health or identity text")
    elif isinstance(value, dict):
        for key, item in value.items():
            _scan_private_text(key)
            _scan_private_text(item)
    elif isinstance(value, list):
        for item in value:
            _scan_private_text(item)


def _max_power(session: dict[str, Any]) -> int | None:
    text = f"{session.get('main_set') or ''} {session.get('key_numbers') or ''}"
    values = [int(value) for value in POWER_VALUE.findall(text)]
    for low, high in re.findall(r"(\d{2,3})\s*[–—-]\s*(\d{2,3})\s*(?:Вт|W)\b", text, re.I):
        values.extend((int(low), int(high)))
    return max(values) if values else None


def _interval_work_minutes(session: dict[str, Any]) -> float | None:
    text = f"{session.get('main_set') or ''} {session.get('key_numbers') or ''}"
    text = re.sub(r"\d{2,3}\s*(?:–|—|-)\s*\d{2,3}\s*(?:Вт|W)\b", " ", text, flags=re.I)
    text = re.sub(r"\d{2,3}\s*(?:Вт|W)\b", " ", text, flags=re.I)
    triple = re.findall(r"(\d+)\s*[×xх]\s*(\d+)\s*[×xх]\s*(\d+)\s*/\s*\d+", text, re.I)
    if triple:
        return sum(int(a) * int(b) * int(c) for a, b, c in triple) / 60
    minutes = re.findall(r"(\d+)\s*[×xх]\s*(\d+)\s*(?:мин(?:ут\w*)?|m(?:in)?|['′])", text, re.I)
    if minutes:
        return sum(int(a) * int(b) for a, b in minutes)
    seconds = re.findall(r"(\d+)\s*[×xх]\s*(\d+)\s*(?:с|сек|s)\b", text, re.I)
    if seconds:
        return sum(int(a) * int(b) for a, b in seconds) / 60
    return None


def validate_manifest(candidate: dict[str, Any], previous: dict[str, Any] | None = None) -> None:
    if candidate.get("schema_version") != 1:
        raise ValueError("unsupported schema version")
    if candidate.get("target") != TARGET:
        raise ValueError("the strategic target is immutable")
    if not isinstance(candidate.get("version_number"), int) or candidate["version_number"] < 1:
        raise ValueError("invalid plan version")
    if not re.fullmatch(r"[0-9a-f]{64}", str(candidate.get("baseline_sha256", ""))):
        raise ValueError("invalid baseline checksum")
    try:
        updated_at = date.fromisoformat(candidate["updated_at"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid update date") from exc

    weeks = candidate.get("weeks")
    if not isinstance(weeks, list) or len(weeks) != EXPECTED_WEEKS:
        raise ValueError("the approved 31-week structure must be preserved")
    sessions = _sessions(candidate)
    if len(sessions) != EXPECTED_SESSIONS:
        raise ValueError("the approved 214-session structure must be preserved")
    if min(sessions) != "2026-11-05" or max(sessions) != TARGET["date"]:
        raise ValueError("plan calendar boundaries changed")
    for session_date, session in sessions.items():
        try:
            parsed_date = date.fromisoformat(session_date)
        except ValueError as exc:
            raise ValueError("invalid session date") from exc
        if session.get("discipline") not in {"bike", "strength", "recovery", "rest"}:
            raise ValueError("unsupported session discipline")
        duration = session.get("duration_min")
        if duration is not None and (not isinstance(duration, int) or not 0 <= duration <= 360):
            raise ValueError("invalid session duration")
        if session.get("completed") and parsed_date > updated_at:
            raise ValueError("a future session cannot be marked completed")
    completed = candidate.get("completed_session_dates", [])
    if not isinstance(completed, list) or not set(completed).issubset(sessions):
        raise ValueError("completion dates must belong to the approved plan")
    if any(date.fromisoformat(item) > updated_at for item in completed):
        raise ValueError("a future session cannot appear in completed history")
    for session_date, session in sessions.items():
        if bool(session.get("completed")) != (session_date in completed):
            raise ValueError("session completion flags must match the verified history")
    expected_history_from = min(completed) if completed else None
    if candidate.get("execution_history_from") != expected_history_from:
        raise ValueError("execution-history coverage marker is inconsistent")
    privacy = candidate.get("privacy") or {}
    if any(privacy.get(key) is not False for key in (
        "garmin_metrics_included", "health_metrics_included", "activity_performance_details_included"
    )):
        raise ValueError("the public data privacy contract is incomplete")
    ftp = candidate.get("current_ftp") or {}
    confirmed = ftp.get("confirmed_watts")
    if confirmed is not None and (not isinstance(confirmed, int) or not 100 <= confirmed <= 600):
        raise ValueError("invalid confirmed FTP")
    for result in candidate.get("confirmed_ftp_tests", []):
        if not 100 <= int(result["ftp_watts"]) <= 600:
            raise ValueError("invalid confirmed FTP test")
        if date.fromisoformat(result["test_date"]) > updated_at:
            raise ValueError("FTP test date is after the manifest update date")
    _scan_private_text(candidate)

    if previous is None:
        return
    if candidate.get("baseline_sha256") != previous.get("baseline_sha256"):
        raise ValueError("baseline checksum changed")
    if candidate["version_number"] == previous.get("version_number"):
        if candidate != previous:
            raise ValueError("a version number cannot be reused for different content")
        return
    if candidate["version_number"] != previous.get("version_number", 0) + 1:
        raise ValueError("plan version must increment by one")
    old_sessions, new_sessions = _sessions(previous), sessions
    if set(old_sessions) != set(new_sessions):
        raise ValueError("calendar dates cannot be added or removed")
    changed_dates = []
    for session_date, old_session in old_sessions.items():
        new_session = new_sessions[session_date]
        old_content = {k: v for k, v in old_session.items() if k != "completed"}
        new_content = {k: v for k, v in new_session.items() if k != "completed"}
        if old_content == new_content:
            continue
        changed_dates.append(session_date)
        parsed_date = date.fromisoformat(session_date)
        if parsed_date <= updated_at or parsed_date > updated_at + timedelta(days=14):
            raise ValueError("only future sessions in the next 14 days can change")
        if old_session.get("discipline") in {"rest", "recovery"} and new_session.get("discipline") in {"bike", "strength"}:
            raise ValueError("a rest/recovery session cannot become training")
        if new_session.get("discipline") not in {old_session.get("discipline"), "rest", "recovery"}:
            raise ValueError("a plan change cannot replace one training discipline with another")
        old_duration, new_duration = old_session.get("duration_min"), new_session.get("duration_min")
        if new_duration is not None and (old_duration is None or new_duration > old_duration * 1.05):
            raise ValueError("session duration increase exceeds the 5% limit")
        old_power, new_power = _max_power(old_session), _max_power(new_session)
        if new_power is not None and (old_power is None or new_power > old_power * 1.03):
            raise ValueError("session power increase exceeds the 3% limit")
        old_work, new_work = _interval_work_minutes(old_session), _interval_work_minutes(new_session)
        if new_work is not None and (old_work is None or new_work > old_work * 1.05):
            raise ValueError("interval work increase exceeds the 5% limit")
    if len(changed_dates) > 4:
        raise ValueError("at most four future sessions may change per review")
    for session_date, old_session in old_sessions.items():
        if date.fromisoformat(session_date) <= updated_at:
            old_content = {k: v for k, v in old_session.items() if k != "completed"}
            new_content = {k: v for k, v in new_sessions[session_date].items() if k != "completed"}
            if old_content != new_content:
                raise ValueError("past or current sessions are immutable")
    old_completed = set(previous.get("completed_session_dates", []))
    if not old_completed.issubset(set(completed)):
        raise ValueError("completed training history cannot be removed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    candidate = json.loads(args.candidate.read_text())
    previous = json.loads(args.previous.read_text()) if args.previous else None
    validate_manifest(candidate, previous)
    print(f"valid public plan v{candidate['version_number']}: {EXPECTED_WEEKS} weeks, {EXPECTED_SESSIONS} sessions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
