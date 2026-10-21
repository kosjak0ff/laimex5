#!/usr/bin/env python3
"""Запустить робота на GitHub Actions (laimex-daily), дождаться окончания и подтянуть результат.

Использует задача Claude: в начале работы — чтобы взять свежий реестр, и после поиска правил —
чтобы робот сразу их скачал. Нужен инструмент gh с доступом к репозиторию.

    python tools/run_robot.py            # запустить, ждать, затем git pull
    python tools/run_robot.py --no-pull  # не делать git pull
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

WORKFLOW = "daily.yml"


def sh(*args: str, check: bool = True) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{r.stdout}\n{r.stderr}")
    return r.stdout


def repo_name() -> str:
    url = sh("git", "remote", "get-url", "origin").strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+)", url)
    return m.group(1) if m else "kosjak0ff/laimex5"


def gh_json(path: str, *extra: str):
    return json.loads(sh("gh", "api", path, *extra) or "null")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-pull", action="store_true")
    ap.add_argument("--timeout", type=int, default=900, help="секунд ждать робота")
    args = ap.parse_args()
    repo = repo_name()
    started = datetime.now(timezone.utc) - timedelta(seconds=10)

    sh("gh", "api", "-X", "POST", f"repos/{repo}/actions/workflows/{WORKFLOW}/dispatches", "-f", "ref=main")
    print(f"Робот запущен в {repo}, жду…", flush=True)

    run_id, deadline = None, time.time() + args.timeout
    while time.time() < deadline:
        runs = gh_json(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=5")
        for run in runs.get("workflow_runs", []):
            created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
            if created >= started:
                run_id = run["id"]
                break
        if run_id:
            break
        time.sleep(5)
    if not run_id:
        print("Не удалось найти запуск робота. Продолжаю без него.")
        return 2

    status = conclusion = None
    while time.time() < deadline:
        run = gh_json(f"repos/{repo}/actions/runs/{run_id}")
        status, conclusion = run["status"], run.get("conclusion")
        if status == "completed":
            break
        time.sleep(10)
    print(f"Робот: {status}, результат: {conclusion} (https://github.com/{repo}/actions/runs/{run_id})")

    if not args.no_pull:
        print(sh("git", "pull", "--rebase", "origin", "main", check=False).strip())
    return 0 if conclusion == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
