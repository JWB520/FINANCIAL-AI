"""经验学习契约（对应前端 endpoints/learning.ts）。

三个删除接口的规矩各不相同（BACKEND.md §4.5），实现在 application/learning_service.py：
    学习候选  任何状态都能删；已审核过的必须带 reason，否则 400
    经验案例  任何状态都能删
    规则版本  任何状态都能删（含生效中）；删生效中的要把同 key 最近历史版本切回 active，
              并通过返回值的 promoted 告知切到了哪一版（没有历史版本则 promoted=null）
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime

CandidateType = Literal["rule", "prompt", "case"]
CandidateState = Literal["pending", "approved", "rejected"]
CaseType = Literal["ai_wrong", "ai_right", "human_added"]
RuleKind = Literal["risk_rule", "prompt", "threshold"]
RuleState = Literal["active", "archived", "canary"]


class ExperienceCase(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    claim_id: Id
    ai_finding_id: Id | None = None
    review_action_id: Id | None = None
    case_type: CaseType
    labels: list[str] = Field(default_factory=list)
    summary: str
    dimensions: list[str] = Field(default_factory=list)
    created_at: IsoDateTime


class LearningCandidate(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    type: CandidateType
    content: str
    source_case_ids: list[Id] = Field(default_factory=list)
    source_summaries: list[str] = Field(default_factory=list)
    impact_dimensions: list[str] = Field(default_factory=list)
    state: CandidateState = "pending"
    reviewer_id: Id | None = None
    reviewer_name: str | None = None
    review_note: str | None = None
    created_at: IsoDateTime
    reviewed_at: IsoDateTime | None = None


class RuleVersion(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    kind: RuleKind
    key: str
    version: int
    content: str
    state: RuleState = "active"
    published_by: str = ""
    published_at: IsoDateTime
    note: str | None = None


class ReviewCandidateRequest(BaseModel):
    """审核候选：通过 = 发布新版本；驳回必须填理由。"""

    approve: bool
    note: str | None = None


class DeleteReasonRequest(BaseModel):
    """删除已审核过的候选必须带理由（它记着"当初为什么通过/驳回"）。"""

    reason: str | None = None


class PromoteResult(BaseModel):
    """删除生效中规则版本的返回：告诉前端自动切回了哪一版。"""

    model_config = CONTRACT_CONFIG

    deleted: Id
    promoted: Id | None = Field(default=None, description="自动切回生效的历史版本 id；没有则为 null")
