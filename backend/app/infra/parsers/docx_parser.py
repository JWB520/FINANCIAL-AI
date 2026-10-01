"""Word 解析：段落 + 表格单元格都要抽出来（表格里的数字经常是核查重点）。"""
from __future__ import annotations

from typing import Any


def parse_docx(file_path: str) -> list[Any]:
    raise NotImplementedError("Word 解析")
