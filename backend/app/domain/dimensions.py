"""维度注册表：加维度只改这里（03_后端架构.md §2.1）。

每个维度声明：代号 / 名字 / 分组 / 说明 / 依赖资料 / 在哪些模式可用 / 常见等级。
- group=check 的维度"找问题"，结论带风险等级；
- group=quality 的维度"评整体质量"，结论不带风险等级（前端评估页就是这么显示的）。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import CheckMode, DimensionGroup, RequiredInput, RiskLevel


@dataclass(frozen=True)
class Dimension:
    code: str
    name: str
    group: DimensionGroup
    description: str
    required_inputs: tuple[RequiredInput, ...] = ()
    enabled_in_modes: tuple[CheckMode, ...] = (CheckMode.QUICK, CheckMode.DEEP)
    default_risk_level: RiskLevel | None = None
    checker_key: str = ""            # 对应 agents/ 下的 Checker 实现（registry.py 用它实例化）
    prompt_key: str | None = None    # 对应 agents/prompts/ 下的提示词


DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(
        code="calc",
        name="计算核查",
        group=DimensionGroup.CHECK,
        description="复算报告里的关键数字，看算式与结论对不对得上",
        required_inputs=(),
        default_risk_level=RiskLevel.HIGH,
        checker_key="calculator_checker",
        prompt_key="extract_numbers",
    ),
    Dimension(
        code="fact",
        name="事实核查",
        group=DimensionGroup.CHECK,
        description="核对事实性表述是否有出处，关键财务数据是否与数据源一致",
        required_inputs=(RequiredInput.MARKET_DATA,),
        default_risk_level=RiskLevel.HIGH,
        checker_key="fact_checker",
        prompt_key="verify_fact",
    ),
    Dimension(
        code="norm",
        name="规范核查",
        group=DimensionGroup.CHECK,
        description="按内部写作规范与禁用表达检查表述合规性",
        required_inputs=(RequiredInput.INTERNAL_NORM,),
        default_risk_level=RiskLevel.MEDIUM,
        checker_key="compliance_checker",
        prompt_key="check_compliance",
    ),
    Dimension(
        code="valuation",
        name="估值核查",
        group=DimensionGroup.CHECK,
        description="核对估值方法、假设与参数是否符合估值规则库",
        required_inputs=(RequiredInput.VALUATION_RULES,),
        default_risk_level=RiskLevel.MEDIUM,
        checker_key="valuation_checker",
    ),
    Dimension(
        code="consistency",
        name="一致性核查",
        group=DimensionGroup.CHECK,
        description="同一篇报告内部前后是否自相矛盾",
        required_inputs=(),
        default_risk_level=RiskLevel.MEDIUM,
        checker_key="consistency_checker",
    ),
    Dimension(
        code="quality_logic",
        name="逻辑质量",
        group=DimensionGroup.QUALITY,
        description="论证链是否完整、结论有没有数据或来源支撑",
        checker_key="quality_assessor",
    ),
    Dimension(
        code="quality_data",
        name="数据支撑",
        group=DimensionGroup.QUALITY,
        description="关键数字是否有出处、现金流与利润是否匹配",
        required_inputs=(RequiredInput.MARKET_DATA,),
        checker_key="quality_assessor",
    ),
    Dimension(
        code="quality_risk",
        name="风险披露",
        group=DimensionGroup.QUALITY,
        description="风险提示是否覆盖需求、供给、成本等主要风险",
        checker_key="quality_assessor",
    ),
    Dimension(
        code="quality_cross",
        name="观点交叉验证",
        group=DimensionGroup.QUALITY,
        description="与同业观点是否明显偏离、是否存在没说明理由的独家判断",
        required_inputs=(RequiredInput.EXTERNAL_REPORTS,),
        checker_key="quality_assessor",
    ),
)

DIMENSION_BY_CODE = {d.code: d for d in DIMENSIONS}


def get_dimension(code: str) -> Dimension:
    """取维度定义；未知代号直接 KeyError（不要静默兜底成默认维度）。"""
    return DIMENSION_BY_CODE[code]


def dimensions_for_mode(mode: CheckMode) -> list[Dimension]:
    """按模式筛出可用维度（quick 只跑最硬的几类）。"""
    return [d for d in DIMENSIONS if mode in d.enabled_in_modes]


def check_dimensions() -> list[Dimension]:
    return [d for d in DIMENSIONS if d.group == DimensionGroup.CHECK]


def quality_dimensions() -> list[Dimension]:
    return [d for d in DIMENSIONS if d.group == DimensionGroup.QUALITY]
