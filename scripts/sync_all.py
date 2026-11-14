#!/usr/bin/env python3
"""Полный цикл синхронизации проекта FTP340 «ВелоМощь 2.0».

Единая команда, которая приводит все репозитории и артефакты в согласованное
состояние и прогоняет все проверки. Запускать перед любым коммитом/деплоем.

Инварианты, которые скрипт гарантирует:
  1. board.js           == site-template/board.js      (root — источник правды)
  2. index.html         == site-template/index.html
  3. ftp340-training/adaptive-plan.json — единый источник плана:
       - зеркалится в versions/ftp340-plan-v<N>.json
       - зеркалится в tricoach-bot/adaptive-plan.json (локальный фолбэк бота)
  4. .ftp340-sync-state.json.manifest_sha256 == canonical sha256 плана

Затем прогоняет:
  - tests (ftp340-training): python3 -m unittest discover tests
  - tests (tricoach-bot):   PYTHONPATH=. pytest tests/
  - validate_deployment.py  (схема + совпадение sha256)
  - privacy check           (нет мед. данных в публичном манифесте)

Использование:
  python3 scripts/sync_all.py            # только синхронизация + проверки
  python3 scripts/sync_all.py --commit   # то же + git add/commit в обоих репо
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Репозиторий ftp340-training — корень скрипта.
PAGES_REPO = Path(__file__).resolve().parents[1]
WORKSPACE = PAGES_REPO.parent
BOT_REPO = WORKSPACE / "tricoach-bot"

PLAN_FILE = PAGES_REPO / "adaptive-plan.json"
STATE_FILE = PAGES_REPO / ".ftp340-sync-state.json"
VERSIONS_DIR = PAGES_REPO / "versions"

# Паттерн приватных/медицинских данных, который запрещён в публичном манифесте.
PRIVACY_PATTERN = re.compile(
    r"(?:hrv\s*[:=]|body\s*battery\s*[:=]|training\s*readiness\s*[:=]|"
    r"resting\s*heart\s*rate\s*[:=]|сон\s*[:=]|пульс\s*[:=]|"
    r"крест(?:ец|ц)|копчик|мениск|артроз|колен|knee|meniscus|arthrosis|"
    r"sacrum|sacral|coccyx|стресс-реакц|медицин\w*|(?:^|\W)garmin(?:\W|$))",
    re.IGNORECASE,
)


def canonical_json(value) -> bytes:
    """Совпадает с publish_plan.canonical_json."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def run(cmd: list[str], cwd: Path, label: str, env: dict | None = None) -> bool:
    print(f"\n▶ {label}")
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)
    ok = r.returncode == 0
    print(f"  {'✅ OK' if ok else '❌ FAIL'}: {' '.join(cmd)}")
    if not ok:
        tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-12:])
        if tail:
            print("  --- вывод ---")
            print("  " + tail.replace("\n", "\n  "))
    return ok


def sync_static_assets() -> None:
    """root → site-template для board.js и index.html."""
    for name in ("board.js", "index.html"):
        root = PAGES_REPO / name
        tmpl = PAGES_REPO / "site-template" / name
        if not root.exists():
            print(f"⚠ {name} отсутствует в корне, пропускаю.")
            continue
        if root.read_bytes() == tmpl.read_bytes():
            print(f"✓ {name} уже синхронизирован.")
        else:
            shutil.copy2(root, tmpl)
            print(f"↻ {name}: скопирован root → site-template/")


