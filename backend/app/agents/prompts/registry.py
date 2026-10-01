"""提示词加载与版本解析。

为什么要版本化：审计事件里要记 prompt_version（结论能追溯到"当时用的是哪版提示词"）。
改动提示词 = 新增一个 vN 文件，**不要原地改**（否则历史结论无法复现）。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PROMPT_DIR = Path(__file__).parent


@dataclass(frozen=True)
class Prompt:
    key: str
    version: int
    template: str        # 里面用 {变量} 占位


class PromptRegistry:
    def load(self, key: str, version: int | None = None) -> Prompt:
        """取提示词：不给版本就取最大版本号（最新）。"""
        raise NotImplementedError("PromptRegistry.load")

    def render(self, prompt: Prompt, **variables: object) -> str:
        """把变量填进模板；缺变量要报错（不要留一个 {xxx} 在提示词里）。"""
        raise NotImplementedError("PromptRegistry.render")
