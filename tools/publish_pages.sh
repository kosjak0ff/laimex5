#!/usr/bin/env bash
# Сайт живёт на Cloudflare Pages (https://laimex.pages.dev/), он сам публикует папку docs/ из main.
# Этот скрипт кладёт в ветку gh-pages страницу переезда (tools/old-site/), чтобы старый адрес
# https://kosjak0ff.github.io/laimex5/ вёл на новый. Ветка всегда содержит один коммит.
set -euo pipefail
: "${GH_TOKEN:?нужен GH_TOKEN}"
tmp=$(mktemp -d)
cp -r tools/old-site/. "$tmp/"
cp "$tmp/index.html" "$tmp/404.html"   # любая старая ссылка тоже ведёт на новый адрес
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="laimex-bot" -c user.email="laimex-bot@users.noreply.github.com" \
    commit -qm "Переезд на laimex.pages.dev $(date -u +%F\ %H:%M) UTC"
git push -qf "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" gh-pages
echo "Старый адрес ведёт на новый"
