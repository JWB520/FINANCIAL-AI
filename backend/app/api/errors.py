"""统一错误处理：业务异常 -> HTTP 状态码 + 错误体（前端只认这个形状）。

前端约定（BACKEND.md §4.2）：
    { code, message, details?, trace_id? }
  - message 是给用户看的中文，前端直接展示，不自己编文案；
  - code 是业务错误码，前端用它配"怎么办"的提示（词典在 frontend/src/api/client.ts）；
  - 新增错误码要同时告诉前端，否则前端只能显示通用提示。

【未实现接口的语义】路由函数体里 raise NotImplementedError，
由下面的处理器统一转成 501 + code=NOT_IMPLEMENTED + 一句"接口还没实现：GET /xxx"。
这样前端联调时能立刻看到"这条还没做"，而不是静默返回空数据（那会被误读成"没有问题"）。
"""
from __future__ import annotations

import logging
from typing import Any, NoReturn

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.common.trace import current_trace_id, new_trace_id, set_trace_id

logger = logging.getLogger(__name__)


class ApiErrorCode:
    """错误码常量：**与前端 frontend/src/api/client.ts 的 ERROR_CODE 逐字一致**。

    前端的每个码都配了一句"怎么办"的提示，所以后端只能产出这些码（多于前端会显示成通用错误）。
    唯一的例外是 NOT_IMPLEMENTED —— 它是本项目联调期新增的码，用来明确表示"这条接口还没做"，
    等后端全部实现后可以去掉（前端目前会把它当通用错误展示）。
    """

    # 鉴权
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"      # 401 令牌过期 -> 前端自动刷新一次
    AUTH_FORBIDDEN = "AUTH_FORBIDDEN"              # 403 无权限

    # 通用
    VALIDATION_ERROR = "VALIDATION_ERROR"          # 400 参数错误 -> 字段级提示
    NOT_FOUND = "NOT_FOUND"                        # 404 资源不存在
    INTERNAL_ERROR = "INTERNAL_ERROR"              # 500 未预期错误
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"  # 503 模型/数据源不可用
    RATE_LIMITED = "RATE_LIMITED"                  # 429 触发限流

    # 研报与任务
    REPORT_PARSE_FAILED = "REPORT_PARSE_FAILED"    # 422 文档解析失败
    TASK_MISSING_INPUTS = "TASK_MISSING_INPUTS"    # 409 所选维度缺资料 -> 引导上传
    TASK_ALREADY_RUNNING = "TASK_ALREADY_RUNNING"  # 409 该报告已有运行中任务
    STAGE_NOT_RETRYABLE = "STAGE_NOT_RETRYABLE"    # 409 该阶段不可重试

    # 人工复核
    CLAIM_REVISION_CONFLICT = "CLAIM_REVISION_CONFLICT"  # 409 别人先改了这条
    REVIEW_REASON_REQUIRED = "REVIEW_REASON_REQUIRED"    # 400 驳回没填理由
    EVIDENCE_REQUIRED = "EVIDENCE_REQUIRED"              # 500 出现无证据的高风险结论（内部缺陷）

    # 经验学习（删除类：前端也按这两条显示）
    DELETE_REASON_REQUIRED = "DELETE_REASON_REQUIRED"    # 400 删已审核过的候选没填理由

    # 联调期专用
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"                  # 501 后端还没实现这条接口


# code -> HTTP 状态码（与前端 client.ts 的注释一致，写错会立刻在测试里暴露）
STATUS_OF: dict[str, int] = {
    ApiErrorCode.AUTH_TOKEN_EXPIRED: 401,
    ApiErrorCode.AUTH_FORBIDDEN: 403,
    ApiErrorCode.VALIDATION_ERROR: 400,
    ApiErrorCode.NOT_FOUND: 404,
    ApiErrorCode.INTERNAL_ERROR: 500,
    ApiErrorCode.UPSTREAM_UNAVAILABLE: 503,
    ApiErrorCode.RATE_LIMITED: 429,
    ApiErrorCode.REPORT_PARSE_FAILED: 422,
    ApiErrorCode.TASK_MISSING_INPUTS: 409,
    ApiErrorCode.TASK_ALREADY_RUNNING: 409,
    ApiErrorCode.STAGE_NOT_RETRYABLE: 409,
    ApiErrorCode.CLAIM_REVISION_CONFLICT: 409,
    ApiErrorCode.REVIEW_REASON_REQUIRED: 400,
    ApiErrorCode.EVIDENCE_REQUIRED: 500,
    ApiErrorCode.DELETE_REASON_REQUIRED: 400,
    ApiErrorCode.NOT_IMPLEMENTED: 501,
}


class ApiError(Exception):
    """业务异常：在 application 层抛，由处理器转成 HTTP 响应。

    用法：
        raise ApiError(ApiErrorCode.TASK_MISSING_INPUTS, "缺少外部研报库，同业一致性维度无法核查",
                       details={"missing_inputs": ["external_reports"]})
    """

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    @property
    def status_code(self) -> int:
        return STATUS_OF.get(self.code, 400)


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details or None,
        "trace_id": current_trace_id(),
    }


def not_implemented(what: str) -> NoReturn:
    """未实现的路由用它统一报 501（不要在路由里自己 raise HTTPException）。"""
    raise NotImplementedError(what)


def register_exception_handlers(app: FastAPI) -> None:
    """main.py 里调一次。顺序：业务异常 -> 校验异常 -> 未实现 -> 兜底。"""

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_body(ApiErrorCode.VALIDATION_ERROR, "请求参数不合法", {"errors": exc.errors()}),
        )

    @app.exception_handler(NotImplementedError)
    async def _not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
        target = str(exc) or "该接口"
        logger.warning("接口尚未实现: %s", target)
        return JSONResponse(
            status_code=501,
            content=error_body(ApiErrorCode.NOT_IMPLEMENTED, f"接口还没实现：{target}"),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        if current_trace_id() is None:
            set_trace_id(new_trace_id())
        logger.exception("未处理的异常")
        return JSONResponse(
            status_code=500,
            content=error_body(ApiErrorCode.INTERNAL_ERROR, "服务内部错误，请把追踪号给工程师"),
        )
