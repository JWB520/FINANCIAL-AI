"""混合检索：全文（FTS）+ 向量（pgvector）+ 融合排序（RRF 或加权）。

实现要点：缺 embedding 模型时降级为纯全文检索，并把"降级"写进审计（status=degraded）。
"""
from __future__ import annotations

from typing import Any


class HybridSearch:
    async def search(self, query: str, filters: dict[str, Any] | None = None, top_k: int = 8) -> list[Any]:
        raise NotImplementedError("HybridSearch.search")
