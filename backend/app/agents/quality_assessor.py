"""质量评估（P1）：四个 quality_* 维度（逻辑/数据/风险披露/观点交叉）。

对应维度：见 app/domain/dimensions.py 里 checker_key="quality_assessor" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Quality_assessor(BaseChecker):
    """质量评估（P1）：四个 quality_* 维度（逻辑/数据/风险披露/观点交叉）。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：
      1. 结论**不带风险等级**（前端评估页就是这么显示的）；
      2. 输出的是"问题数 + 覆盖率"，覆盖率口径见 domain/coverage.py；
      3. quality_cross 需要外部研报库，缺它则该维度 uncovered。"""
        raise NotImplementedError("quality_assessor.check")
