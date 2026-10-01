"""领域枚举：与前端 src/api/enums.ts 的代号**逐字对齐**。

代号一旦上线就不能改名 —— 前端、审计日志、任务请求里存的全是这些字符串。
改这里的任何一个值，等于同时改前端：必须两边一起动（BACKEND.md §4 红线）。
"""
from __future__ import annotations

from enum import StrEnum


class RiskLevel(StrEnum):
    """风险等级。由 domain/risk_rules.py 的规则表算出，不是模型"感觉"出来的。"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class FindingStatus(StrEnum):
    """结论状态。注意：uncovered（未覆盖）≠ pass（通过）—— 产品红线。"""

    PASS = "pass"
    RISK = "risk"
    UNCOVERED = "uncovered"
    ERROR = "error"


class ClaimType(StrEnum):
    """主张类型（拆解阶段的分类结果）。"""

    CALC = "calc"
    FACT = "fact"
    VALUATION = "valuation"
    FORECAST = "forecast"
    NORM = "norm"
    JUDGEMENT = "judgement"


class DimensionGroup(StrEnum):
    CHECK = "check"        # 核查维度：找问题
    QUALITY = "quality"    # 质量评估维度：评整体质量（结论不带风险等级）


class CheckMode(StrEnum):
    QUICK = "quick"
    DEEP = "deep"


class RequiredInput(StrEnum):
    """维度依赖的资料。缺资料时该维度必须返回 uncovered（带原因），不许假装通过。"""

    INTERNAL_NORM = "internal_norm"
    EXTERNAL_REPORTS = "external_reports"
    MARKET_DATA = "market_data"
    VALUATION_RULES = "valuation_rules"
    CASE_LIBRARY = "case_library"


class TaskKind(StrEnum):
    """任务类型。前端靠它决定"查看结果"去勘误界面还是评估界面。"""

    ERRATA = "errata"
    ASSESSMENT = "assessment"


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL_FAILED = "partial_failed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StageCode(StrEnum):
    """流水线五个阶段，顺序即执行顺序（workers/pipeline.py 按这个顺序驱动）。"""

    PARSE = "parse"
    CLAIM_SPLIT = "claim_split"
    CLAIM_CLASSIFY = "claim_classify"
    CHECK = "check"
    AGGREGATE = "aggregate"


class StageStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class ReviewActionType(StrEnum):
    ACCEPT = "accept"
    REJECT = "reject"          # 必须带 reason（它是系统学习的原料，不许跳过）
    VERIFY = "verify"
    ADD_EVIDENCE = "add_evidence"
    MANUAL_EDIT = "manual_edit"


class ReviewState(StrEnum):
    PENDING = "pending"        # 没有人工动作时，生效结论是"待复核"而不是"通过"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    VERIFIED = "verified"
    EDITED = "edited"


class EvidenceType(StrEnum):
    KB_CHUNK = "kb_chunk"
    DATA_SOURCE = "data_source"
    IN_TEXT = "in_text"
    CALC = "calc"
    EXTERNAL_REPORT = "external_report"


class AuditEventType(StrEnum):
    STAGE_START = "stage_start"
    STAGE_END = "stage_end"
    LLM_CALL = "llm_call"
    TOOL_CALL = "tool_call"
    REVIEW_ACTION = "review_action"
    RULE_PUBLISH = "rule_publish"
