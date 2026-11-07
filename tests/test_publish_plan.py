import base64
import copy
import gzip
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.publish_plan import (
    PublishValidationError,
    canonical_json,
    decode_event,
    event_signature,
    restore_previous_manifest,
    stage_event,
)
from scripts.build_pages import build


SECRET = "test-secret-that-is-at-least-32-bytes-long"


def manifest(version=2, *, version_id=None):
    return {
        "schema_version": 1,
        "version_number": version,
        "version_id": version_id or version * 10,
        "baseline_version_id": 10,
        "baseline_sha256": "a" * 64,
        "updated_at": "2026-11-07",
        "target": {
            "ftp_watts": 340, "date": "2027-06-06",
            "discipline": "road_cycling", "race_distance_km": [15, 100],
        },
        "current_ftp": {"confirmed_watts": None, "reported_watts": 280, "status": "athlete_reported"},
        "confirmed_ftp_tests": [],
        "changes": [],
        "weeks": [{"week_number": 0, "block": "Base", "block_rationale": "Build safely",
                   "days": [{"date": "2026-11-06", "day": "Пт", "discipline": "bike",
                             "title": "VO₂ 3×10×30/15", "duration_min": 65,
                             "main_set": "3×10×(30 с @ 118–124% FTP / 15 с легко)",
                             "key_numbers": "330–347 Вт", "goal": "Качественная работа",
                             "completed": True},
                            {"date": "2026-11-07", "day": "Сб", "discipline": "strength",
                             "title": "Силовая A — облегчённая", "duration_min": 33,
                             "main_set": "RPE 6; без отказа", "key_numbers": "",
                             "goal": "Адаптация", "completed": False},
                            {"date": "2026-11-09", "day": "Пн", "discipline": "rest",
                             "title": "Отдых", "duration_min": None,
                             "main_set": "", "key_numbers": "", "goal": "Восстановление",
                             "completed": False}]}],
        "baseline_weeks": [{"week_number": 0, "block": "Base", "block_rationale": "Original approved baseline",
                            "days": [{"date": "2026-11-06", "day": "Пт", "discipline": "bike",
                                      "title": "VO₂ 3×10×30/15", "duration_min": 65,
                                      "main_set": "3×10×(30 с @ 118–124% FTP / 15 с легко)",
                                      "key_numbers": "330–347 Вт", "goal": "Качественная работа",
                                      "completed": True},
                                     {"date": "2026-11-07", "day": "Сб", "discipline": "strength",
                                      "title": "Силовая A — облегчённая", "duration_min": 33,
                                      "main_set": "RPE 6; без отказа", "key_numbers": "",
                                      "goal": "Адаптация", "completed": False},
                                     {"date": "2026-11-09", "day": "Пн", "discipline": "rest",
                                      "title": "Отдых", "duration_min": None,
                                      "main_set": "", "key_numbers": "", "goal": "Восстановление",
                                      "completed": False}]}],
        "completed_session_dates": ["2026-11-06"],
        "execution_history_from": "2026-11-06",
        "privacy": {"garmin_metrics_included": False, "health_metrics_included": False,
                    "activity_performance_details_included": False},
    }


