"""审计写入器：只追加，永不修改或删除（产品红线）。

为什么单独一层：所有写操作（裁决、删除、发布规则）都要写审计，把它做成一个可注入的写入器，
application 层就不会漏写。实现时注意：审计写入失败不影响主事务（但要记 warn 日志）。
"""
from __future__ import annotations

from typing import Any


class AuditWriter:
    async def write(self, event_type: str, **fields: Any) -> None:
        raise NotImplementedError("AuditWriter.write")
