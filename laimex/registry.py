"""Реестр разрешений VID: найти свежий файл, скачать, разобрать, отфильтровать."""
from __future__ import annotations

import io
import re
from datetime import date, datetime, timedelta
from urllib.parse import urljoin

import xlrd
from bs4 import BeautifulSoup

from . import http
from .config import VID_LINK_TEXT, VID_PAGE

HEADERS = {
    "permit": "Atļaujas Nr.",
    "organizer": "Organizētāja nosaukums",
    "organizer_reg": "Organizētāja Reģ. Nr.",
    "purchase": "Preces / pakalpojuma nosaukums",
    "name": "Loterijas nosaukums",
    "start": "Loterijas sākuma datums",
    "end": "Loterijas beigu datums",
    "place": "Loterijas norises vieta",
}

# Журнальные и газетные лотереи — не показываем.
PRESS_RE = re.compile(
    r"žurnāl|avīz|laikrakst|periodisk|izdoto|krustvārd|mīklu|"
    r"\bkuma\b|rīgas viļņi|prāta dzirnas|žurnāls santa|latvijas mediji|dienas mediji|"
    r"izdevniecīb|vakara romān|vakara detektīv",
    re.I,
)
# Лотереи за услугу (связь, страхование, банк, спортклуб) — показываем отдельной меткой.
SERVICE_RE = re.compile(
    r"pakalpojum|līgum|polis|apdrošināšan|abonement|tarif",
    re.I,
)


def find_registry_link(html: str, base: str = VID_PAGE) -> tuple[str, str]:
    """На странице VID найти ссылку на xls-файл реестра и его «версию».
    Ссылка у VID годами одна и та же (/lv/media/34040/download), а новый файл кладут под неё же.
    Поэтому версию берём из того, что меняется вместе с файлом: имя файла (в нём дата), размер
    и дата «Pievienots» рядом со ссылкой."""
    soup = BeautifulSoup(html, "html.parser")
    links = soup.find_all("a", href=True)
    a = next((a for a in links if VID_LINK_TEXT.lower() in a.get_text(" ", strip=True).lower()), None)
    if a is None:  # запасной вариант
        a = next((a for a in links if "/media/" in a["href"]
                  and "atļauj" in a.get_text(" ", strip=True).lower()), None)
    if a is None:
        raise RuntimeError("На странице VID не найдена ссылка на реестр разрешений")
    size = re.search(r"length=(\d+)", a.get("type", ""))
    box = a.find_parent(class_="file-link-wrap") or a.parent
    added = re.search(r"Pievienots:\s*([\d.]+\d)", box.get_text(" ", strip=True))
    version = " | ".join(x for x in (a.get("title", "").strip(), size and size.group(1),
                                      added and added.group(1)) if x)
    return urljoin(base, a["href"]), version


def find_registry_url(html: str, base: str = VID_PAGE) -> str:
    return find_registry_link(html, base)[0]


_DATE_RE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_date(value, datemode: int = 0) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, float):
        try:
            return xlrd.xldate_as_datetime(value, datemode).date()
        except Exception:  # noqa: BLE001
            return None
    if isinstance(value, datetime):
        return value.date()
    m = _DATE_RE.search(str(value))
    if not m:
        return None
    d, mth, y = map(int, m.groups())
    try:
        return date(y, mth, d)
    except ValueError:
        return None


def clean(s) -> str:
    if s is None:
        return ""
    if isinstance(s, float) and s.is_integer():
        s = int(s)
    s = str(s).replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()


QUOTES = "\"'“”„«»"
CLOSING = "”»"


def unquote(name: str) -> str:
    """Снять внешние кавычки, только если они действительно обрамляют название."""
    s = name.strip()
    if len(s) > 2 and s[0] in QUOTES and s[-1] in QUOTES:
        inner = s[1:-1].strip()
        first = next((ch for ch in inner if ch in QUOTES), None)
        if first is None or first not in CLOSING:
            return inner
    return s


def parse_xls(content: bytes) -> list[dict]:
    book = xlrd.open_workbook(file_contents=content)
    sh = book.sheet_by_index(0)
    header = [clean(sh.cell_value(0, c)) for c in range(sh.ncols)]
    idx = {}
    norm = [re.sub(r"[^a-zāčēģīķļņšūž]", "", h.lower()) for h in header]
    for key, title in HEADERS.items():
        t = re.sub(r"[^a-zāčēģīķļņšūž]", "", title.lower())
        # сначала точное совпадение, потом «заголовок начинается с» —
        # «Loterijas nosaukums» и «Loterijas norises vieta» начинаются одинаково
        exact = [c for c, h in enumerate(norm) if h == t]
        loose = [c for c, h in enumerate(norm) if h.startswith(t) or t.startswith(h) and h]
        cand = exact or loose
        if cand:
            idx[key] = cand[0]
    if len(set(idx.values())) != len(idx):
        raise RuntimeError(f"Колонки реестра определились неоднозначно: {idx}")
    missing = set(HEADERS) - set(idx)
    if missing:
        raise RuntimeError(f"В реестре не найдены колонки: {missing}. Заголовки: {header}")
    rows = []
    for r in range(1, sh.nrows):
        def cell(k):
            return sh.cell_value(r, idx[k])
        permit = clean(cell("permit"))
        if not permit:
            continue
        rows.append({
            "permit": permit,
            "organizer": clean(cell("organizer")),
            "organizer_reg": clean(cell("organizer_reg")),
            "purchase": clean(cell("purchase")),
            "name": unquote(clean(cell("name"))),
            "start": _iso(parse_date(cell("start"), book.datemode)),
            "end": _iso(parse_date(cell("end"), book.datemode)),
            "place": clean(cell("place")),
        })
    return rows


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def classify(row: dict) -> str:
    blob = " ".join([row["organizer"], row["purchase"], row["name"]])
    if PRESS_RE.search(blob):
        return "press"
    if SERVICE_RE.search(row["purchase"]):
        return "service"
    return "shop"


def relevant(rows: list[dict], today: date, keep_finished_days: int) -> list[dict]:
    """Идущие, будущие и недавно закончившиеся лотереи без журнальных."""
    out = []
    for row in rows:
        row = dict(row, category=classify(row))
        if row["category"] == "press" or not row["end"]:
            continue
        end = date.fromisoformat(row["end"])
        if end < today - timedelta(days=keep_finished_days):
            continue
        out.append(row)
    return out


def fetch(known_version: str | None = None) -> tuple[str, str, list[dict] | None]:
    """Скачать реестр. Если файл на сайте VID не обновлялся (версия та же, что known_version),
    файл не скачиваем и возвращаем rows=None: VID банит адреса, которые часто к нему обращаются,
    поэтому запросов минимум и без повторов. Если версию определить не удалось, скачиваем."""
    page = http.get(VID_PAGE, retries=0)
    url, version = find_registry_link(page.text, page.url)
    if version and version == known_version:
        return url, version, None
    xls = http.get(url, timeout=60, retries=0)
    return url, version, parse_xls(xls.content)
