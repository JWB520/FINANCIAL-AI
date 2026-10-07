"""研报勘误实验（数字复算）· 用例编排。

【这条用例的完整链路】
    读 PDF（含页号与全文偏移）
      → 按页码范围过滤 + 切句 + 只留含数字的句子（每句 = 一条"主张"）
      → CalculatorChecker.check()：抽算式（模型/规则）→ 本地复算 → 整合批注
      → 把结论草稿（FindingDraft）摊平成页面要的批注列表 + 统计 + 模型留痕

【为什么放在 application 层】它只做编排：调解析器、装配上下文、汇总结果。
  "怎么抽、怎么算、怎么写批注"全在 agents/ 与 infra/ 里，这里一行业务算法都不写。
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.agents.base import CheckContext
from app.agents.calculator_checker import CalculatorChecker
from app.common.text import has_number, split_sentences_with_offsets
from app.domain.enums import FindingStatus, RiskLevel
from app.domain.risk_rules import resolve_level
from app.infra.llm.gateway import LlmGateway
from app.infra.llm.providers import ProviderNotConfigured, build_provider
from app.infra.parsers.pdf_parser import (
    PdfParseError,
    locate_block_id,
    locate_text_boxes,
    merge_blocks_by_page,
    parse_pdf,
)

# 本实验实现的勘误项（对应前端 errataCatalog 的 calc 系列 6 项）
SUPPORTED_TYPE_CODES = [
    "calc_number",
    "calc_unit",
    "calc_table",
    "calc_sum",
    "calc_period",
    "calc_tie",
]
# 已实现的只有"数字复算"这一项；其余 calc 项接受勾选但会在结果里说明"本次未覆盖"
IMPLEMENTED_TYPE_CODES = ["calc_number"]
PROMPT_KEYS = ["extract_numbers", "write_annotation", "verify_mismatches"]

# 哪些结论属于"算不平、需要复核"（按 calc_trace.conclusion 判，不按 status 判）：
#   mismatch     = 句内自证的不一致（现有实现直接判高风险）
#   unconfirmed  = 跨句算不平（现有实现降级成未覆盖）
# 两类在**呈现给用户之前**都必须先经一次模型复核：确认是原文有误才当问题报。
MISMATCH_CONCLUSIONS = ("mismatch", "unconfirmed")

# 复核时每条附带多少上下文字符（只截句子前后各这么多，不整页喂 → 一次调用也花不了多少 token）
REVIEW_CONTEXT_SPAN = 160


def _context_window(page_text: str, statement: str, span: int = REVIEW_CONTEXT_SPAN) -> str:
    """给模型看的一小段原文：以这句为中心向两侧各取 span 个字符。"""
    if not page_text:
        return ""
    position = page_text.find(statement) if statement else -1
    if position < 0:
        return page_text[: span * 2]
    low = max(0, position - span)
    high = min(len(page_text), position + len(statement) + span)
    return page_text[low:high]


def collect_review_candidates(drafts: list[Any], claims: list[Any]) -> list[tuple[Any, dict[str, Any]]]:
    """挑出「本地复算算不平」的条目 —— 它们是这次复核的唯一输入。

    每条带上：原文句子 + 原文上下文 + 机器算式 + 机器算出值 + 原文声称值 + 算式输入范围。
    【为什么要带原文上下文】模型要判"到底是原文写错还是机器配错"，必须看到这句话**周围**
    的数字（本例的分母 28.78 就写在下一句里）—— 只给一句话，它也只能猜。
    """
    page_text = {int(claim.get("page") or 0): str(claim.get("text") or "") for claim in claims}
    pairs: list[tuple[Any, dict[str, Any]]] = []
    for draft in drafts:
        trace = dict(getattr(draft, "calc_trace", None) or {})
        if trace.get("conclusion") not in MISMATCH_CONCLUSIONS:
            continue
        # 「本句自证」类**不交给模型复核**：算式输入全在本句、算术唯一确定。
        # 放它进复核正是当初漏掉用户植入错误的那个口子 —— 模型一句"我方配错"，
        # 真错误就被排掉了（实测：55.00%+39.33%=94.33% 这种硬矛盾被排成"机器配错"）。
        if str(trace.get("extracted_by") or "") == "rule_selfcontained":
            continue
        if trace.get("computed") is None or trace.get("claimed") is None:
            continue
        statement = str(trace.get("statement") or "")
        unit = str(trace.get("unit") or "")
        page = int(trace.get("page") or 0)
        pairs.append(
            (
                draft,
                {
                    "index": len(pairs) + 1,
                    "page": page,
                    "原文句子": statement,
                    "原文上下文": _context_window(page_text.get(page, ""), statement),
                    "机器算式": str(trace.get("normalized") or trace.get("expression") or ""),
                    "机器算出": f"{trace.get('computed_display') or trace.get('computed')}{unit}",
                    "原文写": f"{trace.get('claimed')}{unit}",
                    "算式输入范围": str(
                        trace.get("scope_label") or ("借用了同页其他语句的数字" if trace.get("scope") == "context" else "句内")
                    ),
                },
            )
        )
    return pairs


async def review_mismatches(
    gateway: Any,
    drafts: list[Any],
    claims: list[Any],
    notes: list[str],
) -> tuple[list[Any], dict[str, int], list[dict[str, Any]]]:
    """把「算不平」的条目**一次性**交给模型复核：确认是原文有误，才作为问题返回并呈现。

    【四条设计约定（都是为了"不冤枉原文"）】
      1. 只调**一次**模型（所有候选装在同一个提示词里），不按条调用 —— 省 token 也省时间；
      2. 模型判 `tool_mispair`（我方配错）的条目**直接从结果里去掉**：不呈现、不计入问题数，
         只在 notes 里如实报个数（不静默删）；
      3. 模型判 `unclear` 的保留为「待人工确认」，并把模型的说明写进备注 —— 不升级成"原文有误"；
      4. 模型不可用 / 调用失败 / 某条没给结论 → **不改变任何判定**（该是未覆盖仍是未覆盖），
         如实写进 notes。绝不因为"复核没跑"就把某条升格成"原文有误"。

    【为什么不改 base.FindingDraft】它是全维度共用的契约（不许改）。复核结论挂进
    `calc_trace`（本来就是自由 dict），由 drafts_to_annotations 摊平成响应字段。
    """
    stats = {"candidates": 0, "confirmed": 0, "consistent": 0, "dropped": 0, "unclear": 0, "skipped": 0}
    # 被排除的条目要连理由一起带回去（只报个数字，用户没法判断有没有误杀真问题）
    excluded: list[dict[str, Any]] = []
    pairs = collect_review_candidates(drafts, claims)
    stats["candidates"] = len(pairs)
    if not pairs:
        return drafts, stats, excluded

    if gateway is None or not getattr(gateway, "available", False):
        stats["skipped"] = len(pairs)
        notes.append(
            f"有 {len(pairs)} 条复算对不上，但本次没有接入大模型，无法复核『到底是原文写错还是机器配错』："
            "这些条目一律显示为「待人工确认」，不当成原文有误。"
        )
        return drafts, stats, excluded

    payload = [item for _, item in pairs]
    try:
        data = await gateway.complete_json(
            "verify_mismatches",
            {"items": json.dumps(payload, ensure_ascii=False, indent=1), "count": len(payload)},
        )
    except Exception as exc:  # noqa: BLE001 - 复核失败绝不能影响主结果
        stats["skipped"] = len(payload)
        notes.append(f"复核这一步没有跑成（{exc}）：这些条目一律显示为「待人工确认」，不当成原文有误。")
        return drafts, stats, excluded

    raw_decisions = data.get("decisions") if isinstance(data, dict) else data
    decisions: dict[int, dict[str, str]] = {}
    for item in raw_decisions or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        decisions[index] = {
            "verdict": str(item.get("verdict") or "").strip(),
            "note": str(item.get("note") or "").strip(),
        }

    pair_of = {id(draft): item for draft, item in pairs}
    kept: list[Any] = []
    for draft in drafts:
        item = pair_of.get(id(draft))
        if item is None:
            kept.append(draft)
            continue
        decision = decisions.get(int(item["index"]))
        if decision is None:
            stats["skipped"] += 1
            kept.append(draft)
            continue

        verdict = decision["verdict"]
        note = decision["note"]
        trace = dict(getattr(draft, "calc_trace", None) or {})
        trace["review_verdict"] = verdict
        trace["review_note"] = note
        draft.calc_trace = trace
        unit = str(trace.get("unit") or "")
        normalized = str(trace.get("normalized") or trace.get("expression") or "")
        computed_text = f"{trace.get('computed_display') or trace.get('computed')}{unit}"
        claimed_text = f"{trace.get('claimed')}{unit}"

        if verdict == "report_error":
            # 只有这一档才作为"问题"呈现，并且把结论话术换掉 ——
            # 不能留着旧那句"机器不单独下结论"，否则和已经确认的事实自相矛盾。
            draft.status = FindingStatus.RISK.value
            draft.rule_codes = ["CALC_MISMATCH"]
            level = resolve_level(["CALC_MISMATCH"], RiskLevel.HIGH)
            draft.risk_level = level.value if level else None
            draft.confidence = max(float(draft.confidence or 0.0), 0.7)
            draft.reason = (
                f"复核确认原文有误：原文写 {claimed_text}，按文中数据 {normalized} = {computed_text}。"
            )
            draft.uncovered_reason = None
            stats["confirmed"] += 1
            kept.append(draft)
        elif verdict == "consistent":
            # 复核判定"只是四舍五入" → 直接判一致。
            # 为什么需要这一档：本地比对用的是**相对容差**（0.5%），对接近 0 的百分比过严 ——
            # 原文写 -1.0%、复算 -1.0457%（差 0.046 个百分点，纯粹的写法精度）会被本地判成"不一致"，
            # 结果就是又把正确的原文当成错的。这一档把它纠正回来。
            draft.status = FindingStatus.PASS.value
            draft.rule_codes = []
            draft.risk_level = None
            draft.suggestion = None
            draft.uncovered_reason = None
            draft.confidence = max(float(draft.confidence or 0.0), 0.7)
            draft.reason = (
                f"复核确认一致：原文写 {claimed_text}，按文中数据 {normalized} = {computed_text}，"
                "差值在原文写法的精度范围内（属四舍五入）。"
            )
            stats["consistent"] += 1
            kept.append(draft)
        elif verdict == "unclear":
            if draft.status == FindingStatus.RISK.value:
                # 原本按句内不一致判了高风险，但复核说判断不了 → 降回"待人工确认"
                draft.status = FindingStatus.UNCOVERED.value
                draft.rule_codes = []
                draft.risk_level = None
                draft.uncovered_reason = "复核未能确认原文有误，改列待人工确认"
                draft.reason = (
                    f"复核未能确认原文有误：机器算式 {normalized} = {computed_text}，原文写 {claimed_text}，"
                    "已改列「待人工确认」，请人工核对口径。"
                )
            stats["unclear"] += 1
            kept.append(draft)
        else:
            # tool_mispair（以及任何非预期取值）：判定为"我方配错"，不呈现
            stats["dropped"] += 1
            excluded.append(
                {
                    "page": int(item["page"]),
                    "statement": str(item["原文句子"]),
                    "expression": str(item["机器算式"]),
                    "computed": trace.get("computed"),
                    "claimed": trace.get("claimed"),
                    "unit": unit,
                    "note": note,
                }
            )

    if stats["confirmed"] or stats["consistent"] or stats["dropped"] or stats["unclear"]:
        notes.append(
            f"对 {stats['candidates']} 条「复算算不平」的条目做了一次性复核（1 次模型调用）："
            f"确认原文有误 {stats['confirmed']} 条（作为问题呈现）、"
            f"确认只是四舍五入 {stats['consistent']} 条（判为一致）、"
            f"判定为机器配错已排除 {stats['dropped']} 条、"
            f"无法判定保留待人工确认 {stats['unclear']} 条"
            + (f"、未取到结论 {stats['skipped']} 条" if stats["skipped"] else "")
            + "。"
        )
    return kept, stats, excluded


def build_claims(
    blocks: list[dict[str, Any]],
    page_range: dict[str, int] | None = None,
    max_pages: int | None = None,
) -> list[dict[str, Any]]:
    """按**页**构造核查单元：一页 = 一个 claim。

    【为什么以页为单位，而不是一句话一次（实测推翻的第一版设计）】
      第一版是"一句话一次调用"，结果：34 句调 34 次、只有 1 条产出。原因不是模型不行，
      而是**信息被切碎了**：真实研报里「研发费用 2.90 亿 ÷ 营收 26.48 亿 = 研发费用率 10.95%」
      这三个数散在**三句**里，逐句喂模型谁都拼不出来。
      改成整页一次后：模型有全局视野，能配的关系明显变多，调用次数还从"句数"降到"页数"。
    批注定位不受影响：模型返回的 statement 会在这页文本里检索出字符区间（见 checker._evidence）。
    """
    claims: list[dict[str, Any]] = []
    low = int(page_range["from"]) if page_range else None
    high = int(page_range["to"]) if page_range else None
    for page_info in merge_blocks_by_page(blocks):
        page = int(page_info["page"])
        if low is not None and page < low:
            continue
        if high is not None and page > high:
            continue
        page_text = str(page_info["text"])
        # 含数字的句子数只用来展示"这一页扫了多少句"，不做切分
        sentence_count = sum(1 for _s, _e, sentence in split_sentences_with_offsets(page_text) if has_number(sentence))
        if not sentence_count:
            continue
        claims.append(
            {
                "id": f"p{page:03d}",
                "block_id": locate_block_id(page_info, 0),
                "block_index": len(claims),
                "page": page,
                "text": page_text,
                "sentence_count": sentence_count,
                "start_offset": int(page_info["start_offset"]),
                "end_offset": int(page_info["end_offset"]),
            }
        )
        if max_pages is not None and len(claims) >= max_pages:
            break
    return claims


def locate_annotation_rects(report_path: str, annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """给每条批注补上"它在 PDF 版面上的矩形框"。

    【为什么这一步单独存在】用户的原话：「我不希望你在旁边备注的错误，我需要去满篇找对应在
    原文中的哪个位置，我需要你在错误的原文附近做出标注」。字符坐标只有解析器拿得到，
    所以这里把"原文句子 / 数字"交给 pdf_parser 换回矩形框，再挂到批注上。

    拿不到就留空（rect_match="none"）：前端不画框，也不假装知道位置 —— 画错位置比不画更糟。
    """
    if not annotations:
        return annotations
    targets = [
        {
            "page": int(item.get("page") or 0),
            "statement": str(item.get("statement") or ""),
            # 兜底锚点：数字几乎不会被抽取器改写，句子匹配不上时用它定位
            "number": "" if item.get("claimed") is None else str(item.get("claimed")),
        }
        for item in annotations
    ]
    located = locate_text_boxes(report_path, targets)
    for item, box in zip(annotations, located, strict=False):
        item["rects"] = box.get("rects") or []
        item["page_width"] = float(box.get("page_width") or 0.0)
        item["page_height"] = float(box.get("page_height") or 0.0)
        item["rect_match"] = str(box.get("rect_match") or "none")
    return annotations


def drafts_to_annotations(drafts: list[Any]) -> list[dict[str, Any]]:
    """把结论草稿摊平成批注（页面按页排序展示）。"""
    annotations: list[dict[str, Any]] = []
    for draft in drafts:
        trace = dict(getattr(draft, "calc_trace", None) or {})
        evidences = list(getattr(draft, "evidences", None) or [])
        first = evidences[0] if evidences else {}
        annotations.append(
            {
                "id": f"a{len(annotations) + 1:04d}",
                "page": int(trace.get("page") or first.get("page") or 1),
                "block_id": str(first.get("block_id") or ""),
                "start_offset": int(first.get("start_offset") or 0),
                "end_offset": int(first.get("end_offset") or 0),
                "statement": str(trace.get("statement") or first.get("quote") or ""),
                "expression": str(trace.get("expression") or ""),
                "normalized": str(trace.get("normalized") or ""),
                "steps": list(trace.get("steps") or []),
                "computed": trace.get("computed"),
                "claimed": trace.get("claimed"),
                "unit": str(trace.get("unit") or ""),
                "deviation": trace.get("deviation"),
                "rel_deviation": trace.get("rel_deviation"),
                "tolerance_pct": float(trace.get("tolerance_pct") or 0.5),
                "status": str(getattr(draft, "status", "uncovered")),
                "risk_level": getattr(draft, "risk_level", None),
                "rule_codes": list(getattr(draft, "rule_codes", None) or []),
                "conclusion": str(getattr(draft, "reason", "") or ""),
                "suggestion": getattr(draft, "suggestion", None),
                "confidence": getattr(draft, "confidence", None),
                "extracted_by": str(trace.get("extracted_by") or "llm"),
                "extract_reason": str(trace.get("extract_reason") or ""),
                "scope": str(trace.get("scope") or "sentence"),
                "scope_label": str(trace.get("scope_label") or ""),
                "review_verdict": trace.get("review_verdict"),
                "review_note": trace.get("review_note"),
            }
        )
    annotations.sort(key=lambda item: (item["page"], item["start_offset"]))
    return annotations


class ErrataLabService:
    """自包含的"数字复算"实验服务（不依赖数据库/队列/既有 60 条端点）。"""

    def __init__(self, settings: Any, provider: Any = None) -> None:
        self.settings = settings
        # 注入点：测试与离线评测时塞一个假 provider，走的是**完全相同的链路**，
        # 这样"AI 那一步"的代码有没有问题，不必等有 Key 才能验证。
        self._provider = provider

    # ---------------- 状态 ----------------
    def llm_status(self) -> dict[str, Any]:
        """模型是否可用（设置页/实验页要如实显示，不能让用户以为 AI 跑了）。"""
        status: dict[str, Any] = {
            "available": False,
            "provider": str(getattr(self.settings, "llm_provider", "")),
            "model": str(getattr(self.settings, "llm_model", "")),
            "reason": "",
        }
        if self._provider is not None:
            status["available"] = True
            status["model"] = getattr(self._provider, "model", status["model"])
            return status
        if not getattr(self.settings, "llm_api_key", ""):
            status["reason"] = "backend/.env 里还没有 RQC_LLM_API_KEY"
            return status
        try:
            provider = build_provider(self.settings)
        except ProviderNotConfigured as exc:
            status["reason"] = str(exc)
            return status
        status["available"] = True
        status["model"] = getattr(provider, "model", status["model"])
        return status

    def prompt_versions(self) -> dict[str, int]:
        from app.agents.prompts.registry import PromptRegistry

        registry = PromptRegistry()
        versions: dict[str, int] = {}
        for key in PROMPT_KEYS:
            try:
                versions[key] = registry.load(key).version
            except KeyError:
                versions[key] = 0
        return versions

    # ---------------- 主流程 ----------------
    async def run(
        self,
        *,
        report_path: str,
        types: list[str],
        page_range: dict[str, int] | None = None,
        use_llm: bool = True,
        max_pages: int | None = None,
        tolerance_pct: float = 0.5,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        notes: list[str] = []

        path = Path(report_path)
        if not path.exists():
            raise FileNotFoundError(f"研报文件不存在：{report_path}")
        if path.suffix.lower() != ".pdf":
            raise ValueError(f"本实验目前只支持 PDF，收到的是 {path.suffix or '无扩展名'}")

        # ---------- 1. 解析 ----------
        blocks = await asyncio.to_thread(parse_pdf, str(path))
        if not blocks:
            raise PdfParseError("没有解析出任何文本块")
        pages_total = max(int(block["page"]) for block in blocks)

        # ---------- 2. 切页 ----------
        claims = build_claims(blocks, page_range, max_pages)
        if not claims:
            notes.append("在你选定的范围内没有找到含数字的内容，本次没有可复算的内容。")
        sentences_scanned = sum(int(claim.get("sentence_count") or 0) for claim in claims)

        # ---------- 3. 模型（可降级） ----------
        gateway: LlmGateway | None = None
        if use_llm:
            try:
                gateway = LlmGateway(provider=self._provider or build_provider(self.settings))
            except ProviderNotConfigured as exc:
                notes.append(f"未接入大模型（{exc}）→ 本次改用规则兜底：只认『由 A 增至 B，增长 C%』这类句式，且只报一致。")
        else:
            notes.append("本次显式关闭了大模型 → 规则兜底模式（只报一致）。")

        # ---------- 4. 核查 ----------
        checker = CalculatorChecker(
            llm=gateway,
            tolerance_pct=tolerance_pct,
            concurrency=int(getattr(self.settings, "check_concurrency", 4) or 4),
        )
        context = CheckContext(
            task_id="lab-task",
            batch_id="lab-batch",
            report_id=path.stem,
            report_version_id="v1",
            dimension_code="calc",
            blocks=blocks,
            claims=claims,
        )
        if claims:
            drafts = await checker.check(context)
        else:
            drafts = []

        # ---------- 4.5 复核：把「算不平」的条目带上原文，一次性交给模型确认 ----------
        # 目的：确认是原文算错才作为问题呈现；机器自己配错的要从结果里剔除。
        drafts, review_stats, review_excluded = await review_mismatches(gateway, drafts, claims, notes)

        annotations = drafts_to_annotations(drafts)

        # ---------- 5. 未覆盖/空结果也要说清楚（产品红线：未覆盖 ≠ 通过） ----------
        if not annotations:
            first = claims[0] if claims else {"page": 1, "block_id": blocks[0]["id"], "start_offset": 0, "end_offset": 0}
            why = (
                "本范围内没有定位到可复算的算式。规则模式下这是正常结果（规则只认固定句式）；"
                "接入大模型后可显著提高覆盖率。"
                if gateway is None
                else "模型与规则都没能在这批句子里找到可复算的算式。"
            )
            annotations = [
                {
                    "id": "a0001",
                    "page": int(first["page"]),
                    "block_id": str(first["block_id"]),
                    "start_offset": int(first["start_offset"]),
                    "end_offset": int(first["end_offset"]),
                    "statement": claims[0]["text"] if claims else "（未定位到具体句子）",
                    "expression": "",
                    "normalized": "",
                    "steps": [],
                    "computed": None,
                    "claimed": None,
                    "unit": "",
                    "deviation": None,
                    "rel_deviation": None,
                    "tolerance_pct": tolerance_pct,
                    "status": "uncovered",
                    "risk_level": None,
                    "rule_codes": [],
                    "conclusion": why,
                    "suggestion": None,
                    "confidence": None,
                    "extracted_by": "rule",
                    "extract_reason": "",
                    "scope": "sentence",
                    "scope_label": "",
                    "review_verdict": None,
                    "review_note": None,
                }
            ]
            notes.append("没有产出任何复算结论，已按『未覆盖』如实记录（不是『通过』）。")

        # ---------- 5.5 版面定位：算出每条批注在 PDF 页面上的矩形框 ----------
        # 用户不必再自己满篇找位置：右栏选中卡片 → 左栏那一行直接有框。
        annotations = locate_annotation_rects(str(path), annotations)

        # ---------- 6. 未实现的勾选项说明 ----------
        unsupported = [code for code in types if code not in IMPLEMENTED_TYPE_CODES] if types else []

        stats = {
            "pages_scanned": len(claims),
            "sentences_scanned": sentences_scanned,
            "annotations_total": len(annotations),
            "risk": sum(1 for a in annotations if a["status"] == "risk"),
            "pass": sum(1 for a in annotations if a["status"] == "pass"),
            "uncovered": sum(1 for a in annotations if a["status"] == "uncovered"),
            "extracted_by_llm": sum(1 for a in annotations if a["extracted_by"] == "llm"),
            "extracted_by_rule": sum(1 for a in annotations if a["extracted_by"] == "rule"),
            "dropped_by_validation": int(checker.stats.get("dropped", 0)),
            "cross_skipped": int(checker.stats.get("cross_skipped", 0)),
            "review_candidates": review_stats["candidates"],
            "review_confirmed": review_stats["confirmed"],
            "review_consistent": review_stats["consistent"],
            "review_dropped": review_stats["dropped"],
            "review_unclear": review_stats["unclear"],
            "rects_located": sum(1 for a in annotations if a.get("rects")),
            "self_contained": int(checker.stats.get("self_contained", 0)),
        }

        dropped = int(checker.stats.get("dropped", 0))
        if dropped:
            notes.append(
                f"另有 {dropped} 条算式被本地校验挡下：模型给出的数字/声称值在原文里找不到，"
                "这类「自算自对」的比对没有意义，不计入结论（宁可漏报，不可误报）。"
            )
        cross_skipped = int(checker.stats.get("cross_skipped", 0))
        if cross_skipped:
            notes.append(
                f"另有 {cross_skipped} 条算式借用了上下文基数却「算不平」：跨句推断容易张冠李戴，"
                "这类不直接当问题报，先交模型带原文复核（见下面的复核说明）。"
            )

        self_contained = int(stats["self_contained"])
        if self_contained:
            notes.append(
                f"另有 {self_contained} 条是「本句自证」型的确定性核对（占比之和、分项合计、同句增速）："
                "算式用到的数字全部来自同一句，算不平就是原文有错 —— 这部分不需要模型参与，"
                "也不会被复核推翻（复核只管「需要读懂口径」的那些）。"
            )

        located = int(stats["rects_located"])
        unlocated = len(annotations) - located
        if unlocated > 0:
            notes.append(
                f"另有 {unlocated} 条没能在 PDF 版面上定位到矩形框（PDF 里的文字与抽取出的文本对不上，"
                "常见于表格与跨栏排版）：这些条目只标到页码，不画框 —— 宁可少画，也不把框画到别处。"
            )

        llm_summary = gateway.summary() if gateway else {
            "available": False,
            "model": "",
            "calls": 0,
            "elapsed_ms": 0,
            "tokens_est": 0,
            "failed": 0,
            "detail": [],
        }

        calls = int(llm_summary.get("calls") or 0)
        failed = int(llm_summary.get("failed") or 0)
        if calls and failed == calls:
            # 【必须大声说出来】Key 无效/欠费/断网时模型这条腿整个是断的，但 `available` 仍是 True
            # （它只表示"配了 Key"）。不点破的话，用户会把"没查出来"当成"报告没问题" —— 实测踩过。
            notes.append(
                f"⚠ 本次 {calls} 次模型调用「全部失败」（原因见 llm.detail，常见是 Key 无效 / 欠费 / 网络）："
                "这一轮只剩「本句自证」那类本地确定性核对的结论，覆盖率明显偏低。"
                "这不代表「报告没问题」，而是「没查成」—— 请先修好模型再重跑。"
            )

        return {
            "report_path": str(path),
            "report_name": path.name,
            "pages_total": pages_total,
            "page_range": page_range,
            "requested_types": types,
            "unsupported_types": unsupported,
            "annotations": annotations,
            "review_excluded": review_excluded,
            "stats": stats,
            "llm": llm_summary,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "generated_at": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
            "notes": notes,
        }
