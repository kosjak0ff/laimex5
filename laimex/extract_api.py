"""Режим API: программа сама просит Claude сделать выжимку (нужен ANTHROPIC_API_KEY)."""
from __future__ import annotations

import json
import os

from .config import API_MODEL
from .schema import INSTRUCTIONS, SUMMARY_SCHEMA


def extract(rules_text: str, registry_row: dict) -> dict:
    import anthropic  # импорт здесь, чтобы режим agent не требовал пакета

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    reg = json.dumps(registry_row, ensure_ascii=False, indent=1)
    msg = client.messages.create(
        model=API_MODEL,
        max_tokens=4000,
        system=INSTRUCTIONS,
        tools=[{
            "name": "save_summary",
            "description": "Сохранить выжимку правил лотереи",
            "input_schema": SUMMARY_SCHEMA,
        }],
        tool_choice={"type": "tool", "name": "save_summary"},
        messages=[{
            "role": "user",
            "content": (
                f"Запись из реестра VID (для сверки):\n{reg}\n\n"
                f"Текст правил:\n<rules>\n{rules_text[:120_000]}\n</rules>"
            ),
        }],
    )
    for block in msg.content:
        if block.type == "tool_use":
            return block.input
    raise RuntimeError("Claude не вернул выжимку")
