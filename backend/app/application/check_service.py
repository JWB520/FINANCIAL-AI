"""核查用例：调度各维度 Checker、并发、汇总 Finding（阶段 check）。

对应阶段：StageCode.CHECK
实现要点（03_后端架构.md §3.4）：
  - 并发上限取 settings.check_concurrency；
  - 缺资料的维度不要跳过，要产出 status=uncovered + uncovered_reason；
  - 每产出一条结论就更新 counters 并推一条 counters 事件（前端进度条靠它）。
"""
from __future__ import annotations

from typing import Any


class CheckService:
    async def run_dimensions(self, task_id: str, batch_id: str, dimensions: list[str]) -> list[Any]:
        raise NotImplementedError("CheckService.run_dimensions")
