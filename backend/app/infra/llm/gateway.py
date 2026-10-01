"""LLM 网关实现（domain/ports.LlmGateway）。

所有模型调用都从这里过，好处是集中做四件事：
  1. **留痕**：每次调用写一条审计事件（模型名、prompt_version、token、耗时、输入输出摘要）；
  2. **schema 校验**：要求模型返回 JSON 时，解析失败要能重试一次，而不是把脏数据放进结论；
  3. **限流与超时**：超时 → 让上层记录 degraded，别把整条流水线拖死；
  4. **成本记录**：tokens 写进审计，比赛时能回答"跑一次花多少钱"。
"""
from __future__ import annotations

from typing import Any

from app.infra.llm.providers import Provider


class LlmGateway:
    def __init__(self, provider: Provider, audit: Any = None) -> None:
        self.provider = provider
        self.audit = audit

    async def complete(self, prompt_key: str, variables: dict[str, Any], **opts: Any) -> str:
        raise NotImplementedError("LlmGateway.complete")

    async def complete_json(self, prompt_key: str, variables: dict[str, Any], schema: Any) -> Any:
        """要求 JSON 输出：解析 + 校验 + 失败重试一次（重试仍失败则上报 degraded）。"""
        raise NotImplementedError("LlmGateway.complete_json")

    async def stream(self, prompt_key: str, variables: dict[str, Any], **opts: Any):
        """流式输出（单条追问用）。"""
        raise NotImplementedError("LlmGateway.stream")
