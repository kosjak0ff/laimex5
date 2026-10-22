#!/usr/bin/env python3
"""Скачать реестр VID на этом компьютере и отправить в репозиторий только data/registry.json.

Нужен, когда сайт VID не пускает GitHub Actions (их облачные адреса режет фильтр перед
государственным хостингом). Запускайте по расписанию на компьютере, где vid.gov.lv открывается,
например раз в день до утреннего запуска робота (02:37 UTC):

    Linux/macOS (crontab -e):  7 1 * * *  cd /путь/к/laimex5 && python3 tools/push_registry.py
    Windows: Планировщик заданий → python tools\\push_registry.py, рабочая папка — laimex5

Робот на GitHub Actions, не достучавшись до VID, возьмёт эту копию реестра.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = "data/registry.json"


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, check=check, text=True, capture_output=True)


def main() -> int:
    git("pull", "--rebase", "origin", "main")
    r = subprocess.run([sys.executable, "-m", "laimex", "registry"], cwd=ROOT)
    if r.returncode != 0:
        print("Реестр скачать не удалось, ничего не отправляю.")
        return 1
    if not git("diff", "--quiet", "--", FILE, check=False).returncode:
        print("Реестр не изменился.")
        return 0
    git("add", FILE)
    git("commit", "-m", "Реестр VID: обновление с домашнего компьютера")
    for attempt in range(3):
        if git("push", "origin", "HEAD:main", check=False).returncode == 0:
            print("Реестр отправлен.")
            return 0
        git("pull", "--rebase", "origin", "main", check=False)
    print("Не удалось отправить реестр.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
