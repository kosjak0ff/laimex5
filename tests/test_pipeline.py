"""Сквозной тест ежедневного цикла без интернета: все страницы подменены копиями."""
import io
import json
from datetime import date

import pytest
from PIL import Image

from laimex import http, images, pipeline, registry
from test_core import ROWS, make_xls


def png(w, h):
    out = io.BytesIO()
    Image.new("RGBA", (w, h), (200, 30, 40, 255)).save(out, "PNG")
    return out.getvalue()


RULES_HTML = """<html><body><main><h1>Noteikumi</h1>
<p>Preču loterijas “Haribo loterija” noteikumi. 1. Loterijas organizētājs: SIA “Visas Loterijas”.</p>
<p>4.1. Loterijas norises sākuma datums: 2026. gada 15.oktobris. Beigu datums: 2026. gada 16. novembris.</p>
<table><tr><td>Balva</td><td>Skaits</td></tr><tr><td>Apple MacBook Neo</td><td>1</td></tr></table>
<p>""" + "Loterijas balvu izloze notiek ... " * 40 + """</p></main></body></html>"""

PAGES = {
    "https://www.vid.gov.lv/lv/loterijas":
        '<a href="/lv/media/1/download">Izsniegtās preču un pakalpojumu loteriju atļaujas</a>',
    "https://www.loterijas.lv/": '<a href="/loterija/haribo-loterija-2/">Haribo</a>',
    "https://www.loterijas.lv/loterija/haribo-loterija-2/":
        '<div class="lottery-cover"><img class="cover" src="/wp-content/uploads/haribo-1200x420.png"></div>'
        '<h1>Haribo loterija</h1><p>Atļaujas Nr. <strong>9158</strong></p>'
        '<a class="get-terms" href="/loterija/haribo-loterija-2/noteikumi/">noteikumi</a>'
        '<form class="lottery-registration"></form>',
    "https://www.loterijas.lv/loterija/haribo-loterija-2/noteikumi/": RULES_HTML,
    "https://www.loterijatev.lv/": "<div>нет активных</div>",
    "https://www.loterijas.lv/wp-content/uploads/haribo-1200x420.png": png(1200, 420),
}


class FakeResp:
    def __init__(self, url, body):
        self.url, self.status_code = url, 200
        self.content = body if isinstance(body, bytes) else body.encode()
        self.text = body if isinstance(body, str) else ""
        self.headers = {"content-type": "application/vnd.ms-excel" if isinstance(body, bytes) else "text/html"}


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    xls = make_xls(ROWS)
    def fake_get(url, **kw):
        if url.endswith("/media/1/download"):
            return FakeResp(url, xls)
        if url not in PAGES:
            raise RuntimeError(f"нет копии для {url}")
        return FakeResp(url, PAGES[url])
    monkeypatch.setattr(http, "get", fake_get)
    for name, sub in [("REGISTRY_JSON", "data/registry.json"), ("SOURCES_JSON", "data/sources.json"),
                      ("TODO_JSON", "data/todo.json"), ("RULES_TEXT", "data/rules_text"),
                      ("PENDING", "data/pending"), ("SUMMARIES", "data/summaries"), ("SITE", "docs"),
                      ("RESULTS_JSON", "data/results.json"), ("INBOX", "data/inbox")]:
        monkeypatch.setattr(pipeline, name, tmp_path / sub)
    monkeypatch.setattr(pipeline, "IMAGES", tmp_path / "data/images")
    monkeypatch.setattr(images, "IMAGES", tmp_path / "data/images")
    (tmp_path / "data/rules_text").mkdir(parents=True)
    (tmp_path / "data/summaries").mkdir(parents=True)
    monkeypatch.setattr(pipeline, "today", lambda: date(2026, 10, 19))
    # время записи реестра тоже подменяем, иначе тест зависит от сегодняшней даты
    monkeypatch.setattr(pipeline, "now_iso", lambda: "2026-10-19T12:00:00+03:00")
    return tmp_path


