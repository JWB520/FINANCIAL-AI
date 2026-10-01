"""内存仓储：骨架期让流程能跑（重启即清空，仅用于开发/测试）。

用途：
  1. 让 P0 七条接口在没有数据库时也能连起来自测；
  2. 作为仓储契约的"参考实现"，写 SQL 版时行为要对齐它。
数据要**按 block_index 升序**返回（前端左右联动依赖顺序），并用 dict 保序。
"""
from __future__ import annotations

from typing import Any


class InMemoryStore:
    """所有实体共用一个内存字典（key = 实体名）。"""

    def __init__(self) -> None:
        self.reports: dict[str, Any] = {}
        self.blocks: dict[str, Any] = {}
        self.claims: dict[str, Any] = {}
        self.findings: dict[str, Any] = {}
        self.tasks: dict[str, Any] = {}
        self.stages: dict[str, Any] = {}

    def reset(self) -> None:
        self.__init__()      # type: ignore[misc]