def event_for(value, *, nonce=None):
    zipped = base64.b64encode(gzip.compress(canonical_json(value), mtime=0)).decode()
    payload = {
        "proposal_id": 700 + value["version_number"],
        "version_number": value["version_number"], "version_id": value["version_id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "nonce": nonce or ("a" * 32 if value["version_number"] == 2 else "b" * 32),
        "manifest_gzip_b64": zipped,
    }
    payload["signature"] = event_signature(payload, SECRET)
    return {"action": "tricoach_plan_approved", "client_payload": payload}


class ApprovedPlanPublicationTests(unittest.TestCase):
    def test_artifact_and_legacy_rollback_keep_correct_site(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            repo = base / "repo"
            repo.mkdir()
            import shutil
            for name in ("index.html", "board.js", "board.css", ".nojekyll"):
                shutil.copy2(root / name, repo / name)
            shutil.copytree(root / "site-template", repo / "site-template")
            public = manifest(5)
            (repo / "adaptive-plan.json").write_bytes(canonical_json(public))
            build(repo, base / "new", "adaptive")
            self.assertEqual(json.loads((base / "new/adaptive-plan.json").read_text()), public)
            self.assertIn("approved-plan-calendar", (base / "new/index.html").read_text())
            self.assertFalse((base / "new/site-template").exists())
            build(repo, base / "rollback", "legacy")
            self.assertEqual((base / "rollback/index.html").read_bytes(), (root / "index.html").read_bytes())
            self.assertFalse((base / "rollback/adaptive-plan.json").exists())

    def test_authentication_and_fixed_target_and_privacy_gate(self):
        event = event_for(manifest())
        payload, public, _ = decode_event(event, SECRET)
        self.assertEqual(public["version_number"], payload["version_number"])
        self.assertNotIn("sleep", json.dumps(public).lower())
        self.assertNotIn("HRV", json.dumps(public))

        tampered = copy.deepcopy(event)
        tampered["client_payload"]["version_number"] = 99
        with self.assertRaisesRegex(PublishValidationError, "signature_invalid"):
            decode_event(tampered, SECRET)

        private = manifest()
        private["current_ftp"]["sleep_score"] = 80
        with self.assertRaisesRegex(PublishValidationError, "private_key"):
            decode_event(event_for(private), SECRET)

        private = manifest()
        private["weeks"][0]["days"][0]["goal"] = "Боль в крестец"
        with self.assertRaisesRegex(PublishValidationError, "private_text"):
            decode_event(event_for(private), SECRET)

        wrong_goal = manifest()
        wrong_goal["target"]["ftp_watts"] = 350
        with self.assertRaisesRegex(PublishValidationError, "fixed_target_mismatch"):
            decode_event(event_for(wrong_goal), SECRET)

    def test_approved_manifest_keeps_november_6_and_7_override_dates(self):
        event = event_for(manifest())
        _, public, _ = decode_event(event, SECRET)
        sessions = {day["date"]: day for week in public["weeks"] for day in week["days"]}
        self.assertEqual(sessions["2026-11-06"]["title"], "VO₂ 3×10×30/15")
        self.assertTrue(sessions["2026-11-06"]["completed"])
        self.assertEqual(sessions["2026-11-07"]["discipline"], "strength")
        self.assertEqual(sessions["2026-11-07"]["title"], "Силовая A — облегчённая")

    def test_stage_replay_and_versioned_history_are_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            m2 = manifest(2)
            e2 = event_for(m2)
            ev, decoded, digest = decode_event(e2, SECRET)
            self.assertEqual(stage_event(ev, decoded, digest, repo)[0], "staged")
            self.assertEqual(stage_event(ev, decoded, digest, repo)[0], "duplicate")
            self.assertTrue((repo / ("versions/baseline-" + "a" * 64 + ".json")).exists())
            self.assertFalse((repo / "versions/ftp340-plan-v1.json").exists())
            self.assertTrue((repo / "versions/ftp340-plan-v2.json").exists())

            m3 = manifest(3)
            m3["version_id"] = 30
            m3["weeks"][0]["days"][2]["title"] = "Отдых после цикла"
            ev3, decoded3, digest3 = decode_event(event_for(m3), SECRET)
            stage_event(ev3, decoded3, digest3, repo)
            self.assertEqual(json.loads((repo / "adaptive-plan.json").read_text())['version_number'], 3)

            previous = restore_previous_manifest(repo)
            self.assertEqual(previous["version_number"], 2)
            self.assertTrue((repo / "versions/ftp340-plan-v3.json").exists())
            state = json.loads((repo / ".ftp340-sync-state.json").read_text())
            self.assertEqual(state["current_version"], 2)
            current_hash = hashlib.sha256(canonical_json(previous)).hexdigest()
            self.assertEqual(state["manifest_sha256"], current_hash)

    def test_initial_sync_accepts_current_version_without_inventing_prior_versions(self):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            public = manifest(7)
            public["weeks"][0]["days"][0]["title"] = "Previously approved historical session"
            event, decoded, digest = decode_event(event_for(public), SECRET)
            self.assertEqual(stage_event(event, decoded, digest, repo)[0], "staged")
            self.assertTrue((repo / "versions/ftp340-plan-v7.json").exists())
            self.assertFalse((repo / "versions/ftp340-plan-v1.json").exists())

    def test_stale_gap_and_same_version_content_replay_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            e2 = event_for(manifest(2))
            event2, public2, digest2 = decode_event(e2, SECRET)
            stage_event(event2, public2, digest2, repo)

            stale = manifest(1, version_id=10)
            with self.assertRaisesRegex(PublishValidationError, "stale_version_replay"):
                ev, data, digest = decode_event(event_for(stale), SECRET)
                stage_event(ev, data, digest, repo)

            same = manifest(2)
            same["weeks"][0]["days"][2]["title"] = "Modified under same version"
            with self.assertRaisesRegex(PublishValidationError, "version_replayed_with_different_content"):
                ev, data, digest = decode_event(event_for(same, nonce="c" * 32), SECRET)
                stage_event(ev, data, digest, repo)

            gap = manifest(4)
            with self.assertRaisesRegex(PublishValidationError, "version_gap"):
                ev, data, digest = decode_event(event_for(gap), SECRET)
                stage_event(ev, data, digest, repo)


    def test_resolve_callback_url_prevents_duplicate_path(self):
        from scripts.send_publish_result import resolve_callback_url
        self.assertEqual(
            resolve_callback_url("https://tricoach-garmin.onrender.com"),
            "https://tricoach-garmin.onrender.com/internal/plan-publish-result",
        )
        self.assertEqual(
            resolve_callback_url("https://tricoach-garmin.onrender.com/"),
            "https://tricoach-garmin.onrender.com/internal/plan-publish-result",
        )
        self.assertEqual(
            resolve_callback_url("https://tricoach-garmin.onrender.com/internal/plan-publish-result"),
            "https://tricoach-garmin.onrender.com/internal/plan-publish-result",
        )
        self.assertEqual(
            resolve_callback_url("https://tricoach-garmin.onrender.com/internal/plan-publish-result/"),
            "https://tricoach-garmin.onrender.com/internal/plan-publish-result",
        )


if __name__ == "__main__":
    unittest.main()
