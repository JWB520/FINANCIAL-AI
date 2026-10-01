"""经验学习路由（对应前端 endpoints/learning.ts）—— P2，但删除规矩最多。

三条删除的规矩不一样（BACKEND.md §4.5），实现时照这张表：
    候选 /learning/candidates/{id}  任何状态都能删；已审核过的必须带 reason，否则 400
    案例 /learning/cases/{id}       任何状态都能删
    版本 /learning/versions/{id}    任何状态都能删（含生效中）；删生效中的要把同 key
                                    最近的历史版本切回 active，并用 promoted 告知切到了哪一版
删除一律写审计事件；**不要用 409 拒绝删除** —— 能删 + 自动兜底，比不许删好。
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.errors import not_implemented
from app.common.pagination import Page, PageParams
from app.deps import page_dep
from app.schemas.learning import (
    ExperienceCase,
    LearningCandidate,
    PromoteResult,
    ReviewCandidateRequest,
    RuleVersion,
)

router = APIRouter(tags=["经验学习"])


@router.get("/learning/cases", response_model=Page[ExperienceCase], summary="经验案例")
async def list_cases(page: PageParams = page_dep) -> Page[ExperienceCase]:
    not_implemented("GET /learning/cases")


@router.get("/learning/candidates", response_model=Page[LearningCandidate], summary="学习候选")
async def list_candidates(state: str | None = None, page: PageParams = page_dep) -> Page[LearningCandidate]:
    not_implemented("GET /learning/candidates")


@router.post("/learning/candidates", response_model=list[LearningCandidate], summary="手动触发候选生成")
async def generate_candidates() -> list[LearningCandidate]:
    """候选由人工裁决（尤其"驳回 + 理由"）归纳而来，不会自动生效。"""
    not_implemented("POST /learning/candidates")


@router.post("/learning/candidates/{candidate_id}/review", response_model=LearningCandidate, summary="审核候选（通过=发布新版本）")
async def review_candidate(candidate_id: str, body: ReviewCandidateRequest) -> LearningCandidate:
    """驳回必须填理由（理由不齐等于制造噪声）；通过则生成一个新版本并立即生效。"""
    not_implemented("POST /learning/candidates/{candidateId}/review")


@router.get("/learning/versions", response_model=Page[RuleVersion], summary="规则版本列表")
async def list_versions(page: PageParams = page_dep) -> Page[RuleVersion]:
    not_implemented("GET /learning/versions")


@router.post("/learning/versions/{version_id}/rollback", response_model=RuleVersion, summary="回滚（生成新版本，不删历史）")
async def rollback_version(version_id: str) -> RuleVersion:
    not_implemented("POST /learning/versions/{versionId}/rollback")


@router.delete("/learning/candidates/{candidate_id}", summary="删除候选（已审核过的必须带 reason）")
async def delete_candidate(
    candidate_id: str,
    reason: str | None = Query(default=None, description="已审核过的候选必填"),
) -> dict[str, bool]:
    not_implemented("DELETE /learning/candidates/{candidateId}")


@router.delete("/learning/cases/{case_id}", summary="删除案例（任何状态都能删）")
async def delete_case(case_id: str) -> dict[str, bool]:
    not_implemented("DELETE /learning/cases/{caseId}")


@router.delete("/learning/versions/{version_id}", response_model=PromoteResult, summary="删除版本（含生效中，会自动切回上一版）")
async def delete_version(version_id: str) -> PromoteResult:
    """删生效中的版本 -> 自动把同 key 最近历史版本切回 active，并在 promoted 里告知。"""
    not_implemented("DELETE /learning/versions/{versionId}")
