"""鉴权路由（对应前端 endpoints/auth.ts）。

四条接口 + 一个 /me。演示期 get_current_user 允许匿名，所以前端不登也能跑通主流程；
真实现时把 deps.get_current_user 换成 JWT 校验即可（路由不用动）。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.errors import not_implemented
from app.deps import current_user_dep
from app.schemas.auth import LoginRequest, LoginResult, RefreshRequest, RegisterRequest, User

router = APIRouter(tags=["鉴权"])


@router.post("/auth/login", response_model=LoginResult, summary="登录")
async def login(body: LoginRequest) -> LoginResult:
    """返回 access / refresh / user；前端把令牌存本地，401 时用 refresh 自动续期一次。"""
    not_implemented("POST /auth/login")


@router.post("/auth/register", response_model=LoginResult, summary="注册")
async def register(body: RegisterRequest) -> LoginResult:
    """注册：公司 + 角色（比赛演示用，正式环境应由管理员开户）。"""
    not_implemented("POST /auth/register")


@router.post("/auth/refresh", response_model=LoginResult, summary="用 refresh 换新令牌")
async def refresh(body: RefreshRequest) -> LoginResult:
    """★ 前端在 401 时自动调用一次，所以这条必须稳定（换不到才跳登录页）。"""
    not_implemented("POST /auth/refresh")


@router.post("/auth/logout", summary="退出")
async def logout(user: User = current_user_dep) -> dict[str, bool]:
    """前端同时清本地令牌；后端把 refresh 置为失效。"""
    not_implemented("POST /auth/logout")


@router.get("/me", response_model=User, summary="当前用户（刷新页面恢复登录态）")
async def me(user: User = current_user_dep) -> User:
    not_implemented("GET /me")
