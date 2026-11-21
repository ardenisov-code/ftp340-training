"""Exercise the real board rendering functions using the published v7 data."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TrackDisplayTests(unittest.TestCase):
    def test_published_track_intervals_and_transition_week(self):
        js = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let source = fs.readFileSync('board.js','utf8').replace("  document.addEventListener('DOMContentLoaded', init);", "  globalThis.uat = {renderSessionPhases, weekPresentation, sessionDisplayTitle, renderProfileMetrics};");
class Element {
 constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.style = {}; }
 setAttribute(k, v) { this[k] = v; }
 append(...nodes) { this.children.push(...nodes); }
}
const ctx = {window: {}, document: {createElement: tag => new Element(tag)}};
vm.runInNewContext(source, ctx);
const manifest = JSON.parse(fs.readFileSync('adaptive-plan.json','utf8'));
const week = manifest.weeks.find(w => w.days.some(d => d.date === '2026-11-22'));
const day = week.days.find(d => d.date === '2026-11-22');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const phases = text(ctx.uat.renderSessionPhases(day));
assert.match(phases, /2 × 20 мин · ЧСС 145–150 уд\/мин/);
assert.match(phases, /15 мин разминка/);
const presentation = ctx.uat.weekPresentation(week);
assert.equal(presentation.block, 'Переходная неделя');
assert.doesNotMatch(presentation.rationale, /тест 3/);
const noTargets = ctx.uat.renderSessionPhases({main_set:'По ощущениям', export_steps:[]});
assert.doesNotMatch(text(noTargets), /ЧСС/);
const ordinary = ctx.uat.weekPresentation({block:'Развитие', block_rationale:'Прогрессия', days:[]});
assert.equal(ordinary.block, 'Развитие');
assert.equal(ctx.uat.sessionDisplayTitle('Вело · аэробная выносливость', 'ВЕЛО'), 'Аэробная выносливость');
assert.equal(ctx.uat.sessionDisplayTitle('Велотрек · свитспот 2×20', 'ВЕЛО'), 'Велотрек · свитспот 2×20');
const metrics = ctx.uat.renderProfileMetrics({current_ftp:{reported_watts:290,status:'athlete_reported'}, profile:{workingFtp:290,targetFtp:340,isConfirmed:false,fromManifest:true}});
assert.match(text(metrics), /Заявлен спортсменом · 85% от цели/);
assert.match(text(metrics), /290\s+\/ 340 Вт/);
const progress = metrics.children.at(-1);
assert.equal(progress.children[1].children[0].style.width, '85%');
const noFtp = ctx.uat.renderProfileMetrics({profile:{workingFtp:null,targetFtp:340}});
assert.equal(noFtp.children.length, 3);
'''
        subprocess.run(['node', '-e', js], cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
