"""鉴权契约（对应前端 endpoints/auth.ts）。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import CONTRACT_CONFIG, Id

UserRole = Literal["researcher", "reviewer", "admin"]


class User(BaseModel):
    model_config = CONTRACT_CONFIG

    id: Id
    name: str
    username: str
    role: UserRole
    company: str
    permissions: list[str] = Field(default_factory=list)


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    """注册：公司 + 角色（比赛演示用的最小字段集）。"""

    username: str
    password: str
    name: str
    company: str
    role: UserRole = "researcher"


class RefreshRequest(BaseModel):
    refresh_token: str


class LoginResult(BaseModel):
    """登录/刷新都返回这个形状（前端 client.ts 靠它续期）。"""

    model_config = CONTRACT_CONFIG

    access_token: str
    refresh_token: str
    expires_in: int
    user: User
