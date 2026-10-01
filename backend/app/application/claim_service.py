"""主张用例：拆句 -> 分类 -> 去重（阶段 claim_split / claim_classify）。

对应阶段：StageCode.CLAIM_SPLIT、StageCode.CLAIM_CLASSIFY
实现要点：每条主张的 start/end offset 落在所在块内、可映射回全文绝对区间。
"""
from __future__ import annotations

from typing import Any


class ClaimService:
    async def split_claims(self, version_id: str) -> list[Any]:
        raise NotImplementedError("ClaimService.split_claims")

    async def classify_claims(self, version_id: str) -> list[Any]:
        raise NotImplementedError("ClaimService.classify_claims")
