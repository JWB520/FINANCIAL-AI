"""复核列表契约（对应前端 endpoints/reviews.ts）。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import FindingStatus, ReviewState, RiskLevel, TaskStatus
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime


class RecentHighRisk(BaseModel):
    model_config = CONTRACT_CONFIG

    report_id: Id
    report_title: str
    company: str
    risk_count: int
    latest_at: IsoDateTime


class ReviewsSummary(BaseModel):
    """工作台的四个数字（首页第一屏）。"""

    model_config = CONTRACT_CONFIG

    reports_pending: int = 0
    claims_pending: int = 0
    high_risk_pending: int = 0
    high_risk_last_7d: int = 0
    recent_high_risk: list[RecentHighRisk] = Field(default_factory=list)


class ReportReviewRow(BaseModel):
    """复核列表第一层（报告级）。"""

    model_config = CONTRACT_CONFIG

    report_id: Id
    report_title: str
    company: str
    ticker: str
    report_date: str
    check_status: TaskStatus | Literal["not_started"]
    review_status: Literal["pending", "in_progress", "done"]
    high_risk: int = 0
    medium_risk: int = 0
    low_risk: int = 0
    pass_count: int = 0
    uncovered: int = 0
    reviewed_count: int = 0
    review_total: int = 0
    latest_task_id: Id | None = None
    latest_batch_id: Id | None = None
    updated_at: IsoDateTime


class ClaimQueueRow(BaseModel):
    """复核列表第二层（主张级）。

    排序由后端定（前端不传排序参数）：风险降序 -> 有证据优先 -> 原文顺序。
    """

    model_config = CONTRACT_CONFIG

    claim_id: Id
    report_id: Id
    block_index: int
    excerpt: str
    claim_type: str
    risk_level: RiskLevel | None = None
    status: FindingStatus
    dimension_name: str
    suggestion: str | None = None
    review_state: ReviewState
    has_evidence: bool = False
    revision: int = 1


class BatchVerifyRequest(BaseModel):
    """批量标记已核实。只允许 verify —— 批量驳回前后端都拒（驳回必须逐条写理由）。"""

    report_id: Id
    claim_ids: list[Id] = Field(min_length=1)


class BatchVerifyResult(BaseModel):
    model_config = CONTRACT_CONFIG

    updated: int
    skipped: list[dict[str, str]] = Field(default_factory=list, description="[{claim_id, reason}]")
