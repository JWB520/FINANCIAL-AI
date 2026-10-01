"""复核列表路由（对应前端 endpoints/reviews.ts）。

【排序由后端定】复核队列按"风险降序 -> 有证据优先 -> 原文顺序"，前端不传排序参数
（两处口径不一致是 bug 的温床）。
【批量只允许verify】批量驳回前后端都拒：驳回必须逐条写理由，理由不齐等于制造噪声。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.review import (
    BatchVerifyRequest,
    BatchVerifyResult,
    ClaimQueueRow,
    ReportReviewRow,
    ReviewsSummary,
)

router = APIRouter(tags=["复核"])


@router.get("/reviews/summary", response_model=ReviewsSummary, summary="工作台四个数字")
async def reviews_summary() -> ReviewsSummary:
    """首页第一屏要的数字：待复核报告数 / 待复核条数 / 待复核高风险 / 近 7 天高风险。"""
    not_implemented("GET /reviews/summary")


@router.get("/reviews/reports", response_model=Page[ReportReviewRow], summary="复核列表第一层（报告级）")
async def review_reports(page: PageParams = page_dep) -> Page[ReportReviewRow]:
    not_implemented("GET /reviews/reports")


@router.get("/reviews/{report_id}/queue", response_model=Page[ClaimQueueRow], summary="复核列表第二层（主张级，风险降序）")
async def review_queue(
    report_id: str,
    risk: str | None = None,
    status: str | None = None,
    page: PageParams = page_dep,
) -> Page[ClaimQueueRow]:
    """risk / status 都是多选（逗号分隔，前端传 risk=high,medium）。"""
    not_implemented("GET /reviews/{reportId}/queue")


@router.post("/reviews/batch", response_model=BatchVerifyResult, summary="批量标记已核实（只允许 verify）")
async def batch_verify(body: BatchVerifyRequest) -> BatchVerifyResult:
    """跳过已裁决过的条目，返回 updated 与 skipped[{claim_id, reason}]。"""
    not_implemented("POST /reviews/batch")
