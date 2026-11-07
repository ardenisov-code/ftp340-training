import base64
import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from scripts.publish_adaptive_plan import load_candidate
from scripts.validate_adaptive_plan import validate_manifest


ROOT = Path(__file__).resolve().parents[1]
BASE = json.loads((ROOT / "adaptive-plan.json").read_text())


def find_session(manifest, session_date):
    for week in manifest["weeks"]:
        for session in week["days"]:
            if session["date"] == session_date:
                return session
    raise AssertionError("test session date not found")


class PublicManifestTests(unittest.TestCase):
    def test_current_manifest_is_valid_and_has_fixed_goal(self):
        validate_manifest(BASE)
        self.assertEqual(BASE["target"]["ftp_watts"], 340)
        self.assertEqual(BASE["target"]["date"], "2027-06-06")

    def test_approved_future_changes_pass(self):
        previous = copy.deepcopy(BASE)
        candidate = copy.deepcopy(BASE)
        candidate["version_number"] = 2
        find_session(candidate, "2026-11-08")["title"] += " · adjusted"
        find_session(candidate, "2026-11-10")["title"] += " · adjusted"
        validate_manifest(candidate, previous)

    def test_target_and_past_sessions_are_immutable(self):
        altered_target = copy.deepcopy(BASE)
        altered_target["target"]["ftp_watts"] = 350
        with self.assertRaisesRegex(ValueError, "strategic target"):
            validate_manifest(altered_target)

        previous = copy.deepcopy(BASE)
        candidate = copy.deepcopy(BASE)
        candidate["version_number"] = 2
        find_session(candidate, "2026-11-06")["title"] += " · changed"
        with self.assertRaisesRegex(ValueError, "future sessions"):
            validate_manifest(candidate, previous)

    def test_no_more_than_four_future_sessions_can_change(self):
        previous = copy.deepcopy(BASE)
        candidate = copy.deepcopy(BASE)
        candidate["version_number"] = 2
        for session_date in ("2026-11-08", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"):
            find_session(candidate, session_date)["title"] += " · adjusted"
        with self.assertRaisesRegex(ValueError, "at most four"):
            validate_manifest(candidate, previous)

    def test_interval_and_watt_increases_are_capped(self):
        previous = copy.deepcopy(BASE)
        candidate = copy.deepcopy(BASE)
        target_date = "2026-11-08"
        old = find_session(previous, target_date)
        new = find_session(candidate, target_date)
        old["main_set"] = "3×10 min @ 250–270 Вт"
        old["key_numbers"] = "250–270 Вт"
        new["main_set"] = "4×10 min @ 280–300 Вт"
        new["key_numbers"] = "280–300 Вт"
        candidate["version_number"] = 2
        with self.assertRaisesRegex(ValueError, "power increase exceeds"):
            validate_manifest(candidate, previous)

        candidate = copy.deepcopy(previous)
        candidate["version_number"] = 2
        find_session(candidate, target_date)["main_set"] = "4×10 min @ 250–270 Вт"
        with self.assertRaisesRegex(ValueError, "interval work increase exceeds"):
            validate_manifest(candidate, previous)

    def test_personal_impact_avoidance_note_is_rejected(self):
        candidate = copy.deepcopy(BASE)
        find_session(candidate, "2026-11-08")["main_set"] = "Эллипс (НЕ скакалка — удар), 3×10 min"
        with self.assertRaisesRegex(ValueError, "personal health or identity"):
            validate_manifest(candidate)

    def test_completed_history_cannot_be_removed(self):
        previous = copy.deepcopy(BASE)
        candidate = copy.deepcopy(BASE)
        previous["completed_session_dates"] = ["2026-11-06"]
        find_session(previous, "2026-11-06")["completed"] = True
        candidate["completed_session_dates"] = []
        candidate["version_number"] = 2
        with self.assertRaisesRegex(ValueError, "history cannot be removed"):
            validate_manifest(candidate, previous)

    def test_event_payload_decodes_to_the_approved_public_manifest(self):
        candidate = copy.deepcopy(BASE)
        candidate["version_number"] = 2
        find_session(candidate, "2026-11-08")["title"] += " · adjusted"
        compressed = gzip.compress(json.dumps(candidate, ensure_ascii=False).encode(), mtime=0)
        event = {
            "action": "tricoach_plan_approved",
            "client_payload": {
                "proposal_id": 7, "version_id": 12,
                "manifest_gzip_b64": base64.b64encode(compressed).decode(),
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "event.json"
            path.write_text(json.dumps(event))
            decoded, proposal_id, version_id = load_candidate(path)
        self.assertEqual(decoded, candidate)
        self.assertEqual((proposal_id, version_id), (7, 12))


if __name__ == "__main__":
    unittest.main()
