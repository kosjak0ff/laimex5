#!/usr/bin/env python3
"""Проверка перед коммитом рутины Claude: в коммите только данные и сайт.

Рутина читает текст с чужих сайтов и отправляет коммиты прямо в main, а код из main потом
выполняет робот с правом записи в репозиторий. Поэтому рутина не должна менять ничего, кроме
data/ и docs/. Если в индексе есть другие файлы, скрипт их называет и завершается с ошибкой.

    python tools/check_staged.py
"""
from __future__ import annotations

import subprocess
import sys

ALLOWED = ("data/", "docs/")


def main() -> int:
    out = subprocess.run(["git", "diff", "--cached", "--name-only"], capture_output=True, text=True,
                         check=True).stdout
    bad = [f for f in out.splitlines() if f and not f.startswith(ALLOWED)]
    if bad:
        print("В коммите есть файлы вне data/ и docs/ — рутина не должна их менять:")
        for f in bad:
            print("  ", f)
        print("Уберите их из коммита: git restore --staged <файл>")
        return 1
    print("Проверка пройдена: в коммите только data/ и docs/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
