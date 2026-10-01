"""测试夹具：一个能直接打接口的客户端（不需要真的起服务）。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def api() -> str:
    """接口前缀（跟前端 vite 代理一致）。"""
    return "/api/v1"
