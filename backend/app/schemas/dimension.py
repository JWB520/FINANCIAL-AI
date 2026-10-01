"""维度注册表契约（对应前端 endpoints/dimensions.ts）。

前端"发起任务"页的勾选项与"设置页"的判据都读它 —— 加维度只改 domain/dimensions.py，
这里不用动。
"""
from __future__ import annotations

from pydantic import BaseModel

from app.domain.enums import CheckMode, DimensionGroup, RequiredInput, RiskLevel
from app.schemas.common import CONTRACT_CONFIG


class DimensionOut(BaseModel):
    model_config = CONTRACT_CONFIG

    code: str
    name: str
    group: DimensionGroup
    description: str
    required_inputs: list[RequiredInput]
    enabled_in_modes: list[CheckMode]
    default_risk_level: RiskLevel | None = None
