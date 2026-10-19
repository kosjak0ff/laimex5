"""Автоматические проверки выжимки против реестра и арифметики."""
from __future__ import annotations

from datetime import date, timedelta


def _d(s):
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def check(summary: dict, registry: dict) -> list[dict]:
    """Список проверок: {"ok": bool, "text": "..."}."""
    out = []

    def add(ok, text):
        out.append({"ok": bool(ok), "text": text})

    # 1. номер разрешения
    if summary.get("permit"):
        add(str(summary["permit"]).strip() == registry["permit"],
            f"Номер разрешения в правилах ({summary['permit']}) совпадает с реестром VID")

    # 2. даты лотереи совпадают с реестром
    for key, rkey, label in (("lottery_start", "start", "начала"), ("lottery_end", "end", "окончания")):
        s, r = _d(summary.get(key)), _d(registry.get(rkey))
        if s and r:
            add(s == r, f"Дата {label} ({s:%d.%m.%Y}) совпадает с реестром VID")
        elif r:
            add(False, f"В правилах не найдена дата {label}")

    # 3. регистрация внутри периода лотереи
    ls, le = _d(summary.get("lottery_start")), _d(summary.get("lottery_end"))
    rs, re_ = _d(summary.get("registration_start")), _d(summary.get("registration_end"))
    if ls and le and rs and re_:
        add(ls <= rs <= re_ <= le, "Период регистрации внутри периода лотереи")

    # 4. сумма призов = фонд
    prizes = summary.get("prizes") or []
    fund = summary.get("prize_fund_eur")
    totals = [p.get("total_value_eur") for p in prizes]
    if prizes and fund is not None and all(t is not None for t in totals):
        s = round(sum(totals), 2)
        add(abs(s - fund) <= 1.0, f"Сумма призов {s:.2f} € = призовой фонд {fund:.2f} €")
    for p in prizes:
        if p.get("unit_value_eur") is not None and p.get("total_value_eur") is not None:
            calc = round(p["qty"] * p["unit_value_eur"], 2)
            if abs(calc - p["total_value_eur"]) > 1.0:
                add(False, f"«{p['name']}»: {p['qty']} × {p['unit_value_eur']} ≠ {p['total_value_eur']}")

    # 5. призы в розыгрышах = призы в фонде (по количеству)
    draws = summary.get("draws") or []
    if draws and prizes:
        in_draws = sum(pr.get("qty", 0) for d in draws for pr in d.get("prizes", []))
        in_fund = sum(p.get("qty", 0) for p in prizes)
        if in_draws:
            add(in_draws == in_fund, f"Призов в розыгрышах {in_draws}, в фонде {in_fund}")

    # 6. даты розыгрышей в разумных пределах
    if draws and ls and le:
        bad = [d["date"] for d in draws if _d(d.get("date")) and not
               (ls <= _d(d["date"]) <= le + timedelta(days=45))]
        add(not bad, "Даты розыгрышей в пределах лотереи" + (f" (кроме {', '.join(bad)})" if bad else ""))
    return out


def status(checks: list[dict]) -> str:
    return "ok" if all(c["ok"] for c in checks) else "needs_review"
