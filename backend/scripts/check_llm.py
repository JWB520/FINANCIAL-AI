"""模型连接自检：确认后端能真的调通 DeepSeek（不打印 Key 明文）。

用法：
    cd backend
    python scripts/check_llm.py

它会做三件事：
  1. 打印当前配置（provider / model / base_url / Key 是否就位）——Key 只显示长度与前缀；
  2. 发一个**最小真实请求**（让模型把一句话翻译成算式），打印原文与耗时；
  3. 失败时给出对症的排查清单（没配 Key / 网络不通 / base_url 写错 / 额度不足）。

为什么单独有这一份：配 Key 这件事**失败起来是安静的** ——
env_prefix 写漏、变量名拼错、base_url 少个 /v1，全都表现为"模型未接入"，
跟"真的没配"长得一模一样。有这条自检，5 秒就能分清是哪一种。
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.infra.llm.gateway import LlmGateway  # noqa: E402
from app.infra.llm.providers import ProviderError, ProviderNotConfigured, build_provider  # noqa: E402

SAMPLE = "公司营收由1.20亿元增至1.45亿元，同比增长20.8%。"


async def main() -> int:
    settings = get_settings()
    key = settings.llm_api_key or ""
    print("== 配置 ==")
    print(f"  provider  : {settings.llm_provider}")
    print(f"  model     : {settings.llm_model}")
    print(f"  base_url  : {settings.llm_base_url or '（空，用该 provider 的默认地址）'}")
    print(f"  api_key   : {'已配置，' + str(len(key)) + ' 字符，前缀 ' + key[:3] + '***' if key else '❌ 空'}")

    try:
        provider = build_provider(settings)
    except ProviderNotConfigured as exc:
        print(f"\n❌ 未能构造 provider：{exc}")
        print("   排查：backend/.env 里应有 RQC_LLM_PROVIDER / RQC_LLM_MODEL / RQC_LLM_API_KEY；")
        print("   注意变量名必须带 RQC_ 前缀（见 app/config.py 的 env_prefix）。")
        return 1

    gateway = LlmGateway(provider=provider)
    print(f"\n== 真实调用（提示词 {gateway.prompt_version('extract_numbers')} 版）==")
    print(f"  句：{SAMPLE}")
    started = time.perf_counter()
    try:
        raw = await gateway.complete("extract_numbers", {"passage": SAMPLE})
    except ProviderError as exc:
        print(f"\n❌ 调用失败：{exc}")
        print("   排查顺序：① 本机能否访问 api.deepseek.com:443；② base_url 是否带了正确的路径（官方 OpenAI 兼容端点是 https://api.deepseek.com/v1）；")
        print("             ③ Key 是否有效/有余额；④ 是否需要走代理（如有代理，设 HTTPS_PROXY 环境变量即可，httpx 会自动读取）。")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"\n❌ 未预期错误：{type(exc).__name__}: {exc}")
        return 1

    elapsed = int((time.perf_counter() - started) * 1000)
    print(f"  ✅ 返回（{elapsed} ms）：")
    print("  " + raw.strip().replace("\n", "\n  ")[:600])

    summary = gateway.summary()
    print(f"\n== 留痕 ==\n  调用 {summary['calls']} 次｜约 {summary['tokens_est']} tokens｜失败 {summary['failed']} 次")
    print("\n模型链路可用 —— 现在可以跑真实勘误了：")
    print('  python scripts/run_errata_lab.py "你的研报.pdf" --pages 1-6')
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
