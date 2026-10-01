"""经验学习用例：案例聚合、候选生成、审核发布、回滚、删除。

【删除的三条不同规矩】实现前先看 frontend/BACKEND.md §4.5：
  候选：任何状态都能删；已审核过的必须带 reason（否则 DELETE_REASON_REQUIRED）
  案例：任何状态都能删
  版本：任何状态都能删（含生效中）；删生效中的要把同 key 最近历史版本切回 active，
        并在返回的 promoted 里说明切到哪一版（没有则 null）
"""
from __future__ import annotations

from typing import Any


class LearningService:
    async def list_cases(self, **filters: Any) -> tuple[list[Any], int]:
        raise NotImplementedError("LearningService.list_cases")

    async def generate_candidates(self) -> list[Any]:
        raise NotImplementedError("LearningService.generate_candidates")

    async def review_candidate(self, candidate_id: str, approve: bool, note: str | None) -> Any:
        raise NotImplementedError("LearningService.review_candidate")

    async def delete_candidate(self, candidate_id: str, reason: str | None) -> None:
        raise NotImplementedError("LearningService.delete_candidate")

    async def delete_version(self, version_id: str) -> Any:
        """删除 + 自动兜底：返回 PromoteResult(deleted, promoted)。"""
        raise NotImplementedError("LearningService.delete_version")
