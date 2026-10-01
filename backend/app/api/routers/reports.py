"""研报路由（对应前端 endpoints/reports.ts）—— P0 里占三条。

P0 三条：POST /reports/ensure（打开项目时幂等对齐）、GET /reports/{id}/blocks（左栏原文）、
          GET /reports/{id}/claims（右栏结论）。
另外几条（上传、版本、差异、导出、重查）属于 P1/P2，骨架同样都建好了。

【实现要点 / 踩过的坑】
- /reports/ensure 必须幂等：同一 project_id + report_path 重复调用不许建出两份报告；
- blocks 的 offset 是**全文绝对区间**；claims 必须按 block_index 升序返回；
- 未知 reportId 必须 404，**不许兜底成第一条**（前端会被误导成"打开了另一份报告"）。
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.claim import Claim
from app.schemas.report import (
    Block,
    EnsureReportRequest,
    Report,
    ReportDetail,
    ReportVersion,
)

router = APIRouter(tags=["研报"])


@router.post("/reports/ensure", response_model=Report, summary="★ 打开本地项目时对齐报告（幂等）")
async def ensure_report(body: EnsureReportRequest) -> Report:
    """按 project_id + report_path 确保报告存在。

    幂等要求：已存在就返回它（可顺带刷新 title/company），不许重复创建。
    前端在进入项目界面时会调用；它决定项目里三个入口能不能点开。
    """
    not_implemented("POST /reports/ensure")


@router.post("/reports", response_model=Report, summary="上传研报（multipart）")
async def upload_report(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    title: str = Form(...),
    company: str = Form(...),
    ticker: str = Form(...),
    report_date: str = Form(...),
) -> Report:
    """multipart/form-data：file + project_id + title + company + ticker + report_date。"""
    not_implemented("POST /reports")


@router.get("/reports", response_model=Page[Report], summary="研报列表")
async def list_reports(
    project_id: str | None = None,
    company: str | None = None,
    status: str | None = None,
    keyword: str | None = None,
    page: PageParams = page_dep,
) -> Page[Report]:
    not_implemented("GET /reports")


@router.get("/reports/{report_id}", response_model=ReportDetail, summary="报告详情（含版本与最近任务）")
async def get_report(report_id: str) -> ReportDetail:
    not_implemented("GET /reports/{reportId}")


@router.get("/reports/{report_id}/blocks", response_model=list[Block], summary="★ 原文块（复核裁决左栏）")
async def list_blocks(report_id: str) -> list[Block]:
    """按 block_index 升序返回；start/end offset 是全文绝对区间（前端高亮靠它）。"""
    not_implemented("GET /reports/{reportId}/blocks")


@router.get("/reports/{report_id}/claims", response_model=list[Claim], summary="★ 该报告的全部主张（按原文顺序）")
async def list_claims(report_id: str) -> list[Claim]:
    """必须按 block_index 升序返回 —— 前端左右联动就是靠这个顺序。

    返回空数组必须是真的没有主张；查不到报告要 404，不许静默返回空
    （前端会显示"这份报告没有问题"，那是产品事故）。
    """
    not_implemented("GET /reports/{reportId}/claims")


@router.post("/reports/{report_id}/versions", response_model=ReportVersion, summary="上传新版本（multipart）")
async def upload_version(report_id: str, file: UploadFile = File(...)) -> ReportVersion:
    not_implemented("POST /reports/{reportId}/versions")


@router.get("/reports/{report_id}/versions/{from_version}/diff", summary="版本差异（改了哪些块、结论增删）")
async def diff_versions(report_id: str, from_version: int) -> dict:
    not_implemented("GET /reports/{reportId}/versions/{fromVersion}/diff")


@router.get("/reports/{report_id}/export", summary="导出 docx/pdf（前端用 window.open 下载）")
async def export_report(report_id: str, format: str = "docx") -> dict:
    """真实现：直接返回文件字节流（Content-Disposition: attachment）。

    注意：前端用 window.open 打开这个 URL，所以它必须能在浏览器里直接下载，
    不能要求额外的请求头（那是演示模式的 /export-preview 要解决的事）。
    """
    not_implemented("GET /reports/{reportId}/export")


@router.get("/reports/{report_id}/export-preview", summary="演示模式用的文本摘要（真后端可不实现）")
async def export_preview(report_id: str) -> dict:
    not_implemented("GET /reports/{reportId}/export-preview")


@router.post("/reports/{report_id}/recheck", response_model=Report, summary="按新配置重新核查（产生新批次）")
async def recheck_report(report_id: str) -> Report:
    """重新核查不删旧结论：新批次与旧批次都留在库里（审计要能追溯）。"""
    not_implemented("POST /reports/{reportId}/recheck")
