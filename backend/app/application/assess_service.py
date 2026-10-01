"""评估用例：报告级指标、优先级建议、参考分（阶段 aggregate + 评估接口）。

对应阶段：StageCode.AGGREGATE
实现要点：所有指标都是确定性计算（domain/coverage.py 的口径），不许让模型"感觉"一个分数；
        参考分只用于排序，未评估时是 null（不是 0）。
"""
from __future__ import annotations

from typing import Any


class AssessService:
    async def aggregate(self, report_id: str, batch_id: str) -> Any:
        raise NotImplementedError("AssessService.aggregate")
