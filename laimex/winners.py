"""Подсказки для поиска победителей.

Задача Claude не может открыть через WebFetch ссылки из data/sources.json: WebFetch открывает
только адреса из результатов поиска в той же сессии. Поэтому известные страницы лотерей из списка
«Нужны сведения о розыгрышах» открывает робот и пишет в data/pending/results.md, где на них
упоминаются победители и какие там есть ссылки на списки. Имена победителей в файл не попадают:
только ссылки, число упоминаний и даты рядом.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from . import http

WINNERS_HINT = re.compile(r"laimētāj|laimetaj|uzvarētāj|uzvaretaj|winners|победител", re.I)
DATE_RE = re.compile(r"\b([0-3]?\d)\.\s?(0[1-9]|1[0-2])\.")
PUBLISH_DAYS = 60    # даты позже конца лотереи на столько дней — ещё публикация победителей
MAX_LINKS = 3        # сколько ссылок на победителей открывать с одной страницы


def _in_span(day: int, month: int, span: tuple[date, date] | None) -> bool:
    if not span:
        return True
    for year in {span[0].year, span[1].year}:
        try:
            if span[0] <= date(year, month, day) <= span[1]:
                return True
        except ValueError:
            pass
    return False


def page_hints(html: str, url: str, span: tuple[date, date] | None = None) -> dict:
    """Что на странице говорит о победителях: ссылки на списки, число упоминаний и даты рядом
    (только те, что попадают в срок лотереи span)."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        label = a.get_text(" ", strip=True)
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        if WINNERS_HINT.search(label) or WINNERS_HINT.search(href):
            full = urljoin(url, href)
            if full not in (u for u, _ in links):
                links.append((full, label[:60]))
    text = re.sub(r"\s+", " ", soup.get_text(" "))
    dates = set()
    for m in WINNERS_HINT.finditer(text):
        for d in DATE_RE.finditer(text[m.start():m.start() + 300]):
            day, month = int(d.group(1)), int(d.group(2))
            if _in_span(day, month, span):
                dates.add((month, day))
    return {"links": links, "mentions": len(WINNERS_HINT.findall(text)),
            "dates": [f"{d:02d}.{m:02d}" for m, d in sorted(dates)]}


def _describe(h: dict) -> str:
    if not h["mentions"]:
        return "про победителей ничего"
    out = f"слово «laimētāji/uzvarētāji» встречается {h['mentions']} раз"
    if h["dates"]:
        out += "; даты рядом: " + ", ".join(h["dates"])
    return out


def _is_pdf(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".pdf")


def lottery_hints(src: dict, span: tuple[date, date] | None = None, log=print) -> list[str]:
    """Строки отчёта по одной лотерее: страница лотереи и ссылки на победителей с неё.
    Правила не открываем: слово «laimētāji» там есть всегда, а победителей там не публикуют."""
    lines = []
    if src.get("rules") and src.get("rules") != src.get("page"):
        lines.append(f"- правила: {src['rules']}")
    url = src.get("page")
    if not url:
        return lines + ["- страницы лотереи нет: ищите через WebSearch"]
    try:
        r = http.get(url, retries=1)
    except http.Blocked:
        return lines + [f"- страница: {url} — robots.txt запрещает открывать"]
    except Exception as e:  # noqa: BLE001
        return lines + [f"- страница: {url} — не открылась ({type(e).__name__})"]
    h = page_hints(r.text, r.url, span)
    lines.append(f"- страница: {url} — {_describe(h)}")
    opened = 0
    for link, label in h["links"]:
        note = ""
        if link.split("#")[0] in (r.url.split("#")[0], url.split("#")[0]):
            note = "якорь на этой же странице"
        elif _is_pdf(link):
            note = "PDF, не открывал"
        elif opened < MAX_LINKS:
            opened += 1
            try:
                note = _describe(page_hints(http.get(link, retries=1).text, link, span))
            except Exception as e:  # noqa: BLE001
                note = f"не открылась ({type(e).__name__})"
        lines.append(f"  - ссылка «{label or '—'}»: {link}" + (f" — {note}" if note else ""))
    return lines


def write_hints(need_results: list[dict], sources: dict, path, log=print) -> None:
    parts = ["# Подсказки для поиска победителей", "",
             "Робот сам открыл известные страницы лотерей из списка «Нужны сведения о розыгрышах». "
             "Ссылки отсюда WebFetch не откроет: записывайте их командой add-result, "
             "если подсказка однозначна (ссылка «Laimētāji» или упоминания с датами розыгрышей).", ""]
    for row in need_results:
        p = row["permit"]
        parts += [f"## {p} | {row['name']}", f"Причина: {row['reason']}"]
        span = None
        if row.get("start") and row.get("end"):
            span = (date.fromisoformat(row["start"]),
                    date.fromisoformat(row["end"]) + timedelta(days=PUBLISH_DAYS))
        parts += lottery_hints(sources.get(p, {}), span, log)
        parts.append("")
    path.write_text("\n".join(parts), encoding="utf-8")
    log(f"Подсказки по победителям: {len(need_results)} лотерей")
