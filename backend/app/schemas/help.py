"""帮助文档契约（对应前端 endpoints/help.ts）。

帮助内容走后端接口（改文案不用发版）。前端按 group 分组、按 slug 跳转，
所以 group 沿用既有五组、slug 一旦发布不许改。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import CONTRACT_CONFIG, IsoDateTime


class HelpArticle(BaseModel):
    model_config = CONTRACT_CONFIG

    id: str
    group: str
    title: str
    slug: str
    content: str = Field(description="正文，用 \n 分段")
    updated_at: IsoDateTime
