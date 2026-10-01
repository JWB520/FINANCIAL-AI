"""领域实体：业务逻辑用的对象（**不带数据库注解**）。

与 app/infra/models/ 的表模型分开（03_后端架构.md §1 的理由）：
领域对象带行为、可随手构造，写单元测试不用起数据库；表模型带索引/外键，只管存储。
字段名与前端 src/api/types.ts 的实体**完全一致** —— 响应模型直接由它们转换。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.domain.enums import (
    ClaimType,
    EvidenceType,
    FindingStatus,
    ReviewActionType,
    ReviewState,
    RiskLevel,
    StageCode,
    StageStatus,
    TaskKind,
    TaskStatus,
)


@dataclass
class Report:
    id: str
    title: str
    company: str
    ticker: str
    report_date: str
    owner_id: str
    status: str = "draft"
    project_id: str | None = None
    project_name: str | None = None
    local_path: str | None = None
    owner_name: str | None = None
    latest_version_no: int = 0
    findings_high: int | None = None
    findings_medium: int | None = None
    findings_low: int | None = None
    uncovered: int | None = None
    pending_review: int | None = None
    reviewed_count: int | None = None
    review_total: int | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class Block:
    """原文块。start/end offset 是**全文绝对区间**（高亮定位靠它）。"""

    id: str
    report_version_id: str
    block_index: int
    block_type: str
    start_offset: int
    end_offset: int
    text: str
    section_path: str


@dataclass
class Claim:
    """一条可核查主张（拆解阶段的产物）。"""

    id: str
    report_version_id: str
    block_id: str
    block_index: int
    start_offset: int
    end_offset: int
    text: str
    claim_type: ClaimType
    confidence: float
    revision: int = 1          # 复核提交带 If-Match 比它，用于并发冲突检测
    section_path: str = ""


@dataclass
class Evidence:
    id: str
    type: EvidenceType
    source_ref: str
    snippet: str
    start_offset: int | None = None
    end_offset: int | None = None
    uri: str | None = None
    captured_at: str | None = None


@dataclass
class Finding:
    """一条结论（某个维度对某条主张的判定）。"""

    id: str
    claim_id: str
    check_batch_id: str
    dimension_code: str
    dimension_name: str
    status: FindingStatus
    reason: str
    risk_level: RiskLevel | None = None
    rule_hits: list[dict[str, str]] = field(default_factory=list)
    suggestion: str | None = None
    calc_trace: dict[str, Any] | None = None
    confidence: float | None = None
    evidences: list[Evidence] = field(default_factory=list)
    uncovered_reason: str | None = None
    created_at: str = ""


@dataclass
class ReviewAction:
    """人工裁决记录（只追加，不修改）。"""

    id: str
    claim_id: str
    action: ReviewActionType
    actor_id: str
    actor_name: str
    created_at: str
    reason: str | None = None           # reject 必填
    payload: dict[str, Any] | None = None


@dataclass
class TaskStage:
    id: str
    task_id: str
    stage_code: StageCode
    status: StageStatus = StageStatus.PENDING
    attempt: int = 0
    progress: int = 0
    stat: dict[str, int] | None = None
    skip_reason: str | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None


@dataclass
class Task:
    """核查任务。kind / stages[].stage_code / counters.findings_* 三处字段名是坑（BACKEND.md §4.7）。"""

    id: str
    report_id: str
    mode: str
    kind: TaskKind
    owner_id: str
    owner_name: str
    trace_id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    report_title: str = ""
    company: str = ""
    ticker: str = ""
    check_batch_id: str | None = None
    dimensions: list[str] = field(default_factory=list)
    message: str | None = None
    current_stage: StageCode | None = None
    created_at: str = ""
    updated_at: str = ""
    started_at: str | None = None
    finished_at: str | None = None
    stages: list[TaskStage] = field(default_factory=list)
    counters: dict[str, int] | None = None


@dataclass
class ReviewStateSnapshot:
    """三态结论：AI 说什么 / 人说什么 / 最终算什么（没有人工动作时是待复核）。"""

    state: ReviewState
    ai_conclusion: str
    human_conclusion: str | None
    effective_conclusion: str
