"""复算器：把一句自然语言里抽出来的算式**在本地算出来**，并给出逐步过程。

【为什么必须有这一层，而不是让模型直接说结果】
  "模型不许直接算数"是本项目的硬红线（03_后端架构.md §6）：模型只负责把
  自然语言翻译成算式（B 跑道 checker 的活），算数必须由工具做。
  只有这样，结论才能"可复算"——用户点开核算过程，看到的每一步都能自己验算；
  评审查"这个数怎么来的"时，回答是"3.14/2=1.57，不是我猜的"。

【安全】用 ast 白名单解析，不 eval：
  只允许 数字 / + - * / ** // % / 一元负号 / 括号。
  任何函数调用、属性访问、下划线名一律拒绝 —— 提示词里的算式是模型给的，
  不能信任它（提示注入 / 瞎编都可能导致 eval 出任意代码）。
"""
from __future__ import annotations

import ast
import operator
import re
from typing import Any

MAX_EXPR_LEN = 500
MAX_NODES = 200

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SYM = {
    ast.Add: "+",
    ast.Sub: "-",
    ast.Mult: "×",
    ast.Div: "÷",
    ast.FloorDiv: "//",
    ast.Mod: "%",
    ast.Pow: "^",
}

# 全角/排版字符 -> 可计算的 ASCII
_NORMALIZE_MAP = str.maketrans(
    {
        "×": "*", "✕": "*", "⋅": "*", "·": "*",
        "÷": "/", "／": "/",
        "－": "-", "−": "-", "—": "-", "–": "-",
        "＋": "+", "＝": "=", "（": "(", "）": ")",
        "％": "%", "，": ",", "。": ".", "　": " ",
    }
)

# 千分位逗号：1,234.5 -> 1234.5（只在数字之间出现时才删，避免误伤 1,2 这种列表）
_THOUSAND_SEP = re.compile(r"(?<=\d),(?=\d{3}\b)")
# 百分号：12.3% -> (12.3/100)，参与运算时才是这个语义
_PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")


class CalcError(ValueError):
    """算式不可计算（语法错 / 含不允许的节点 / 除零）。"""


def normalize_expression(raw: str) -> str:
    """把模型给的算式归一化成纯 ASCII 可计算形式。"""
    if not raw:
        return ""
    text = raw.strip().translate(_NORMALIZE_MAP)
    text = _THOUSAND_SEP.sub("", text)
    text = _PERCENT.sub(r"(\1/100)", text)
    # 去掉尾部的等号与单位（模型常写 "120/30 = 4 倍"）
    text = text.split("=")[0].strip()
    text = re.sub(r"(倍|个百分点|万元|亿元|元|%)\s*$", "", text).strip()
    return text


def _fmt(value: float) -> str:
    """数字显示：整数不带小数点，小数最多 6 位并去掉尾随 0。"""
    if isinstance(value, int):
        return str(value)
    if abs(value - round(value)) < 1e-12 and abs(value) < 1e15:
        return str(int(round(value)))
    text = f"{round(value, 6):.6f}".rstrip("0").rstrip(".")
    return text or "0"


def _count_nodes(node: ast.AST) -> int:
    return sum(1 for _ in ast.walk(node))


def _fold(node: ast.AST, steps: list[dict[str, Any]]) -> float:
    """递归折叠求值，同时把每个二元运算记成一步（这就是"核算过程"）。"""
    if isinstance(node, ast.Expression):
        return _fold(node.body, steps)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int | float):
            raise CalcError(f"算式里出现了非数字常量：{node.value!r}")
        return float(node.value)
    if isinstance(node, ast.UnaryOp):
        operand = _fold(node.operand, steps)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
        raise CalcError("只支持一元正负号")
    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in _BIN_OPS:
            raise CalcError(f"不支持的运算符：{op_type.__name__}")
        left = _fold(node.left, steps)
        right = _fold(node.right, steps)
        if op_type in (ast.Div, ast.FloorDiv, ast.Mod) and abs(right) < 1e-15:
            raise CalcError("除数不能为 0")
        try:
            value = _BIN_OPS[op_type](left, right)
        except ZeroDivisionError as exc:  # pragma: no cover - 上面已拦
            raise CalcError("除数不能为 0") from exc
        expression = f"{ast.unparse(node.left)}{_SYM[op_type]}{ast.unparse(node.right)}"
        steps.append(
            {
                "step": len(steps) + 1,
                "expression": expression,
                "value": _fmt(value),
                "value_raw": float(value),
            }
        )
        return float(value)
    raise CalcError(f"算式里出现了不允许的内容：{type(node).__name__}")


def evaluate(expression: str) -> dict[str, Any]:
    """算一个算式。

    返回（永远不抛，失败用 ok=False 表达，方便批量跑）：
      {
        ok, expression(原式), normalized(归一化后), result(float|None),
        display(展示用结果字符串), steps[{step,expression,value,value_raw}], error
      }
    """
    out: dict[str, Any] = {
        "ok": False,
        "expression": expression,
        "normalized": "",
        "result": None,
        "display": "",
        "steps": [],
        "error": "",
    }
    if not expression or not expression.strip():
        out["error"] = "空算式"
        return out

    normalized = normalize_expression(expression)
    out["normalized"] = normalized
    if not normalized:
        out["error"] = "归一化后为空"
        return out
    if len(normalized) > MAX_EXPR_LEN:
        out["error"] = "算式过长"
        return out
    if "=" in normalized:
        out["error"] = "算式里含等号（只接受纯算式，结果由本地计算）"
        return out

    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as exc:
        out["error"] = f"算式语法错误：{exc.msg}"
        return out

    if _count_nodes(tree) > MAX_NODES:
        out["error"] = "算式过于复杂"
        return out

    try:
        steps: list[dict[str, Any]] = []
        value = _fold(tree, steps)
    except CalcError as exc:
        out["error"] = str(exc)
        return out
    except (OverflowError, ValueError, TypeError) as exc:  # pragma: no cover
        out["error"] = f"计算失败：{exc}"
        return out

    if value != value or value in (float("inf"), float("-inf")):  # NaN / Inf
        out["error"] = "计算结果不是有效数字"
        return out

    out["ok"] = True
    out["result"] = float(value)
    out["display"] = _fmt(value)
    out["steps"] = steps
    return out


def compare(computed: float, claimed: float, *, rel_tol: float = 5e-3, abs_tol: float = 1e-3) -> dict[str, Any]:
    """比较"本地算出来的值"与"原文声称的值"。

    容差为什么不能是 0：研报里的数字普遍做过四舍五入（12.28% 写成 12.3%），
    零容差会把正常修约全判成错，那这个功能就没人信了。
    默认 相对 0.5% / 绝对 0.001 —— 超过它才算"复算不一致"。
    """
    deviation = computed - claimed
    base = abs(claimed) if abs(claimed) > 1e-12 else None
    rel_deviation = (abs(deviation) / base) if base else None
    consistent = abs(deviation) <= abs_tol or (rel_deviation is not None and rel_deviation <= rel_tol)
    return {
        "computed": computed,
        "claimed": claimed,
        "deviation": deviation,
        "rel_deviation": rel_deviation,
        "rel_tol": rel_tol,
        "abs_tol": abs_tol,
        "consistent": consistent,
    }
