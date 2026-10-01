"""任务用例：建任务、校验维度依赖、投队列、终止、单阶段重试。

对应路由：app/api/routers/tasks.py
"""
from __future__ import annotations

from typing import Any

from app.domain.entities import Task


class TaskService:
    async def create(self, **fields: Any) -> Task:
        """★ P0-2：校验维度依赖（缺资料抛 TASK_MISSING_INPUTS）-> 建任务 -> 投队列。

        实现要点：
          - 同报告已有运行中任务 -> TASK_ALREADY_RUNNING；
          - 任务要带上 kind（errata/assessment）与 counters 的初始值；
          - stages 五条（parse/claim_split/claim_classify/check/aggregate）一次建好，全部 pending。
        """
        raise NotImplementedError("TaskService.create")

    async def get(self, task_id: str) -> Task:
        """★ P0-3：进度页快照（要便宜）。未知 id 抛 404。"""
        raise NotImplementedError("TaskService.get")

    async def cancel(self, task_id: str) -> Task:
        raise NotImplementedError("TaskService.cancel")

    async def retry_stage(self, task_id: str, stage_code: str) -> Any:
        """只有 failed 的阶段可重试，否则 STAGE_NOT_RETRYABLE。"""
        raise NotImplementedError("TaskService.retry_stage")
