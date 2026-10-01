"""分页：统一 Page<T> 的出参形状与入参解析。

前端契约（types.ts 的 Page<T>）：{ items, total, page, page_size }
—— 列表接口一律直接返回这个形状，**不要另包一层 envelope**（BACKEND.md §1 硬规矩 3）。
"""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200


class Page(BaseModel, Generic[T]):
    """列表接口的统一响应体（与前端 types.ts 的 Page<T> 逐字段一致）。"""

    items: list[T]
    total: int
    page: int
    page_size: int


class PageParams(BaseModel):
    """分页入参（在路由里用 Depends(PageParams) 使用）。"""

    page: int = Field(default=1, ge=1, description="页码，从 1 开始")
    page_size: int = Field(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE, description="每页条数")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def paginate(items: list[T], params: PageParams) -> Page[T]:
    """把已查好的列表切成 Page。

    实现要点：数据量变大后应改成"仓储层分页"（把 page/page_size 传进 SQL），
    这一层保持签名不变即可，路由与前端都不用动。
    """
    start = params.offset
    return Page[T](
        items=items[start : start + params.page_size],
        total=len(items),
        page=params.page,
        page_size=params.page_size,
    )
