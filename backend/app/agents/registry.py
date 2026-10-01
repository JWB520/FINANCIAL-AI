"""维度注册表 -> Checker 实例（唯一的装配点）。

为什么要有它：application/check_service 只按维度代号取 Checker，
新增维度时"改 domain/dimensions.py + 加一个 Checker 文件 + 在这里登记"三步就够了。
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseChecker
from app.domain.dimensions import DIMENSIONS


class CheckerRegistry:
    """维度代号 -> Checker 类。实现时把下面的 CHECKERS 填满即可。"""

    # TODO(实现): 按 domain/dimensions.py 的 checker_key 登记，例如：
    #   "calculator_checker": CalculatorChecker,
    #   "fact_checker": FactChecker,
    CHECKERS: dict[str, type[BaseChecker]] = {}

    def __init__(self, llm: Any = None, tools: dict[str, Any] | None = None) -> None:
        self.llm = llm
        self.tools = tools or {}

    def checker_for(self, dimension_code: str) -> BaseChecker:
        """取某个维度的 Checker；没登记的维度明确报未实现（不要静默跳过）。"""
        dimension = next((d for d in DIMENSIONS if d.code == dimension_code), None)
        if dimension is None:
            raise KeyError(f"未注册的维度: {dimension_code}")
        cls = self.CHECKERS.get(dimension.checker_key)
        if cls is None:
            raise NotImplementedError(f"维度 {dimension_code} 的 Checker（{dimension.checker_key}）")
        return cls(llm=self.llm, tools=self.tools)
