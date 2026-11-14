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
        self.assertIn("fetch(`adaptive-plan.json", script)
        self.assertIn("renderPlan(manifest)", script)
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
        self.assertIn("ftp-reference", page)
        self.assertIn("class=\"ztab\"", page)
        self.assertIn("button.dataset.tab = key", script)
        self.assertIn("guide-switch", script)
        self.assertIn("localStorage.setItem('ftp340_public_calc'", script)
        self.assertIn("const init = async () =>", script)
        self.assertIn("todayButton.dataset.action = 'open-today'", script)
        self.assertIn("expandButton.dataset.action = 'expand-weeks'", script)
        self.assertIn("collapseButton.dataset.action = 'collapse-weeks'", script)
        self.assertIn("session.warmup", script)
        self.assertIn("session.main_set", script)
        self.assertIn("session.cooldown", script)
        self.assertIn("source_reference_ftp_watts", script)
        self.assertIn("wrap.querySelectorAll(':scope > nav a[href^=\"#\"]')", script)
        self.assertIn("@media", css)
        self.assertIn("details.week", css)

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
            self.assertNotIn("CP 270", script)
            self.assertNotIn("24.0 кДж", script)
            self.assertNotIn("91.5%", script)
            self.assertNotIn("<b>8.3</b>", script)
            self.assertNotIn("<b>1.7</b>", script)
            self.assertNotIn("-6.6</b>", script)
            self.assertNotIn("910 Вт", script)
            self.assertNotIn("770 Вт", script)
            self.assertNotIn("518 Вт", script)
            self.assertNotIn("±18 Вт", script)
            self.assertIn("Недостаточно данных", script)
            self.assertIn("Не откалиброван", script)

    def test_telemetry_secure_authorization_and_no_token_in_url(self):
        for fname in ("site-template/board.js", "board.js"):
            script = (ROOT / fname).read_text(encoding="utf-8")
            self.assertNotIn("?token=", script)
            self.assertNotIn("&token=", script)
            self.assertIn("Authorization", script)
            self.assertIn("Bearer", script)
            self.assertIn("429", script)
            self.assertIn("pinInput.value = ''", script)

    def test_mission_control_live_health_and_active_plan_banner(self):
        for fname in ("site-template/board.js", "board.js"):
            script = (ROOT / fname).read_text(encoding="utf-8")
            self.assertIn("/api/mission-control/status", script)
            self.assertIn("updateLiveSystemStatus", script)
            self.assertIn("const updateLivePlanBanner = async container =>", script)
            self.assertIn("gates.active_version", script)
            self.assertIn("updateLivePlanBanner(planBanner)", script)
            self.assertIn("safety-gate-status-badge", script)

    def test_workout_export_does_not_reimplement_plan_parser_in_browser(self):
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertIn("/api/workouts/${session.date}/zwo?ftp=${ftp}", script)
        self.assertIn("/api/workouts/${session.date}.fit?ftp=${ftp}", script)
        self.assertNotIn("generateZwoXml", script)

    def test_live_zwo_export_uses_server_parser_and_working_ftp(self):
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertIn("/api/workouts/${session.date}/zwo?ftp=${ftp}", script)
        self.assertIn("getWorkingFtp(manifest)", script)
        self.assertNotIn("const xml = generateZwoXml(session, ftp)", script)

    def test_board_surfaces_exports_for_next_three_uncompleted_bike_sessions(self):
        script = (ROOT / "site-template/board.js").read_text(encoding="utf-8")
        self.assertIn("const renderNextBikeExports = (manifest, ftp)", script)
        self.assertIn("session.discipline === 'bike' && session.date >= localMoscowDate() && !session.completed", script)
        self.assertIn(".slice(0, 3)", script)
        self.assertIn("ZWO · MyWhoosh", script)
        self.assertIn("FIT · Garmin", script)
        self.assertIn("Как импортировать ZWO в MyWhoosh с телефона", script)
        self.assertIn("Downloads", script)
        self.assertIn("renderNextBikeExports(manifest, ftp)", script)


if __name__ == "__main__":
    unittest.main()
