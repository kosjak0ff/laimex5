"""Командная строка робота.

  python -m laimex daily            — всё за один раз (реестр, правила, задания, сайт)
  python -m laimex todo             — что осталось сделать (для агента)
  python -m laimex save 9158 f.json — сохранить выжимку и показать проверки
  python -m laimex add-source 9158 --page URL [--rules URL] [--registration URL] [--no-fetch]
  python -m laimex no-source 9158 --note TEXT — правила не нашлись, не искать 7 дней
  python -m laimex add-result 9158 [--winners URL] [--note TEXT] [--next ДАТА]
  python -m laimex build            — только пересобрать сайт
  python -m laimex health           — проверить, всё ли обновляется
"""
from __future__ import annotations

import argparse
import json
import sys

from . import pipeline
from .config import EXTRACT_MODE, ensure_dirs


def main(argv=None):
    ap = argparse.ArgumentParser(prog="laimex")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("daily")
    d.add_argument("--mode", choices=["agent", "api"], default=EXTRACT_MODE)
    sub.add_parser("todo")
    s = sub.add_parser("save")
    s.add_argument("permit")
    s.add_argument("file", help="JSON с выжимкой, '-' — из stdin")
    a = sub.add_parser("add-source")
    a.add_argument("permit")
    a.add_argument("--page")
    a.add_argument("--rules")
    a.add_argument("--registration")
    a.add_argument("--found-by", default="agent-search")
    a.add_argument("--no-fetch", action="store_true", help="только записать ссылки, правила скачает GitHub Actions")
    n = sub.add_parser("no-source")
    n.add_argument("permit")
    n.add_argument("--note", required=True, help="по-русски: где искали и что не так")
    r = sub.add_parser("add-result")
    r.add_argument("permit")
    r.add_argument("--winners", help="страница или файл со списком победителей")
    r.add_argument("--note", help="по-русски для посетителей сайта: что известно о розыгрышах")
    r.add_argument("--next", metavar="DATE", help="не искать снова до этой даты (ГГГГ-ММ-ДД), например "
                   "когда организатор обещал опубликовать победителей")
    sub.add_parser("build")
    h = sub.add_parser("health")
    h.add_argument("--github-issue", metavar="OWNER/REPO", help="открыть/закрыть issue при проблемах")
    h.add_argument("--run-url", help="ссылка на журнал этого запуска робота")
    h.add_argument("--failed", action="store_true", help="робот в этом запуске упал")
    args = ap.parse_args(argv)
    ensure_dirs()

    if args.cmd == "daily":
        pipeline.daily(args.mode)
    elif args.cmd == "todo":
        todo = pipeline.load(pipeline.TODO_JSON, None)
        if not todo:
            print("Сначала запустите: python -m laimex daily")
            return 1
        print(f"Нужна выжимка ({len(todo['need_summary'])}): файлы в data/pending/")
        for p in todo["need_summary"]:
            print("  ", p)
        print(f"Не найдены правила ({len(todo['need_sources'])}):")
        for r in todo["need_sources"]:
            print(f"   {r['permit']} | {r['name']} | {r['organizer']} | {r['purchase']} | "
                  f"{r['start']}..{r['end']} | {r['place']}")
        need_results = todo.get("need_results", [])
        print(f"Нужны сведения о розыгрышах ({len(need_results)}):")
        for r in need_results:
            print(f"   {r['permit']} | {r['name']} | {r['organizer']} | {r['start']}..{r['end']} | {r['reason']}")
        if need_results:
            print("   Подсказки робота по известным страницам: data/pending/results.md")
        if todo["broken"]:
            print(f"Проблемы с правилами ({len(todo['broken'])}):")
            for r in todo["broken"]:
                print(f"   {r['permit']} | {r['name']} | {r['error']} | {r['rules']}")
    elif args.cmd == "save":
        raw = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
        checks = pipeline.save_summary(args.permit, json.loads(raw))
        for c in checks:
            print(("OK  " if c["ok"] else "ПЛОХО ") + c["text"])
        if not all(c["ok"] for c in checks):
            print("Есть несовпадения: перепроверьте выжимку по тексту правил.")
    elif args.cmd == "add-source":
        src = pipeline.add_source(args.permit, args.page, args.rules, args.registration,
                                  args.found_by, fetch=not args.no_fetch)
        print(json.dumps(src.get(args.permit, {}), ensure_ascii=False, indent=1))
    elif args.cmd == "no-source":
        print(json.dumps(pipeline.no_source(args.permit, args.note), ensure_ascii=False, indent=1))
    elif args.cmd == "add-result":
        res = pipeline.add_result(args.permit, args.winners, args.note, args.next)
        print(json.dumps(res, ensure_ascii=False, indent=1))
    elif args.cmd == "build":
        pipeline.build_site()
    elif args.cmd == "health":
        from . import health
        res = health.check(failed_run=(args.run_url or "см. вкладку Actions") if args.failed else None,
                           repo=args.github_issue or health.REPO)
        print("Всё в порядке" if res["ok"] else
              "Проблемы:\n- " + "\n- ".join(p["title"] for p in res["problems"]))
        if args.github_issue:
            print("Issue на GitHub:", health.sync_issue(res, args.github_issue, args.run_url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
