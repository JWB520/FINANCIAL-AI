"""流式通道事件契约（对应前端 src/api/sse.ts 与 types.ts 的 TaskSseEvent / AskSseEvent）。

前端用 fetch + ReadableStream 手写解析（原生 EventSource 带不了 Authorization 头），
所以事件体就是 data: 后面的 JSON —— 字段名必须与这里一致。

两条通道：
    GET  /tasks/{taskId}/events    stage / counters / task / error / heartbeat
    POST /claims/{claimId}/ask     chunk / done

三条必须做到的（BACKEND.md §4.6）：
1. 允许 Authorization 与 X-Trace-Id 头（走 CORS）；
2. 响应头带 text/event-stream + no-cache, no-transform + X-Accel-Buffering: no；
3. 至少每 5 秒一个 heartbeat，否则前端会降级成轮询。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.domain.enums import StageCode, StageStatus, TaskStatus
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime


class StageEventData(BaseModel):
    stage_code: StageCode
    status: StageStatus
    progress: int
    message: str | None = None
    stat: dict[str, int] | None = None


class CountersEventData(BaseModel):
    claims_total: int = 0
    findings_high: int = 0
    findings_medium: int = 0
    findings_low: int = 0
    uncovered: int = 0


class TaskStatusEventData(BaseModel):
    status: TaskStatus
    progress: int
    message: str | None = None


class ErrorEventData(BaseModel):
    stage_code: StageCode
    message: str
    retryable: bool = True


class HeartbeatEventData(BaseModel):
    ts: IsoDateTime


class SSEMessage(BaseModel):
    """一条 SSE 消息（event 名 + data 体）。"""

    model_config = CONTRACT_CONFIG

    event: Literal["stage", "counters", "task", "error", "heartbeat", "chunk", "done"]
    data: dict


class AskRequest(BaseModel):
    """单条追问的请求体（受限对话：只围绕这一条结论）。"""

    question: str


class AskCitation(BaseModel):
    claim_id: Id | None = None
    label: str


class AskDoneData(BaseModel):
    message_id: Id
    citations: list[AskCitation] = []
