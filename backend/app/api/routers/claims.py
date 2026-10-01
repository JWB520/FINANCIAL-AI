"""主张与结论路由（对应前端 endpoints/claims.ts）—— 人工裁决的入口在这里。

【P0】POST /claims/{id}/reviews 是七条里最后一条：复核做不了，整个"人工复核"主线就断了。
【红线】驳回必须带理由（缺理由 400 REVIEW_REASON_REQUIRED）；
       提交要带 If-Match: <revision>，不一致 409 CLAIM_REVISION_CONFLICT。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api import sse_util
from app.api.errors import not_implemented
from app.deps import current_user_dep, if_match_revision
from app.schemas.auth import User
from app.schemas.claim import (
    ClaimWithFindings,
    Finding,
    FindingDetail,
    ReviewAction,
    SubmitReviewRequest,
)
from app.schemas.sse import AskRequest

router = APIRouter(tags=["主张与复核"])


@router.get("/claims/{claim_id}", response_model=ClaimWithFindings, summary="主张详情（含结论与三态结论）")
async def get_claim(claim_id: str) -> ClaimWithFindings:
    not_implemented("GET /claims/{claimId}")


@router.get("/claims/{claim_id}/findings", response_model=list[Finding], summary="该主张在各维度下的全部结论")
async def list_claim_findings(claim_id: str) -> list[Finding]:
    """一条主张可能同时命中多个维度：前端会把它们都列出来（结论卡片可以切换）。"""
    not_implemented("GET /claims/{claimId}/findings")


@router.get("/findings/{finding_id}", response_model=FindingDetail, summary="单条结论详情（证据 / 核算 / 规则 / 复核历史）")
async def get_finding(finding_id: str) -> FindingDetail:
    not_implemented("GET /findings/{findingId}")


@router.post("/claims/{claim_id}/reviews", response_model=ReviewAction, summary="★ 提交人工裁决")
async def submit_review(
    claim_id: str,
    body: SubmitReviewRequest,
    revision: int | None = Depends(if_match_revision),
    user: User = current_user_dep,
) -> ReviewAction:
    """接受 / 驳回 / 标记已核实 / 补充证据 / 人工修改。

    校验顺序（写实现时照这个顺序，前端提示才对得上）：
      1. action=reject 且没填 reason -> 400 REVIEW_REASON_REQUIRED；
      2. If-Match 与 claim.revision 不一致 -> 409 CLAIM_REVISION_CONFLICT；
      3. 写入后 claim.revision + 1，并写一条审计事件（review_action）。
    """
    not_implemented("POST /claims/{claimId}/reviews")


@router.get("/claims/{claim_id}/reviews", response_model=list[ReviewAction], summary="复核历史（只追加，AI 原始结论永远可见）")
async def list_reviews(claim_id: str) -> list[ReviewAction]:
    not_implemented("GET /claims/{claimId}/reviews")


@router.post("/claims/{claim_id}/ask", summary="单条追问 SSE（chunk / done）")
async def ask_claim(claim_id: str, body: AskRequest) -> StreamingResponse:
    """受限对话：只围绕这一条结论回答。

    注意：追问的回答**不会写进核查结论**（前端帮助里也这么写）。事件格式见 sse_util。
    """
    async def _stream():
        async for chunk in sse_util.heartbeat_stream():
            yield chunk

    return StreamingResponse(_stream(), media_type="text/event-stream", headers=sse_util.SSE_HEADERS)
