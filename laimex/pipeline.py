"""Главный конвейер: реестр → источники → правила → задания на выжимку → сайт."""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

from . import discover, http, registry, rules, validate
from .config import (ROOT, DATA, KEEP_FINISHED_DAYS, PENDING, RULES_TEXT, SITE, SUMMARIES, TZ, WEB,
                     WORK, ensure_dirs, today)
from .schema import validate_shape

REGISTRY_JSON = DATA / "registry.json"
SOURCES_JSON = DATA / "sources.json"
TODO_JSON = DATA / "todo.json"


# ------------------------------------------------------------------ файлы

def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


# --------------------------------------------------------------- шаг 1: реестр

def step_registry(log=print) -> list[dict]:
    url, rows = registry.fetch()
    rel = registry.relevant(rows, today(), KEEP_FINISHED_DAYS)
    save(REGISTRY_JSON, {"source": url, "fetched": now_iso(), "total_in_file": len(rows),
                         "lotteries": rel})
    log(f"Реестр: {len(rows)} записей в файле, актуальных без журнальных: {len(rel)}")
    return rel


# ------------------------------------------------------ шаг 2: ссылки и правила

def step_sources(rows: list[dict], log=print, only: set[str] | None = None) -> dict:
    sources = load(SOURCES_JSON, {})
    wanted = {r["permit"] for r in rows}
    if only is None:
        for permit, info in discover.crawl_agencies(log).items():
            if permit in wanted:
                cur = sources.setdefault(permit, {})
                for k, v in info.items():
                    if v and not cur.get(k):
                        cur[k] = v
    for permit in sorted(wanted if only is None else only & wanted):
        src = sources.get(permit)
        if not src:
            continue
        if src.get("page") and not src.get("rules"):
            try:
                html = http.get(src["page"]).text
                link = discover.find_rules_link(html, src["page"])
                if link:
                    src["rules"] = link
                    log(f"  {permit}: правила найдены на странице кампании")
                elif rules.looks_like_rules(rules.html_to_text(html)) and "izloz" in html.lower():
                    src["rules"] = src["page"]  # правила встроены в саму страницу
                    log(f"  {permit}: правила встроены в страницу кампании")
            except Exception as e:  # noqa: BLE001
                log(f"  ! {permit}: страница недоступна: {e}")
        if src.get("rules_local"):
            # правила, которые робот скачать не может (например, Google Диск) — их текст
            # положен в репозиторий вручную, ссылка rules остаётся для кнопки «Правила» на сайте
            text = (ROOT / src["rules_local"]).read_text(encoding="utf-8")
            src.pop("error", None)
            src.update(rules_type="local", rules_sha=hashlib.sha256(text.encode()).hexdigest()[:16],
                       rules_checked=now_iso())
            (RULES_TEXT / f"{permit}.txt").write_text(text, encoding="utf-8")
        elif src.get("rules"):
            try:
                got = rules.fetch_rules(src["rules"])
            except http.Blocked:
                src["error"] = "robots.txt запрещает скачивать правила"
                continue
            except Exception as e:  # noqa: BLE001
                src["error"] = f"не удалось скачать правила: {e}"
                log(f"  ! {permit}: {src['error']}")
                continue
            src.pop("error", None)
            if not got["ok"]:
                src["error"] = ("правила на Google Диске: роботам скачивать оттуда запрещено"
                                if "drive.google.com" in src["rules"] else
                                "текст правил не распознан (скан или не та страница)")
            src.update(rules_type=got["type"], rules_sha=got["sha"], rules_checked=now_iso())
            (RULES_TEXT / f"{permit}.txt").write_text(got["text"], encoding="utf-8")
    save(SOURCES_JSON, sources)
    return sources


# --------------------------------------------------- шаг 3: задания на выжимку

def summary_path(permit: str) -> Path:
    return SUMMARIES / f"{permit}.json"


def step_todo(rows: list[dict], sources: dict, log=print) -> dict:
    shutil.rmtree(PENDING, ignore_errors=True)
    PENDING.mkdir(parents=True, exist_ok=True)
    need_summary, need_sources, broken = [], [], []
    for row in rows:
        p = row["permit"]
        if row["end"] < today().isoformat():
            continue  # закончившиеся не дорабатываем
        src = sources.get(p, {})
        text_file = RULES_TEXT / f"{p}.txt"
        if not src.get("rules") or not text_file.exists():
            need_sources.append(row)
            continue
        if src.get("error"):
            broken.append({**row, "error": src["error"], "rules": src.get("rules")})
        summ = load(summary_path(p), None)
        if summ and summ.get("_rules_sha") is None and src.get("rules_sha"):
            # выжимка сделана вручную до первого запуска робота — принимаем её
            summ["_rules_sha"] = src["rules_sha"]
            save(summary_path(p), summ)
        if summ and summ.get("_rules_sha") == src.get("rules_sha"):
            continue
        need_summary.append(p)
        (PENDING / f"{p}.md").write_text(
            f"# Разрешение {p}\n\nЗапись реестра VID:\n```json\n"
            f"{json.dumps(row, ensure_ascii=False, indent=1)}\n```\n\n"
            f"Источник правил: {src['rules']}\n\n## Текст правил\n\n"
            f"{text_file.read_text(encoding='utf-8')}\n",
            encoding="utf-8",
        )
    # с какого дня лотерея ждёт выжимку или правила — для контроля здоровья
    prev = load(TODO_JSON, {}).get("waiting_since", {})
    waiting = set(need_summary) | {r["permit"] for r in need_sources if r["start"] <= today().isoformat()}
    waiting_since = {p: prev.get(p, today().isoformat()) for p in sorted(waiting)}
    todo = {"generated": now_iso(), "need_summary": need_summary,
            "need_sources": need_sources, "broken": broken, "waiting_since": waiting_since}
    save(TODO_JSON, todo)
    log(f"Нужна выжимка: {len(need_summary)}; не найдены правила: {len(need_sources)}; "
        f"проблемы с правилами: {len(broken)}")
    return todo


