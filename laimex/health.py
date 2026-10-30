"""Контроль здоровья: всё ли обновляется. При проблемах робот открывает issue на GitHub,
а GitHub присылает владельцу письмо. Когда всё снова в порядке — issue закрывается."""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
from datetime import date, datetime

from .config import DATA, SUMMARIES, today
from .pipeline import REGISTRY_JSON, TODO_JSON, inbox_files, load, now_iso, save

HEALTH_JSON = DATA / "health.json"
ISSUE_TITLE = "Laimex: что нужно сделать"
OLD_TITLES = {ISSUE_TITLE, "Laimex: нужна проверка"}   # прежнее название, чтобы не открыть второе issue
MAX_WAIT_DAYS = 2        # сколько дней лотерея может ждать выжимку
MAX_QUIET_DAYS = 2       # сколько дней задача Claude может ничего не сохранять при непустой очереди
MAX_NOSOURCE_DAYS = 5    # сколько дней идущая лотерея может быть без найденных правил
MAX_REGISTRY_DAYS = 7    # раз в столько дней напоминать загрузить реестр VID (робота VID не пускает)

REPO = "kosjak0ff/laimex5"
SITE_URL = "https://laimex.pages.dev/"
ROUTINES_URL = "https://claude.ai/code/routines"
ROUTINE_NAME = "Laimex: выжимки лотерей"
ASK_CLAUDE = "напишите Claude в проекте Laimex5 на claude.ai"


def _days_since(iso: str | None, now: date) -> int | None:
    if not iso:
        return None
    return (now - datetime.fromisoformat(iso).date()).days


def _ru_date(iso: str | None) -> str:
    return datetime.fromisoformat(iso).strftime("%d.%m.%Y") if iso else "—"


def _lotteries(permits, names) -> str:
    return "\n".join(f"- [{p} {names.get(p, '')}".rstrip() + f"]({SITE_URL}?l={p})" for p in permits)


def _problem(key: str, title: str, why: str, do: str) -> dict:
    """key — постоянный код проблемы (по нему видно, что появилась новая), title — заголовок,
    why — что случилось и чем это грозит, do — что сделать владельцу: действие, где, ссылка."""
    return {"key": key, "title": title, "why": why, "do": do}


