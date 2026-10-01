"""解析入库用例：PDF/Word -> 原文块（带准确的字符区间）。

对应阶段：StageCode.PARSE
实现要点：偏移必须由 common/text.locate 算，**禁止手写**；分块要保留 section_path。
"""
from __future__ import annotations

from typing import Any


class IngestService:
    async def parse_and_store(self, version_id: str, file_path: str) -> list[Any]:
        raise NotImplementedError("IngestService.parse_and_store")
