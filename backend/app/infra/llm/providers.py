"""模型提供方适配：把不同厂商的差异关在这一层里。

约定：上层只认 `Provider.chat(messages, **opts) -> str` 和 `Provider.stream(...)`。
配置项见 app/config.py（llm_provider / llm_model / llm_api_key / llm_base_url / llm_temperature）。
"""
from __future__ import annotations

from typing import Any, Protocol


class Provider(Protocol):
    name: str

    async def chat(self, messages: list[dict[str, str]], **opts: Any) -> str: ...

    def stream(self, messages: list[dict[str, str]], **opts: Any): ...


def build_provider(settings: Any) -> Provider:
    """按 settings.llm_provider 造一个 provider。

    待实现：deepseek / openai / anthropic / ollama（比赛用 ollama 跑本地方案时也要能切）。
    """
    raise NotImplementedError("模型提供方（deepseek / openai / anthropic / ollama）")
