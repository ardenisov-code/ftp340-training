import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PublicBoardContractTests(unittest.TestCase):
    def test_workouts_only_come_from_the_approved_json_manifest(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "board.js").read_text(encoding="utf-8")
        manifest = json.loads((ROOT / "adaptive-plan.json").read_text(encoding="utf-8"))
        self.assertIn('id="approved-plan-calendar"', page)
        self.assertIn('id="macro-summary"', page)
        self.assertIn("fetch(`adaptive-plan.json", script)
        self.assertIn("renderPlan(manifest)", script)
        self.assertNotRegex(page, r"<details[^>]+class=.?week")
        self.assertNotRegex(script, r"VO₂\s*3×10|2026-11-06|2026-11-07|Силовая B")
        self.assertEqual(manifest["status"], "awaiting_approved_sync")
        self.assertEqual(manifest["weeks"], [])

    def test_site_design_and_interactions_remain_available(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "board.js").read_text(encoding="utf-8")
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
        self.assertIn("wrap.querySelectorAll(':scope > nav a[href^=\"#\"]')", script)
        self.assertIn("@media", css)
        self.assertIn("details.week", css)

    def test_public_html_does_not_contain_personal_medical_or_garmin_facts(self):
        public = "\n".join((ROOT / file).read_text(encoding="utf-8") for file in (
            "index.html", "board.js", "COACHING_CONSTITUTION.md", "adaptive-plan.json",
        ))
        for pattern in (r"крестц", r"копчик", r"стресс-реакц", r"HRV\s*[:=]\s*\d+",
                        r"sleep_score", r"body_battery", r"training_readiness", r"Artem Denisov",
                        r"Артём Денисов", r"\d{2}\s*лет\s*[·,]", r"\d{2,3}\s*см\s*/"):
            self.assertIsNone(re.search(pattern, public, re.IGNORECASE), pattern)


if __name__ == "__main__":
    unittest.main()
