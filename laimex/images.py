"""Баннеры лотерей для карточек на сайте.

Баннер берём со страницы лотереи на loterijas.lv (ссылка banner_src в data/sources.json),
уменьшаем и храним в data/images/: сайт не грузит картинки с чужого сервера, а баннер
не пропадает, когда агентство убирает страницу. У кого баннера нет, сайт рисует свой.
"""
from __future__ import annotations

import io
from pathlib import Path

from . import http
from .config import IMAGES

WIDTH = 720  # карточка на телефоне и компьютере уже, с запасом на экраны с высокой плотностью


def banner_path(permit: str) -> Path:
    return IMAGES / f"{permit}.jpg"


def shrink(raw: bytes) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(raw))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    else:
        im = im.convert("RGB")
    if im.width > WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80, optimize=True, progressive=True)
    return out.getvalue()


def fetch_banners(sources: dict, permits: set[str], log=print) -> int:
    """Скачать недостающие баннеры и удалить баннеры лотерей, которых больше нет на сайте."""
    IMAGES.mkdir(parents=True, exist_ok=True)
    got = 0
    for permit in sorted(permits):
        src = sources.get(permit, {}).get("banner_src")
        dest = banner_path(permit)
        if not src or dest.exists():
            continue
        try:
            dest.write_bytes(shrink(http.get(src).content))
            got += 1
        except Exception as e:  # noqa: BLE001
            log(f"  ! {permit}: баннер не скачан: {e}")
    for f in IMAGES.glob("*.jpg"):
        if f.stem not in permits:
            f.unlink()
    if got:
        log(f"Скачано баннеров: {got}")
    return got
