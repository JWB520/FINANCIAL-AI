"""时间工具：全局只用 ISO 8601 UTC 字符串。

前端约定：所有时间是 ISO 8601 UTC（例：2026-10-01T12:00:00Z）。
别在业务代码里随手 datetime.now() —— 那会写进本地时间，前端显示差 8 小时。
"""
from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    """带时区的当前时间（永远用它，不要用 datetime.now()）。"""
    return datetime.now(UTC)


def iso(dt: datetime | None = None) -> str:
    """转成前端要的 ISO 8601 UTC 字符串。"""
    value = (dt or utcnow()).astimezone(UTC)
    return value.isoformat().replace("+00:00", "Z")
