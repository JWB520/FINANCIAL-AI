"""「数字复算」实验的模型路径自检（注入假 provider，不需要真 Key）。

【为什么要这一份】没有 API Key 时链路只能走规则兜底，实际上"AI 那一步"
（抽取算式 + 整合批注）的代码路径完全没被跑到。这里塞一个**假 provider**，
让它按预置结果应答，走的却是**与线上完全相同的** gateway → 提示词渲染 →
JSON 解析 → 复算 → 批注 链路。这样：
  · "有 Key 时的行为对不对"不必等 Key 才能验；
  · 换模型/改提示词后，链路回归照样能跑。
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

import pytest

from app.agents.base import FindingDraft
from app.application.errata_lab_service import ErrataLabService, collect_review_candidates, review_mismatches
from app.config import Settings

# 复算基准：(0.42-0.30)/0.30*100 = 40.0%
_BASE_EXPRESSION = "(0.42-0.30)/0.30*100"


class FakeProvider:
    """假模型：只验证"链路"，不验证模型能力。

    规则：
      · 提示词里出现 "items" → 是"抽取算式"那一步：取这句里第一个百分数当 claimed，
        算式固定用 (0.42-0.30)/0.30*100（=40.0）。于是：
           句子里写着 40.0% → 一致 → pass
           句子里写着 55.0% → 不一致 → risk（高风险）
      · 提示词里出现"待复核条目" → 是"复核"那一步：按 `verdict_for()` 的判定逐条回 JSON。
        默认判 report_error（保持既有断言不变）；子类改判 tool_mispair / unclear 来测别的分支。
      · 其他 → 是"写批注"那一步，回一句固定文案。
    """

    name = "fake"
    model = "fake-extractor-v1"

    def __init__(self, annotation: str = "原文写 55.0%，按文中数据复算应为 40.0%，建议核对后修改。") -> None:
        self.annotation = annotation
        self.seen_prompts: list[str] = []

    def verdict_for(self, item: dict) -> str:
        """默认：算不平就是原文有误（既有用例依赖这个判定）。"""
        return "report_error"

    def _review_decisions(self, user: str) -> str:
        payload = user.split("待复核条目", 1)[-1]
        payload = payload[payload.find("[") : payload.rfind("]") + 1]
        decisions = [
            {"index": item["index"], "verdict": self.verdict_for(item), "note": f"假模型判定：{self.verdict_for(item)}"}
            for item in json.loads(payload)
        ]
        return json.dumps({"decisions": decisions}, ensure_ascii=False)

    async def chat(self, messages: list[dict[str, str]], **opts: object) -> str:
        user = messages[-1]["content"]
        self.seen_prompts.append(user)
        if "待复核条目" in user:
            return self._review_decisions(user)
        if '"items"' in user:
            # 现在核查单元是"整页"，这里模拟模型在这一页里找出所有 "up X%" 的量
            page = user.split("本页原文：")[-1]
            items = []
            for sentence in (s.strip() for s in re.split(r"(?<=\.)\s+", page)):
                match = re.search(r"up (\d+(?:\.\d+)?)%", sentence)
                if not match:
                    continue
                items.append(
                    {
                        "expression": _BASE_EXPRESSION,  # (0.42-0.30)/0.30*100 = 40.0
                        "claimed": float(match.group(1)),
                        "unit": "%",
                        "statement": sentence,  # 完整句：要能在页里原样检索到
                        "tolerance_pct": 0.5,
                    }
                )
            return json.dumps({"items": items}, ensure_ascii=False)
        return self.annotation

    async def stream(self, messages: list[dict[str, str]], **opts: object):  # pragma: no cover - 实验未用
        yield self.annotation


@pytest.fixture()
def english_pdf(tmp_path: Path) -> Path:
    """英文样例（字体必然可用，避免不同机器缺中文字体导致测试不稳定）。

    句 1 复算一致（40.0%），句 2 不一致（写着 55.0%，实际应为 40.0%）。
    """
    fitz = pytest.importorskip("fitz")
    path = tmp_path / "sample_en.pdf"
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        "Net profit rose from 0.30 to 0.42, up 40.0% year on year.",
        "Revenue rose from 0.30 to 0.42, up 55.0% year on year.",
    ]
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11)
        y += 22
    doc.save(str(path))
    doc.close()
    return path


def test_end_to_end_with_fake_model(english_pdf: Path) -> None:
    provider = FakeProvider()
    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=provider)

    result = asyncio.run(
        service.run(
            report_path=str(english_pdf),
            types=["calc_number"],
            page_range={"from": 1, "to": 1},
            use_llm=True,
        )
    )

    # ① 模型这条路径真的被走到了（否则这个测试等于没测）
    assert result["llm"]["available"] is True
    assert result["llm"]["calls"] >= 3, "两句话各调一次抽取，一致的那些还要调一次写批注"
    assert result["stats"]["extracted_by_llm"] >= 2

    # ② 复算一致的判 pass，不一致的判 risk 且必须是高风险（反向验证）
    risk = [a for a in result["annotations"] if a["status"] == "risk"]
    passed = [a for a in result["annotations"] if a["status"] == "pass"]
    assert risk, "写着 55.0%、实际应为 40.0% 的那条必须被报出来"
    assert passed, "写着 40.0% 的那条必须判为一致"
    assert risk[0]["risk_level"] == "high"
    assert "CALC_MISMATCH" in risk[0]["rule_codes"]
    assert risk[0]["extracted_by"] == "llm"

    # ③ 批注必须来自模型那一步（不是模板），且带核算过程与证据
    assert risk[0]["suggestion"] == provider.annotation
    assert risk[0]["steps"], "核算过程不能是空的（前端要展开给人自己验算）"
    assert risk[0]["start_offset"] >= 0 and risk[0]["end_offset"] > risk[0]["start_offset"]

    # ④ 留痕：提示词版本、耗时、token 估量都要有（"跑一次花多少钱"答得上来）
    detail = result["llm"]["detail"]
    assert detail and all("prompt_version" in call for call in detail)
    assert {"extract_numbers", "write_annotation"} <= {call["prompt_key"] for call in detail}

    # ⑤ 版面定位：批注要能回到 PDF 上"那一行"（新增：不让用户自己满篇找位置）
    assert result["stats"]["rects_located"] >= 1, "至少一条批注要能在版面上换回矩形框"
    assert risk[0]["rects"], "报出来的问题必须带矩形框"
    assert risk[0]["rect_match"] in ("statement", "number")
    assert risk[0]["page_width"] > 0 and risk[0]["page_height"] > 0
    box = risk[0]["rects"][0]
    assert 0 <= box["x0"] < box["x1"] <= risk[0]["page_width"]
    assert 0 <= box["y0"] < box["y1"] <= risk[0]["page_height"]


def test_fake_model_gives_up_gracefully(english_pdf: Path) -> None:
    """模型返回空结果时：不能假装通过。

    这时会退到规则兜底（规则只认句式、且只报一致），所以允许出现 pass，
    但 pass 必须来自规则（extracted_by=rule），**不许**是模型没抽到却凭空判"通过"。
    """

    class EmptyProvider(FakeProvider):
        async def chat(self, messages: list[dict[str, str]], **opts: object) -> str:
            if '"items"' in messages[-1]["content"]:
                return json.dumps({"items": []}, ensure_ascii=False)
            return ""

    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=EmptyProvider())
    result = asyncio.run(service.run(report_path=str(english_pdf), types=[], page_range=None, use_llm=True))
    assert result["stats"]["annotations_total"] >= 1
    assert result["stats"]["extracted_by_llm"] == 0
    for annotation in result["annotations"]:
        assert annotation["status"] in ("pass", "uncovered")
        if annotation["status"] == "pass":
            assert annotation["extracted_by"] == "rule"


# ---------------------------------------------------------------------------
# 复核（"算不平"的条目在呈现前由模型带原文确认一次）
# 这三条是本次的核心：判错的代价是冤枉原文，所以每一条分支都要钉住。
# ---------------------------------------------------------------------------


def test_review_drops_tool_mispair(english_pdf: Path) -> None:
    """模型复核判定"是我们配错了"时：那条**不许**出现在结果里。"""

    class MisPairProvider(FakeProvider):
        def verdict_for(self, item: dict) -> str:
            return "tool_mispair"

    provider = MisPairProvider()
    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=provider)
    result = asyncio.run(
        service.run(report_path=str(english_pdf), types=["calc_number"], page_range={"from": 1, "to": 1}, use_llm=True)
    )

    assert result["stats"]["review_candidates"] >= 1, "应当至少有一条算不平的条目进入复核"
    assert result["stats"]["review_dropped"] == result["stats"]["review_candidates"]
    assert not [a for a in result["annotations"] if a["status"] == "risk"], "判为机器配错的条目不能作为问题呈现"
    assert any("已排除" in note for note in result["notes"]), "剔除了几条必须如实写在说明里（不许静默删除）"
    # 排除的条目必须连"为什么排除"一起返回：否则用户没法判断有没有被误杀的真问题
    assert result["review_excluded"], "被排除的条目要留在结果里（可查），不能只报一个数字"
    for item in result["review_excluded"]:
        assert item["note"], "每条排除都要有理由"
        assert item["statement"], "每条排除都要带原文"
        assert item["expression"], "每条排除都要带算式"


def test_review_keeps_unclear_as_uncovered(english_pdf: Path) -> None:
    """"判断不了"的条目：降为待人工确认（绝不升级成"原文有误"），并带上复核备注。"""

    class UnclearProvider(FakeProvider):
        def verdict_for(self, item: dict) -> str:
            return "unclear"

    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=UnclearProvider())
    result = asyncio.run(
        service.run(report_path=str(english_pdf), types=["calc_number"], page_range={"from": 1, "to": 1}, use_llm=True)
    )

    marked = [a for a in result["annotations"] if a["review_verdict"] == "unclear"]
    assert marked, "复核给过结论的条目必须把结论带回来"
    for annotation in marked:
        assert annotation["status"] == "uncovered"
        assert annotation["risk_level"] is None and annotation["rule_codes"] == []
        assert annotation["review_note"], "备注不能是空的（读者要靠它看明白可能的问题在哪）"


def test_review_confirms_report_error_keeps_note(english_pdf: Path) -> None:
    """确认原文有误：保留为高风险，并写上复核备注。"""
    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=FakeProvider())
    result = asyncio.run(
        service.run(report_path=str(english_pdf), types=["calc_number"], page_range={"from": 1, "to": 1}, use_llm=True)
    )

    risk = [a for a in result["annotations"] if a["status"] == "risk"]
    assert risk, "假模型默认判 report_error，这条必须作为问题呈现"
    assert risk[0]["review_verdict"] == "report_error"
    assert risk[0]["review_note"]
    assert risk[0]["risk_level"] == "high"
    assert "复核确认原文有误" in risk[0]["conclusion"]
    assert "机器不单独下" not in risk[0]["conclusion"], "已确认有误的条目不该再留着旧那句免责话术"


def test_review_treats_rounding_as_consistent(english_pdf: Path) -> None:
    """"只是四舍五入"必须判成一致。

    本地比对用相对容差（0.5%），对接近 0 的百分比过严：原文写 -1.0%、复算 -1.0457%
    （差 0.046 个百分点，纯写法精度）会被本地判成"不一致"。这一档负责把它纠正回来。
    """

    class ConsistentProvider(FakeProvider):
        def verdict_for(self, item: dict) -> str:
            return "consistent"

    service = ErrataLabService(Settings(llm_api_key="fake-key"), provider=ConsistentProvider())
    result = asyncio.run(
        service.run(report_path=str(english_pdf), types=["calc_number"], page_range={"from": 1, "to": 1}, use_llm=True)
    )

    assert result["stats"]["review_candidates"] >= 1
    assert result["stats"]["review_consistent"] == result["stats"]["review_candidates"]
    assert not [a for a in result["annotations"] if a["status"] == "risk"], "只是四舍五入的不许留成问题"
    marked = [a for a in result["annotations"] if a["review_verdict"] == "consistent"]
    assert marked, "复核结论要带回来"
    for annotation in marked:
        assert annotation["status"] == "pass"
        assert annotation["risk_level"] is None and annotation["rule_codes"] == []
        assert annotation["review_note"]
    assert not result["review_excluded"], "判成一致的条目不属于被排除"


def test_review_is_skipped_without_model() -> None:
    """没有模型时复核必须整段跳过：判定一律不变，且如实写进说明。"""
    draft = FindingDraft(
        claim_id="p001",
        dimension_code="calc",
        status="uncovered",
        reason="跨句复算对不上",
        calc_trace={
            "conclusion": "unconfirmed",
            "page": 1,
            "statement": "收入 20.11 亿元，占比 60.67%",
            "normalized": "20.11/28.78*100",
            "computed": 69.87,
            "claimed": 60.67,
            "unit": "%",
        },
    )
    notes: list[str] = []
    kept, stats, excluded = asyncio.run(review_mismatches(None, [draft], [{"page": 1, "text": draft.calc_trace["statement"]}], notes))

    assert kept == [draft], "没有模型时不许丢弃任何结论"
    assert excluded == [], "没有模型时也不许排除任何条目"
    assert draft.status == "uncovered" and draft.risk_level is None
    assert stats["candidates"] == 1 and stats["skipped"] == 1
    assert notes and "没有接入大模型" in notes[0]


def test_review_candidate_carries_source_context() -> None:
    """复核输入必须带上原文上下文（否则模型只能猜）—— 分母常常写在隔壁那句里。"""
    page_text = "第一句收入 20.11 亿元。第二句写占比 60.67%。第三句说全年营收 28.78 亿元。"
    draft = FindingDraft(
        claim_id="p001",
        dimension_code="calc",
        status="uncovered",
        reason="跨句复算对不上",
        calc_trace={
            "conclusion": "unconfirmed",
            "page": 1,
            "statement": "第二句写占比 60.67%。",
            "normalized": "20.11/28.78*100",
            "computed": 69.87,
            "claimed": 60.67,
            "unit": "%",
        },
    )
    pairs = collect_review_candidates([draft], [{"page": 1, "text": page_text}])
    assert len(pairs) == 1
    assert pairs[0][1]["index"] == 1
    assert "28.78" in pairs[0][1]["原文上下文"], "上下文里必须能看到隔壁那句的总营收"
    assert pairs[0][1]["原文写"] == "60.67%"
    assert pairs[0][1]["机器算式"] == "20.11/28.78*100"
