"""PDF 解析：优先取文本层；扫描件走 OCR（可选）。

实现要点：
  1. 每页 -> 若干段，段落之间的换行要归一化，否则 offset 与前端展示不一致；
  2. 标题/表格/图注分别标 block_type（heading / table_cell / caption）；
  3. 解析失败要抛 REPORT_PARSE_FAILED（前端会提示"换一个可复制文本的版本"）。
"""
from __future__ import annotations

from typing import Any


def parse_pdf(file_path: str) -> list[Any]:
    raise NotImplementedError("PDF 解析")
