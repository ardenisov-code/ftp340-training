#!/usr/bin/env python3
"""Build an allowlisted Pages artifact; legacy mode is only for rollback."""
import argparse
import json
import shutil
from pathlib import Path


def build(repo: Path, output: Path, mode: str) -> None:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    source = repo / 'site-template' if mode == 'adaptive' else repo
    for name in ('index.html', 'board.js'):
        shutil.copy2(source / name, output / name)
    for name in ('board.css', '.nojekyll'):
        shutil.copy2(repo / name, output / name)
    if (repo / 'assets').exists():
        shutil.copytree(repo / 'assets', output / 'assets')
    if mode == 'adaptive':
        manifest = json.loads((repo / 'adaptive-plan.json').read_text(encoding='utf-8'))
        if manifest.get('version_number', 0) < 1 or not manifest.get('weeks'):
            raise ValueError('no approved plan to publish')
        shutil.copy2(repo / 'adaptive-plan.json', output / 'adaptive-plan.json')
        if (repo / 'versions').exists():
            shutil.copytree(repo / 'versions', output / 'versions')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['adaptive', 'legacy'], required=True)
    args = parser.parse_args()
    build(args.repo, args.output, args.mode)
