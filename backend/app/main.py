"""应用入口：装配路由、中间件、异常处理、服务容器。

启动命令见 backend/README.md 第 1 节（这里不写运行代码，避免和文档两处不一致）。

验收顺序（联调前先自己看一眼）：
    /health               存活探针
    /docs                 交互式接口文档 —— 骨架期它就是一封"待办清单"
    /api/v1/dimensions    唯一已经能返回真实数据的接口（数据来自 domain 层）
    其余接口              501 + code=NOT_IMPLEMENTED + 中文说明（前端会明确报错，不会静默）
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.middleware import TraceMiddleware
from app.api.routers import api_router
from app.common.logging import get_logger, setup_logging
from app.config import get_settings
from app.deps import Container

logger = get_logger("app.main")

# 前端会带这些头，CORS 必须放行（其中 Authorization 与 X-Trace-Id 是 SSE 也需要的）
ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Trace-Id", "If-Match", "Accept"]
EXPOSED_HEADERS = ["X-Trace-Id"]

OPENAPI_TAGS = [
    {"name": "系统", "description": "存活探针"},
    {"name": "鉴权", "description": "登录 / 注册 / 续期 / 当前用户"},
    {"name": "维度", "description": "维度注册表（驱动任务单与设置页）"},
    {"name": "研报", "description": "上传、版本、原文块、主张、导出"},
    {"name": "任务", "description": "建任务、进度快照、SSE、终止与重试"},
    {"name": "主张与复核", "description": "结论详情与人工裁决"},
    {"name": "复核", "description": "复核列表（报告级 / 主张级）与批量核实"},
    {"name": "研报评估", "description": "整篇质量评估"},
    {"name": "知识库", "description": "资料入库、启停、分片"},
    {"name": "经验学习", "description": "案例 → 候选 → 审核发布 → 回滚 → 删除"},
    {"name": "审计", "description": "审计事件与追踪号全链路"},
    {"name": "帮助", "description": "帮助文档"},
    {"name": "项目", "description": "项目云归档（当前前端不调用）"},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动/关闭钩子：装日志、建容器、准备存储目录。

    连接池（数据库 / Redis / 模型客户端）以后也在这里初始化 —— 业务代码不自己建连接。
    """
    settings = get_settings()
    setup_logging("DEBUG" if settings.debug else "INFO")
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)

    # 服务容器：现在都是 None（于是未实现接口统一报 501）。
    # 实现某个用例时，在这里塞进真实实例即可，路由一行都不用改。
    app.state.container = Container(settings=settings)
    logger.info("启动完成：env=%s prefix=%s 存储目录=%s", settings.env, settings.api_prefix, settings.storage_dir)
    yield
    logger.info("服务关闭")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0-skeleton",
        description=(
            "研报核查与质量评估平台 · 后端骨架。\n\n"
            "契约以 frontend/src/api/types.ts 为准；实现顺序见 frontend/BACKEND.md 的 P0 七条。"
        ),
        lifespan=lifespan,
        openapi_tags=OPENAPI_TAGS,
    )

    app.add_middleware(TraceMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=ALLOWED_HEADERS,
        expose_headers=EXPOSED_HEADERS,
    )

    register_exception_handlers(app)

    @app.get("/health", tags=["系统"], summary="存活探针")
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name, "env": settings.env}

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
