"""队列任务入口（薄壳）：只做"取任务 -> 调 application 用例 -> 写终态"。

真正的阶段编排在 workers/pipeline.py；这里保持薄，方便在测试里直接调 application 层。
"""
from __future__ import annotations


def run_task(task_id: str) -> None:
    """跑一条核查任务的全部阶段（幂等：重复投递不会重复扣模型费用）。"""
    raise NotImplementedError("run_task")
