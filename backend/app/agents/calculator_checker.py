"""计算核查（P0）：抽数字 -> 复算 -> 比对。

对应维度：见 app/domain/dimensions.py 里 checker_key="calculator_checker" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Calculator_checker(BaseChecker):
    """计算核查（P0）：抽数字 -> 复算 -> 比对。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点（03_后端架构.md §4.2）：
      1. 抽取正文里的算式/数字（提示词 extract_numbers.v3）；
      2. 用 tools/calculator 复算，产出 CalcTrace（含 steps/deviation/tolerance）；
      3. 不一致 -> CALC_MISMATCH（高风险）；单位/口径不一致 -> CALC_UNIT_ERROR。
    注意：**模型不许直接算数**，只负责抽参数；计算由工具做，才能"可复算"。"""
        raise NotImplementedError("calculator_checker.check")
