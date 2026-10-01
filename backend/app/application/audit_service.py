"""审计用例：写审计事件（只追加）、按 trace_id 拉全链路。

所有写操作的实现都要在事务里顺手调一次 `record(...)` —— 删除、裁决、发布规则都不能例外。
"""
from __future__ import annotations

from typing import Any


class AuditService:
    async def record(self, event_type: str, **fields: Any) -> Any:
        raise NotImplementedError("AuditService.record")

    async def list_events(self, **filters: Any) -> tuple[list[Any], int]:
        raise NotImplementedError("AuditService.list_events")

    async def trace(self, trace_id: str) -> list[Any]:
        raise NotImplementedError("AuditService.trace")
