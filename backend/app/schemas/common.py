"""通用模型：错误体、分页、时间与 Id 别名。"""
from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict

from app.common.pagination import Page, PageParams

__all__ = ["ApiErrorBody", "Page", "PageParams", "Id", "IsoDateTime", "CONTRACT_CONFIG"]

Id = Annotated[str, "实体 id（形如 rpt-xxx / task-xxx / claim-xxx）"]
IsoDateTime = Annotated[str, "ISO 8601 UTC 字符串，例 2026-10-01T12:00:00Z"]

# 所有契约模型的公共配置：允许直接从 dataclass / ORM 对象构造
CONTRACT_CONFIG = ConfigDict(from_attributes=True, populate_by_name=True)


class ApiErrorBody(BaseModel):
    """统一错误体（前端 ApiErrorBody 逐字段一致）。

    code     业务错误码，前端用它决定"怎么办"（词典见 frontend/src/api/client.ts）
    message  给用户看的中文，前端直接展示，不自己编文案
    details  结构化补充（如 missing_inputs: [...]）
    trace_id 与响应头 X-Trace-Id 同一个值，报障时用它查全链路
    """

    model_config = CONTRACT_CONFIG

    code: str
    message: str
    details: dict[str, Any] | None = None
    trace_id: str | None = None
