"""模型提供方适配：把不同厂商的差异关在这一层里。

约定：上层只认 `Provider.chat(messages, **opts) -> str` 和 `Provider.stream(...)`。
配置项见 app/config.py（llm_provider / llm_model / llm_api_key / llm_base_url / llm_temperature）。

【本文件的实现要点】
  · deepseek / openai / ollama / custom 都是 **OpenAI 兼容**协议（POST /chat/completions），
    所以共用一个类，只换 base_url 与 key；
  · anthropic 是另一套协议（/v1/messages），单独一个类；
  · **没有 Key 不是崩溃，是"AI 未接入"** —— build_provider 抛 ProviderNotConfigured，
    上层（errata_lab_service）据此降级成纯规则模式并把 llm_used=false 写进响应，
    页面会明说"本次未调用大模型"。这样演示不依赖 Key，也不会假装 AI 跑过了。
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Protocol

import httpx

# 各家默认 base_url（settings.llm_base_url 非空时以它为准）
DEFAULT_BASE_URL = {
    "deepseek": "https://api.deepseek.com/v1",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434/v1",
    "custom": "",
}
# 各家默认模型
DEFAULT_MODEL = {
    "deepseek": "deepseek-chat",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-sonnet-latest",
    "ollama": "qwen2.5:7b",
    "custom": "",
}


class ProviderNotConfigured(RuntimeError):
    """没配 Key / 没装本地模型 —— 不是错误，是"这条能力当前不可用"。"""


class ProviderError(RuntimeError):
    """调用失败（网络/超时/上游报错）。"""


class Provider(Protocol):
    name: str
    model: str

    async def chat(self, messages: list[dict[str, str]], **opts: Any) -> str: ...

    def stream(self, messages: list[dict[str, str]], **opts: Any) -> AsyncIterator[str]: ...


class OpenAICompatProvider:
    """OpenAI 兼容协议（deepseek / openai / ollama / 任何自建网关）。"""

    def __init__(
        self,
        *,
        name: str,
        api_key: str,
        base_url: str,
        model: str,
        temperature: float = 0.2,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> None:
        self.name = name
        self.api_key = api_key
        self.base_url = (base_url or DEFAULT_BASE_URL.get(name, "")).rstrip("/")
        self.model = model or DEFAULT_MODEL.get(name, "")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        if not self.base_url:
            raise ProviderNotConfigured(f"{name} 缺少 base_url（请在 .env 里配置 RQC_LLM_BASE_URL）")
        # 本地 ollama 不需要 Key；其余必须有
        if not self.api_key and name not in ("ollama", "custom"):
            raise ProviderNotConfigured(f"{name} 缺少 API Key（请在 backend/.env 里配置 RQC_LLM_API_KEY）")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _payload(self, messages: list[dict[str, str]], **opts: Any) -> dict[str, Any]:
        return {
            "model": opts.get("model") or self.model,
            "messages": messages,
            "temperature": opts.get("temperature", self.temperature),
            "max_tokens": opts.get("max_tokens", self.max_tokens),
            **({"stream": True} if opts.get("stream") else {}),
        }

    async def chat(self, messages: list[dict[str, str]], **opts: Any) -> str:
        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, headers=self._headers(), json=self._payload(messages, **opts))
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name} 请求失败：{exc}") from exc
        if resp.status_code >= 400:
            raise ProviderError(f"{self.name} 返回 {resp.status_code}：{resp.text[:300]}")
        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"{self.name} 响应格式异常：{json.dumps(data)[:300]}") from exc

    async def stream(self, messages: list[dict[str, str]], **opts: Any) -> AsyncIterator[str]:
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(messages, stream=True, **opts)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, headers=self._headers(), json=payload) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        raise ProviderError(f"{self.name} 返回 {resp.status_code}：{body[:300]!r}")
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if chunk == "[DONE]":
                            break
                        try:
                            delta = json.loads(chunk)["choices"][0]["delta"].get("content") or ""
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
                        if delta:
                            yield delta
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name} 流式请求失败：{exc}") from exc


class AnthropicProvider:
    """Anthropic Messages API（协议与 OpenAI 不同，单独实现）。"""

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        temperature: float = 0.2,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> None:
        if not api_key:
            raise ProviderNotConfigured("anthropic 缺少 API Key（请在 backend/.env 里配置 RQC_LLM_API_KEY）")
        self.api_key = api_key
        self.base_url = (base_url or "https://api.anthropic.com/v1").rstrip("/")
        self.model = model or DEFAULT_MODEL["anthropic"]
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

    async def chat(self, messages: list[dict[str, str]], **opts: Any) -> str:
        system = "\n".join(m["content"] for m in messages if m.get("role") == "system")
        turns = [m for m in messages if m.get("role") != "system"]
        payload: dict[str, Any] = {
            "model": opts.get("model") or self.model,
            "max_tokens": opts.get("max_tokens", self.max_tokens),
            "temperature": opts.get("temperature", self.temperature),
            "messages": turns,
        }
        if system:
            payload["system"] = system
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/messages",
                    headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise ProviderError(f"anthropic 请求失败：{exc}") from exc
        if resp.status_code >= 400:
            raise ProviderError(f"anthropic 返回 {resp.status_code}：{resp.text[:300]}")
        data = resp.json()
        return "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")

    async def stream(self, messages: list[dict[str, str]], **opts: Any) -> AsyncIterator[str]:  # pragma: no cover - 实验未用
        text = await self.chat(messages, **opts)
        yield text


def build_provider(settings: Any) -> Provider:
    """按 settings.llm_provider 造一个 provider。

    没有 Key 时抛 ProviderNotConfigured —— 调用方据此降级，不要 try/except 吞掉。
    """
    name = (getattr(settings, "llm_provider", "") or "deepseek").strip().lower()
    api_key = (getattr(settings, "llm_api_key", "") or "").strip()
    base_url = (getattr(settings, "llm_base_url", "") or "").strip()
    model = (getattr(settings, "llm_model", "") or "").strip() or DEFAULT_MODEL.get(name, "")
    common = {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "temperature": getattr(settings, "llm_temperature", 0.2),
        "max_tokens": getattr(settings, "llm_max_tokens", 4096),
        "timeout": getattr(settings, "llm_timeout_seconds", 60),
    }
    if name == "anthropic":
        return AnthropicProvider(**common)
    if name in (*DEFAULT_BASE_URL.keys(), "custom"):
        return OpenAICompatProvider(name=name, **common)
    raise ProviderNotConfigured(f"未知的模型提供方：{name}")