def test_daily_cycle(sandbox):
    todo = pipeline.daily("agent", log=lambda *a: None)
    # Haribo найден у агентства, правила скачаны, создано задание на выжимку
    assert todo["need_summary"] == ["9158"]
    assert (sandbox / "data/pending/9158.md").read_text().count("Apple MacBook Neo") >= 1
    # BALTA (услуга) без источника — в списке на поиск; журнал отброшен
    assert [r["permit"] for r in todo["need_sources"]] == ["9089"]

    from laimex.schema import SUMMARY_SCHEMA
    summary = {k: None for k in SUMMARY_SCHEMA["required"]}
    summary.update(title="Haribo loterija", organizer="SIA «Visas Loterijas»", what_to_buy="2 Haribo",
                   where="Латвия", how_to_enter="loterijas.lv", lottery_start="2026-10-15",
                   lottery_end="2026-11-16",
                   draws=[{"date": "2026-11-16", "time": "11:00", "period_from": None, "period_to": None,
                           "prizes": [{"name": "MacBook", "qty": 1}]}], prizes=[{"name": "MacBook", "qty": 1,
                   "unit_value_eur": 699, "total_value_eur": 699}], prize_fund_eur=699)
    checks = pipeline.save_summary("9158", summary)
    assert all(c["ok"] for c in checks)

    # второй запуск: правила не менялись — повторная выжимка не нужна
    todo2 = pipeline.daily("agent", log=lambda *a: None)
    assert todo2["need_summary"] == []

    site = json.loads((sandbox / "docs/data.json").read_text())
    by = {x["permit"]: x for x in site["lotteries"]}
    assert by["9158"]["status"] == "ok"
    assert by["9158"]["links"]["registration"].endswith("/haribo-loterija-2/")
    assert by["9089"]["status"] == "no_summary" and by["9089"]["category"] == "service"
    # выжимка без розыгрышей — «неполные данные», а не «сверено»
    pipeline.save_summary("9158", dict(summary, draws=[]))
    pipeline.build_site(log=lambda *a: None)
    site = json.loads((sandbox / "docs/data.json").read_text())
    assert {x["permit"]: x for x in site["lotteries"]}["9158"]["status"] == "partial"
    assert "9191" not in by  # журнальная лотерея скрыта
    assert (sandbox / "docs/index.html").exists() and (sandbox / "docs/sw.js").exists()
    assert "__BUILD__" not in (sandbox / "docs/sw.js").read_text()
    # баннер с loterijas.lv уменьшен и лежит рядом с сайтом; у BALTA баннера нет
    assert by["9158"]["banner"] == "img/9158.jpg" and by["9089"]["banner"] is None
    assert Image.open(sandbox / "docs/img/9158.jpg").size == (720, 252)

    # правила изменились — выжимку нужно сделать заново
    PAGES["https://www.loterijas.lv/loterija/haribo-loterija-2/noteikumi/"] = RULES_HTML.replace("1</td>", "2</td>")
    todo3 = pipeline.daily("agent", log=lambda *a: None)
    assert todo3["need_summary"] == ["9158"]


def test_health(sandbox, monkeypatch):
    from laimex import health
    monkeypatch.setattr(health, "SUMMARIES", sandbox / "data/summaries")
    monkeypatch.setattr(health, "REGISTRY_JSON", sandbox / "data/registry.json")
    monkeypatch.setattr(health, "TODO_JSON", sandbox / "data/todo.json")
    monkeypatch.setattr(health, "HEALTH_JSON", sandbox / "data/health.json")
    pipeline.daily("agent", log=lambda *a: None)
    # сразу после запуска: реестр свежий, выжимка ждёт 0 дней — всё в порядке
    assert health.check(date(2026, 10, 19))["ok"]
    # через 4 дня та же лотерея всё ещё ждёт выжимку — тревога
    res = health.check(date(2026, 10, 23))
    assert not res["ok"]
    keys = {p["key"]: p for p in res["problems"]}
    assert "9158" in keys["late_summary"]["why"] and "?l=9158" in keys["late_summary"]["why"]
    assert "data/inbox" in keys["registry"]["do"]  # говорит, что сделать и куда загрузить файл
    assert "failed" not in keys and "robot_failed" not in keys
    res = health.check(date(2026, 10, 19), failed_run="https://example/run/1")
    assert res["problems"][0]["key"] == "robot_failed" and "https://example/run/1" in res["problems"][0]["do"]


