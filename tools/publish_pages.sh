#!/usr/bin/env bash
# Публикует папку docs/ в ветку gh-pages (из неё GitHub Pages показывает сайт).
# Ветка всегда содержит один коммит — так репозиторий не разрастается.
set -euo pipefail
: "${GH_TOKEN:?нужен GH_TOKEN}"
tmp=$(mktemp -d)
cp -r docs/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="laimex-bot" -c user.email="laimex-bot@users.noreply.github.com" \
    commit -qm "Сайт $(date -u +%F\ %H:%M) UTC"
git push -qf "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" gh-pages
echo "Сайт опубликован"
