"""Аккуратные HTTP-запросы: robots.txt, пауза между запросами, повторы."""
from __future__ import annotations

import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

from .config import USER_AGENT

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "lv,en;q=0.8"})
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_last_hit: dict[str, float] = {}
MIN_DELAY = 1.0  # секунд между запросами к одному сайту


class Blocked(Exception):
    """Сайт запретил обход этой страницы в robots.txt."""


def _robots_for(url: str):
    host = urlparse(url).scheme + "://" + urlparse(url).netloc
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _session.get(host + "/robots.txt", timeout=15)
            ctype = r.headers.get("content-type", "")
            # Некоторые сайты отдают главную страницу вместо robots.txt —
            # это значит, что правил нет.
            if r.status_code == 200 and "html" not in ctype:
                rp.parse(r.text.splitlines())
            else:
                rp = None
        except requests.RequestException:
            rp = None
        _robots[host] = rp
    return _robots[host]


def allowed(url: str) -> bool:
    rp = _robots_for(url)
    return True if rp is None else rp.can_fetch("LaimexBot", url)


def get(url: str, *, timeout: int = 30, retries: int = 2) -> requests.Response:
    if not allowed(url):
        raise Blocked(url)
    host = urlparse(url).netloc
    wait = MIN_DELAY - (time.time() - _last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    last_exc = None
    for attempt in range(retries + 1):
        try:
            r = _session.get(url, timeout=timeout, allow_redirects=True)
            _last_hit[host] = time.time()
            if r.status_code >= 500 and attempt < retries:
                time.sleep(3 * (attempt + 1))
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # noqa: PERF203
            last_exc = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last_exc  # type: ignore[misc]