# ---------------------------------------------------- сохранение выжимки

def save_summary(permit: str, summary: dict) -> list[dict]:
    errors = validate_shape(summary)
    if errors:
        raise ValueError("Выжимка не по шаблону: " + "; ".join(errors))
    sources = load(SOURCES_JSON, {})
    rows = {r["permit"]: r for r in load(REGISTRY_JSON, {"lotteries": []})["lotteries"]}
    if permit not in rows:
        raise ValueError(f"Разрешения {permit} нет среди актуальных в реестре")
    summary = dict(summary, _rules_sha=sources.get(permit, {}).get("rules_sha"),
                   _extracted=now_iso())
    save(summary_path(permit), summary)
    return validate.check(summary, rows[permit])


def add_source(permit: str, page: str | None, rules_url: str | None,
               registration: str | None, found_by: str = "manual", fetch: bool = True) -> dict:
    sources = load(SOURCES_JSON, {})
    cur = sources.setdefault(permit, {})
    for k, v in (("page", page), ("rules", rules_url), ("registration", registration)):
        if v:
            cur[k] = v
    cur["found_by"] = found_by
    save(SOURCES_JSON, sources)
    if not fetch:  # правила скачает ближайший запуск GitHub Actions
        return sources
    rows = load(REGISTRY_JSON, {"lotteries": []})["lotteries"]
    return step_sources(rows, only={permit})


# ------------------------------------------------------------- шаг 4: сайт

def build_site(log=print) -> Path:
    reg = load(REGISTRY_JSON, {"lotteries": [], "fetched": None, "source": None})
    sources = load(SOURCES_JSON, {})
    items = []
    for row in reg["lotteries"]:
        p = row["permit"]
        src = sources.get(p, {})
        summ = load(summary_path(p), None)
        checks = validate.check(summ, row) if summ else []
        if summ:
            st = validate.status(checks)
            if st == "ok" and (not summ.get("prizes") or not summ.get("draws")
                               or summ.get("prize_fund_eur") is None):
                st = "partial"  # полные правила прочитать не удалось
        else:
            st = "no_summary"
        clean_summ = {k: v for k, v in (summ or {}).items() if not k.startswith("_")} or None
        items.append({
            **row,
            "links": {k: src.get(k) for k in ("page", "rules", "registration")},
            "summary": clean_summ,
            "checks": checks,
            "status": st,
        })
    items.sort(key=lambda x: (x["end"], x["permit"]))
    SITE.mkdir(parents=True, exist_ok=True)
    for f in WEB.rglob("*"):
        if f.is_file():
            dest = SITE / f.relative_to(WEB)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
    data = {"updated": now_iso(), "registry_source": reg.get("source"),
            "registry_fetched": reg.get("fetched"), "lotteries": items}
    save(SITE / "data.json", data)
    # версия для кэша приложения: меняется при каждой сборке
    sw = SITE / "sw.js"
    if sw.exists():
        sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD__", now_iso()),
                      encoding="utf-8")
    (SITE / ".nojekyll").write_text("", encoding="utf-8")
    n_ok = sum(i["status"] == "ok" for i in items)
    log(f"Сайт собран: {len(items)} лотерей, полностью проверено: {n_ok}")
    return SITE


def daily(mode: str, log=print):
    ensure_dirs()
    rows = step_registry(log)
    sources = step_sources(rows, log)
    todo = step_todo(rows, sources, log)
    if mode == "api":
        from .extract_api import extract
        for p in todo["need_summary"]:
            row = next(r for r in rows if r["permit"] == p)
            text = (RULES_TEXT / f"{p}.txt").read_text(encoding="utf-8")
            try:
                checks = save_summary(p, extract(text, row))
                log(f"  {p}: выжимка готова, проверки: "
                    f"{sum(c['ok'] for c in checks)}/{len(checks)}")
            except Exception as e:  # noqa: BLE001
                log(f"  ! {p}: {e}")
    build_site(log)
    return todo
