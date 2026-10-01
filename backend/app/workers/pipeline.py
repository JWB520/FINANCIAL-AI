"""阶段机驱动：按顺序执行五个阶段、重试、断点续跑（后端的心脏）。

实现要点（03_后端架构.md §3.2~§3.4）：
  1. 启动时先读全部 TaskStage，**跳过 done/skipped**，只跑未完成的 —— 这是"断点续跑"，
     任务中断后重跑不会重复调模型（省费用、也避免重复结论）；
  2. 每个阶段开始/结束都写审计事件（stage_start / stage_end），并推一条 stage 事件；
  3. 失败按 settings.stage_retry_limit 重试；不可重试的失败 -> 任务终态 partial_failed/failed；
  4. check 阶段用并发（settings.check_concurrency），但**不要并发写同一张表**；
  5. 阶段产物落库后再推 counters 事件（否则前端数字领先于数据）。
"""
from __future__ import annotations

from app.domain.enums import StageCode

STAGE_ORDER: tuple[StageCode, ...] = (
    StageCode.PARSE,
    StageCode.CLAIM_SPLIT,
    StageCode.CLAIM_CLASSIFY,
    StageCode.CHECK,
    StageCode.AGGREGATE,
)


class Pipeline:
    async def run(self, task_id: str) -> None:
        raise NotImplementedError("Pipeline.run")

    async def run_stage(self, task_id: str, stage: StageCode) -> None:
        raise NotImplementedError("Pipeline.run_stage")
