"""trace_id：取出前端传来的 X-Trace-Id，再写回响应头与错误体。

前端约定（BACKEND.md §4.1）：每个请求都带 X-Trace-Id，报障时给工程师的就是它。所以这里三件事：
  1. 请求进来时取出（没有就生成一个 tr-xxxxxxxx）；
  2. 放进 contextvar，供日志与审计使用；
  3. 中间件把它写回响应头，异常处理器把它放进错误体（trace_id 字段）。
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar

TRACE_HEADER = "X-Trace-Id"

_trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)


def new_trace_id() -> str:
    """形如 tr-3f9a1c8b —— 前端也用这个前缀，方便一眼认出来。"""
    return "tr-" + uuid.uuid4().hex[:12]


def set_trace_id(value: str) -> None:
    _trace_id.set(value)


def current_trace_id() -> str | None:
    return _trace_id.get()
