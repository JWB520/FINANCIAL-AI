"""契约对齐测试：拿前端的 types.ts 逐字段检查我们的响应模型。

【这个测试为什么值钱】字段名漂移是前后端联调最贵的 bug（页面永远空白、数字永远 0），
但两边都不会报错。这里把前端 types.ts 当唯一事实来源，直接比对字段名：
    TS 里有的字段，我们的模型必须有（缺一个 -> 这个测试红）
    我们额外加的字段只提示、不失败（避免挡住合理的补充）

已知坑（写过一次就记住了）：TS 有内联对象字段（如 Task.counters 里的五个数字），
朴素的逐行解析会把内联对象里的字段误当成外层接口的字段 —— 所以下面按大括号深度只取第一层。

跑法：python -m pytest tests/test_contract.py -q
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TYPES_TS = BACKEND_ROOT.parent / "frontend" / "src" / "api" / "types.ts"
CLIENT_TS = BACKEND_ROOT.parent / "frontend" / "src" / "api" / "client.ts"

# 需要严格对齐的核心实体：TS 接口名 -> (我们的模块名, 类名)
CORE_PAIRS = {
    "Report": ("report", "Report"),
    "ReportVersion": ("report", "ReportVersion"),
    "Block": ("report", "Block"),
    "Claim": ("claim", "Claim"),
    "Evidence": ("claim", "Evidence"),
    "Finding": ("claim", "Finding"),
    "CalcTrace": ("claim", "CalcTrace"),
    "Task": ("task", "Task"),
    "TaskStage": ("task", "TaskStage"),
    "ReviewAction": ("claim", "ReviewAction"),
}

# TS 里有、但故意不映射到响应模型的字段（前端内部用）
IGNORED_FIELDS = {"__row_key"}

# 前端词典里没有的后端专用错误码：每一条都要写明为什么可以例外
BACKEND_ONLY_CODES = {
    "NOT_IMPLEMENTED",          # 联调期新增：明确表示"接口还没做"，后端全部实现后可删
    "NOT_FOUND",                # 前端对 404 有统一兜底文案（页面级空态），不必单列提示
    "DELETE_REASON_REQUIRED",   # 前端表单已强制填理由；此码防的是绕过前端的调用
}


def _ts_interfaces():
    """抽出 types.ts 里 interface 名 -> 第一层字段名列表。"""
    if not TYPES_TS.exists():
        pytest.skip(f"找不到前端契约文件: {TYPES_TS}")
    text = TYPES_TS.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"export interface (\w+)(?:<[^>]*>)?\s*\{", text):
        name = m.group(1)
        rest = text[m.end():]
        depth = 1
        buf = []
        for ch in rest:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            buf.append(ch)
        fields = []
        inner = 0
        for line in "".join(buf).splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith(("//", "/*", "*")):
                continue
            if inner == 0:
                fm = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\??:", stripped)
                if fm:
                    fields.append(fm.group(1))
            inner += stripped.count("{") - stripped.count("}")
            if inner < 0:
                inner = 0
        out[name] = fields
    return out


def _model_fields(module, cls):
    import importlib

    model = getattr(importlib.import_module(f"app.schemas.{module}"), cls)
    fields = set(model.model_fields.keys())
    for f in model.model_fields.values():       # 别名也算（如 pass_ 的 alias="pass"）
        if f.alias:
            fields.add(f.alias)
    return fields


def test_core_entities_field_aligned():
    """核心实体的字段名必须与前端 types.ts 一致。"""
    ts = _ts_interfaces()
    problems = []
    for ts_name, (module, cls) in CORE_PAIRS.items():
        ts_fields = [f for f in ts.get(ts_name, []) if f not in IGNORED_FIELDS]
        if not ts_fields:
            problems.append(f"types.ts 里找不到 {ts_name}（测试本身要更新？）")
            continue
        missing = [f for f in ts_fields if f not in _model_fields(module, cls)]
        if missing:
            problems.append(f"{ts_name}(app.schemas.{module}.{cls}) 缺字段: {missing}")
    assert not problems, "字段漂移：\n  " + "\n  ".join(problems)


def test_enum_values_aligned():
    """枚举代号必须与前端 enums.ts 一致（这些值会存进库，改了就读不出来）。"""
    from app.domain.enums import FindingStatus, ReviewState, RiskLevel, StageCode, TaskKind, TaskStatus

    assert {s.value for s in FindingStatus} == {"pass", "risk", "uncovered", "error"}
    assert {s.value for s in RiskLevel} == {"high", "medium", "low"}
    assert {s.value for s in TaskStatus} == {
        "pending", "running", "completed", "partial_failed", "failed", "cancelled",
    }
    assert {s.value for s in StageCode} == {
        "parse", "claim_split", "claim_classify", "check", "aggregate",
    }
    assert {s.value for s in TaskKind} == {"errata", "assessment"}
    assert {s.value for s in ReviewState} == {"pending", "accepted", "rejected", "verified", "edited"}


def test_error_codes_aligned_with_frontend():
    """错误码要么在前端 client.ts 的词典里，要么在已知例外清单里。"""
    from app.api.errors import ApiErrorCode

    if not CLIENT_TS.exists():
        pytest.skip(f"找不到前端 client.ts: {CLIENT_TS}")
    text = CLIENT_TS.read_text(encoding="utf-8")
    ours = [v for k, v in vars(ApiErrorCode).items() if not k.startswith("_") and isinstance(v, str)]
    unknown = [c for c in ours if c not in text and c not in BACKEND_ONLY_CODES]
    assert not unknown, f"这些错误码前端不认识、也不在例外清单里: {unknown}"
