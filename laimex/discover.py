"""Поиск страниц лотерей и ссылок на правила.

Источники по порядку надёжности:
1. data/sources.json — ссылки, найденные ранее (в т.ч. агентом через веб-поиск);
2. сайты агентств, где номер разрешения указан прямо на странице;
3. на найденной странице кампании ищем ссылку на правила (noteikumi / PDF).
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from . import http

PERMIT_RE = re.compile(r"atļaujas?\s*(?:Nr\.?|numurs)\s*:?\s*(\d{4,5})", re.I)
RULES_HINT = re.compile(r"noteikum|nolikum|rules|terms", re.I)


# ---------------------------------------------------------------- агентства

def parse_loterijas_lv_index(html: str, base: str = "https://www.loterijas.lv/") -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    for a in soup.select('a[href*="/loterija/"]'):
        u = urljoin(base, a["href"]).split("#")[0]
        if u.rstrip("/").endswith("/noteikumi"):
            continue
        if u not in urls:
            urls.append(u)
    return urls


def parse_loterijas_lv_page(html: str, url: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    m = PERMIT_RE.search(text)
    if not m:
        return None
    rules = None
    for a in soup.select("a.get-terms[href]"):
        if a["href"].strip():
            rules = urljoin(url, a["href"])
            break
    title = soup.find("h1")
    return {
        "permit": m.group(1),
        "page": url,
        "rules": rules,
        "registration": url if soup.select_one("form.lottery-registration") else None,
        "title": title.get_text(" ", strip=True) if title else None,
        "found_by": "loterijas.lv",
    }


def parse_loterijatev(html: str, base: str = "https://www.loterijatev.lv/") -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a.item[href]"):
        txt = a.get_text(" ", strip=True)
        m = PERMIT_RE.search(txt)
        if not m:
            continue
        h4 = a.find("h4")
        out.append({
            "permit": m.group(1),
            "page": urljoin(base, a["href"]),
            "title": h4.get_text(" ", strip=True) if h4 else None,
            "found_by": "loterijatev.lv",
        })
    return out


def crawl_agencies(log=print) -> dict[str, dict]:
    found: dict[str, dict] = {}
    try:
        idx = http.get("https://www.loterijas.lv/")
        for u in parse_loterijas_lv_index(idx.text, idx.url):
            try:
                info = parse_loterijas_lv_page(http.get(u).text, u)
            except Exception as e:  # noqa: BLE001
                log(f"  ! {u}: {e}")
                continue
            if info:
                found.setdefault(info["permit"], info)
    except Exception as e:  # noqa: BLE001
        log(f"! loterijas.lv недоступен: {e}")
    try:
        r = http.get("https://www.loterijatev.lv/")
        for info in parse_loterijatev(r.text, r.url):
            found.setdefault(info["permit"], info)
    except Exception as e:  # noqa: BLE001
        log(f"! loterijatev.lv недоступен: {e}")
    return found


# ---------------------------------------------------- ссылка на правила

def find_rules_link(html: str, url: str) -> str | None:
    """Самая вероятная ссылка на правила на странице кампании."""
    soup = BeautifulSoup(html, "html.parser")
    best, best_score = None, 0
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(url, href)
        if full.split("#")[0] == url.split("#")[0]:
            continue  # якорь на той же странице
        label = a.get_text(" ", strip=True)
        score = 0
        if RULES_HINT.search(label):
            score += 3
        if RULES_HINT.search(href):
            score += 2
        if href.lower().split("?")[0].endswith(".pdf"):
            score += 2
        if re.search(r"privāt|sīkdat|cookie|lietošanas|privacy", label + href, re.I):
            score -= 5
        if urlparse(full).netloc != urlparse(url).netloc:
            score -= 1
        if score > best_score:
            best, best_score = full, score
    return best if best_score >= 3 else None
