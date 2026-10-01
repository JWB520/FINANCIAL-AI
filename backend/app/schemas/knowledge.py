"""知识库契约（对应前端 endpoints/knowledge.ts）。

知识点：资料类型（type）决定它支撑哪个维度；缺某类资料时，相关维度必须返回
uncovered（带原因），而不是"跳过不报" —— 前端 DimensionPicker 会据此提示用户去补资料。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import CONTRACT_CONFIG, Id, IsoDateTime

KnowledgeType = Literal["norm", "valuation", "forbidden_expr", "metric_def", "case", "external_report"]
ParseStatus = Literal["pending", "parsing", "done", "failed"]


class KnowledgeDoc(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    type: KnowledgeType
    title: str
    version: int = 1
    enabled: bool = True
    effective_from: str | None = None
    scope: list[str] = Field(default_factory=list)
    file_uri: str | None = None
    chunk_count: int = 0
    parse_status: ParseStatus = "pending"
    parse_error: str | None = None
    uploaded_by: str = ""
    created_at: IsoDateTime


class KnowledgeChunk(BaseModel):
    """分片（排查"为什么这条规范没被检索到"时看它）。"""

    model_config = CONTRACT_CONFIG

    id: Id
    doc_id: Id
    doc_title: str
    chunk_index: int
    text: str
    meta: dict[str, str] | None = None


class ToggleDocRequest(BaseModel):
    enabled: bool


class KnowledgeDocParams(BaseModel):
    type: KnowledgeType | None = None
    q: str | None = None
