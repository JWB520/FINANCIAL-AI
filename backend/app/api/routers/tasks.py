"""任务路由（对应前端 endpoints/tasks.ts）—— P0 里占两条。

P0：POST /tasks（建任务，缺资料返回 409 TASK_MISSING_INPUTS）
    GET  /tasks/{id}（进度页快照：5 秒轮询 + 每次重连都拉，所以它必须便宜）
    GET  /tasks/{id}/events（SSE 实时推送，前端断线会降级成轮询上面那条）

【实现要点】
- 任务对象里 kind / stages[].stage_code / counters.findings_* 三处字段名不能改（BACKEND.md §4.7）；
- GET /tasks/{id} 未知 id 必须 404（不许兜底成第一条任务）；
- 同报告已有运行中任务时再次建任务 -> 409 TASK_ALREADY_RUNNING；
- 单阶段重试：只有 failed 的阶段可重试，否则 409 STAGE_NOT_RETRYABLE。
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api import sse_util
from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import current_user_dep, page_dep
from app.schemas.auth import User
from app.schemas.task import CreateTaskRequest, Task, TaskStage, TaskSubmitPayload, TaskSummary

router = APIRouter(tags=["任务"])


@router.post("/tasks", response_model=Task, summary="★ 创建核查任务")
async def create_task(body: CreateTaskRequest, user: User = current_user_dep) -> Task:
    """按维度与模式建任务并投队列（workers/celery_app）。

    缺资料时抛 409 TASK_MISSING_INPUTS，details.missing_inputs 列出缺哪些
    （前端会引导用户去上传对应类型的知识库资料）。
    """
    not_implemented("POST /tasks")


@router.post("/tasks/submit", response_model=Task, summary="提交任务单（含用户勾选与页码范围）")
async def submit_task(body: TaskSubmitPayload, user: User = current_user_dep) -> Task:
    """前端「发送」时调用的完整任务单入口（比 /tasks 多带 types / page_range / depth）。

    桌面端已把同一份 payload 留档到 <项目>/data/tasks/，所以这条只需落库 + 投队列。
    """
    not_implemented("POST /tasks/submit")


@router.get("/tasks", response_model=Page[TaskSummary], summary="任务列表")
async def list_tasks(
    status: str | None = None,
    report_id: str | None = None,
    kind: str | None = None,
    page: PageParams = page_dep,
) -> Page[TaskSummary]:
    not_implemented("GET /tasks")


@router.get("/tasks/{task_id}", response_model=Task, summary="★ 任务详情（进度页快照）")
async def get_task(task_id: str) -> Task:
    """进度页 5 秒轮询这条；必须便宜，并且未知 id 要 404。"""
    not_implemented("GET /tasks/{taskId}")


@router.get("/tasks/{task_id}/events", summary="★ 任务进度 SSE（stage / counters / task / error / heartbeat）")
async def task_events(task_id: str) -> StreamingResponse:
    """实时推送流水线进度。

    前端行为：连不上或连续失败会自动降级为 5 秒轮询 GET /tasks/{task_id}，
    所以这条挂了不会白屏，但进度条会变慢（页面上会提示用户）。
    """
    async def _stream():
        async for chunk in sse_util.heartbeat_stream():
            yield chunk

    return StreamingResponse(_stream(), media_type="text/event-stream", headers=sse_util.SSE_HEADERS)


@router.post("/tasks/{task_id}/cancel", response_model=Task, summary="终止任务（已完成阶段的产物保留）")
async def cancel_task(task_id: str) -> Task:
    not_implemented("POST /tasks/{taskId}/cancel")


@router.post("/tasks/{task_id}/stages/{stage_code}/retry", response_model=TaskStage, summary="单阶段重试")
async def retry_stage(task_id: str, stage_code: str) -> TaskStage:
    """只补跑这一步；不可重试的阶段（如已完成）返回 409 STAGE_NOT_RETRYABLE。"""
    not_implemented("POST /tasks/{taskId}/stages/{stageCode}/retry")
