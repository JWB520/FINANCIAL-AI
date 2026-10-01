"""审计契约（对应前端 endpoints/audit.ts）。

审计只追加、不可删、不可改 —— "东西怎么没了"永远查得到。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.domain.enums import AuditEventType, StageCode
from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime


class AuditEvent(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    task_id: Id | None = None
    stage_code: StageCode | None = None
    event_type: AuditEventType
    actor: str
    model: str | None = None
    prompt_version: str | None = None
    tool_name: str | None = None
    input_digest: str | None = None
    output_digest: str | None = None
    duration_ms: int | None = None
    tokens: int | None = None
    trace_id: str
    status: Literal["ok", "error", "degraded"] = "ok"
    error_message: str | None = None
    created_at: IsoDateTime


class AuditListParams(BaseModel):
    task_id: Id | None = None
    event_type: AuditEventType | None = None
    trace_id: str | None = None
    status: Literal["ok", "error", "degraded"] | None = None
