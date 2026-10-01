"""日志配置：统一格式，每条日志带 trace_id。

为什么自己配而不是用 uvicorn 默认：前端每个请求都带 X-Trace-Id，用户报障时给的也是它。
日志里没有 trace_id，就变成"用户给了编号、后端查不到"。
"""
from __future__ import annotations

import logging
import sys

from app.common.trace import current_trace_id

LOG_FORMAT = "%(asctime)s %(levelname)-7s trace=%(trace_id)s %(name)s: %(message)s"


class TraceIdFilter(logging.Filter):
    """给每条日志补上 trace_id（没有上下文时填 -）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = current_trace_id() or "-"
        return True


def setup_logging(level: str = "INFO") -> None:
    """进程启动时调一次（main.py 里调）。"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(TraceIdFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
