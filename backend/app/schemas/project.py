"""项目契约（对应前端 endpoints/projects.ts）。

【当前前端不调用这些接口】项目由桌面端以本地文件夹管理
（<文档>/RQC 项目库/<项目名>/project.json + data/），
这套接口是为将来的"项目云归档 / 团队共享"预留的 —— 实现优先级最低（P2）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import StageCode, TaskStatus
from app.schemas.common import CONTRACT_CONFIG, Id

ProjectStatus = Literal["active", "archived"]


class Project(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    name: str
    owner_id: Id
    owner_name: str
    status: ProjectStatus = "active"
    description: str | None = None
    report_count: int = 0
    errata_done: int = 0
    assessment_done: int = 0
    pending_review_count: int = 0
    high_risk_count: int = 0
    running_task_count: int = 0
    created_at: str
    updated_at: str


class ProjectReportRow(BaseModel):
    """项目详情里的一行（每份研报的勘误 / 评估 / 复核状态）。"""

    model_config = CONTRACT_CONFIG

    report_id: Id
    title: str
    company: str
    ticker: str
    report_date: str
    errata_status: TaskStatus
    errata_high: int = 0
    errata_medium: int = 0
    errata_low: int = 0
    errata_uncovered: int = 0
    claims_reviewed: int = 0
    claims_total: int = 0
    assessment_status: Literal["not_started", "running", "completed"]
    assessment_score: str | None = None
    latest_task_id: Id | None = None
    updated_at: str


class ProjectDetail(Project):
    reports: list[ProjectReportRow] = Field(default_factory=list)


class CreateProjectRequest(BaseModel):
    name: str
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectListParams(BaseModel):
    status: ProjectStatus | None = None
    q: str | None = None


# 项目列表行里的一个阶段状态（前端 ProjectReportRow 用到的枚举先在这里引用一下，避免循环 import）
STAGE_HINT: dict[StageCode, str] = {}
