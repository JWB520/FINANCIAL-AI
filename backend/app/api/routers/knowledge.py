"""知识库路由（对应前端 endpoints/knowledge.ts）—— P2。

资料类型（type）决定它支撑哪个维度：norm -> 规范核查、valuation -> 估值核查、
forbidden_expr / metric_def -> 规范与口径、case -> 历史参考、external_report -> 观点交叉验证。
启停只影响**后续任务**（历史结论不动，这是用户能理解的口径）。
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.knowledge import KnowledgeChunk, KnowledgeDoc, ToggleDocRequest

router = APIRouter(tags=["知识库"])


@router.get("/knowledge/docs", response_model=Page[KnowledgeDoc], summary="文档列表")
async def list_docs(type: str | None = None, q: str | None = None, page: PageParams = page_dep) -> Page[KnowledgeDoc]:
    not_implemented("GET /knowledge/docs")


@router.post("/knowledge/docs", response_model=KnowledgeDoc, summary="上传资料（multipart；type 决定支撑哪个维度）")
async def upload_doc(
    file: UploadFile = File(...),
    type: str = Form(...),
    title: str = Form(...),
    scope: str | None = Form(default=None),
) -> KnowledgeDoc:
    not_implemented("POST /knowledge/docs")


@router.patch("/knowledge/docs/{doc_id}/enable", response_model=KnowledgeDoc, summary="启停（只影响后续任务）")
async def toggle_doc(doc_id: str, body: ToggleDocRequest) -> KnowledgeDoc:
    not_implemented("PATCH /knowledge/docs/{docId}/enable")


@router.delete("/knowledge/docs/{doc_id}", summary="删除（软删，审计保留）")
async def delete_doc(doc_id: str) -> dict[str, bool]:
    """软删：数据打标记，审计里留一条 *_deleted 事件 —— "东西怎么没了"永远查得到。"""
    not_implemented("DELETE /knowledge/docs/{docId}")


@router.get("/knowledge/chunks", response_model=Page[KnowledgeChunk], summary="分片列表")
async def list_chunks(doc_id: str | None = None, page: PageParams = page_dep) -> Page[KnowledgeChunk]:
    """排查"为什么这条规范没被检索到"时看它（切片、召回、相似度都在这里对）。"""
    not_implemented("GET /knowledge/chunks")
