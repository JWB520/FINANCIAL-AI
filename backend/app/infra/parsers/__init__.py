"""文档解析：PDF / Word -> 原文块（Block 列表）。

【这一层最容易埋雷】块必须**覆盖全文且不重叠**，start/end offset 是全文绝对区间。
建议：解析完立刻做一次自检 —— 把所有块的 text 按顺序拼起来应当与原文一致
（前端 verify:core 里就有"原文无损"的断言，后端也该有同样的一条）。
"""
from __future__ import annotations

from typing import Any


class Parser:
    def parse(self, file_path: str) -> list[Any]:
        raise NotImplementedError("解析文档 -> 原文块")
