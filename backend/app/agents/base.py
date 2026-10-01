"""Checker 基类与上下文对象：所有维度核查都从这里派生。

【统一接口的意义】application/check_service.py 只认 `Checker.check(ctx) -> list[FindingDraft]`，
所以新增一个维度 = 加一个 Checker 子类 + 在 domain/dimensions.py 注册，别的代码都不用动。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CheckContext:
    """一次核查需要的全部输入（由 application 层装配好，Checker 不去自己查库）。"""

    task_id: str
    batch_id: str
    report_id: str
    report_version_id: str
    dimension_code: str
    # 原文与主张（按 block_index 升序）
    blocks: list[Any] = field(default_factory=list)
    claims: list[Any] = field(default_factory=list)
    # 知识库检索结果（key 是资料类型，如 internal_norm）
    knowledge: dict[str, list[Any]] = field(default_factory=dict)
    # 外部工具结果（行情/财务数据等）
    tool_results: dict[str, Any] = field(default_factory=dict)
    rule_version: str = ""


@dataclass
class FindingDraft:
    """结论草稿。offsets 必须是**全文绝对区间**（前端高亮靠它）。"""

    claim_id: str
    dimension_code: str
    status: str                      # FindingStatus 的值：pass / risk / uncovered / error
    reason: str
    risk_level: str | None = None    # 由 domain/risk_rules.resolve_level 算出
    rule_codes: list[str] = field(default_factory=list)
    suggestion: str | None = None
    calc_trace: dict[str, Any] | None = None
    confidence: float | None = None
    evidences: list[dict[str, Any]] = field(default_factory=list)
    uncovered_reason: str | None = None


class BaseChecker(ABC):
    """维度核查器基类。

    实现要点：
      1. 缺资料 -> 返回一条 status="uncovered" 的草稿（带 uncovered_reason），**不要抛异常**；
      2. 每条草稿都必须带证据（evidence）或说明为什么没有；
      3. 风险等级不要自己拍，交给 domain/risk_rules.resolve_level。
    """

    dimension_code: str = ""

    def __init__(self, llm: Any = None, tools: dict[str, Any] | None = None) -> None:
        self.llm = llm
        self.tools = tools or {}

    @abstractmethod
    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """返回每个主张的结论草稿（可能一条主张多条）。"""
        raise NotImplementedError