def check(now: date | None = None, failed_run: str | None = None, repo: str = REPO) -> dict:
    now = now or today()
    reg = load(REGISTRY_JSON, {})
    todo = load(TODO_JSON, {})
    extracted = [load(SUMMARIES / os.path.basename(f), {}).get("_extracted")
                 for f in glob.glob(str(SUMMARIES / "*.json"))]
    last_summary = max((e for e in extracted if e), default=None)
    waiting = todo.get("waiting_since", {})
    need_summary = set(todo.get("need_summary", []))
    names = {r["permit"]: r["name"] for r in reg.get("lotteries", [])}
    upload = f"https://github.com/{repo}/upload/main/data/inbox"

    problems = []
    if failed_run:
        problems.append(_problem(
            "robot_failed", "Робот упал при последнем запуске",
            "Сайт в этот раз не обновился. Если сбой разовый (например, сайт лотереи не ответил), "
            "следующий запуск всё исправит, и это issue закроется само.",
            f"Если сообщение висит больше суток, откройте журнал запуска {failed_run}, скопируйте "
            f"ссылку на него и {ASK_CLAUDE}: «робот упал, вот журнал». Больше ничего не нужно."))
    bad_uploads = [f.name for f in inbox_files()]
    if bad_uploads:
        problems.append(_problem(
            "inbox_bad", "Загруженный файл реестра не удалось прочитать",
            "В папке data/inbox лежит " + ", ".join(bad_uploads) + ", но это не реестр VID "
            "или файл повреждён, поэтому список лотерей из него не обновился.",
            f"Удалите этот файл на GitHub (https://github.com/{repo}/tree/main/data/inbox, "
            "файл → значок корзины → «Commit changes») и загрузите заново именно файл "
            "«Izsniegtās preču un pakalpojumu loteriju atļaujas» со страницы "
            f"https://www.vid.gov.lv/lv/loterijas сюда: {upload}"))
    reg_age = _days_since(reg.get("fetched"), now)
    if reg_age is None or reg_age >= MAX_REGISTRY_DAYS:
        since = _ru_date(reg.get("fetched"))
        # неделя в ключе: если файл так и не загрузили, через неделю будет новый комментарий (письмо)
        week = (reg_age or 0) // MAX_REGISTRY_DAYS
        problems.append(_problem(
            f"registry_w{week}", f"Пора загрузить реестр VID: список лотерей от {since}",
            "Сайт VID пускает только мобильный интернет, поэтому робот не может скачать реестр "
            f"разрешений сам, и список обновляете вы раз в неделю. На {SITE_URL} показан список "
            f"от {since} ({reg_age if reg_age is not None else '?'} дн. назад): новые лотереи "
            "там не появятся, пока вы не загрузите свежий файл.",
            "Это займёт пару минут:\n"
            "1. На телефоне выключите Wi-Fi и через мобильный интернет откройте "
            "https://www.vid.gov.lv/lv/loterijas.\n"
            "2. Скачайте файл «Izsniegtās preču un pakalpojumu loteriju atļaujas».\n"
            f"3. Загрузите его сюда: {upload} и нажмите «Commit changes».\n\n"
            "Робот сам возьмёт файл, обновит сайт и закроет это issue. Следующее напоминание "
            f"придёт через {MAX_REGISTRY_DAYS} дн. Если сайт VID снова начнёт пускать робота, "
            "он будет скачивать реестр сам и напоминать перестанет."))
    quiet = _days_since(last_summary, now)
    if need_summary and quiet is not None and quiet > MAX_QUIET_DAYS:
        problems.append(_problem(
            "routine", f"Задача Claude «{ROUTINE_NAME}» не работает {quiet} дн.",
            f"В очереди {len(need_summary)} лотерей ждут разбора правил. Пока их не разобрали, "
            "на сайте у них нет призов и дат розыгрышей.",
            f"Откройте {ROUTINES_URL} и задачу «{ROUTINE_NAME}». Если она выключена, включите. "
            "Если последний запуск с ошибкой, запустите её вручную; повторится ошибка — скопируйте "
            f"ссылку на запуск и {ASK_CLAUDE}. Если запусков нет совсем, проверьте, что подписка "
            "Claude активна."))
    late_summary = sorted(p for p in need_summary
                          if (_days_since(waiting.get(p), now) or 0) > MAX_WAIT_DAYS)
    if late_summary:
        problems.append(_problem(
            "late_summary", f"Правила не разобраны больше {MAX_WAIT_DAYS} дн.: {len(late_summary)} лотер.",
            _lotteries(late_summary, names) + "\n\nЗадача Claude их не осилила: скорее всего, правила "
            "нечитаемые или неполные. На сайте у этих лотерей только данные реестра.",
            f"{ASK_CLAUDE.capitalize()}: «разбери правила лотерей {', '.join(late_summary)}». "
            "Можно ничего не делать: карточки останутся без призов и розыгрышей."))
    late_source = sorted(p for p, since in waiting.items() if p not in need_summary
                         and (_days_since(since, now) or 0) > MAX_NOSOURCE_DAYS)
    if late_source:
        problems.append(_problem(
            "late_source", f"Правила не найдены больше {MAX_NOSOURCE_DAYS} дн.: {len(late_source)} лотер.",
            _lotteries(late_source, names) + "\n\nЛотереи уже идут, но ни робот, ни Claude не нашли "
            "их правила. На сайте у них только данные реестра.",
            f"Если знаете страницу или правила такой лотереи (например, видели в магазине), {ASK_CLAUDE} "
            "и пришлите ссылку. Иначе делать ничего не нужно."))

    blocked = [r for r in todo.get("broken", []) if "robots" in r["error"] or "Google" in r["error"]
               or "не отдал" in r["error"]]
    if blocked:
        problems.append(_problem(
            "rules_blocked", f"Правила нельзя скачать роботом: {len(blocked)} лотер.",
            _lotteries([r["permit"] for r in blocked], names) + "\n\nСайты этих лотерей не дают "
            "роботу скачать правила (robots.txt, Google Диск или сайт не пускает GitHub), поэтому "
            "на сайте у них нет призов и дат розыгрышей.",
            "Для каждой лотереи откройте ссылку на правила в браузере, скачайте файл (PDF) и "
            "загрузите его на GitHub по второй ссылке, затем нажмите «Commit changes»:\n" +
            "\n".join(f"- {r['permit']}: правила {r['rules']} → "
                      f"https://github.com/{repo}/upload/main/data/manual_rules/{r['permit']}"
                      for r in blocked) +
            "\n\nРобот сам прочитает файл, а задача Claude сделает выжимку на следующее утро."))

    health = {"checked": now_iso(), "ok": not problems, "problems": problems,
              "registry_fetched": reg.get("fetched"), "last_summary": last_summary,
              "queue_summaries": len(need_summary), "queue_sources": len(todo.get("need_sources", []))}
    save(HEALTH_JSON, health)
    return health


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def issue_body(health: dict, run_url: str | None = None) -> str:
    probs = health["problems"]
    n = len(probs)
    parts = [f"Робот Laimex просит вас посмотреть {n} {'пункт' if n == 1 else 'пункта' if n < 5 else 'пунктов'}. "
             "В каждом написано, что случилось и что сделать.", ""]
    for i, p in enumerate(probs, 1):
        parts += [f"### {i}. {p['title']}", "", p["why"], "", f"**Что сделать:** {p['do']}", ""]
    checked = datetime.fromisoformat(health["checked"]).strftime("%d.%m.%Y в %H:%M")
    foot = f"Проверено {checked} по Риге. Сайт: {SITE_URL}"
    if run_url:
        foot += f" · журнал запуска: {run_url}"
    parts += ["---", foot + ".",
              "Когда всё наладится, робот сам закроет это issue и напишет здесь, что делать больше ничего не нужно."]
    # невидимые метки: по ним следующий запуск поймёт, какие проблемы уже были
    parts.append("".join(f"<!-- laimex:{p['key']} -->" for p in probs))
    return "\n".join(parts)


