"""PDF 解析：优先取文本层；扫描件走 OCR（可选）。

实现要点：
  1. 每页 -> 若干段，段落之间的换行要归一化，否则 offset 与前端展示不一致；
  2. 标题/表格/图注分别标 block_type（heading / table_cell / caption）；
  3. 解析失败要抛 REPORT_PARSE_FAILED（前端会提示"换一个可复制文本的版本"）。

【本文件做了两件超出原始注释的事，因为"数字复算"实验要按页定位到 PDF 原件】
  · 每个块都带 `page`（1 起）——前端要靠它把批注跳到 PDF 的第几页；
  · 每个块都带 `start_offset` / `end_offset`（**全文绝对区间**，口径见 common/text.py 顶部），
    同一份文本的字符区间在"后端解析"与"前端高亮"两侧必须一致。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from app.common.text import normalize_ws


class PdfParseError(RuntimeError):
    """解析失败（前端映射为 422 REPORT_PARSE_FAILED）。"""


@dataclass
class ParsedBlock:
    id: str
    block_index: int
    block_type: str        # heading / paragraph / table_cell / caption
    page: int              # 1 起
    text: str
    start_offset: int      # 全文绝对区间（含块间 1 个换行字符的口径）
    end_offset: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _classify(text: str) -> str:
    """块类型启发式判定。

    目的只有一个：让前端知道"这段是不是标题/表格"，不至于把表头当成正文结论。
    判定错不致命，所以这里用便宜可靠的特征，不上版面分析。
    """
    stripped = text.strip()
    if not stripped:
        return "paragraph"
    # 图注 / 表注
    if stripped.startswith(("图", "表", "图表", "资料来源", "数据来源", "注：", "注:")):
        return "caption"
    # 标题：短、没有句末标点、且不是一整句大白话
    if len(stripped) <= 30 and not stripped.endswith(("。", "；", "，", "、", "：", ":", ".", "%")):
        return "heading"
    # 表格行：以竖线/多个连续空格分隔的列，且含数字
    if ("|" in stripped or "  " in stripped) and any(ch.isdigit() for ch in stripped):
        return "table_cell"
    return "paragraph"


def parse_pdf(file_path: str, *, max_pages: int | None = None) -> list[dict[str, Any]]:
    """把 PDF 解析成带页码与全文偏移的块列表。

    参数
    ----
    file_path : PDF 绝对路径
    max_pages : 只解析前 N 页（演示 / 大文件用法；None = 全篇）

    返回
    ----
    list[dict]，每项字段见 ParsedBlock；按 (page, 块内顺序) 排好，block_index 连续。

    抛错
    ----
    PdfParseError：文件不存在 / 打不开 / 没有文本层（扫描件）。
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - 环境缺依赖时给明确提示
        raise PdfParseError("缺少 PyMuPDF（pip install pymupdf）") from exc

    try:
        doc = fitz.open(file_path)
    except Exception as exc:  # noqa: BLE001 - 统一转成领域错误
        raise PdfParseError(f"打不开文件：{exc}") from exc

    blocks: list[dict[str, Any]] = []
    offset_cursor = 0
    text_chars = 0

    try:
        page_total = doc.page_count
        limit = page_total if max_pages is None else min(page_total, max_pages)
        for page_no in range(1, limit + 1):
            page = doc.load_page(page_no - 1)
            # "blocks" 模式会替我们做段落聚合，比逐行更接近"一段话"的粒度
            raw = page.get_text("blocks") or []
            for entry in raw:
                # entry = (x0, y0, x1, y1, text, block_no, block_type)；block_type=1 是图片
                if len(entry) < 7 or entry[6] != 0:
                    continue
                text = normalize_ws(str(entry[4] or ""))
                if not text:
                    continue
                text_chars += len(text)
                block = ParsedBlock(
                    id=f"b{len(blocks) + 1:04d}",
                    block_index=len(blocks),
                    block_type=_classify(text),
                    page=page_no,
                    text=text,
                    start_offset=offset_cursor,
                    end_offset=offset_cursor + len(text),
                )
                blocks.append(block.to_dict())
                # 块间算 1 个换行字符（与前端 totalChars 口径一致）
                offset_cursor += len(text) + 1
    finally:
        doc.close()

    if not blocks or text_chars < 50:
        raise PdfParseError(
            "这份 PDF 没有可复制的文本层（可能是扫描件或图片版），无法逐句复算。"
            "请改用可复制文本的版本。"
        )
    return blocks


def page_offsets(blocks: list[dict[str, Any]]) -> dict[int, tuple[int, int]]:
    """页码 -> (该页首个字符的全文偏移, 该页最后一个字符的全文偏移)。

    前端拿着批注的绝对偏移，就能算出"这条批注在第几页"。
    """
    result: dict[int, tuple[int, int]] = {}
    for block in blocks:
        page = int(block["page"])
        start = int(block["start_offset"])
        end = int(block["end_offset"])
        if page not in result:
            result[page] = (start, end)
        else:
            old_start, old_end = result[page]
            result[page] = (min(old_start, start), max(old_end, end))
    return result


