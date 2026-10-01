"""领域层纯逻辑测试：不连数据库、不调模型，直接算。

这几条对应"口径"，前端三个页面用的是同一套数字，所以这里错了会三处一起错。
"""
from __future__ import annotations


def test_coverage_excludes_uncovered_and_error() -> None:
    """覆盖率 = 有结论(通过+有问题) / 总数；未覆盖与失败都不算有结论。"""
    from app.domain.coverage import coverage_from_statuses
    from app.domain.enums import FindingStatus as S

    assert coverage_from_statuses([S.PASS, S.RISK, S.UNCOVERED, S.ERROR]) == 0.5
    assert coverage_from_statuses([]) == 0.0          # 不许除零、也不许 NaN
    assert coverage_from_statuses([S.PASS, S.PASS]) == 1.0


def test_risk_level_comes_from_rule_table() -> None:
    """风险等级由规则表算：命中规则取最高级；没命中才用维度默认值。"""
    from app.domain.enums import RiskLevel
    from app.domain.risk_rules import resolve_level

    assert resolve_level(["CALC_UNIT_ERROR", "NORM_TONE"]) == RiskLevel.MEDIUM
    assert resolve_level(["CALC_MISMATCH", "NORM_TONE"]) == RiskLevel.HIGH
    assert resolve_level([], default=RiskLevel.LOW) == RiskLevel.LOW
    assert resolve_level(["不存在的码"]) is None


def test_dimension_registry_consistency() -> None:
    """维度注册表自检：代号唯一、check 维度有默认等级、quality 维度没有等级。"""
    from app.domain.dimensions import DIMENSIONS
    from app.domain.enums import DimensionGroup

    codes = [d.code for d in DIMENSIONS]
    assert len(codes) == len(set(codes)), "维度代号重复了"
    assert {d.code for d in DIMENSIONS} >= {"calc", "fact", "norm"}, "P0 三维度必须在注册表里"
    for d in DIMENSIONS:
        if d.group == DimensionGroup.CHECK:
            assert d.default_risk_level is not None, f"{d.code} 是核查维度，应有默认等级"
        else:
            assert d.default_risk_level is None, f"{d.code} 是质量维度，不该有风险等级"