def sync_plan() -> str:
    """Зеркалит план в versions/, tricoach-bot/, пересчитывает sha256."""
    plan = json.loads(PLAN_FILE.read_text(encoding="utf-8"))
    version = plan.get("version_number", 0)
    if version < 1 or not plan.get("weeks"):
        raise ValueError("adaptive-plan.json: нет version_number или weeks")

    # Канонический sha256
    digest = hashlib.sha256(canonical_json(plan)).hexdigest()
    print(f"✓ version_number={version}, weeks={len(plan['weeks'])}, sha256={digest[:16]}…")

    # versions/ зеркало
    ver_file = VERSIONS_DIR / f"ftp340-plan-v{version}.json"
    ver_file.write_text(PLAN_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"✓ зеркало versions/{ver_file.name}")

    # Локальный фолбэк бота
    if BOT_REPO.exists():
        bot_plan = BOT_REPO / "adaptive-plan.json"
        bot_plan.write_text(PLAN_FILE.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"✓ зеркало {bot_plan.relative_to(WORKSPACE)}")
    else:
        print(f"⚠ tricoach-bot не найден по пути {BOT_REPO}, фолбэк бота не обновлён.")

    # sync-state
    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
    state["manifest_sha256"] = digest
    state["current_version"] = version
    for ev in state.get("accepted_events", []):
        if ev.get("version_number") == version:
            ev["manifest_sha256"] = digest
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ .ftp340-sync-state.json обновлён (manifest_sha256={digest})")

    return digest


def privacy_check() -> bool:
    text = PLAN_FILE.read_text(encoding="utf-8")
    matches = sorted(set(PRIVACY_PATTERN.findall(text)))
    if matches:
        print(f"❌ Privacy contract violation: {matches}")
        return False
    print("✓ Privacy contract: медицинских/персональных данных в манифесте нет.")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="затем git add/commit в обоих репо")
    args = ap.parse_args()

    if not PLAN_FILE.exists():
        print(f"❌ {PLAN_FILE} не найден — нечего синхронизировать.")
        return 1

    print("=" * 62)
    print("СИНХРОНИЗАЦИЯ FTP340")
    print("=" * 62)

    sync_static_assets()
    digest = sync_plan()
    privacy_ok = privacy_check()

    all_ok = True
    all_ok &= run(["python3", "-m", "unittest", "discover", "tests"], PAGES_REPO, "Тесты ftp340-training")
    all_ok &= run(["python3", "scripts/validate_deployment.py"], PAGES_REPO, "validate_deployment.py (схема + sha256)")

    if BOT_REPO.exists():
        all_ok &= run([".venv/bin/python", "-m", "pytest", "tests/", "-q"], BOT_REPO,
                      "Тесты tricoach-bot (pytest)", env={**os.environ, "PYTHONPATH": "."})
    else:
        print("⚠ tricoach-bot не найден — тесты бота пропущены.")

    # Финальная сверка статических файлов
    for name in ("board.js", "index.html"):
        a = (PAGES_REPO / name).read_bytes()
        b = (PAGES_REPO / "site-template" / name).read_bytes()
        print(f"✓ diff {name} ↔ site-template/{name}: {'IDENTICAL' if a == b else '⚠ DIFFERENT'}")
        if a != b:
            all_ok = False

    print("\n" + "=" * 62)
    if all_ok:
        print("РЕЗУЛЬТАТ: ✅ всё синхронизировано, все проверки пройдены.")
    else:
        print("РЕЗУЛЬТАТ: ❌ есть несоответствия или упавшие проверки (см. выше).")
    print("=" * 62)

    if args.commit and all_ok:
        for repo, paths, msg in [
            (PAGES_REPO, ["board.js", "index.html", "site-template/board.js",
                          "site-template/index.html", "adaptive-plan.json",
                          ".ftp340-sync-state.json", "versions/"], "sync: full plan & assets cycle"),
            (BOT_REPO, ["adaptive-plan.json"], "sync: mirror authoritative adaptive-plan.json"),
        ]:
            if not repo.exists():
                continue
            subprocess.run(["git", "add", *paths], cwd=repo, check=False)
            r = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo)
            if r.returncode != 0:
                subprocess.run(["git", "commit", "-q", "-m", msg], cwd=repo, check=False)
                print(f"✓ commit в {repo.name}")
            else:
                print(f"• {repo.name}: изменений нет, коммит пропущен.")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
