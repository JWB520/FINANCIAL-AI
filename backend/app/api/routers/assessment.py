"""研报评估路由（对应前端 endpoints/assessments.ts）。

评估 = 整篇质量（四个质量维度），结论**不带风险等级**；
它和勘误的区别：勘误回答"这句话有没有错"，评估回答"这份报告整体写得怎么样"。
未评估的报告必须 status=not_started、reference_score=null（不要用 0 分代替）。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.assessment import Assessment, AssessmentRow

router = APIRouter(tags=["研报评估"])


@router.get("/assessments", response_model=Page[AssessmentRow], summary="评估列表")
async def list_assessments(
    project_id: str | None = None,
    status: str | None = None,
    q: str | None = None,
    page: PageParams = page_dep,
) -> Page[AssessmentRow]:
    not_implemented("GET /assessments")


@router.get("/reports/{report_id}/assessment", response_model=Assessment, summary="该报告的评估明细")
async def report_assessment(report_id: str) -> Assessment:
    """与 reports.py 里的同一条路径共用（前端两个视角都读它）。

    注意：未做过评估时返回 404 或 not_started 语义，不要返回一个"全是 0"的假评估。
    """
    not_implemented("GET /reports/{reportId}/assessment")
