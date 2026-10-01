"""规范核查（P0）：内部规范库 + 禁用表达。

对应维度：见 app/domain/dimensions.py 里 checker_key="compliance_checker" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Compliance_checker(BaseChecker):
    """规范核查（P0）：内部规范库 + 禁用表达。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：
      1. 禁用表达是"最硬的规则"（命中即报，不容易误判）—— 用规则匹配，不要只用模型判断；
      2. 命中 -> NORM_FORBIDDEN（高风险）；表述不合规范 -> NORM_TONE（低风险）；
      3. 没有内部规范库 -> 整个维度 uncovered（原因：未配置 internal_norm）。"""
        raise NotImplementedError("compliance_checker.check")