def merge_blocks_by_page(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把每页的块按顺序拼回**连续文本**，供切句使用。

    【为什么非做不可（实测踩到的坑）】
      PDF 抽出来的块是按版面切的：一句话常被切成 3~4 块，例如
        "实现营收26.48 亿元，同比下降1.0%，实现归母净利润5.39 亿元，同比增长"
        "10.0%，实现扣非归母净利润4.65 亿元，同比增长56.0%。"
      不在块内拼回来，切出来的"句子"都是半截话，模型与规则都抽不出算式 ——
      实测一份真实研报：只按块切句，命中 0 条可复算量。

    【拼接方式为什么是"单个空格"】
      全文偏移的口径是"块与块之间算 1 个字符"（见 common/text.py）。
      这里每块之间正好插 1 个空格，于是**页内相对位置 = 全文偏移 - 页起始偏移**，
      线性对应，切出来的句子区间可以直接加基数变成绝对区间，不需要任何查找表。

    返回每项：{page, start_offset, end_offset, text, spans[(rel_start, rel_end, block_id)]}
    """
    grouped: dict[int, list[dict[str, Any]]] = {}
    for block in blocks:
        grouped.setdefault(int(block["page"]), []).append(block)

    merged: list[dict[str, Any]] = []
    for page in sorted(grouped):
        items = sorted(grouped[page], key=lambda item: int(item["block_index"]))
        text_parts: list[str] = []
        spans: list[tuple[int, int, str]] = []
        cursor = 0
        for item in items:
            piece = str(item["text"])
            spans.append((cursor, cursor + len(piece), str(item["id"])))
            text_parts.append(piece)
            cursor += len(piece) + 1  # +1 = 块间分隔（口径与全文偏移一致）
        merged.append(
            {
                "page": page,
                "start_offset": int(items[0]["start_offset"]),
                "end_offset": int(items[-1]["end_offset"]),
                "text": " ".join(text_parts),
                "spans": spans,
            }
        )
    return merged


def locate_block_id(page_info: dict[str, Any], rel_offset: int) -> str:
    """页内相对偏移 -> 它落在哪个块（批注要指回块，供前端定位）。"""
    spans: list[tuple[int, int, str]] = page_info.get("spans") or []
    for start, end, block_id in spans:
        if start <= rel_offset < end:
            return block_id
    return spans[-1][2] if spans else ""


# ============================================================================
# 批注在版面上的**矩形框**（"别让我满篇找它在哪一行"）
#
# 为什么这件事必须后端做：前端左栏渲染的是**位图 canvas**（pdf.js 页面渲染），
# 到手的东西没有字符坐标；只有 PDF 解析器能拿到每个词的 x/y。
# 所以这里用 `page.get_text("words")` 取词级坐标，按批注的原文句子把词框并成行框。
#
# 坐标口径：PyMuPDF 的左上原点、单位是点（pt）；返回时**同时给出页面宽高**，
# 前端只要按百分比摆放（left = x0/宽*100%）就与缩放、高分屏、DPR 全部无关。
# ============================================================================

# 一条批注最多给几个行框（超过就退化成一个大框，避免把整页画满）
MAX_RECTS_PER_ANNOTATION = 6


def _strip_ws(text: str) -> str:
    """去掉所有空白字符。

    【为什么必须先去空白再匹配】解析侧（`get_text("blocks")` + normalize_ws）与
    词级抽取（`get_text("words")`）对空格/换行的处理不一样，同一句话在两边的字符串
    不逐字相同。把两边的空白都去掉再比，才能稳稳匹配上；而"哪几个词覆盖了这段话"
    是能通过逐词累计长度反推出来的（见 `_find_word_span`）。
    """
    return "".join(ch for ch in text if not ch.isspace())


def _page_words(page: Any) -> list[dict[str, Any]]:
    """取一页的词级框：{x0,y0,x1,y1,text}，按 PDF 给出的阅读顺序。"""
    words: list[dict[str, Any]] = []
    for entry in page.get_text("words") or []:
        if len(entry) < 5:
            continue
        text = str(entry[4] or "")
        if not text.strip():
            continue
        words.append(
            {
                "x0": float(entry[0]),
                "y0": float(entry[1]),
                "x1": float(entry[2]),
                "y1": float(entry[3]),
                "text": text,
            }
        )
    return words


def _find_word_span(words: list[dict[str, Any]], target: str) -> tuple[int, int] | None:
    """在词序列里找出覆盖 target 的词下标区间 [start, end]（忽略空白）。找不到返回 None。"""
    needle = _strip_ws(target)
    if not needle:
        return None
    # 逐词累计长度：拼接串里第 k 个字符属于哪个词，全靠这份 mapping 反查
    mapping: list[int] = []
    for index, word in enumerate(words):
        mapping.extend([index] * len(_strip_ws(str(word["text"]))))
    haystack = "".join(_strip_ws(str(word["text"])) for word in words)
    position = haystack.find(needle)
    if position < 0:
        return None
    end = min(position + len(needle), len(mapping)) - 1
    return mapping[position], mapping[max(position, end)]


def _merge_word_boxes(words: list[dict[str, Any]], start: int, end: int) -> list[dict[str, float]]:
    """把若干词的框按行合并成行框（同一行的词并成一个，读起来才像一个高亮）。"""
    picked = words[start : end + 1]
    if not picked:
        return []
    lines: list[dict[str, float]] = []
    for word in sorted(picked, key=lambda item: (round(float(item["y0"]), 1), float(item["x0"]))):
        height = max(float(word["y1"]) - float(word["y0"]), 1.0)
        center = (float(word["y0"]) + float(word["y1"])) / 2
        for line in lines:
            if abs(center - (line["y0"] + line["y1"]) / 2) <= max(height / 2, 3.0):
                line["x0"] = min(line["x0"], float(word["x0"]))
                line["y0"] = min(line["y0"], float(word["y0"]))
                line["x1"] = max(line["x1"], float(word["x1"]))
                line["y1"] = max(line["y1"], float(word["y1"]))
                break
        else:
            lines.append(
                {"x0": float(word["x0"]), "y0": float(word["y0"]), "x1": float(word["x1"]), "y1": float(word["y1"])}
            )
    if len(lines) > MAX_RECTS_PER_ANNOTATION:
        # 行数太多（模型摘的句子跨了半页）→ 退化成一个大框，别把整页画成霓虹灯
        return [
            {
                "x0": min(line["x0"] for line in lines),
                "y0": min(line["y0"] for line in lines),
                "x1": max(line["x1"] for line in lines),
                "y1": max(line["y1"] for line in lines),
            }
        ]
    return [
        # 四周各留 1 点内边距：纯字形框贴在字上看着像把字切了
        {"x0": line["x0"] - 1, "y0": line["y0"] - 1, "x1": line["x1"] + 1, "y1": line["y1"] + 1}
        for line in lines
    ]


def locate_text_boxes(file_path: str, targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """给每条批注算出它在 PDF 版面上的矩形框。

    参数
    ----
    targets : [{"page": 1, "statement": "原文那句话", "number": "60.67"}]
              statement 优先（它是模型摘的原文，最准）；找不到时退回用 number 定位
              （数字几乎不会被抽取器改写，是最稳的兜底锚点）。

    返回
    ----
    与 targets 等长的列表，每项：
      {"rects": [{"x0","y0","x1","y1"}...], "page_width": float, "page_height": float,
       "rect_match": "statement" | "number" | "none"}

    【拿不到坐标时返回空列表，绝不猜一个位置】旋转页（`page.rotation != 0`）的坐标换算没做，
    本实验的研报也不涉及；宁可这一条不画框，也不能把框画到别的地方去。
    """
    results: list[dict[str, Any]] = [
        {"rects": [], "page_width": 0.0, "page_height": 0.0, "rect_match": "none"} for _ in targets
    ]
    by_page: dict[int, list[int]] = {}
    for index, target in enumerate(targets):
        by_page.setdefault(int((target or {}).get("page") or 0), []).append(index)
    if not any(by_page):
        return results

    try:
        import fitz  # PyMuPDF

        doc = fitz.open(file_path)
    except Exception:  # noqa: BLE001 - 定位失败不能影响主结果（只是这条没框）
        return results

    try:
        for page_no, indices in by_page.items():
            if page_no < 1 or page_no > doc.page_count:
                continue
            page = doc.load_page(page_no - 1)
            width = float(page.rect.width)
            height = float(page.rect.height)
            for index in indices:
                results[index]["page_width"] = width
                results[index]["page_height"] = height
            if int(getattr(page, "rotation", 0) or 0) % 360 != 0:
                continue  # 旋转页：不画（见函数说明）
            words = _page_words(page)
            if not words:
                continue
            for index in indices:
                target = targets[index] or {}
                span = _find_word_span(words, str(target.get("statement") or ""))
                match = "statement"
                if span is None:
                    number = str(target.get("number") or "").strip()
                    span = _find_word_span(words, number) if number else None
                    match = "number"
                if span is None:
                    continue
                results[index]["rects"] = _merge_word_boxes(words, span[0], span[1])
                results[index]["rect_match"] = match
    finally:
        doc.close()
    return results
