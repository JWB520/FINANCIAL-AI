"""事实核查（P0）：外部数据 + 文内互证。

对应维度：见 app/domain/dimensions.py 里 checker_key="fact_checker" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Fact_checker(BaseChecker):
    """事实核查（P0）：外部数据 + 文内互证。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：
      1. 有 market_data 就调 tools/finance 与 tools/market 核对关键财务数据；
      2. 没有外部数据源时**只能做文内互证**，其余标注 uncovered（原因写清楚）；
      3. 与数据源冲突 -> FACT_CONFLICT（高风险）；没有出处 -> FACT_NO_SOURCE。"""
        raise NotImplementedError("fact_checker.check")
