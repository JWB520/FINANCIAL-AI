"""「数字复算」实验的自检。

覆盖四层，每层都有能**失败**的断言（自检不会失败 = 没有自检）：
  1. 复算器：正常算式 / 拒绝危险表达式 / 逐步过程 / 容差比对
  2. 文本切句：区间与文本**逐字一致**（前端高亮就靠这条）
  3. 规则提取：能从"由 A 增至 B，增长 C%"里构造出正确算式
  4. 端到端：造一份 PDF 跑完整链路；并单独验证"复算不一致 → CALC_MISMATCH（高风险）"
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.agents.calculator_checker import CalculatorChecker, rule_recall, validate_item
from app.common.text import has_number, split_sentences_with_offsets
from app.infra.parsers.pdf_parser import parse_pdf
from app.infra.tools import calculator


# ===========================================================================
# 1. 复算器
# ===========================================================================
def test_calculator_basic_and_steps() -> None:
    result = calculator.evaluate("(1.45-1.20)/1.20*100")
    assert result["ok"] is True
    assert result["result"] == pytest.approx(20.833333, rel=1e-6)
    # 逐步过程必须有内容（前端"核算过程"面板靠它），且最后一步就是整式结果
    assert len(result["steps"]) >= 3
    assert result["steps"][-1]["value_raw"] == pytest.approx(20.833333, rel=1e-6)


def test_calculator_percent_and_fullwidth() -> None:
    """全角符号与百分号要能算：25% 的语义是 0.25；横排全角乘号要认。"""
    result = calculator.evaluate("25％")  # 全角百分号
    assert result["ok"] is True
    assert result["result"] == pytest.approx(0.25)
    converted = calculator.evaluate("50×0.5")  # 全角乘号
    assert converted["ok"] is True
    assert converted["result"] == pytest.approx(25.0)


def test_calculator_rejects_dangerous_expression() -> None:
    """模型给的算式不能直接 eval：函数调用/属性访问/名字一律拒绝。"""
    for evil in ["__import__('os').system('echo hi')", "open('x')", "a+1", "1/0"]:
        result = calculator.evaluate(evil)
        assert result["ok"] is False, f"不该算得出来：{evil}"
        assert result["error"]


def test_compare_tolerance() -> None:
    # 研报常见的四舍五入（20.83 -> 20.8）必须判为一致，否则正常修约全被误报
    assert calculator.compare(20.8333, 20.8)["consistent"] is True
    # 明显错的不许放过
    assert calculator.compare(20.8333, 25.0)["consistent"] is False


# ===========================================================================
# 2. 切句偏移
# ===========================================================================
def test_split_sentences_offsets_roundtrip() -> None:
    text = "公司营收由1.20亿元增至1.45亿元，同比增长20.8%。毛利率30.5%，同比提升1.2个百分点。"
    pieces = split_sentences_with_offsets(text)
    assert len(pieces) >= 2
    for start, end, sentence in pieces:
        # 关键断言：区间切出来的原文必须与句子**逐字相同**（错一位前端高亮就整条错位）
        assert text[start:end] == sentence
    assert any(has_number(sentence) for _s, _e, sentence in pieces)


def test_split_sentences_long_sentence_cut() -> None:
    text = "A" * 300 + "，" + "B" * 300 + "。"
    pieces = split_sentences_with_offsets(text, max_len=100)
    assert all(len(sentence) <= 100 for _s, _e, sentence in pieces)
    for start, end, sentence in pieces:
        assert text[start:end] == sentence


def test_decimal_point_is_not_sentence_end() -> None:
    """小数点不许当句末：26.48 不能被切成 "26" 和 "48 亿元"（真正的句点才切）。"""
    text = "实现营收26.48 亿元，同比增长1.0%。Net profit up 40.0% year on year."
    sentences = [sentence for _s, _e, sentence in split_sentences_with_offsets(text)]
    assert sentences[0].startswith("实现营收26.48")
    assert "48 亿元" in sentences[0], "小数点被误当句末，整句被切碎了"
    assert sentences[-1].endswith("year on year.")


# ===========================================================================
# 3. 规则提取
# ===========================================================================
def test_rule_recall_from_to_pattern() -> None:
    items = rule_recall("公司营收由1.20亿元增至1.45亿元，同比增长20.8%。")
    assert items, "『由 A 增至 B，增长 C%』应该能被规则识别"
    item = items[0]
    assert item["source"] == "rule"
    result = calculator.evaluate(item["expression"])
    assert result["ok"] is True
    assert calculator.compare(float(result["result"]), item["claimed"])["consistent"] is True


def test_rule_recall_gives_up_when_unsure() -> None:
    """句子读不懂就**不要产出**（规则模式宁可漏，不可误报）。"""
    assert rule_recall("公司是行业龙头，竞争力较强。") == []
    assert rule_recall("报告期内公司经营稳健。") == []


# ===========================================================================
# 3.5 本地硬校验：模型说的每个数都必须在原文里（这是防误报的闸门）
# ===========================================================================
def test_validate_rejects_model_invented_claimed() -> None:
    """声称值必须是原文写出来的数 —— 模型自己算一个数当"原文写的"，属于自算自对。"""
    text = "2024年实现营收18.78亿元，同比增长1.23%，营收占比为59.6%。"
    ok, why = validate_item({"expression": "18.78/59.6*100", "claimed": 31.51}, text)
    assert ok is False
    assert "不在重点句子里" in why


def test_validate_rejects_numbers_not_in_sentence() -> None:
    """算式不许用到这句话里没有的数（模型拿隔壁句子的数来拼算式）。"""
    text = "实现归母净利润5.39亿元，同比增长10.0%。"
    ok, why = validate_item({"expression": "(5.39-4.65)/4.65*100", "claimed": 10.0}, text)
    assert ok is False
    assert "没有的数字" in why


def test_validate_rejects_claim_equal_to_operand() -> None:
    """声称值不能就是算式里的操作数（拿输入比输入，比对无意义）。"""
    text = "毛利率为36.27%，同比提升6.38pct。"
    ok, _why = validate_item({"expression": "36.27-6.38", "claimed": 36.27}, text)
    assert ok is False


def test_validate_accepts_real_identity() -> None:
    """真的恒等式必须放行（否则等于把功能关掉了）。"""
    text = "公司营收由1.20亿元增至1.45亿元，同比增长20.8%。"
    ok, why = validate_item({"expression": "(1.45-1.20)/1.20*100", "claimed": 20.8}, text)
    assert ok is True, why


# ===========================================================================
# 4. 结论分级（反向验证：不一致必须是高风险）
# ===========================================================================
def _claim(text: str = "公司营收由1.20亿元增至1.45亿元，同比增长20.8%。") -> dict:
    return {
        "id": "c0001",
        "block_id": "b0001",
        "block_index": 0,
        "page": 1,
        "text": text,
        "start_offset": 0,
        "end_offset": len(text),
    }


def test_verdict_mismatch_is_high_risk() -> None:
    """故意给一个算不对的算式：必须产出一条 CALC_MISMATCH 的高风险结论。

    source='llm' 表示"这条是模型读懂了句子后抽的算式"，此时系统才敢断言不一致。
    """
    checker = CalculatorChecker(llm=None)
    draft = asyncio.run(
        checker.verdict(
            _claim(),
            {"expression": "(1.45-1.20)/1.20*100", "claimed": 40.0, "unit": "%", "statement": "…", "source": "llm"},
        )
    )
    assert draft is not None
    assert draft.status == "risk"
    assert draft.risk_level == "high"
    assert "CALC_MISMATCH" in draft.rule_codes
    assert draft.calc_trace["conclusion"] == "mismatch"
    # 必须带证据（没证据的高风险结论是产品事故）
    assert draft.evidences and draft.evidences[0]["start_offset"] == 0


def test_verdict_rule_mode_stays_silent_on_mismatch() -> None:
    """规则抽出来的算式本就可能是猜的 —— 此时**不许**报不一致（避免误报）。"""
    checker = CalculatorChecker(llm=None)
    draft = asyncio.run(
        checker.verdict(
            _claim(),
            {"expression": "(1.45-1.20)/1.20*100", "claimed": 40.0, "unit": "%", "statement": "…", "source": "rule"},
        )
    )
    assert draft is None


def test_verdict_consistent_is_pass() -> None:
    checker = CalculatorChecker(llm=None)
    draft = asyncio.run(
        checker.verdict(
            _claim(),
            {"expression": "(1.45-1.20)/1.20*100", "claimed": 20.8, "unit": "%", "statement": "…", "source": "llm"},
        )
    )
    assert draft is not None
    assert draft.status == "pass"
    assert draft.risk_level is None


# ===========================================================================
# 5. 端到端：造 PDF → 解析 → 切句 → 规则复算 → 批注
# ===========================================================================
@pytest.fixture()
def sample_pdf(tmp_path: Path) -> Path:
    fitz = pytest.importorskip("fitz")
    path = tmp_path / "sample.pdf"
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        "公司营收由1.20亿元增至1.45亿元，同比增长20.8%。",
        "公司归母净利润由0.30亿元增至0.42亿元，同比增长55.0%。",  # 故意写错：应为 40.0%
        "本期毛利率30.5%，较上年同期提升1.2个百分点。",
    ]
    y = 72
    for line in lines:
        try:
            page.insert_text((72, y), line, fontsize=11, fontname="china-s")
        except Exception:  # noqa: BLE001 - 没有中文字体时退化成英文数字文本
            page.insert_text((72, y), "Revenue grew from 1.20 to 1.45, up 20.8%.", fontsize=11)
        y += 24
    doc.save(str(path))
    doc.close()
    return path


def test_end_to_end_synthetic_pdf(sample_pdf: Path) -> None:
    from app.application.errata_lab_service import ErrataLabService
    from app.config import Settings

    blocks = parse_pdf(str(sample_pdf))
    assert blocks, "应该解析出文本块"
    assert blocks[0]["page"] == 1
    assert blocks[0]["start_offset"] == 0

    settings = Settings(llm_api_key="")  # 无 Key → 规则兜底
    service = ErrataLabService(settings)
    result = asyncio.run(
        service.run(report_path=str(sample_pdf), types=["calc_number"], page_range={"from": 1, "to": 1}, use_llm=True)
    )

    stats = result["stats"]
    assert stats["sentences_scanned"] >= 2, "至少扫到两句含数字的句子"
    assert result["annotations"], "应该产出批注（至少是未覆盖说明）"
    # 无 Key：要么规则确认了一致（pass，source=rule），要么如实标未覆盖 —— 绝不许假装 AI 跑过
    assert result["llm"]["calls"] == 0
    assert result["llm"]["available"] is False
    for annotation in result["annotations"]:
        assert annotation["status"] in ("pass", "risk", "uncovered")
        if annotation["status"] == "uncovered":
            assert annotation["conclusion"]
    # 无 Key 时的结论只能来自**确定性通道**（本句自证 / 老规则），绝不能标成"模型抽的"。
    # 2026-10 起多了"本句自证"这条（占比互补 / 分项合计 / 同句增速），所以两者加起来算。
    if stats["pass"] or stats["risk"]:
        assert stats["extracted_by_rule"] + stats["self_contained"] >= 1
    # 夹具里第 2 句本来就有个"故意写错的"数：净利润由 0.30 增至 0.42，同比增长写 55.0%（应为 40.0%）
    assert any(item["status"] == "risk" for item in result["annotations"]), "植入式的错值必须报出来（这是召回率回归）"
