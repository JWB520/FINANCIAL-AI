"""研报、版本、原文块契约（对应前端 endpoints/reports.ts）。

【最容易做错的两处】
1. blocks 的 start_offset / end_offset 是**全文绝对区间**（不是块内偏移）；
2. claims 必须按 block_index 升序返回（前端左原文右结论的联动靠这个顺序）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime

ReportStatus = Literal["draft", "checking", "checked", "archived"]
BlockType = Literal["heading", "paragraph", "table_cell", "caption", "bullet"]
ParseStatus = Literal["pending", "parsing", "done", "failed"]


class Report(BaseModel):
    """报告实体。列表与详情都用它（详情多带 versions / latest_task，见下）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    title: str
    company: str
    ticker: str
    report_date: str
    owner_id: Id
    status: ReportStatus = "draft"
    project_id: Id | None = None
    project_name: str | None = None
    local_path: str | None = None
    owner_name: str | None = None
    latest_version_no: int = 0
    # 下面这些是"汇总数字"，必须由结论明细派生、不许手写
    findings_high: int | None = None
    findings_medium: int | None = None
    findings_low: int | None = None
    uncovered: int | None = None
    pending_review: int | None = None
    reviewed_count: int | None = None
    review_total: int | None = None
    created_at: IsoDateTime
    updated_at: IsoDateTime


class ReportVersion(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    report_id: Id
    version_no: int
    file_uri: str
    file_hash: str
    char_count: int
    parse_status: ParseStatus = "pending"
    parse_error: str | None = None
    created_at: IsoDateTime


class Block(BaseModel):
    """原文块。offsets 是整个文档的绝对字符区间。"""

    model_config = CONTRACT_CONFIG

    id: Id
    report_version_id: Id
    block_index: int = Field(description="阅读顺序，claims/blocks 都按它升序")
    block_type: BlockType
    start_offset: int
    end_offset: int
    text: str
    section_path: str = Field(default="", description="形如 第一章 / 1.2 产能释放")


class ReportDetail(Report):
    """报告详情：实体 + 版本 + 最近一次任务（前端详情页用）。"""

    versions: list[ReportVersion] = Field(default_factory=list)
    latest_task: dict | None = Field(default=None, description="最近一次任务的摘要（见 schemas/task.py 的 TaskSummary）")


class EnsureReportRequest(BaseModel):
    """POST /reports/ensure 的请求体（打开本地项目时调用，必须幂等）。"""

    project_id: Id
    report_path: str = Field(description="本地研报绝对路径（桌面端给的真实路径）")
    title: str | None = None
    company: str | None = None
    ticker: str | None = None
    report_date: str | None = None


class ReportListParams(BaseModel):
    project_id: Id | None = None
    company: str | None = None
    status: ReportStatus | None = None
    keyword: str | None = None
