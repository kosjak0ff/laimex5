"""Шаблон выжимки из правил. Один и тот же для Claude-агента и для API."""
from __future__ import annotations

DATE = {"type": ["string", "null"], "description": "YYYY-MM-DD"}
MONEY = {"type": ["number", "null"]}

SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "title", "organizer", "sponsor", "permit", "what_to_buy", "min_purchase_eur",
        "where", "how_to_enter", "registration_url", "keep", "lottery_start", "lottery_end",
        "registration_start", "registration_end", "draws", "prizes", "prize_fund_eur",
        "odds", "winners_published", "claim_deadline", "age_min", "limits", "notes",
    ],
    "properties": {
        "title": {"type": "string", "description": "Название лотереи как в правилах"},
        "organizer": {"type": "string", "description": "Организатор (rīkotājs/organizētājs) с формой: SIA «...»"},
        "sponsor": {"type": ["string", "null"], "description": "Производитель/бренд/магазин, если указан отдельно"},
        "permit": {"type": ["string", "null"], "description": "Номер разрешения, если он есть в тексте правил, иначе null"},
        "what_to_buy": {"type": "string", "description": "По-русски, коротко и точно: что и сколько купить в одном чеке. Сохраняй названия товаров как в оригинале"},
        "min_purchase_eur": MONEY,
        "where": {"type": "string", "description": "По-русски: где покупать (сети, интернет-магазины, вся Латвия)"},
        "how_to_enter": {"type": "string", "description": "По-русски: как зарегистрироваться (форма на сайте, код под крышкой, карта лояльности — автоматически, SMS) и какие данные нужны"},
        "registration_url": {"type": ["string", "null"], "description": "Адрес сайта для регистрации, если указан"},
        "keep": {"type": ["string", "null"], "description": "По-русски: что сохранить до получения приза (чек, крышку, упаковку)"},
        "lottery_start": DATE,
        "lottery_end": DATE,
        "registration_start": DATE,
        "registration_end": DATE,
        "draws": {
            "type": "array",
            "description": "Все розыгрыши по порядку. Главный приз, разыгрываемый за весь период, — отдельной строкой",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["date", "time", "period_from", "period_to", "prizes"],
                "properties": {
                    "date": DATE,
                    "time": {"type": ["string", "null"], "description": "HH:MM"},
                    "period_from": DATE,
                    "period_to": DATE,
                    "prizes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["name", "qty"],
                            "properties": {"name": {"type": "string"}, "qty": {"type": "integer"}},
                        },
                    },
                },
            },
        },
        "prizes": {
            "type": "array",
            "description": "Призовой фонд по видам призов",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "qty", "unit_value_eur", "total_value_eur"],
                "properties": {
                    "name": {"type": "string", "description": "Название приза по-русски, модель — как в оригинале"},
                    "qty": {"type": "integer"},
                    "unit_value_eur": MONEY,
                    "total_value_eur": MONEY,
                },
            },
        },
        "prize_fund_eur": {"type": ["number", "null"], "description": "Общая стоимость призов, как написано в правилах"},
        "odds": {"type": ["string", "null"], "description": "Вероятность выигрыша как в правилах, напр. «121 к 10000»"},
        "winners_published": {"type": ["string", "null"], "description": "По-русски: где и когда публикуют победителей"},
        "claim_deadline": DATE,
        "age_min": {"type": ["integer", "null"]},
        "limits": {"type": ["string", "null"], "description": "По-русски: ограничения (один приз на человека, один чек — один приз и т.п.)"},
        "notes": {"type": ["string", "null"], "description": "По-русски: прочее важное для участника, 1–2 предложения, или null"},
    },
}

INSTRUCTIONS = """\
Ты делаешь выжимку из правил латвийской товарной лотереи (preču loterija) для сайта-каталога.
Отвечай ТОЛЬКО фактами из текста правил. Ничего не придумывай: если чего-то нет — null.
Текстовые поля пиши по-русски, коротко и понятно обычному покупателю;
названия товаров, брендов, магазинов и моделей призов оставляй как в оригинале.
Даты — в формате YYYY-MM-DD. Суммы — числом в евро (5806.19).
Розыгрыши (izlozes) перечисли все, с датой, временем, периодом покупок и призами.
Призы (balvas) — по видам: количество, цена одного, общая цена. prize_fund_eur — итоговая
сумма фонда (balvu fonds), как она указана в правилах.
"""


def validate_shape(summary: dict) -> list[str]:
    """Минимальная проверка, что ответ похож на нужный шаблон."""
    errors = []
    for key in SUMMARY_SCHEMA["required"]:
        if key not in summary:
            errors.append(f"нет поля {key}")
    if not isinstance(summary.get("draws", []), list):
        errors.append("draws должен быть списком")
    if not isinstance(summary.get("prizes", []), list):
        errors.append("prizes должен быть списком")
    return errors
