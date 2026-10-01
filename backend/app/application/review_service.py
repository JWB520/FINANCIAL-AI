"""复核用例：人工裁决、三态结论、批量核实（★ P0-7 在这里）。

对应路由：app/api/routers/claims.py、reviews.py
红线：驳回必须带理由（REVIEW_REASON_REQUIRED）；写入后 claim.revision + 1 并写审计事件。
"""
from __future__ import annotations

from typing import Any


class ReviewService:
    async def submit(self, claim_id: str, action: str, reason: str | None, payload: dict | None, actor: Any) -> Any:
        """★ P0-7：提交人工裁决。校验顺序：理由 -> revision -> 落库 + 审计。"""
        raise NotImplementedError("ReviewService.submit")

    async def conclusion_of(self, claim_id: str) -> Any:
        """三态结论：AI / 人工 / 生效（没有人工动作时生效结论是"待复核"）。"""
        raise NotImplementedError("ReviewService.conclusion_of")

    async def batch_verify(self, report_id: str, claim_ids: list[str]) -> Any:
        """只允许 verify；已裁决过的条目跳过并在 skipped 里说明原因。"""
        raise NotImplementedError("ReviewService.batch_verify")
