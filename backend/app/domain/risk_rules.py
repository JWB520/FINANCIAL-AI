"""风险定级规则：显式、可版本化、纯函数（03_后端架构.md §2.2）。

【为什么不用模型直接给等级】等级必须可解释、可复现：同类问题永远同一等级。
模型只负责判"命中哪条规则"，等级由规则表算出来；规则表有版本号，
审计与结论卡片上都会带 rule_version。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import RiskLevel

DEFAULT_RULE_VERSION = "rv-2026.09"


@dataclass(frozen=True)
class RiskRule:
    code: str
    desc: str
    level: RiskLevel


RULES: dict[str, RiskRule] = {
    "CALC_MISMATCH": RiskRule("CALC_MISMATCH", "复算结果与原文数字不一致", RiskLevel.HIGH),
    "CALC_UNIT_ERROR": RiskRule("CALC_UNIT_ERROR", "单位或口径不一致", RiskLevel.MEDIUM),
    "FACT_NO_SOURCE": RiskRule("FACT_NO_SOURCE", "事实性表述没有出处", RiskLevel.MEDIUM),
    "FACT_CONFLICT": RiskRule("FACT_CONFLICT", "与数据源或原文冲突", RiskLevel.HIGH),
    "NORM_FORBIDDEN": RiskRule("NORM_FORBIDDEN", "命中禁用表达", RiskLevel.HIGH),
    "NORM_TONE": RiskRule("NORM_TONE", "表述不合内部写作规范", RiskLevel.LOW),
    "CONSISTENCY_CONFLICT": RiskRule("CONSISTENCY_CONFLICT", "前后表述自相矛盾", RiskLevel.MEDIUM),
}


def resolve_level(rule_codes: list[str], default: RiskLevel | None = None) -> RiskLevel | None:
    """由命中的规则取最高等级（这是唯一允许的定级入口）。"""
    levels = [RULES[c].level for c in rule_codes if c in RULES]
    if not levels:
        return default
    order = {RiskLevel.HIGH: 3, RiskLevel.MEDIUM: 2, RiskLevel.LOW: 1}
    return max(levels, key=lambda lv: order[lv])
