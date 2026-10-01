"""文本工具：片段定位、偏移计算、摘要。

【为什么这一层不能马虎】前端的高亮靠字符偏移：ClaimSpan / Evidence 的
start_offset / end_offset 必须是**全文绝对区间**，错一位就整条高亮错位
（前端有 20 项断言在防这件事，但它防不住后端给错数据）。
所以偏移一律由这里算，**禁止在别处手写偏移**。
"""
from __future__ import annotations


def locate(block_text: str, snippet: str) -> tuple[int, int]:
    """在块文本里找片段，返回块内相对区间 (start, end)；找不到返回 (-1, -1)。"""
    raise NotImplementedError


def to_absolute(block_start_offset: int, relative_start: int, relative_end: int) -> tuple[int, int]:
    """把块内相对区间换成全文绝对区间（前端要的就是绝对区间）。"""
    raise NotImplementedError


def excerpt(text: str, limit: int = 60) -> str:
    """生成摘要（复核队列里的 excerpt 用它）。"""
    cleaned = " ".join(text.split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"
