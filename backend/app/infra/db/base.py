"""SQLAlchemy 2.0 声明基类（表模型继承它）。

与 domain/entities.py 的关系：领域实体管业务，表模型管存储，两者分开（03_后端架构.md §1）。
"""
from __future__ import annotations

try:                                    # 骨架期允许没装 SQLAlchemy 也能 import 别的模块
    from sqlalchemy.orm import DeclarativeBase
except ModuleNotFoundError:             # pragma: no cover
    class DeclarativeBase:              # type: ignore[no-redef]
        """占位：装上 sqlalchemy 后会换成真的基类。"""


class Base(DeclarativeBase):
    """所有表模型的基类。"""
