"""Общие настройки робота Laimex."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SUMMARIES = DATA / "summaries"
RULES_TEXT = DATA / "rules_text"        # извлечённый текст правил (кэш)
WORK = ROOT / "work"                     # временные файлы, не в git
PENDING = DATA / "pending"               # задания на выжимку (в git: их читает рутина Claude)
IMAGES = DATA / "images"                 # баннеры лотерей, уменьшенные для карточек
WEB = ROOT / "web"                       # исходники сайта
SITE = ROOT / "docs"                     # готовый сайт (GitHub Pages: main /docs)

TZ = ZoneInfo("Europe/Riga")

VID_PAGE = "https://www.vid.gov.lv/lv/loterijas"
VID_LINK_TEXT = "Izsniegtās preču un pakalpojumu loteriju atļaujas"

USER_AGENT = (
    "Mozilla/5.0 (compatible; LaimexBot/0.1; +https://github.com/) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# Сколько дней после окончания лотереи держать её в разделе «Завершённые».
KEEP_FINISHED_DAYS = int(os.environ.get("LAIMEX_KEEP_FINISHED_DAYS", "30"))

# Режим выжимки: "agent" — делает Claude в рутине по подписке,
# "api" — программа сама вызывает Claude API (нужен ANTHROPIC_API_KEY).
EXTRACT_MODE = os.environ.get("LAIMEX_EXTRACT_MODE", "agent")
API_MODEL = os.environ.get("LAIMEX_API_MODEL", "claude-sonnet-5-5")


def today():
    return datetime.now(TZ).date()


def ensure_dirs():
    for p in (DATA, SUMMARIES, RULES_TEXT, WORK, PENDING, IMAGES, SITE):
        p.mkdir(parents=True, exist_ok=True)
