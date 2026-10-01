"""覆盖率与计数口径（纯函数，必须可单测）。

口径写死在文档里（BACKEND.md §4.4）：
    覆盖率 = 有结论的条数 / 主张总数，"未覆盖"与"核查失败"**都不算有结论**。
前端左栏、工作台、评估页用的是同一个口径；这里改口径 = 三个页面对不上。
"""
from __future__ import annotations

from app.domain.enums import FindingStatus


def is_covered(status: FindingStatus) -> bool:
    """有结论 = 通过 或 有问题（未覆盖/失败都不算）。"""
    return status in (FindingStatus.PASS, FindingStatus.RISK)


def coverage_rate(covered: int, total: int) -> float:
    """总数为 0 时返回 0.0（不要除零、也不要返回 NaN）。"""
    return round(covered / total, 4) if total else 0.0


def coverage_from_statuses(statuses: list[FindingStatus]) -> float:
    return coverage_rate(sum(1 for s in statuses if is_covered(s)), len(statuses))


def review_progress(reviewed: int, total: int) -> float:
    """复核进度 = 已裁决条数 / 待复核总数（不是覆盖率，别混用）。"""
    return round(reviewed / total, 4) if total else 0.0
