"""项目路由（对应前端 endpoints/projects.ts）。

【优先级最低】项目当前由桌面端以本地文件夹管理（<文档>/RQC 项目库/<名>/project.json），
前端**不调用**这些接口；它们是为"项目云归档 / 团队共享"预留的（BACKEND.md §2 P2）。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.project import (
    CreateProjectRequest,
    Project,
    ProjectDetail,
    UpdateProjectRequest,
)

router = APIRouter(tags=["项目"])


@router.get("/projects", response_model=Page[Project], summary="项目列表")
async def list_projects(
    status: str | None = None,
    q: str | None = None,
    page: PageParams = page_dep,
) -> Page[Project]:
    """筛选 status(active/archived) / q（名字模糊搜）+ 分页。"""
    not_implemented("GET /projects")


@router.post("/projects", response_model=Project, summary="新建项目")
async def create_project(body: CreateProjectRequest) -> Project:
    not_implemented("POST /projects")


@router.get("/projects/{project_id}", response_model=ProjectDetail, summary="项目详情（含每份研报的状态）")
async def get_project(project_id: str) -> ProjectDetail:
    not_implemented("GET /projects/{projectId}")


@router.patch("/projects/{project_id}", response_model=Project, summary="改项目名 / 说明")
async def update_project(project_id: str, body: UpdateProjectRequest) -> Project:
    not_implemented("PATCH /projects/{projectId}")


@router.post("/projects/{project_id}/archive", response_model=Project, summary="归档（只改状态，历史数据全留）")
async def archive_project(project_id: str) -> Project:
    not_implemented("POST /projects/{projectId}/archive")
