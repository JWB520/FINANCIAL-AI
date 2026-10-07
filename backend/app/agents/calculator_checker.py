"""计算核查（P0）：抽数字 -> 复算 -> 比对。

对应维度：见 app/domain/dimensions.py 里 checker_key="calculator_checker" 的那一项。

【这条链路的分工（也是本实验的核心）】
   ① 筛句：规则找"含数字的句子"（不用模型，便宜且不漏）            —— common/text.py
   ② 提取：**大模型**把句子翻译成算式 + 声称值（extract_numbers 提示词）  —— 模型只做翻译
   ③ 复算：**本地复算器**算出来（infra/tools/calculator）              —— 模型不碰算数
   ④ 批注：**大模型**把"原文/复算值/偏差"整合成一条批注（write_annotation）

【两条降级路径（没有 API Key 也能跑，且不许假装 AI 跑过了）】
   · ② 失败（没 Key / 超时 / 返回不是 JSON）→ 用**规则提取器**兜底：只认
     "由 A 增至 B，增长 C%" 这种句式，自己构造算式 (B-A)/A*100 再复算。
   · ④ 失败 → 用模板拼批注（逻辑与模型写的一致，只是话术朴素）。

【规则模式为什么"只报一致、不报不一致"】
   规则提取的算式是猜出来的（它看不懂句子，只能套句式），猜错了就会误报"复算不一致"。
   误报比漏报更伤信任，所以规则模式下**只有算出来与原文一致才产出结论**，
   算不出/不匹配就老实不产出（由上层统计成"未覆盖"）。
   模型模式读懂了句子才敢断言不一致 —— 这是 ② 存在的意义。
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from app.agents.base import BaseChecker, CheckContext, FindingDraft
from app.common.text import split_sentences
from app.domain.enums import FindingStatus, RiskLevel
from app.domain.risk_rules import resolve_level
from app.infra.tools import calculator

# --------------------------- 规则提取用的正则 ---------------------------

# 百分比数值（结果）
_PERCENT_VALUE = re.compile(r"(-?\d[\d,]*(?:\.\d+)?)\s*%")
# 任意数值（含千分位与小数）
_ANY_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
# "由 A ... 增至 B" 句式（A、B 都是绝对量）
_FROM_TO = re.compile(
    r"(?:由|从)\s*(-?\d[\d,]*(?:\.\d+)?)\s*[^，。；,;]{0,8}?"
    r"(?:增至|增长至|提升至|上升至|增加至|升至|达到|回落至|下降至|减少至|降至|下滑至)\s*"
    r"(-?\d[\d,]*(?:\.\d+)?)"
)
# 增长/下降的动词（决定 (B-A) 还是 (A-B)）
_RISING = re.compile(r"(增长|上升|提升|增加|增至|升至|达到|提高)")
_FALLING = re.compile(r"(下降|减少|回落|下滑|降低|降至)")

# 数值 token（含千分位与小数）——本地硬校验用
_NUM_TOKEN = re.compile(r"-?\d[\d,]*(?:\.\d+)?")

# 允许出现在算式里、但原文不一定要写出来的换算常量
_CANON_CONSTANTS = (0.0, 1.0, 100.0, 10000.0)


def _same(a: float, b: float) -> bool:
    """两个数是否"同一个数"（按绝对值比）。

    为什么要取绝对值：从算式里抽数字时，`(1.45-1.20)` 会把减号读成负号抽出 `-1.20`，
    而原文写的是正数 1.20 —— 不取绝对值就会把正常的减式全判成"用到了原文没有的数字"，
    等于把功能关掉（实测踩到，测试直接红）。
    """
    return abs(abs(a) - abs(b)) < 1e-9


def _numbers_in(text: str) -> list[float]:
    """把一段文字里的数值全部抽出来（用于"这个数原文到底有没有写"的核对）。"""
    out: list[float] = []
    for match in _NUM_TOKEN.finditer(text or ""):
        try:
            out.append(float(match.group(0).replace(",", "")))
        except ValueError:
            continue
    return out


def validate_item(item: dict[str, Any], sentence: str, context: str = "") -> tuple[bool, str]:
    """本地硬校验：模型说的每个数字，都必须在**原文里逐字出现**。

    【三档严格程度，逐条对应实测踩到的坑】
      · 声称值（claimed）→ 必须在**重点句子**里出现。模型自己算一个数当"原文写的"，
        会变成"自己跟自己对账"（例：原文写 59.6%，它算出 31.51 当声称值，本地复算又得 31.51 →
        判"一致"，纯属废话）。
      · 算式用到的数字 → 允许来自重点句子 **或**上下文（真实研报的基数常写在上一句），
        但不许来自"文中根本没有"（模型凭记忆编的行业数据、上年真值）。
      · 声称值不得等于算式里的操作数（拿输入比输入，比对本身没有意义）。

    【为什么结论正确性不能只靠提示词】提示词能压住大部分，但这类"这句话里有没有这个数"
      是可以**客观判定**的 —— 凡是能客观判定的，一律在本地判，不赌模型听话。
    """
    if not sentence:
        return False, "没有重点句子"
    sentence_numbers = _numbers_in(sentence)
    if not sentence_numbers:
        return False, "重点句子里没有数字"
    allowed_numbers = sentence_numbers + _numbers_in(context)

    claimed = float(item.get("claimed"))
    # ① 声称值必须是**重点句子**里出现过的数
    if not any(_same(claimed, value) for value in sentence_numbers):
        return False, f"声称值 {claimed} 不在重点句子里（疑似模型自己算出来的）"

    # ② 算式用到的数字（换算常量除外）必须在"句子 + 上下文"里找得到
    expression_numbers = _numbers_in(str(item.get("expression") or ""))
    if len(expression_numbers) < 2:
        return False, "算式里的数字少于两个"
    foreign = [
        value
        for value in expression_numbers
        if not any(_same(value, allowed) for allowed in _CANON_CONSTANTS)
        and not any(_same(value, value_in_text) for value_in_text in allowed_numbers)
    ]
    if foreign:
        return False, f"算式用到了原文里没有的数字：{foreign}"

    # ③ 声称值不能就是算式里的操作数（拿输入比输入，比对本身没有意义）
    if any(_same(claimed, value) for value in expression_numbers):
        return False, "声称值与算式中的操作数相同，比对没有意义"

    return True, ""


def item_scope(item: dict[str, Any], sentence: str) -> str:
    """这条算式的输入是否**全部**来自重点句子。

    sentence：句内就能自证（可信，允许报"不一致"）
    context ：借用了上下文里的基数（跨句推断，更容易张冠李戴 → 只报"一致"，见 verdict）
    """
    sentence_numbers = _numbers_in(sentence)
    expression_numbers = _numbers_in(str(item.get("expression") or ""))
    for value in expression_numbers:
        if any(_same(value, allowed) for allowed in _CANON_CONSTANTS):
            continue
        if not any(_same(value, inside) for inside in sentence_numbers):
            return "context"
    return "sentence"


def dedupe_items(items: list[dict[str, Any]], per_claim_limit: int = 2) -> list[dict[str, Any]]:
    """同一句话里去掉重复算式，并限制条数（防止一句话刷出七八条同义批注）。"""
    seen: set[tuple[str, float]] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        key = (str(item.get("expression") or ""), float(item.get("claimed") or 0))
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= per_claim_limit:
            break
    return out


def _to_float(raw: str) -> float | None:
    try:
        return float(str(raw).replace(",", ""))
    except (TypeError, ValueError):
        return None


def rule_recall(text: str) -> list[dict[str, Any]]:
    """规则提取器：从一句话里找**可复算且方向明确**的量。

    只做两类：
      A. "由 A 增至 B，…增长 C%"  → (B-A)/A*100
      B. 句子里恰好两个数 a、b 且有一个百分比 c → 四个候选算式里哪个对得上就用哪个
         （方向穷举，不匹配就放弃，绝不硬报）
    """
    if not text:
        return []

    percent_values = [_to_float(m.group(1)) for m in _PERCENT_VALUE.finditer(text)]
    percent_values = [v for v in percent_values if v is not None]
    if not percent_values:
        return []
    claimed = percent_values[0]

    items: list[dict[str, Any]] = []

    # ---- A. 由 A 增至 B ----
    match = _FROM_TO.search(text)
    if match:
        a = _to_float(match.group(1))
        b = _to_float(match.group(2))
        if a not in (None, 0) and b is not None:
            expression = f"({b}-{a})/{a}*100"
            if _RISING.search(text) and not _FALLING.search(text[: match.start()]):
                items.append(
                    {
                        "expression": expression,
                        "claimed": claimed,
                        "unit": "%",
                        "statement": text,
                        "tolerance_pct": 0.5,
                        "source": "rule",
                        "why": f"由 {a} 变到 {b}，按 (B-A)/A 复算增速",
                    }
                )

    # ---- B. 两个数 + 一个百分比：穷举四个方向 ----
    numbers = [_to_float(m.group(0)) for m in _ANY_NUMBER.finditer(text)]
    numbers = [n for n in numbers if n is not None]
    # 去掉那个百分比数字本身（它已经被当作结果）
    body = [n for n in numbers if abs(n - claimed) > 1e-9]
    if len(body) >= 2:
        a, b = body[0], body[1]
        candidates = [
            (f"({b}-{a})/{a}*100", "期末/期初 增速"),
            (f"({a}-{b})/{b}*100", "反向 增速"),
            (f"{a}/{b}*100", "占比"),
            (f"{b}/{a}*100", "占比（反向）"),
        ]
        for expression, why in candidates:
            result = calculator.evaluate(expression)
            if not result["ok"]:
                continue
            compared = calculator.compare(float(result["result"]), claimed)
            if compared["consistent"]:
                items.append(
                    {
                        "expression": expression,
                        "claimed": claimed,
                        "unit": "%",
                        "statement": text,
                        "tolerance_pct": 0.5,
                        "source": "rule",
                        "why": why,
                    }
                )
                break
    return items


# ============================================================================
# 「本句自证」通道：算式要用到的数**全在这一句里**、方向唯一确定 —— 这类算不平就是原文有错
#
# 【为什么必须单独有这条路】模型看一句话只挑它认得的 1~2 组关系（实测：一页十几句带数字，
# 它只给一两条），而"两占比之和=100%""分项之和=合计"这类**根本不需要模型参与**：
# 句子里就把方程写全了。以前 `recall()` 写的是 `if items: return items`，
# 模型一有产出规则通道就永远不跑 —— 等于这条确定性通道形同虚设。
#
# 【实测教训（用户植入错误）】原文「收入分别为 20.11/13.04 亿元，占比 60.67%/39.33%」
# 被改成 55.00%/39.33%：55.00+39.33=94.33≠100，且 20.11÷(20.11+13.04)=60.66≠55.00，
# 双重自证矛盾本可一击命中，却因为"模型分母挑错(用 28.78) → 复核判我方配错"整条被排掉。
# ============================================================================

# ① 两个分项 + 两个占比：「…收入分别为 20.11/13.04 亿元，占比 60.67%/39.33%」
_SPLIT_SHARE = re.compile(
    r"([\d,]+(?:\.\d+)?)\s*/\s*([\d,]+(?:\.\d+)?)"  # 两个分项
    r"[^。；;]{0,20}?占比\s*(-?[\d,]+(?:\.\d+)?)\s*%\s*/\s*"  # 第一个占比
    r"(-?[\d,]+(?:\.\d+)?)\s*%"  # 第二个占比
)
# ② 分项之和 = 合计：「A、B 分别为 x、y，合计 T」
_SPLIT_TOTAL = re.compile(
    r"([\d,]+(?:\.\d+)?)\s*[、,，和及与]\s*([\d,]+(?:\.\d+)?)"
    r"(?:\s*[、,，和及与]\s*([\d,]+(?:\.\d+)?))?"
    r"[^。；;]{0,16}?(?:合计|共计|总计|合共)\s*(?:为|达|约|是)?\s*([\d,]+(?:\.\d+)?)"
)
# 出现这些词时"增速"口径本身就可疑（两年复合？含其他分项？）→ 不在这条通道下结论
_AMBIGUOUS_GROWTH = re.compile(r"两年|复合|年均|累计|CAGR|折合|合计|共计|总计")


def _fmt(value: float) -> str:
    """展示用数字：去掉浮点尾巴（60.663170 → 60.6632）。"""
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def self_contained_recall(text: str) -> list[dict[str, Any]]:
    """只做"整句自证"的关系：输入全在本句、方向唯一 —— 算不平即原文有错。

    产出条目的 `source` 固定为 `rule_selfcontained`，因此：
      · `item_scope` 会把它判成 `sentence`（输入都在句内）→ 判定链自动给"不一致 = 有问题"；
      · 服务端**不把它交给模型复核**（算术结论不该由模型投票推翻，见 collect_review_candidates）；
      · 备注由本地算出来（`why`），不假装是模型复核的结论。

    【两处踩过的坑，都在下面那条循环里】
      · 必须**逐句**做（先切句再匹配）：按整页做时，同一句里多组"由 A 增至 B + 百分比"
        会配对错（实测把 223% 配给 1.71→4.26，报了误报）；而且批注的"原文"会变成整页文本、
        版面框会框住一大片，卡片上没法看。
      · 必须**逐个匹配**（finditer），不能只 `search` 第一个：一页里第二句同型的话就永远查不到
        （实测：第 1 句先被匹配，第 2 句的错值 55.0% 整段漏掉）。
    """
    if not text:
        return []
    items: list[dict[str, Any]] = []
    for sentence in split_sentences(text):
        items.extend(_self_contained_in_sentence(sentence))
    return items


def _self_contained_in_sentence(text: str) -> list[dict[str, Any]]:
    """一句话里的自证关系（① 占比互补 / ② 分项合计 / ③ 同句增速）。

    参数名沿用 `text`，但调用方保证它**只是一句** —— 下面三条规则都依赖这个前提（配对才可靠）。
    """
    if not text:
        return []
    items: list[dict[str, Any]] = []

    # ---- ① 两分项 + 两占比：分母就是两分项之和（本句自证），顺带查"两占比之和 = 100%" ----
    for match in _SPLIT_SHARE.finditer(text):
        first, second = match.group(1), match.group(2)
        a, b = _to_float(first), _to_float(second)
        p1, p2 = _to_float(match.group(3)), _to_float(match.group(4))
        if not (a and b and p1 is not None and p2 is not None and (a + b)):
            continue
        for part, claimed, other, ordinal in ((first, p1, p2, "第一个"), (second, p2, p1, "第二个")):
            items.append(
                {
                    "expression": f"{part}/({first}+{second})*100",
                    "claimed": claimed,
                    "unit": "%",
                    "statement": text,
                    "tolerance_pct": 0.5,
                    "source": "rule_selfcontained",
                    "why": (
                        f"本句自证：{ordinal}分项 {part} 占两分项之和（{first}+{second}={_fmt(a + b)}）的比重，"
                        f"另一个占比为 {_fmt(other)}%；两个占比相加应为 100%，原文相加为 {_fmt(p1 + p2)}%"
                    ),
                }
            )

    # ---- ② 分项之和 = 合计 ----
    for match in _SPLIT_TOTAL.finditer(text):
        groups = [value for value in match.groups()[:3] if value is not None]
        parts = [_to_float(value) for value in groups]
        total = _to_float(match.group(4))
        # 防误报：匹配段里若还有别的数字，说明分项没列全（如"A、B、C、D 合计 T"只抓到两个），
        # 这时不下结论 —— 漏报好过报错。
        if total in (None, 0) or len(groups) < 2 or None in parts:
            continue
        if len(_numbers_in(match.group(0))) != len(parts) + 1:
            continue
        expression = "+".join(_fmt(value) for value in parts)  # type: ignore[arg-type]
        items.append(
            {
                "expression": expression,
                "claimed": total,
                "unit": "",
                "statement": text,
                "tolerance_pct": 0.5,
                "source": "rule_selfcontained",
                "why": f"本句自证：各分项相加应等于合计，{expression} 与原文合计 {_fmt(total)} 对比",
            }
        )

    # ---- ③ 同句增速：「由 A 增至 B，…增长 C%」----
    #
    # 【为什么这条要收得比①②严】实测踩到两条误报：
    #   · 第 13 页同一句里有**多组**"由 A 增至 B + 百分比"，223% 被配给了 (1.71→4.26)
    #     （它其实属于 1335→4318，那组自己算出来 223.4% 是对的）→ 配对错 = 误报；
    #   · 第 16 页"由 2.3 降至 2.1，下降 8.0%"：报表用的是**未四舍五入的原值**，
    #     拿页面印出来的 2.3/2.1 反推得 8.7%，差 0.7 个百分点 → 精度差 = 误报。
    # 因此：① 全句只允许一组 A→B、只允许一个百分比（多组时配对不可靠 → 交给模型复核）；
    #       ② 容差放宽到 10%，只抓"差得离谱"的（如 40% 写成 55%）。
    growth_matches = list(_FROM_TO.finditer(text))
    for match in growth_matches if len(growth_matches) == 1 else []:
        if _AMBIGUOUS_GROWTH.search(text[max(0, match.start() - 12) : match.end() + 24]):
            continue  # "两年/复合/累计/合计"这类词出现时口径可疑，交给模型复核
        before, after = _to_float(match.group(1)), _to_float(match.group(2))
        if not (before and after and before != 0):
            continue
        # 只看**同一句**里"变了之后"出现的百分比：切到句末，避免把下一句的百分比当增速（防误报）
        tail = text[match.end() :]
        for stop in ("。", "；", ";", "\n"):
            tail = tail.split(stop)[0]
        tail_percent = _PERCENT_VALUE.search(tail)
        if tail_percent is None:
            continue
        if len(_PERCENT_VALUE.findall(tail)) != 1:
            continue  # 同一句里有多个百分比 → 说不清哪个属于这组数，不在这里下结论
        claimed = _to_float(tail_percent.group(1))
        if claimed is None:
            continue
        falling = bool(_FALLING.search(text[match.start() : match.end()])) and not _RISING.search(tail)
        # 降幅也按「变化量 ÷ 期初」算：基期是变之前那个数（写错分母是最常见的口径错误）
        expression = f"({after}-{before})/{before}*100" if not falling else f"({before}-{after})/{before}*100"
        items.append(
            {
                "expression": expression,
                "claimed": claimed,
                "unit": "%",
                "statement": text,
                # 10% 容差：页面印的是四舍五入后的值，拿 2.3/2.1 这种精度反推会有零点几个百分点的误差
                "tolerance_pct": 10.0,
                "source": "rule_selfcontained",
                "why": (
                    f"本句自证：由 {_fmt(before)} 变到 {_fmt(after)}，"
                    f"按「变化量 ÷ 基期」复算{'降幅' if falling else '增速'}"
                ),
            }
        )
    return items


class Calculator_checker(BaseChecker):
    """计算核查（P0）：抽数字 -> 复算 -> 比对。

    【类名说明】骨架期这里是生成器拼出来的 `Calculator_checker`；实验沿用原类名，
    同时在文件尾部留了 `CalculatorChecker = Calculator_checker` 别名，
    新代码（registry / 测试 / 实验服务）用别名，避免以后再改一处漏一处。
    """

    dimension_code = "calc"

    def __init__(
        self,
        llm: Any = None,
        tools: dict[str, Any] | None = None,
        *,
        tolerance_pct: float = 0.5,
        concurrency: int = 4,
    ) -> None:
        super().__init__(llm=llm, tools=tools)
        self.tolerance_pct = tolerance_pct
        # 并发上限：一次核查要"每句调 1~2 次模型"，串行跑一份几十页的研报要十几分钟。
        # 4 是经验值（DeepSeek 官方限流下稳），调大要先确认账号的并发额度。
        self.concurrency = max(1, int(concurrency))
        # 本次运行的取数来源统计（实验页要如实展示"哪几条是 AI 抽的、哪几条是规则兜的"）
        self.stats: dict[str, int] = {
            "llm": 0,
            "self_contained": 0,
            "rule": 0,
            "unevaluable": 0,
            "miss": 0,
            "dropped": 0,
            "cross_skipped": 0,
        }
        # 被本地校验挡下的原因（去重后展示前几条，让"为什么没查到"有据可查）
        self.dropped_reasons: list[str] = []

    def _screen(self, items: list[dict[str, Any]], page_text: str) -> list[dict[str, Any]]:
        """本地硬校验 + 去重：模型/规则给的每条都要先过这一关。

        过不了的一律丢掉（并记账）—— 丢掉的是"说人家错了其实没错"的误报来源，
        宁可这一页标成未覆盖，也不能把一条假问题摆到用户面前。

        【定位得到 / 定位不到，处理不一样】
          · 模型给的 statement 能在这页原文里检索到 → 用它做**严格**校验
            （声称值必须出现在这一句里），并按"算式输入是否都在这一句内"判定 scope；
          · 检索不到（模型改写/拼接过原文）→ 退回整页校验（宽松），并把 scope 标成 context
            （跨句拼出来的东西只报"对得上"，不报"有错"）。
        """
        kept: list[dict[str, Any]] = []
        for item in items:
            statement = str(item.get("statement") or "").strip()
            located = bool(statement) and statement in page_text
            strict = statement if located else page_text
            ok, why = validate_item(item, strict, page_text)
            if ok:
                item["scope"] = item_scope(item, strict) if located else "context"
                kept.append(item)
            else:
                self.stats["dropped"] += 1
                if len(self.dropped_reasons) < 20:
                    self.dropped_reasons.append(why)
        return dedupe_items(kept)

    # ------------------------------------------------------------------
    # ② 提取：优先模型，失败降级规则
    # ------------------------------------------------------------------
    async def recall(self, text: str) -> list[dict[str, Any]]:
        """从这一页文本里召回"可复算的量"。

        【两条通道取并集，不是二选一】以前这里是 `if items: return items` —— 模型一有产出，
        规则通道就永远不跑，等于把确定性那部分关掉了（实测：一页十几句带数字，模型只给一两条）。
          · 本句自证（`self_contained_recall`）：确定性关系（占比互补 / 分项合计 / 同句增速），
            输入全在本句 → **无条件跑**，且它的结论不由模型复核推翻；
          · 模型抽取（`extract_numbers`）：覆盖需要"读懂口径"的那些关系。
        """
        deterministic = self._screen(self_contained_recall(text), text)
        if deterministic:
            self.stats["self_contained"] += len(deterministic)

        items: list[dict[str, Any]] = []
        if self.llm is not None and getattr(self.llm, "available", False):
            try:
                data = await self.llm.complete_json("extract_numbers", {"passage": text})
                items = self._parse_llm_items(data, text)
            except Exception:  # noqa: BLE001 - 模型任何异常都不能让整篇核查失败
                items = []
        # ★ 模型给的东西一律先过本地硬校验（见 validate_item 的注释：结论正确性不能只靠提示词）
        items = self._screen(items, text)
        if items:
            self.stats["llm"] += len(items)
        elif not deterministic:
            # 模型没给出东西、确定性通道也没命中 → 最后才降级到老规则（它只在"算得对"时产出）
            fallback = self._screen(rule_recall(text), text)
            self.stats["rule"] += len(fallback)
            items = fallback

        # 上限放宽到 8：statement 是"整页文本"，一页十几句带数字，限太死会把后面的同型条目挤掉
        # （确定性条目排在前面，优先保留）。重复算式由 dedupe_items 按 (算式, 声称值) 去重。
        merged = dedupe_items(deterministic + items, per_claim_limit=8)
        if not merged:
            self.stats["miss"] += 1
        return merged

    @staticmethod
    def _parse_llm_items(data: Any, text: str) -> list[dict[str, Any]]:
        """把模型返回的 JSON 收成内部结构，顺手把明显不合规的条目丢掉。"""
        raw_items = data.get("items") if isinstance(data, dict) else data
        if not isinstance(raw_items, list):
            return []
        out: list[dict[str, Any]] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            expression = str(raw.get("expression") or "").strip()
            claimed = _to_float(raw.get("claimed"))
            if not expression or claimed is None:
                continue
            tolerance_pct = raw.get("tolerance_pct")
            try:
                tolerance = float(tolerance_pct) if tolerance_pct is not None else 0.5
            except (TypeError, ValueError):
                tolerance = 0.5
            out.append(
                {
                    "expression": expression,
                    "claimed": claimed,
                    "unit": str(raw.get("unit") or "").strip(),
                    "statement": str(raw.get("statement") or text).strip(),
                    "tolerance_pct": max(0.0, min(10.0, tolerance)),
                    "source": "llm",
                    "why": "大模型从句子中提取的算式",
                }
            )
        return out

    # ------------------------------------------------------------------
    # ③ + ④：复算 + 批注
    # ------------------------------------------------------------------
    async def verdict(self, claim: dict[str, Any], item: dict[str, Any]) -> FindingDraft | None:
        text = str(claim.get("text") or "")
        # 展示用的"原文那句话"：模型摘出来的 statement；摘不到就退回页首一小段
        statement = str(item.get("statement") or "").strip() or text[:120]
        unit = item.get("unit") or ""
        claimed_value = float(item["claimed"])

        result = calculator.evaluate(str(item["expression"]))
        if not result["ok"]:
            # 算式算不出来 = 这一条没查成（未覆盖），绝不写 pass
            self.stats["unevaluable"] += 1
            return FindingDraft(
                claim_id=str(claim.get("id") or ""),
                dimension_code=self.dimension_code,
                status=FindingStatus.UNCOVERED.value,
                reason=f"抽出的算式无法计算（{result['error']}），本条未完成复算",
                uncovered_reason=f"算式不可计算：{result['error']}",
                calc_trace={
                    "page": claim.get("page"),
                    "statement": statement,
                    "expression": item["expression"],
                    "normalized": result["normalized"],
                    "steps": result["steps"],
                    "claimed": claimed_value,
                    "unit": unit,
                    "extracted_by": item["source"],
                },
                evidences=[self._evidence(claim, item)],
            )

        computed = float(result["result"])
        tolerance = max(0.0, float(item.get("tolerance_pct", self.tolerance_pct))) / 100.0
        compared = calculator.compare(computed, claimed_value, rel_tol=tolerance)
        consistent = bool(compared["consistent"])

        # 老规则模式只报一致、不报不一致（见 rule_recall 说明）；
        # 但「本句自证」类（source=rule_selfcontained）**必须报不一致** —— 它的输入全在本句，
        # 算不平就是原文有错，这正是当初漏掉用户植入错误的那个缺口。
        if not consistent and item["source"] == "rule":
            self.stats["miss"] += 1
            return None

        # 跨句推断的算式**不与"句内自证"同等对待**：基数取自其他语句时更容易张冠李戴
        # （实测：模型曾拿"归母净利润5.39亿"去除"扣非4.65亿"去"复算"另一个指标的增速 56%）。
        # 但直接丢掉又浪费了线索 —— 改成产出**未覆盖 + 说明**：把算式、两个数、为什么不下结论
        # 都摆出来，让人一眼能判断"这是模型搞错了"还是"报告真写错了"。
        scope = str(item.get("scope") or "sentence")
        if not consistent and scope == "context":
            self.stats["cross_skipped"] += 1
            return FindingDraft(
                claim_id=str(claim.get("id") or ""),
                dimension_code=self.dimension_code,
                status=FindingStatus.UNCOVERED.value,
                reason=(
                    f"跨句复算对不上：{result['normalized']} = {self._num_text(computed, unit)}，"
                    f"原文写 {self._num_text(claimed_value, unit)}。算式用到了同页其他语句的数字，"
                    "机器不单独下「报告有错」的结论，请人工核对口径。"
                ),
                uncovered_reason="算式输入跨越多句话，属于推断；机器只对「句内自证」的不一致下结论",
                calc_trace={
                    "page": claim.get("page"),
                    "statement": statement,
                    "expression": item["expression"],
                    "normalized": result["normalized"],
                    "steps": result["steps"],
                    "computed": computed,
                    "computed_display": calculator._fmt(computed),  # noqa: SLF001
                    "claimed": claimed_value,
                    "unit": unit,
                    "deviation": compared["deviation"],
                    "rel_deviation": compared["rel_deviation"],
                    "tolerance_pct": round(tolerance * 100, 4),
                    "conclusion": "unconfirmed",
                    "extracted_by": item["source"],
                    "extract_reason": item.get("why", ""),
                    "scope": "context",
                    "scope_label": "借用了同页其他语句的数字",
                },
                confidence=0.4,
                evidences=[self._evidence(claim, item)],
            )

        if consistent:
            status = FindingStatus.PASS.value
            rule_codes: list[str] = []
            risk_level = None
        else:
            status = FindingStatus.RISK.value
            rule_codes = ["CALC_MISMATCH"]
            risk_level = resolve_level(rule_codes, RiskLevel.HIGH)
            risk_level = risk_level.value if risk_level else None

        deviation_text = self._deviation_text(computed, claimed_value, unit, compared)
        verdict_text = "一致" if consistent else "不一致"
        annotation = await self._annotate(
            statement=statement,
            expression=result["normalized"] or item["expression"],
            computed=computed,
            claimed=claimed_value,
            unit=unit,
            deviation_text=deviation_text,
            verdict=verdict_text,
        )

        trace = {
            "page": claim.get("page"),
            "statement": statement,
            "expression": item["expression"],
            "normalized": result["normalized"],
            "steps": result["steps"],
            "computed": computed,
            "computed_display": calculator._fmt(computed),  # noqa: SLF001 - 同包内复用格式化
            "claimed": claimed_value,
            "unit": unit,
            "deviation": compared["deviation"],
            "rel_deviation": compared["rel_deviation"],
            "tolerance_pct": round(tolerance * 100, 4),
            "conclusion": "consistent" if consistent else "mismatch",
            "extracted_by": item["source"],
            "extract_reason": item.get("why", ""),
            "scope": "sentence" if item.get("scope") != "context" else "context",
            "scope_label": "句内自证" if item.get("scope") != "context" else "借用了上下文基数",
            "annotation": annotation,
        }

        if item["source"] == "rule_selfcontained":
            # 备注就是本地算出来的说明（why）—— 不经模型，也不假装是模型复核的结论
            trace["self_check"] = str(item.get("why") or "")
            trace["review_note"] = str(item.get("why") or "")

        if consistent:
            reason = f"复算一致：{result['normalized']} = {trace['computed_display']}{unit}，与原文一致"
            suggestion = None
        else:
            reason = (
                f"复算不一致：原文写 {self._num_text(claimed_value, unit)}，"
                f"按文中数据 {result['normalized']} = {self._num_text(computed, unit)}"
            )
            suggestion = annotation

        return FindingDraft(
            claim_id=str(claim.get("id") or ""),
            dimension_code=self.dimension_code,
            status=status,
            reason=reason,
            risk_level=risk_level,
            rule_codes=rule_codes,
            suggestion=suggestion,
            calc_trace=trace,
            # 本句自证的置信度最高（本地算术、输入全在句内、可复算）；
            # 其次是模型抽取（要读口径）；老规则兜底最低。
            confidence=0.92 if item["source"] == "rule_selfcontained" else (0.85 if item["source"] == "llm" else 0.6),
            evidences=[self._evidence(claim, item)],
        )

    async def _annotate(
        self,
        *,
        statement: str,
        expression: str,
        computed: float,
        claimed: float,
        unit: str,
        deviation_text: str,
        verdict: str,
    ) -> str:
        """④ 整合成批注：优先模型，失败用模板。"""
        if self.llm is not None and getattr(self.llm, "available", False):
            try:
                text = await self.llm.complete(
                    "write_annotation",
                    {
                        "statement": statement,
                        "expression": expression,
                        "computed": self._num_text(computed, ""),
                        "claimed": self._num_text(claimed, ""),
                        "unit": unit,
                        "deviation_text": deviation_text,
                        "verdict": verdict,
                    },
                )
                cleaned = " ".join(str(text).split()).strip().strip("“”\"'")
                if cleaned:
                    return cleaned
            except Exception:  # noqa: BLE001 - 模型失败降级模板
                pass
        return self._template_annotation(computed, claimed, unit, expression, deviation_text, verdict)

    @staticmethod
    def _template_annotation(computed: float, claimed: float, unit: str, expression: str, deviation_text: str, verdict: str) -> str:
        if verdict == "一致":
            return f"该数字经本地复算无误：{expression} = {Calculator_checker._num_text(computed, unit)}，与原文一致。"
        return (
            f"原文写 {Calculator_checker._num_text(claimed, unit)}，"
            f"按文中数据复算 {expression} = {Calculator_checker._num_text(computed, unit)}"
            f"（{deviation_text}）。建议核对后改为 {Calculator_checker._num_text(computed, unit)}。"
        )

    @staticmethod
    def _num_text(value: float, unit: str) -> str:
        return f"{calculator._fmt(value)}{unit}"  # noqa: SLF001 - 同包内复用格式化

    @staticmethod
    def _deviation_text(computed: float, claimed: float, unit: str, compared: dict[str, Any]) -> str:
        diff = computed - claimed
        sign = "+" if diff >= 0 else ""
        base = f"相差 {sign}{calculator._fmt(diff)}{unit}"  # noqa: SLF001
        rel = compared.get("rel_deviation")
        if rel is not None:
            base += f"，相对偏差 {abs(float(rel)) * 100:.2f}%"
        return base

    @staticmethod
    def _evidence(claim: dict[str, Any], item: dict[str, Any] | None = None) -> dict[str, Any]:
        """定位这条批注在原文里的字符区间。

        【核查单元是"整页"，精确区间怎么来】模型返回的 statement 是它从这页里摘出来的原话，
        用它在这一页文本里**检索**出位置，再加上这一页的全文起始偏移 —— 得到的就是
        前端高亮要的绝对区间。检索不到（模型改写过原文）时退回页首，并在 _screen 里
        已把这类标成 context（只报一致），不会拿错位置去断言"有错"。
        """
        page_text = str(claim.get("text") or "")
        base = int(claim.get("start_offset") or 0)
        statement = str((item or {}).get("statement") or "").strip()
        rel = page_text.find(statement) if statement else -1
        if rel < 0:
            statement = page_text[:120]
            rel = 0
        return {
            "type": "in_text",
            "block_id": claim.get("block_id"),
            "page": claim.get("page"),
            "start_offset": base + rel,
            "end_offset": base + rel + len(statement),
            "quote": statement,
        }

    # ------------------------------------------------------------------
    # 对外主入口（BaseChecker 约定）
    # ------------------------------------------------------------------
    async def check(self, ctx: CheckContext) -> list[FindingDraft]:
        """逐条主张核查。claims 的每一项是一个含数字的句子（由实验服务切好）。

        【为什么并发】一句要调 1~2 次模型，串行跑几十页的研报要十几分钟，
        用户会以为卡死了。这里用信号量限流并发（上限见 self.concurrency），
        结果顺序不受影响（gather 保持入参顺序，最后仍按原文顺序摊平）。
        """
        semaphore = asyncio.Semaphore(self.concurrency)

        async def check_one(claim: dict[str, Any]) -> list[FindingDraft]:
            text = str((claim or {}).get("text") or "")
            if not text:
                return []
            async with semaphore:
                items = await self.recall(text)
                drafts: list[FindingDraft] = []
                for item in items:
                    draft = await self.verdict(claim, item)
                    if draft is not None:
                        drafts.append(draft)
                return drafts

        groups = await asyncio.gather(*(check_one(claim) for claim in ctx.claims))
        return [draft for group in groups for draft in group]


# 新代码用这个别名（原类名是生成器拼出来的，保留以兼容 registry）
CalculatorChecker = Calculator_checker
