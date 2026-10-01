"""数据库会话：engine、sessionmaker、FastAPI 依赖。

实现要点：
  1. engine 在这里创建一次（读 settings.database_url）；
  2. `get_session()` 作为 Depends 用，请求结束自动关闭；
  3. 事务边界在 application 层（一个用例一个事务），不在路由里 commit。
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

_engine: Any = None


def get_engine() -> Any:
    raise NotImplementedError("数据库 engine（读 settings.database_url）")


async def get_session() -> AsyncIterator[Any]:
    """FastAPI 依赖：yield 一个会话，请求结束自动关闭。"""
    raise NotImplementedError("数据库会话")
    yield None      # pragma: no cover
