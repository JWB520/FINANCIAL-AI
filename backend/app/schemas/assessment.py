"""研报评估契约（对应前端 endpoints/assessments.ts）。

注意：未评估的报告 status=not_started、reference_score=null（**不要用 0 代替**）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import RiskLevel
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime


class DimensionMetric(BaseModel):
    model_config = CONTRACT_CONFIG

    code: str
    name: str
    problems: int = 0
    checked: int = 0
    coverage: float = 0.0
    uncovered_reason: str | None = None


class RiskCounts(BaseModel):
    model_config = CONTRACT_CONFIG

    high: int = 0
    medium: int = 0
    low: int = 0
    pass_: int = Field(default=0, alias="pass")   # pass 是 Python 关键字，所以字段名加下划线 + 别名


class AssessmentMetrics(BaseModel):
    """指标全部由确定性计算得出（覆盖率口径见 domain/coverage.py）。"""

    model_config = CONTRACT_CONFIG

    claims_total: int = 0
    covered: int = 0
    uncovered: int = 0
    error_count: int = 0
    coverage_rate: float = 0.0
    risk_counts: RiskCounts = Field(default_factory=RiskCounts)
    by_dimension: list[DimensionMetric] = Field(default_factory=list)
    qualitative_without_data_rate: float = 0.0
    risk_disclosure_covered: bool | None = None
    cross_view_consistent: int | None = None
    cross_view_conflicts: int | None = None


class PriorityClaim(BaseModel):
    model_config = CONTRACT_CONFIG

    claim_id: Id
    risk_level: RiskLevel
    dimension_name: str
    excerpt: str


class Assessment(BaseModel):
    """评估明细（前端评估页与勘误结果页的"总体风险 + 参考分"都读它）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    check_batch_id: Id
    report_id: Id
    overall_risk: Literal["high", "medium", "low", "pass"]
    summary: str = Field(description="一句话总体结论（由后端生成，前端不自己拼）")
    metrics: AssessmentMetrics
    priority_claims: list[PriorityClaim] = Field(default_factory=list)
    rule_version: str = ""
    reference_score: str | None = Field(default=None, description="仅用于排序的加权分；未评估时为 null")
    created_at: IsoDateTime


class AssessmentRow(BaseModel):
    """评估列表的一行（跨报告）。"""

    model_config = CONTRACT_CONFIG

    report_id: Id
    project_id: Id
    project_name: str
    title: str
    company: str
    ticker: str
    report_date: str
    status: Literal["not_started", "running", "completed"]
    reference_score: str | None = None
    quality_problems: int = 0
    quality_coverage: float = 0.0
    uncovered_dimensions: list[str] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str


class AssessmentListParams(BaseModel):
    project_id: Id | None = None
    status: Literal["not_started", "running", "completed"] | None = None
    q: str | None = None
