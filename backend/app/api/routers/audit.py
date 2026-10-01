"""审计路由（对应前端 endpoints/audit.ts）—— P2。

审计只追加、不可删改；报障时用户给的就是 trace_id，工程师用它拉全链路。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.audit import AuditEvent

router = APIRouter(tags=["审计"])


@router.get("/audit/events", response_model=Page[AuditEvent], summary="审计事件列表")
async def list_events(
    task_id: str | None = None,
    event_type: str | None = None,
    trace_id: str | None = None,
    status: str | None = None,
    page: PageParams = page_dep,
) -> Page[AuditEvent]:
    not_implemented("GET /audit/events")


@router.get("/audit/trace/{trace_id}", response_model=list[AuditEvent], summary="按追踪号拉全链路")
async def trace_events(trace_id: str) -> list[AuditEvent]:
    not_implemented("GET /audit/trace/{traceId}")
