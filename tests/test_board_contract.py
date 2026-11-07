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
            self.assertIn("Действующая программа: Версия 1 (Базовый утверждённый календарь)", script)
            self.assertIn("Обновление программы ожидает утверждения спортсмена", script)
            self.assertIn("safety-gate-status-badge", script)

    def test_workout_teleport_js_generation_and_strict_validation(self):
        import subprocess
        node_bin = "/opt/homebrew/bin/node"
        check_script = """
        const fs = require('fs');
        const code = fs.readFileSync('site-template/board.js', 'utf8');
        const fnStr = code.slice(code.indexOf('const generateZwoXml ='), code.indexOf('const exportZwoFile ='));
        const fmtStr = code.slice(code.indexOf('const fmt ='), code.indexOf('const generateZwoXml ='));
        const fn = new Function('session', 'ftp', fmtStr + '\\n' + fnStr + '\\nreturn generateZwoXml(session, ftp);');

        // 1. 3x10x30/15
        const z1 = fn({ discipline: 'bike', title: 'VO2', duration_min: 75, main_set: "3 серии по 10×(30 с @ 120–125% / 15 с @ 50%). Отдых между сериями 3' легко" }, 290);
        if (!z1.includes('OnPower="1.225"') || !z1.includes('Repeat="10"')) throw new Error('Failed 30/15');

        // 2. 4x8 subthreshold
        const z2 = fn({ discipline: 'bike', title: 'Sub', duration_min: 80, main_set: "4×8' @ 85–88% через 2' легко" }, 290);
        if (!z2.includes('OnPower="0.865"') || !z2.includes('Repeat="4"')) throw new Error('Failed 4x8');

        // 3. 5x4 VO2max
        const z3 = fn({ discipline: 'bike', title: 'VO2max', duration_min: 70, main_set: "5×4' @ 105–110% через 3' легко" }, 290);
        if (!z3.includes('OnPower="1.075"') || !z3.includes('Repeat="5"') || !z3.includes('OffDuration="180"')) throw new Error('Failed 5x4');

        // 4. Long Z2 with embedded tempo
        const z4 = fn({ discipline: 'bike', title: 'Endurance', duration_min: 120, main_set: "Весь объём @ 62–72%. В середине 2×15' @ 80–85% через 5' легко" }, 290);
        if (!z4.includes('OnPower="0.825"') || !z4.includes('Repeat="2"')) throw new Error('Failed embedded tempo');

        // 5. Rejection of non-bike
        let rejectedNonBike = false;
        try { fn({ discipline: 'strength', title: 'Gym', main_set: 'Squats' }, 290); } catch (e) { rejectedNonBike = true; }
        if (!rejectedNonBike) throw new Error('Non-bike not rejected');

        // 6. Rejection of ambiguous
        let rejectedAmbiguous = false;
        try { fn({ discipline: 'bike', title: 'Random', main_set: 'Just pedal' }, 290); } catch (e) { rejectedAmbiguous = true; }
        if (!rejectedAmbiguous) throw new Error('Ambiguous not rejected');

        console.log('ALL_TELEPORT_JS_PASS');
        """
        proc = subprocess.run([node_bin, "-e", check_script], cwd=str(ROOT), capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, f"Node script failed: {proc.stderr}")
        self.assertIn("ALL_TELEPORT_JS_PASS", proc.stdout)


if __name__ == "__main__":
    unittest.main()
