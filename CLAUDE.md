# Laimex

@AGENTS.md

## Ежедневная облачная задача
Если ты работаешь как облачная задача «Laimex: выжимки лотерей», выполняй только `ROUTINE.md`.
Субагентов из этого файла и Codex в облаке нет, не ищи их.

## Кто что делает в этом проекте (локальная работа)
Общая таблица — в `~/.claude/CLAUDE.md`. Здесь — что она значит для Laimex.
- Код робота в `laimex/` по готовому плану → `implementer`. Проверка: `python -m pytest -q`.
- Ошибки разбора правил, проверок выжимок, расчёта дат и призов, которые не нашлись сразу → `architect`.
  Если не поддались двум попыткам → `codex-deep`.
- Сайт в `web/` (карточки, фильтры, календарь, вид на телефоне) → `frontend`, затем `python -m laimex build`.
- Падения GitHub Actions (`daily.yml`, `tests.yml`) и логи робота → `codex-ops`.
- Много однотипных тестов или правок по всем модулям → `codex-bulk`.
- Перед коммитом в `main` (это сразу публикация) → `codex-review`.

Инструменты в этом проекте:
- Сайт публикует Cloudflare Pages (https://laimex.pages.dev/) из `docs/` в `main`. Вопросы по Pages, кэшу и скорости — скиллы `cloudflare:cloudflare` и `cloudflare:web-perf`, MCP Cloudflare `docs`/`search`.
- GitHub Actions: логи и запуски — `gh run list`, `gh run view <id> --log-failed`; issue «Laimex: что нужно сделать» — `gh issue view`.
- Библиотеки робота (`requests`, `beautifulsoup4`, `xlrd`, `pypdf`, `Pillow`, `anthropic`) — документация через Context7; для режима API также скилл `claude-api`.
- Проверить сайт глазами — встроенный браузер на https://laimex.pages.dev/ или локальная `docs/index.html`; автоматические проверки — Playwright.
- Правила лотерей в PDF разбирает робот. Скилл `pdf` нужен только для ручного разбора сложного файла.
