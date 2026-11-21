import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PublicBoardContractTests(unittest.TestCase):
    def test_workouts_only_come_from_the_approved_json_manifest(self):
        page = (ROOT / "site-template/index.html").read_text(encoding="utf-8")
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertIn('id="approved-plan-calendar"', page)
        self.assertIn('id="macro-summary"', page)
        self.assertIn("adaptive-plan.json", script)
        self.assertIn("await (await fetch(url", script)
        self.assertNotRegex(page, r"<details[^>]+class=.?week")
        self.assertNotRegex(script, r"VO₂\s*3×10|2026-11-06|2026-11-07|Силовая B")
        self.assertFalse((ROOT / "site-template/adaptive-plan.json").exists())
        if (ROOT / "adaptive-plan.json").exists():
            manifest = json.loads((ROOT / "adaptive-plan.json").read_text(encoding="utf-8"))
            self.assertIn("version_number", manifest)
            self.assertIn("weeks", manifest)

    def test_site_design_and_interactions_remain_available(self):
        page = (ROOT / "site-template/index.html").read_text(encoding="utf-8")
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        css = (ROOT / "board.css").read_text(encoding="utf-8")
        self.assertIn('id="ftp-input"', page)
        self.assertIn('class="zone-table"', page)
        self.assertIn('id="week-rail"', page)
        self.assertIn('id="day-grid"', page)
        self.assertIn('id="day-modal"', page)
        self.assertIn('id="telemetry-pin"', page)
        self.assertIn("localStorage.setItem('ftp340_public_calc'", script)
        self.assertIn("function renderWeek()", script)
        self.assertIn("function openDay(day)", script)
        self.assertIn("async function exportWorkout", script)
        self.assertIn("function renderCalculator()", script)
        self.assertIn("async function updateLiveStatus", script)
        self.assertIn("@media", css)
        self.assertIn(".week-shell", css)
        self.assertIn(".day-grid", css)
        self.assertIn(".telemetry-panel", css)

    def test_public_html_does_not_contain_personal_medical_or_garmin_facts(self):
        public = "\n".join((ROOT / file).read_text(encoding="utf-8") for file in (
            "site-template/index.html", "site-template/board.js", "COACHING_CONSTITUTION.md",
        ))
        for pattern in (r"крест(?:ец|ц)", r"копчик", r"стресс-реакц", r"HRV\s*[:=]\s*\d+",
                        r"sleep_score", r"body_battery", r"training_readiness", r"Artem Denisov",
                        r"Артём Денисов", r"\d{2}\s*лет\s*[·,]", r"\d{2,3}\s*см\s*/"):
            self.assertIsNone(re.search(pattern, public, re.IGNORECASE), pattern)

    def test_fictitious_sports_data_eliminated(self):
        for fname in ("site-template/board.js", "board.js"):
            script = (ROOT / fname).read_text(encoding="utf-8")
            for marker in ("CP 270", "24.0 кДж", "91.5%", "<b>8.3</b>", "<b>1.7</b>",
                           "-6.6</b>", "910 Вт", "770 Вт", "518 Вт", "±18 Вт"):
                self.assertNotIn(marker, script)

    def test_telemetry_secure_authorization_and_no_token_in_url(self):
        for fname in ("site-template/board.js", "board.js"):
            script = (ROOT / fname).read_text(encoding="utf-8")
            self.assertNotIn("?token=", script)
            self.assertNotIn("&token=", script)
            self.assertIn("Authorization", script)
            self.assertIn("Bearer", script)
            self.assertIn("429", script)
            self.assertIn("input.value = ''", script)

    def test_mission_control_live_health_and_active_plan_banner(self):
        for fname in ("site-template/board.js", "board.js"):
            script = (ROOT / fname).read_text(encoding="utf-8")
            self.assertIn("/api/mission-control/status", script)
            self.assertIn("updateLiveStatus", script)
            self.assertIn("status-pill", script)

    def test_workout_export_does_not_reimplement_plan_parser_in_browser(self):
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertIn("/api/workouts/${day.date}.${format}", script)
        self.assertIn("searchParams.set('version'", script)
        self.assertNotIn("generateZwoXml", script)

    def test_public_schedule_does_not_merge_live_or_private_training_data(self):
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertNotIn("/api/plan/live-status", script)
        self.assertNotIn("date_overrides", script)
        self.assertNotIn("actual_np", script)
        self.assertIn("source_reference_ftp_watts", script)
        self.assertIn("getWorkingFtp", script)


if __name__ == "__main__":
    unittest.main()
