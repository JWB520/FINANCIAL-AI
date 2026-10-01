"""任务与阶段契约（对应前端 endpoints/tasks.ts + TaskSubmitPayload）。

【三个被踩过的字段名，别再改回去】（BACKEND.md §4.7）
    kind                    任务类型（errata / assessment），前端靠它决定"查看结果"去哪
    stages[].stage_code      必须是 StageCode 的五个值之一
    counters.findings_high/medium/low  不叫 findings/high/medium
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.domain.enums import CheckMode, StageCode, StageStatus, TaskKind, TaskStatus
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime


class TaskStage(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    task_id: Id
    stage_code: StageCode
    status: StageStatus = StageStatus.PENDING
    attempt: int = 0
    progress: int = Field(default=0, ge=0, le=100)
    stat: dict[str, int] | None = None
    skip_reason: str | None = None
    error: str | None = None
    started_at: IsoDateTime | None = None
    finished_at: IsoDateTime | None = None
    duration_ms: int | None = None


class TaskCounters(BaseModel):
    """进度页四个数字 + 总数（字段名固定，前端直接读）。"""

    model_config = CONTRACT_CONFIG

    claims_total: int = 0
    findings_high: int = 0
    findings_medium: int = 0
    findings_low: int = 0
    uncovered: int = 0


class Task(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    report_id: Id
    report_title: str
    company: str
    ticker: str
    mode: CheckMode
    kind: TaskKind
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    owner_id: Id
    owner_name: str
    trace_id: str
    check_batch_id: Id | None = None
    dimensions: list[str] = Field(default_factory=list)
    message: str | None = None
    current_stage: StageCode | None = None
    created_at: IsoDateTime
    updated_at: IsoDateTime
    started_at: IsoDateTime | None = None
    finished_at: IsoDateTime | None = None
    stages: list[TaskStage] | None = None
    counters: TaskCounters | None = None


class TaskSummary(BaseModel):
    """列表页用的轻量形状（不带 stages）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    report_id: Id
    report_title: str
    kind: TaskKind
    status: TaskStatus
    progress: int
    trace_id: str
    created_at: IsoDateTime
    updated_at: IsoDateTime


class CreateTaskRequest(BaseModel):
    """POST /tasks 的请求体。

    缺资料时返回 409 TASK_MISSING_INPUTS，details.missing_inputs 列出缺哪些
    （前端 DimensionPicker 会据此提示"去上传哪类资料"）。
    """

    report_id: Id
    kind: TaskKind = TaskKind.ERRATA
    mode: CheckMode = CheckMode.DEEP
    dimensions: list[str] = Field(default_factory=list, description="空表示按模式取默认维度")


class TaskSubmitType(BaseModel):
    """任务单里的一条勾选项（前端 TaskRequestPayload.types 的一项）。"""

    code: str
    name: str
    note: str | None = None


class PageRange(BaseModel):
    from_: int = Field(alias="from")
    to: int

    model_config = {"populate_by_name": True}


class TaskSubmitPayload(BaseModel):
    """前端「发送」时提交的完整任务单（含本地项目信息与用户勾选）。

    来源：前端 src/api/types.ts 的 TaskSubmitPayload（桌面端还会把它留档到 <项目>/data/tasks/）。
    后端只关心 report_id / kind / types / page_range / depth，其余字段用于审计与留痕。
    """

    model_config = CONTRACT_CONFIG

    project_id: Id
    project_name: str
    report_path: str
    knowledge_dir: str | None = None
    report_id: Id | None = None
    kind: TaskKind
    types: list[TaskSubmitType] = Field(default_factory=list)
    page_range: dict[str, int] | None = None
    total_pages: int | None = None
    depth: Literal["quick", "standard", "deep"] | None = None
    note: str | None = None
    estimated_minutes: int | None = None
    submitted_at: str | None = None


class TaskListParams(BaseModel):
    status: TaskStatus | None = None
    report_id: Id | None = None
    kind: TaskKind | None = None
    extra: dict[str, Any] | None = None
