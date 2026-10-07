"""LLM 网关实现（domain/ports.LlmGateway）。

所有模型调用都从这里过，好处是集中做四件事：
  1. **留痕**：每次调用写一条审计事件（模型名、prompt_version、token、耗时、输入输出摘要）；
  2. **schema 校验**：要求模型返回 JSON 时，解析失败要能重试一次，而不是把脏数据放进结论；
  3. **限流与超时**：超时 → 让上层记录 degraded，别把整条流水线拖死；
  4. **成本记录**：tokens 写进审计，比赛时能回答"跑一次花多少钱"。

【本文件的实现约定】
  · provider 为 None（没配 Key）不是错误：`available=False`，上层直接走规则降级；
  · complete_json 解析失败会**带纠正提示重试一次**，再失败抛 JsonParseFailed（不返回半成品）；
  · 每次调用都追加一条 `self.call_log`（实验页要展示"这次勘误调了几次模型、花了多少 token"）。
"""
from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from typing import Any

from app.agents.prompts.registry import PromptRegistry
from app.infra.llm.providers import Provider, ProviderError

# 从一堆文本里抠出 JSON：优先代码块，其次第一个 { / [ 到最后一个 } / ]
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


class JsonParseFailed(RuntimeError):
    """模型两次都没给出可解析的 JSON。"""


def extract_json(text: str) -> Any:
    """尽力从模型输出里抠出 JSON；抠不出抛 JsonParseFailed。"""
    if not text:
        raise JsonParseFailed("模型返回为空")
    candidates: list[str] = []
    fenced = _FENCE.findall(text)
    candidates.extend(block.strip() for block in fenced)
    candidates.append(text.strip())
    for start_ch, end_ch in (("{", "}"), ("[", "]")):
        first = text.find(start_ch)
        last = text.rfind(end_ch)
        if first >= 0 and last > first:
            candidates.append(text[first : last + 1])
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise JsonParseFailed(f"无法从模型输出里解析 JSON：{text[:200]}")


class LlmGateway:
    def __init__(self, provider: Provider | None = None, audit: Any = None, registry: PromptRegistry | None = None) -> None:
        self.provider = provider
        self.audit = audit
        self.registry = registry or PromptRegistry()
        # 每次调用的留痕（模型、提示词版本、耗时、字符数、成败）
        self.call_log: list[dict[str, Any]] = []

    # ---------------- 状态 ----------------
    @property
    def available(self) -> bool:
        return self.provider is not None

    @property
    def model_name(self) -> str:
        return getattr(self.provider, "model", "") if self.provider else ""

    def prompt_version(self, key: str) -> int:
        """这个提示词当前生效的版本号（写进审计，答辩问"能不能复现"时有答案）。"""
        try:
            return self.registry.load(key).version
        except KeyError:
            return 0

    def _record(self, prompt_key: str, version: int, started: float, *, ok: bool, chars_in: int, chars_out: int, error: str = "") -> None:
        entry = {
            "prompt_key": prompt_key,
            "prompt_version": version,
            "model": self.model_name,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "chars_in": chars_in,
            "chars_out": chars_out,
            # 粗估 token（中文约 1 字 1 token，英文 4 字符 1 token）；只用于演示成本，不用于计费
            "tokens_est": int(chars_in * 0.8 + chars_out * 0.8),
            "ok": ok,
            "error": error,
        }
        self.call_log.append(entry)
        if self.audit is not None:  # 有审计实现时顺便打一条（骨架期是 None）
            try:
                self.audit.llm_call(entry)  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001 - 审计失败不能拖垮核查
                pass

    # ---------------- 三个方法 ----------------
    async def complete(self, prompt_key: str, variables: dict[str, Any], **opts: Any) -> str:
        """渲染提示词 → 调模型 → 返回纯文本。provider 不可用时抛 RuntimeError（上层降级）。"""
        if self.provider is None:
            raise ProviderError("未配置模型（llm_provider / llm_api_key）")
        prompt = self.registry.load(prompt_key)
        user_content = self.registry.render(prompt, **variables)
        messages = [
            {"role": "system", "content": "你是严谨的中文证券研究助理，只按要求输出，不闲聊。"},
            {"role": "user", "content": user_content},
        ]
        started = time.perf_counter()
        try:
            out = await self.provider.chat(messages, **opts)
        except Exception as exc:  # noqa: BLE001 - 统一记留痕后原样抛给上层
            self._record(prompt_key, prompt.version, started, ok=False, chars_in=len(user_content), chars_out=0, error=str(exc))
            raise
        self._record(prompt_key, prompt.version, started, ok=True, chars_in=len(user_content), chars_out=len(out))
        return out

    async def complete_json(
        self,
        prompt_key: str,
        variables: dict[str, Any],
        schema: Any = None,
        **opts: Any,
    ) -> Any:
        """要求 JSON 输出：解析 + 校验 + 失败重试一次（重试仍失败则抛 JsonParseFailed）。"""
        first = await self.complete(prompt_key, variables, **opts)
        try:
            data = extract_json(first)
        except JsonParseFailed:
            # 重试一次：把上一次的坏输出与"只回 JSON"的纠正一起发回去
            retry_variables = dict(variables)
            retry_variables["_correction"] = (
                "上一次的输出不是合法 JSON，无法解析。请只输出 JSON，不要任何解释文字、不要 Markdown 代码块。"
            )
            second = await self.complete(prompt_key, retry_variables, **opts)
            data = extract_json(second)  # 仍失败就抛，让上层降级
        if schema is not None and hasattr(schema, "model_validate"):
            data = schema.model_validate(data)
        return data

    async def stream(self, prompt_key: str, variables: dict[str, Any], **opts: Any) -> AsyncIterator[str]:
        """流式输出（单条追问用）。"""
        if self.provider is None:
            raise ProviderError("未配置模型（llm_provider / llm_api_key）")
        prompt = self.registry.load(prompt_key)
        user_content = self.registry.render(prompt, **variables)
        messages = [
            {"role": "system", "content": "你是严谨的中文证券研究助理，只按要求输出，不闲聊。"},
            {"role": "user", "content": user_content},
        ]
        async for chunk in self.provider.stream(messages, **opts):
            yield chunk

    def summary(self) -> dict[str, Any]:
        """本次运行的全部模型调用汇总（实验页与审计页都用它）。"""
        return {
            "available": self.available,
            "model": self.model_name,
            "calls": len(self.call_log),
            "elapsed_ms": sum(int(c["elapsed_ms"]) for c in self.call_log),
            "tokens_est": sum(int(c["tokens_est"]) for c in self.call_log),
            "failed": sum(1 for c in self.call_log if not c["ok"]),
            "detail": self.call_log,
        }
