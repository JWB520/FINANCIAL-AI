"""一致性核查（P1）：报告内部前后是否自相矛盾。

对应维度：见 app/domain/dimensions.py 里 checker_key="consistency_checker" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Consistency_checker(BaseChecker):
    """一致性核查（P1）：报告内部前后是否自相矛盾。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：跨块比对同一指标/口径的表述；冲突 -> CONSISTENCY_CONFLICT（中风险）。
    这类问题模型容易误报，所以建议要求模型同时给出两条原文作为证据。"""
        raise NotImplementedError("consistency_checker.check")
