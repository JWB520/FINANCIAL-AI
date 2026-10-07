"""所有路由的汇总出口（main.py 只挂这一次，前缀就是前端要的 /api/v1）。

【骨架期的工作方式】每个端点都写好了路径、参数、响应模型与中文说明，函数体是
not_implemented("GET /xxx")，由 app/api/errors.py 统一转成 501 + 明确的中文提示。
于是 /docs 就是一份"待办清单"：做完一条，把 not_implemented(...) 换成真正的服务调用即可。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.routers import (
    assessment,
    audit,
    auth,
    claims,
    dimensions,
    errata_lab,
    help,
    knowledge,
    learning,
    projects,
    reports,
    reviews,
    tasks,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(reports.router)
api_router.include_router(tasks.router)
api_router.include_router(claims.router)
api_router.include_router(reviews.router)
api_router.include_router(assessment.router)
api_router.include_router(knowledge.router)
api_router.include_router(learning.router)
api_router.include_router(audit.router)
api_router.include_router(dimensions.router)
api_router.include_router(help.router)
# 研报勘误实验（数字复算）：自包含的三条接口，不动上面任何一条既有端点
api_router.include_router(errata_lab.router)
