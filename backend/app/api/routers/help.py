"""帮助文档路由（对应前端 endpoints/help.ts）。

帮助内容走后端接口 —— 改文案不用发版。分组沿用既有五组：
    开始使用 / 核心概念 / 复核流程 / 资料与知识库 / 常见问题
slug 一旦发布不许改（结论卡片上的 ? 按钮按 slug 跳转）。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.schemas.help import HelpArticle

router = APIRouter(tags=["帮助"])


@router.get("/help/articles", response_model=list[HelpArticle], summary="帮助文章列表")
async def list_articles() -> list[HelpArticle]:
    not_implemented("GET /help/articles")


@router.get("/help/articles/{slug}", response_model=HelpArticle, summary="按 slug 取一篇")
async def get_article(slug: str) -> HelpArticle:
    not_implemented("GET /help/articles/{slug}")
