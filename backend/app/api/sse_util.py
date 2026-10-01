"""SSE 工具：响应头、事件格式化、心跳间隔。

前端用 fetch + ReadableStream 手写解析（原生 EventSource 带不了 Authorization 头），
所以这里必须做到三件事（BACKEND.md §4.6）：
  1. 响应头严格如下（缺 X-Accel-Buffering 会被网关缓冲，事件憋很久一次性出来）；
  2. 每个事件体是 `event: xxx\ndata: {...}\n\n`；
  3. 至少每 HEARTBEAT_SECONDS 秒发一个 heartbeat，否则前端判定连接死了会降级成轮询。
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

SSE_HEADERS: dict[str, str] = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",      # 给 nginx 看的：禁用缓冲
}

HEARTBEAT_SECONDS = 5


def format_event(event: str, data: dict[str, Any]) -> str:
    """把一条事件格式化成 SSE 报文（注意结尾两个换行）。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def heartbeat_stream() -> AsyncIterator[str]:
    """最小可用实现：只发心跳。

    真实现要在这里订阅 workers/progress 的 Redis 通道，把 stage/counters/task/error
    事件逐个转发出去，并在任务结束后发一条终态事件再关闭。
    """
    raise NotImplementedError("SSE 事件流（需要接 workers/progress 的发布通道）")
