"""Скачивание правил (PDF или HTML) и извлечение текста."""
from __future__ import annotations

import hashlib
import io
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from pypdf import PdfReader

from . import http

MIN_TEXT = 800  # меньше — скорее всего скан или не та страница


def pdf_to_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    pages = []
    for i, page in enumerate(reader.pages, 1):
        pages.append(f"--- lapa {i} ---\n{page.extract_text() or ''}")
    return "\n".join(pages)


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "form", "svg"]):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    # таблицы: ячейки через « | », строки с новой строки — так ИИ легче читать
    for tr in root.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        tr.replace_with(soup.new_string("\n" + " | ".join(cells) + "\n"))
    text = root.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", text)


def looks_like_rules(text: str) -> bool:
    t = text.lower()
    return len(text) >= MIN_TEXT and ("loterij" in t) and ("noteikum" in t or "balv" in t)


def fetch_rules(url: str) -> dict:
    r = http.get(url, timeout=60)
    ctype = r.headers.get("content-type", "").lower()
    # сайт может назвать веб-страницу PDF-файлом: верим только сигнатуре в начале файла
    is_pdf = b"%PDF-" in r.content[:1024]
    text = pdf_to_text(r.content) if is_pdf else html_to_text(r.text)
    # просили .pdf, а пришла веб-страница: сайт, вероятно, не пускает робота (например, IP GitHub)
    want_pdf = any(urlparse(u).path.lower().endswith(".pdf") for u in (url, r.url)) or "pdf" in ctype
    return {
        "url": r.url,
        "type": "pdf" if is_pdf else "html",
        "sha": hashlib.sha256(text.encode()).hexdigest()[:16],
        "text": text,
        "ok": looks_like_rules(text),
        "not_pdf": want_pdf and not is_pdf,
    }
