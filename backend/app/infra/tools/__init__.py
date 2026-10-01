"""工具集：计算器、财务数据、行情、知识库检索、文本相似度。

【为什么工具要独立一层】"模型不许直接算数/不许自己编数据"这条红线靠它实现：
数字与事实必须来自工具，结论才可复算、可溯源（03_后端架构.md §6）。

每个工具的接口约定：入参是明确的领域对象/字符串，出参是结构化数据 + 证据片段。
"""
from __future__ import annotations

from typing import Any, Protocol


class CalculatorTool(Protocol):
    """表达式计算（复算用）。必须返回逐步结果，前端"核算过程"要靠它展示。"""

    def evaluate(self, expression: str) -> dict[str, Any]: ...


class FinanceTool(Protocol):
    """财务数据（利润表/现金流/资产负债），用于数据支撑与事实核查。"""

    async def fetch(self, company: str, ticker: str, metric: str, period: str) -> Any: ...


class MarketTool(Protocol):
    """行情数据（股价、市值、估值倍数）。取数时间必须记录（证据里要显示 captured_at）。"""

    async def snapshot(self, ticker: str) -> Any: ...


class KbSearchTool(Protocol):
    """知识库检索（混合检索：全文 + 向量）。

    返回的每条都要带 doc_id / chunk_index / 相似度，作为 Evidence 的 source_ref。
    """

    async def search(self, query: str, types: list[str] | None = None, top_k: int = 8) -> Any: ...


class TextSimTool(Protocol):
    """文本相似度（前后一致性核查、观点交叉验证用）。"""

    def similarity(self, a: str, b: str) -> float: ...
