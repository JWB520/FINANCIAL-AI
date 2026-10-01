"""请求中间件：trace_id 进出 + 访问日志。

为什么必须自己写：前端每个请求带 X-Trace-Id（用户报障时给的也是它）。
中间件负责 ① 取出或生成 ② 放进 contextvar（日志/审计自动带上）③ 写回响应头。
"""
from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.common.logging import get_logger
from app.common.trace import TRACE_HEADER, new_trace_id, set_trace_id

logger = get_logger("app.access")


class TraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        trace_id = request.headers.get(TRACE_HEADER) or new_trace_id()
        set_trace_id(trace_id)
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers[TRACE_HEADER] = trace_id
        logger.info("%s %s -> %s (%sms)", request.method, request.url.path, response.status_code, elapsed_ms)
        return response
