"""估值核查（P1）：估值方法、假设、参数是否符合估值规则库。

对应维度：见 app/domain/dimensions.py 里 checker_key="valuation_checker" 的那一项。
"""
from __future__ import annotations

from app.agents.base import BaseChecker, CheckContext, FindingDraft


class Valuation_checker(BaseChecker):
    """估值核查（P1）：估值方法、假设、参数是否符合估值规则库。"""

    dimension_code = ""

    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """实现要点：需要 valuation_rules 资料；缺它则 uncovered。方法与假设的偏差要给出对照条目作为证据。"""
        raise NotImplementedError("valuation_checker.check")
