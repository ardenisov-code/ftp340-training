"""Exercise the redesigned board's pure presentation helpers on v7 data."""
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE_BIN = shutil.which("node") or ("/opt/homebrew/bin/node" if Path("/opt/homebrew/bin/node").exists() else "node")


class TrackDisplayTests(unittest.TestCase):
    def test_titles_blocks_and_disciplines_render_from_manifest_values(self):
        js = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('board.js', 'utf8');
const ctx = {
  __BOARD_UAT__: true,
  window: {},
  document: { addEventListener() {}, createElement: () => ({ append() {}, style: {} }) },
};
vm.runInNewContext(source, ctx);
const uat = ctx.uat;
assert.equal(uat.displayTitle('Вело · аэробная выносливость'), 'Аэробная выносливость');
assert.equal(uat.displayTitle('ВЕЛО Z2L Длинная выносливость 2ч'), 'Z2L Длинная выносливость 2ч');
assert.equal(uat.displayTitle('СИЛА Жим ногами'), 'Жим ногами');
assert.equal(uat.blockName('Блок 1 · Неделя 1: Тесты и калибровка'), 'Тесты и калибровка');
assert.equal(uat.blockName('Развитие FTP'), 'Развитие FTP');
assert.equal(uat.kindOf({discipline: 'strength'}).label, 'Силовая');
assert.equal(uat.kindOf({discipline: 'rest'}).label, 'Отдых');
assert.equal(uat.isTest({title: "ТЕСТ 3' + 12'"}), true);
assert.equal(uat.isTest({title: 'ВЕЛО Z2'}), false);
console.log('board presentation UAT passed');
'''
        subprocess.run([NODE_BIN, '-e', js], cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
