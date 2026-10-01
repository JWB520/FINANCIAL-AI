"""帮助文档用例：列表与按 slug 取单篇（内容可入库，也可先用静态文件）。"""
from __future__ import annotations

from typing import Any


class HelpService:
    async def list_articles(self) -> list[Any]:
        raise NotImplementedError("HelpService.list_articles")

    async def get_article(self, slug: str) -> Any:
        raise NotImplementedError("HelpService.get_article")
