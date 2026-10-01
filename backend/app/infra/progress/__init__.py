"""进度发布：Redis pub/sub（实时）+ 快照（重连后能拿到当前状态）。

前端有两条路径读进度：
    SSE  /tasks/{id}/events      订阅 pub/sub
    轮询 GET /tasks/{id}         读快照（SSE 失败时的降级路径）
所以每推一次事件，**同时更新快照**（否则降级后进度条会倒退）。
"""
from __future__ import annotations

from typing import Any


class RedisProgressPublisher:
    async def publish(self, task_id: str, event: str, data: dict[str, Any]) -> None:
        raise NotImplementedError("RedisProgressPublisher.publish")

    async def snapshot(self, task_id: str) -> dict[str, Any] | None:
        raise NotImplementedError("RedisProgressPublisher.snapshot")

    async def subscribe(self, task_id: str):
        raise NotImplementedError("RedisProgressPublisher.subscribe")