def test_health_issue_sync(sandbox, monkeypatch):
    from laimex import health
    for name, sub in [("SUMMARIES", "data/summaries"), ("REGISTRY_JSON", "data/registry.json"),
                      ("TODO_JSON", "data/todo.json"), ("HEALTH_JSON", "data/health.json")]:
        monkeypatch.setattr(health, name, sandbox / sub)
    pipeline.daily("agent", log=lambda *a: None)
    issues, calls = [], []

    def fake_gh(*args):
        calls.append(args)
        if args[:2] == ("api", "repos/o/r/issues?state=open&per_page=50"):
            return json.dumps(issues)
        return ""
    monkeypatch.setattr(health, "_gh", fake_gh)

    res = health.check(date(2026, 10, 23), repo="o/r")
    assert health.sync_issue(res, "o/r") == "открыто"
    body = next(a for a in calls[-1] if a.startswith("body="))[5:]
    assert "Что сделать:" in body and "https://github.com/o/r/upload/main/data/inbox" in body
    assert "laimex.pages.dev" in body

    # старое issue с прежним названием: переименовываем, переписываем и пишем комментарий (письмо)
    issues.append({"number": 6, "title": "Laimex: нужна проверка", "body": "Робот Laimex заметил проблему"})
    calls.clear()
    assert health.sync_issue(res, "o/r") == "обновлено"
    assert any("title=Laimex: что нужно сделать" in a for c in calls for a in c)
    assert any(a.endswith("/comments") for c in calls for a in c)

    # тот же набор проблем на следующий день: текст обновляется молча, без комментария
    issues[0] = {"number": 6, "title": health.ISSUE_TITLE, "body": health.issue_body(res)}
    calls.clear()
    health.sync_issue(health.check(date(2026, 10, 24), repo="o/r"), "o/r")
    assert not any(a.endswith("/comments") for c in calls for a in c)

    # всё наладилось — закрываем с объяснением
    assert health.sync_issue({"ok": True, "problems": []}, "o/r") == "закрыто"


def test_registry_from_uploaded_file(sandbox, monkeypatch):
    from test_core import ROWS, make_xls
    pipeline.daily("agent", log=lambda *a: None)
    inbox = sandbox / "data/inbox"
    inbox.mkdir()
    (inbox / "README.md").write_text("инструкция")
    (inbox / "atlaujas.xls").write_bytes(make_xls(ROWS[:1]))

    def down(**kw):
        raise AssertionError("к VID ходить не нужно, файл уже загружен")
    monkeypatch.setattr(registry, "fetch", down)
    monkeypatch.setattr(pipeline, "now_iso", lambda: "2026-10-22T12:00:00+03:00")
    monkeypatch.setattr(pipeline, "today", lambda: date(2026, 10, 22))
    rows = pipeline.step_registry(log=lambda *a: None)
    assert [r["permit"] for r in rows] == ["9158"]
    saved = json.loads((sandbox / "data/registry.json").read_text(encoding="utf-8"))
    assert saved["fetched"] == "2026-10-22T12:00:00+03:00" and saved["manual"] == "atlaujas.xls"
    assert saved["source"] == "https://www.vid.gov.lv/lv/media/1/download"
    assert [f.name for f in inbox.iterdir()] == ["README.md"]  # файл убран, инструкция осталась

    # не реестр — файл остаётся, проверка здоровья скажет, что его не удалось прочитать
    (inbox / "foto.jpg").write_bytes(b"not xls")
    monkeypatch.setattr(pipeline, "today", lambda: date(2026, 10, 23))
    monkeypatch.setattr(registry, "fetch", lambda **kw: ("https://www.vid.gov.lv/lv/media/1/download", None))
    pipeline.step_registry(log=lambda *a: None)
    assert (inbox / "foto.jpg").exists()
    from laimex import health
    monkeypatch.setattr(health, "REGISTRY_JSON", sandbox / "data/registry.json")
    monkeypatch.setattr(health, "TODO_JSON", sandbox / "data/todo.json")
    monkeypatch.setattr(health, "HEALTH_JSON", sandbox / "data/health.json")
    assert any(p["key"] == "inbox_bad" and "foto.jpg" in p["why"]
               for p in health.check(date(2026, 10, 23))["problems"])


def test_sources_searched_only_for_running(sandbox):
    rows = [
        {"permit": "1", "name": "Идёт", "start": "2026-10-01", "end": "2026-11-01"},
        {"permit": "2", "name": "Будущая", "start": "2026-10-25", "end": "2026-12-01"},
        {"permit": "3", "name": "Без даты начала", "start": None, "end": "2026-12-01"},
    ]
    todo = pipeline.step_todo(rows, {}, log=lambda *a: None)
    assert [r["permit"] for r in todo["need_sources"]] == ["1"]
    assert set(todo["waiting_since"]) == {"1"}


