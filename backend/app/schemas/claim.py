"""主张、结论、证据、核算过程、三态结论（对应前端 endpoints/claims.ts）。

【三条不能糊弄的语义】（BACKEND.md §4.3）
1. 未覆盖 != 通过：没查成必须 status=uncovered + uncovered_reason；
2. 没做过 != 0 分：未评估的字段用 null，不要用 0；
3. 三态结论：ai_conclusion / human_conclusion / effective_conclusion 同时给，
   没有人工动作时 effective_conclusion 是"待复核"，不是"通过"。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.domain.enums import (
    ClaimType,
    EvidenceType,
    FindingStatus,
    ReviewActionType,
    ReviewState,
    RiskLevel,
)
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime

FindingConclusion = Literal["match", "mismatch"]


class Claim(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    report_version_id: Id
    block_id: Id
    block_index: int
    start_offset: int
    end_offset: int
    text: str
    claim_type: ClaimType
    confidence: float = Field(ge=0, le=1, description="拆解置信度（低于阈值时前端提示人工确认）")
    revision: int = Field(default=1, description="复核提交带 If-Match 与它比对，不一致返回 409")
    section_path: str = ""


class ClaimSpan(BaseModel):
    """原文块上的高亮区间（前端左栏渲染用）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    block_id: Id
    start_offset: int
    end_offset: int
    risk_level: RiskLevel | None = None
    status: FindingStatus


class Evidence(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    type: EvidenceType
    source_ref: str
    snippet: str
    start_offset: int | None = None
    end_offset: int | None = None
    uri: str | None = None
    captured_at: IsoDateTime | None = None


class CalcStep(BaseModel):
    model_config = CONTRACT_CONFIG

    label: str
    value: str
    source: str | None = None
    note: str | None = None


class CalcTrace(BaseModel):
    """核算过程：前端"核算过程"折叠面板逐行展示，可复算。"""

    model_config = CONTRACT_CONFIG

    expression: str
    unit: str | None = None
    steps: list[CalcStep] = Field(default_factory=list)
    computed: str
    claimed: str
    deviation: str
    tolerance: str
    conclusion: FindingConclusion


class RuleHit(BaseModel):
    model_config = CONTRACT_CONFIG

    code: str
    desc: str


class Finding(BaseModel):
    """一条结论：某维度对某条主张的判定（前端结论卡片的主体）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    claim_id: Id
    check_batch_id: Id
    dimension_code: str
    dimension_name: str
    status: FindingStatus
    reason: str
    risk_level: RiskLevel | None = None
    rule_hits: list[RuleHit] = Field(default_factory=list)
    suggestion: str | None = None
    calc_trace: CalcTrace | None = None
    confidence: float | None = None
    evidences: list[Evidence] = Field(default_factory=list)
    uncovered_reason: str | None = None
    created_at: IsoDateTime


class ClaimConclusion(BaseModel):
    """三态结论（前端卡片上那三行：AI / 人工 / 生效）。"""

    model_config = CONTRACT_CONFIG

    state: ReviewState
    ai_conclusion: str
    human_conclusion: str | None = None
    effective_conclusion: str


class ReviewAction(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    claim_id: Id
    action: ReviewActionType
    actor_id: Id
    actor_name: str
    created_at: IsoDateTime
    reason: str | None = None
    payload: dict[str, Any] | None = None


class ReviewTrace(BaseModel):
    model_config = CONTRACT_CONFIG

    task_id: Id | None = None
    trace_id: str | None = None
    model_ref: str | None = None
    prompt_version: str | None = None
    rule_version: str | None = None


class FindingDetail(BaseModel):
    """结论详情（点开一条结论时前端要的全套）。"""

    model_config = CONTRACT_CONFIG

    finding: Finding
    claim: Claim
    review: ClaimConclusion
    review_actions: list[ReviewAction] = Field(default_factory=list)
    trace: ReviewTrace


class ClaimWithFindings(BaseModel):
    model_config = CONTRACT_CONFIG

    claim: Claim
    findings: list[Finding] = Field(default_factory=list)
    review: ClaimConclusion


class SubmitReviewRequest(BaseModel):
    """POST /claims/{id}/reviews 的请求体。

    必填校验：action=reject 时 reason 必填（缺理由返回 400 REJECT_REASON_REQUIRED）；
    并发校验：If-Match 头带 claim.revision，不一致返回 409 CLAIM_REVISION_CONFLICT。
    """

    action: ReviewActionType
    reason: str | None = None
    payload: dict[str, Any] | None = None


class CheckBatch(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    report_id: Id
    batch_no: int
    mode: str
    dimensions: list[str] = Field(default_factory=list)
    uncovered: dict[str, str] = Field(default_factory=dict, description="维度代号 -> 未覆盖原因")
    created_at: IsoDateTime
