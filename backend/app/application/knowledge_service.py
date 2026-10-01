"""知识库用例：文档入库、切片、向量化、启停、删除（软删 + 审计）。"""
from __future__ import annotations

from typing import Any


class KnowledgeService:
    async def list_docs(self, **filters: Any) -> tuple[list[Any], int]:
        raise NotImplementedError("KnowledgeService.list_docs")

    async def upload(self, **fields: Any) -> Any:
        raise NotImplementedError("KnowledgeService.upload")

    async def toggle(self, doc_id: str, enabled: bool) -> Any:
        """启停只影响后续任务（历史结论不动）。"""
        raise NotImplementedError("KnowledgeService.toggle")

    async def delete(self, doc_id: str) -> None:
        """软删 + 审计事件（"东西怎么没了"永远查得到）。"""
        raise NotImplementedError("KnowledgeService.delete")
