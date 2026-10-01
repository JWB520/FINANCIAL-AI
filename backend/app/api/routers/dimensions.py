"""维度注册表路由（对应前端 endpoints/dimensions.ts）。

这条接口驱动两处界面：发起任务页的勾选项、设置页的核查判据。
数据来自 app/domain/dimensions.py（加维度只改那一处），所以这个路由几乎不用动。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.domain.dimensions import DIMENSIONS
from app.schemas.dimension import DimensionOut

router = APIRouter(tags=["维度"])


@router.get("/dimensions", response_model=list[DimensionOut], summary="维度注册表")
async def list_dimensions() -> list[DimensionOut]:
    """返回全部维度（含 required_inputs / enabled_in_modes）。

    这个实现只有一行转换 —— 领域层的 DIMENSIONS 就是唯一事实来源。
    """
    return [
        DimensionOut(
            code=d.code,
            name=d.name,
            group=d.group,
            description=d.description,
            required_inputs=list(d.required_inputs),
            enabled_in_modes=list(d.enabled_in_modes),
            default_risk_level=d.default_risk_level,
        )
        for d in DIMENSIONS
    ]
