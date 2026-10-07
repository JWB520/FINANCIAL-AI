"""文本工具：片段定位、偏移计算、摘要。

【为什么这一层不能马虎】前端的高亮靠字符偏移：ClaimSpan / Evidence 的
start_offset / end_offset 必须是**全文绝对区间**，错一位就整条高亮错位
（前端有 20 项断言在防这件事，但它防不住后端给错数据）。
所以偏移一律由这里算，**禁止在别处手写偏移**。

【全文偏移的口径】（与前端 frontend/src/pages/reviews/ClaimReviewPage.tsx 的
`totalChars = Σ(block.text.length + 1)` 一致）：块与块之间算 **1 个字符**（换行），
所以第 i 块的起点 = 前面所有块的 (len + 1) 之和。两侧必须用同一个口径，
否则高亮会整体偏移。
"""
from __future__ import annotations

import re


def locate(block_text: str, snippet: str) -> tuple[int, int]:
    """在块文本里找片段，返回块内相对区间 (start, end)；找不到返回 (-1, -1)。

    只在**第一个**命中位置返回。找不到就明确返回 -1（调用方据此把结论标成
    uncovered / error），绝不"猜"一个位置 —— 猜出来的偏移会让高亮整条错位。
    """
    if not block_text or not snippet:
        return (-1, -1)
    start = block_text.find(snippet)
    if start < 0:
        return (-1, -1)
    return (start, start + len(snippet))


def to_absolute(block_start_offset: int, relative_start: int, relative_end: int) -> tuple[int, int]:
    """把块内相对区间换成全文绝对区间（前端要的就是绝对区间）。"""
    if relative_start < 0 or relative_end < 0:
        return (-1, -1)
    return (block_start_offset + relative_start, block_start_offset + relative_end)


def excerpt(text: str, limit: int = 60) -> str:
    """生成摘要（复核队列里的 excerpt 用它）。"""
    cleaned = " ".join(text.split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


# ---------------------------------------------------------------------------
# 以下为"数字复算"实验新增（本文件仍是偏移的唯一出口）
# ---------------------------------------------------------------------------

# 句末标点：中文句号/分号/问号/叹号，以及英文 ! ? ;
# 注意：**半角句点 "." 不在此列** —— 它在数字里到处都是（26.48 / 1.23%），
# 无脑按它切会把"实现营收26.48 亿元"切成"实现营收26"和"48 亿元"。
# 半角句点单独用 is_sentence_end() 判断（后面必须是空白或行尾才算句末）。
_SENTENCE_END = "。！？；!?;"

# 含阿拉伯数字（含小数、千分位、百分号、亿元万元等单位里的数字）
_HAS_DIGIT = re.compile(r"\d")


def is_sentence_end(text: str, index: int) -> bool:
    """text[index] 是不是句末标点（供切句用）。

    半角句点要额外看后一个字符：`"up 40.0% year on year."` 末尾的 "." 是句末，
    而 `26.48` 里的 "." 不是 —— 判错的代价是整句话被切碎，抽不出算式（实测踩过）。
    """
    ch = text[index]
    if ch in _SENTENCE_END:
        return True
    if ch == ".":
        nxt = text[index + 1] if index + 1 < len(text) else ""
        return nxt == "" or nxt.isspace()
    return False


def normalize_ws(text: str) -> str:
    """把块内空白归一化成单个空格。

    为什么必须做：PDF 抽出来的段落里换行/制表符/连续空格混在一起，
    如果不归一化，同一句话在"解析结果"与"前端展示"里长度不同 → 偏移对不上。
    """
    return " ".join(text.split())


def split_sentences_with_offsets(text: str, max_len: int = 220) -> list[tuple[int, int, str]]:
    """把一段文本切成句子，**同时给出每句在块内的字符区间** (start, end, 句子)。

    规则：
      1. 先按句末标点切（。！？；!?;）；
      2. 仍然超过 max_len 的长句，再按逗号/顿号切一刀（研报里常见一逗到底的长句，
         整句丢给模型会淹掉真正要复算的那个数）。
    区间是 strip 之后的（前后空白不计入），这样交给前端的 start/end 与它拿到的
    文本逐字对应 —— 前端高亮有断言在防"区间与文本不一致"。
    """
    if not text:
        return []

    out: list[tuple[int, int, str]] = []

    def push(a: int, b: int) -> None:
        seg = text[a:b]
        stripped = seg.strip()
        if not stripped:
            return
        lead = len(seg) - len(seg.lstrip())
        out.append((a + lead, a + lead + len(stripped), stripped))

    cursor = 0
    for idx in range(len(text)):
        if is_sentence_end(text, idx):
            push(cursor, idx + 1)
            cursor = idx + 1
    if cursor < len(text):
        push(cursor, len(text))

    # 长句再切（只对超长句生效，普通句子保持原样）
    final: list[tuple[int, int, str]] = []

    def emit(a: int, b: int) -> None:
        seg = text[a:b]
        stripped = seg.strip()
        if not stripped:
            return
        lead = len(seg) - len(seg.lstrip())
        start0, end0 = a + lead, a + lead + len(stripped)
        if len(stripped) <= max_len:
            final.append((start0, end0, stripped))
            return
        # 最后兜底：切完还超长（整段没有逗号）就按 max_len 硬切。
        # 硬切出来的"句子"语义上不完整，但它只是喂给模型的最小单位，
        # 不参与对外展示的原文区间 —— 所以宁愿硬切，也不让一条提示词被撑爆。
        pos = start0
        while pos < end0:
            nxt = min(pos + max_len, end0)
            final.append((pos, nxt, text[pos:nxt]))
            pos = nxt

    for start, end, sentence in out:
        if len(sentence) <= max_len:
            final.append((start, end, sentence))
            continue
        cut = start
        for i in range(start, end):
            if text[i] in "，,、" and i - cut + 1 >= max_len:
                emit(cut, i + 1)
                cut = i + 1
        emit(cut, end)
    return final


def split_sentences(text: str, max_len: int = 220) -> list[str]:
    """只要句子文本（不需要区间时用它）。"""
    return [sentence for _start, _end, sentence in split_sentences_with_offsets(text, max_len)]


def has_number(text: str) -> bool:
    """是否含阿拉伯数字（"含数字的句子"的判定，第一步筛选用）。"""
    return bool(_HAS_DIGIT.search(text or ""))
