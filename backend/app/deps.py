"""依赖注入：配置、当前用户、分页、并发校验、服务实例。

一条纪律：**路由里的 Depends 只来自这里**（不直接 new 服务、不读环境变量）。
这样将来换存储（内存 -> PostgreSQL）只改这一个文件的装配，路由一行都不用动。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request

from app.api.errors import ApiError, ApiErrorCode
from app.common.pagination import PageParams
from app.config import Settings, get_settings
from app.domain.entities import Claim
from app.schemas.auth import User


@dataclass
class Container:
    """服务容器：应用启动时装配一次（main.py 的 lifespan），路由按需取用。

    现在里面都还是 None —— 实现某个用例时，在装配处塞进真实实例即可，
    路由的写法（Depends(get_container)）保持不变。
    """

    settings: Settings
    report_service: Any = None
    task_service: Any = None
    claim_service: Any = None
    review_service: Any = None
    assess_service: Any = None
    knowledge_service: Any = None
    learning_service: Any = None
    audit_service: Any = None
    help_service: Any = None

    def require(self, name: str) -> Any:
        """取服务；没装配就明确报未实现（不要静默给个空对象）。"""
        value = getattr(self, name, None)
        if value is None:
            raise NotImplementedError(name)
        return value


def get_container(request: Request) -> Container:
    return request.app.state.container


container_dep = Depends(get_container)
settings_dep = Depends(get_settings)
page_dep = Depends(PageParams)


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = settings_dep,      # type: ignore[assignment]
) -> User:
    """当前用户：从 Authorization 解析；演示期允许匿名（settings.allow_anonymous_demo）。

    实现要点：真实现要校验 JWT 并查用户；401 时前端会自动用 refresh 换一次票再重试
    （见 frontend/src/api/client.ts），所以这条接口必须稳定。
    """
    if authorization:
        raise NotImplementedError("鉴权解析（Authorization）")
    if settings.allow_anonymous_demo:
        return User(
            id="user-demo",
            name="演示用户",
            username="demo",
            role="researcher",
            company="RQC 演示",
            permissions=["report:read", "report:write", "review:write"],
        )
    raise ApiError(ApiErrorCode.UNAUTHORIZED, "请先登录")


current_user_dep = Depends(get_current_user)


def page_params(page: int = 1, page_size: int = 20) -> PageParams:
    """分页参数（query 上直接写 ?page=1&page_size=20）。"""
    return PageParams(page=page, page_size=page_size)


def if_match_revision(if_match: Annotated[str | None, Header()] = None) -> int | None:
    """复核提交的并发校验头：If-Match: <claim.revision>。

    不一致时由 review_service 抛 409 CLAIM_REVISION_CONFLICT（前端会提示"别人先改了这条"）。
    """
    if if_match is None:
        return None
    try:
        return int(if_match.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Match 必须是整数 revision") from None


def ensure_revision(claim: Claim, revision: int | None) -> None:
    """比较 revision；不一致 -> 409（放在这里，避免每个路由各写一遍）。"""
    if revision is not None and revision != claim.revision:
        raise ApiError(
            ApiErrorCode.CLAIM_REVISION_CONFLICT,
            "这条结论已经被别人改过了，请刷新后重试",
            {"expected": claim.revision, "got": revision},
        )
