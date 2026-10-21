"""Контроль здоровья: всё ли обновляется. При проблемах робот открывает issue на GitHub,
а GitHub присылает владельцу письмо. Когда всё снова в порядке — issue закрывается."""
from __future__ import annotations

import glob
import json
import os
import subprocess
from datetime import date, datetime

from .config import DATA, SUMMARIES, today
from .pipeline import REGISTRY_JSON, TODO_JSON, load, now_iso, save

HEALTH_JSON = DATA / "health.json"
ISSUE_TITLE = "Laimex: нужна проверка"
MAX_WAIT_DAYS = 2        # сколько дней лотерея может ждать выжимку
MAX_QUIET_DAYS = 2       # сколько дней задача Claude может ничего не сохранять при непустой очереди
MAX_NOSOURCE_DAYS = 5    # сколько дней идущая лотерея может быть без найденных правил


def _days_since(iso: str | None, now: date) -> int | None:
    if not iso:
        return None
    return (now - datetime.fromisoformat(iso).date()).days


def check(now: date | None = None) -> dict:
    now = now or today()
    reg = load(REGISTRY_JSON, {})
    todo = load(TODO_JSON, {})
    extracted = [load(SUMMARIES / os.path.basename(f), {}).get("_extracted")
                 for f in glob.glob(str(SUMMARIES / "*.json"))]
    last_summary = max((e for e in extracted if e), default=None)
    waiting = todo.get("waiting_since", {})
    need_summary = set(todo.get("need_summary", []))
    names = {r["permit"]: r["name"] for r in reg.get("lotteries", [])}

    problems = []
    reg_age = _days_since(reg.get("fetched"), now)
    if reg_age is None or reg_age > 1:
        problems.append(f"Реестр VID не обновлялся {reg_age} дн. — проверьте вкладку Actions.")
    quiet = _days_since(last_summary, now)
    if need_summary and quiet is not None and quiet > MAX_QUIET_DAYS:
        problems.append(f"Задача Claude ничего не сохраняла {quiet} дн., а в очереди "
                        f"{len(need_summary)} выжимок. Проверьте подписку и запуски задачи.")
    late_summary = sorted(p for p in need_summary
                          if (_days_since(waiting.get(p), now) or 0) > MAX_WAIT_DAYS)
    if late_summary:
        problems.append("Давно ждут выжимку: " + ", ".join(f"{p} {names.get(p, '')}" for p in late_summary))
    late_source = sorted(p for p, since in waiting.items() if p not in need_summary
                         and (_days_since(since, now) or 0) > MAX_NOSOURCE_DAYS)
    if late_source:
        problems.append("Идут, но правила не найдены уже больше "
                        f"{MAX_NOSOURCE_DAYS} дн.: " + ", ".join(f"{p} {names.get(p, '')}" for p in late_source))

    health = {"checked": now_iso(), "ok": not problems, "problems": problems,
              "registry_fetched": reg.get("fetched"), "last_summary": last_summary,
              "queue_summaries": len(need_summary), "queue_sources": len(todo.get("need_sources", []))}
    save(HEALTH_JSON, health)
    return health


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def sync_issue(health: dict, repo: str) -> str:
    """Открыть, обновить или закрыть issue в зависимости от состояния."""
    issues = json.loads(_gh("api", f"repos/{repo}/issues?state=open&per_page=50") or "[]")
    mine = next((i for i in issues if i["title"] == ISSUE_TITLE and "pull_request" not in i), None)
    if health["ok"]:
        if mine:
            _gh("api", "-X", "POST", f"repos/{repo}/issues/{mine['number']}/comments",
                "-f", "body=Всё снова в порядке, закрываю.")
            _gh("api", "-X", "PATCH", f"repos/{repo}/issues/{mine['number']}", "-f", "state=closed")
            return "closed"
        return "ok"
    body = ("Робот Laimex заметил проблему:\n\n" + "\n".join(f"- {p}" for p in health["problems"]) +
            f"\n\nПроверено: {health['checked']}. Issue закроется само, когда всё наладится.")
    if mine:
        if mine.get("body") != body:
            _gh("api", "-X", "PATCH", f"repos/{repo}/issues/{mine['number']}", "-f", f"body={body}")
        return "updated"
    _gh("api", "-X", "POST", f"repos/{repo}/issues", "-f", f"title={ISSUE_TITLE}", "-f", f"body={body}")
    return "opened"