def test_results_reason():
    now = "2026-10-19"
    row = {"permit": "1", "start": "2026-09-01", "end": "2026-11-30"}
    summ = {"draws": [{"date": "2026-10-01"}, {"date": "2026-10-15"}, {"date": "2026-11-30"}]}
    assert "розыгрышей: 2, последний 2026-10-15" in pipeline.results_reason(row, summ, None, now)
    # страница с победителями уже найдена — искать нечего
    assert pipeline.results_reason(row, summ, {"winners_url": "https://x"}, now) is None
    # недавно искали — не повторяем
    assert pipeline.results_reason(row, summ, {"checked": "2026-10-17"}, now) is None
    assert pipeline.results_reason(row, summ, {"checked": "2026-10-15"}, now)
    # будущая лотерея и лотерея без прошедших розыгрышей — не ищем
    assert pipeline.results_reason(dict(row, start="2026-10-25"), summ, None, now) is None
    assert pipeline.results_reason(row, {"draws": [{"date": "2026-11-30"}]}, None, now) is None
    # в выжимке нет дат розыгрышей — ищем даты
    assert "нет дат" in pipeline.results_reason(row, {"draws": []}, None, now)
    # закончилась, выжимки нет — ищем победителей
    assert "закончилась" in pipeline.results_reason(dict(row, end="2026-10-10"), None, None, now)


def test_results_order(sandbox):
    rows = [
        {"permit": "1", "name": "Давно закончилась", "start": "2026-08-01", "end": "2026-09-25"},
        {"permit": "2", "name": "Недавно закончилась", "start": "2026-08-01", "end": "2026-10-10"},
        {"permit": "3", "name": "Идёт", "start": "2026-10-01", "end": "2026-11-30"},
    ]
    (sandbox / "data/summaries/3.json").write_text('{"draws": [{"date": "2026-10-05"}]}', encoding="utf-8")
    todo = pipeline.step_todo(rows, {}, log=lambda *a: None)
    assert [r["permit"] for r in todo["need_results"]] == ["3", "2", "1"]


def test_add_result_and_site(sandbox):
    pipeline.daily("agent", log=lambda *a: None)
    pipeline.add_result("9158", None, "Победители пока не опубликованы")
    res = pipeline.add_result("9158", "https://example.lv/laimetaji", "Победители первого розыгрыша опубликованы")
    assert res == {"winners_url": "https://example.lv/laimetaji",
                   "note": "Победители первого розыгрыша опубликованы", "checked": "2026-10-19"}
    pipeline.build_site(log=lambda *a: None)
    data = json.loads((sandbox / "docs/data.json").read_text(encoding="utf-8"))
    item = next(i for i in data["lotteries"] if i["permit"] == "9158")
    assert item["results"]["winners_url"] == "https://example.lv/laimetaji"


def test_registry_unreachable_uses_cache(sandbox, monkeypatch):
    pipeline.daily("agent", log=lambda *a: None)
    before = (sandbox / "data/registry.json").read_text()

    def down(**kw):
        raise http.requests.ConnectTimeout("www.vid.gov.lv timed out")
    monkeypatch.setattr(registry, "fetch", down)
    monkeypatch.setattr(pipeline, "now_iso", lambda: "2026-10-20T12:00:00+03:00")
    monkeypatch.setattr(pipeline, "today", lambda: date(2026, 10, 20))
    todo = pipeline.daily("agent", log=lambda *a: None)
    assert todo["need_summary"] == ["9158"]
    # дата fetched старая, проверка здоровья это увидит
    after = json.loads((sandbox / "data/registry.json").read_text())
    assert after["fetched"] == json.loads(before)["fetched"]


def test_registry_file_downloaded_only_when_link_changes(sandbox, monkeypatch):
    calls = []
    real_get = http.get

    def counting_get(url, **kw):
        if "vid.gov.lv" in url:
            calls.append((url, kw.get("retries")))
        return real_get(url, **kw)
    monkeypatch.setattr(http, "get", counting_get)
    pipeline.step_registry(log=lambda *a: None)
    assert [u for u, _ in calls] == ["https://www.vid.gov.lv/lv/loterijas",
                                     "https://www.vid.gov.lv/lv/media/1/download"]
    assert all(r == 0 for _, r in calls)  # к VID без повторов
    calls.clear()
    # в тот же день повторный запуск к VID не ходит вовсе
    pipeline.step_registry(log=lambda *a: None)
    assert calls == []
    monkeypatch.setattr(pipeline, "now_iso", lambda: "2026-10-20T12:00:00+03:00")
    monkeypatch.setattr(pipeline, "today", lambda: date(2026, 10, 20))
    rows = pipeline.step_registry(log=lambda *a: None)
    # ссылка та же — файл не скачиваем, но отмечаем, что реестр проверен
    assert [u for u, _ in calls] == ["https://www.vid.gov.lv/lv/loterijas"]
    assert {r["permit"] for r in rows} == {"9158", "9089"}
    saved = json.loads((sandbox / "data/registry.json").read_text(encoding="utf-8"))
    assert saved["fetched"] == "2026-10-20T12:00:00+03:00"