def sync_issue(health: dict, repo: str, run_url: str | None = None) -> str:
    """Открыть, обновить или закрыть issue в зависимости от состояния.
    GitHub присылает письмо, когда issue открывается и когда в нём появляется комментарий,
    но не когда меняется текст. Поэтому о новой проблеме робот пишет комментарий."""
    issues = json.loads(_gh("api", f"repos/{repo}/issues?state=open&per_page=50") or "[]")
    mine = next((i for i in issues if i["title"] in OLD_TITLES and "pull_request" not in i), None)
    if health["ok"]:
        if mine:
            _gh("api", "-X", "POST", f"repos/{repo}/issues/{mine['number']}/comments",
                "-f", "body=Всё снова в порядке, от вас ничего не нужно. Закрываю.")
            _gh("api", "-X", "PATCH", f"repos/{repo}/issues/{mine['number']}", "-f", "state=closed")
            return "закрыто"
        return "не нужно"
    body = issue_body(health, run_url)
    if not mine:
        _gh("api", "-X", "POST", f"repos/{repo}/issues", "-f", f"title={ISSUE_TITLE}", "-f", f"body={body}")
        return "открыто"
    old_body = mine.get("body") or ""
    if old_body != body or mine["title"] != ISSUE_TITLE:
        _gh("api", "-X", "PATCH", f"repos/{repo}/issues/{mine['number']}",
            "-f", f"title={ISSUE_TITLE}", "-f", f"body={body}")
    known = set(re.findall(r"laimex:([a-z0-9_]+)", old_body))
    fresh = [p for p in health["problems"] if p["key"] not in known]
    if fresh:
        _gh("api", "-X", "POST", f"repos/{repo}/issues/{mine['number']}/comments", "-f",
            "body=Новое в этом issue: " + "; ".join(p["title"] for p in fresh) +
            ". Что сделать, написано в описании выше.")
    return "обновлено"
