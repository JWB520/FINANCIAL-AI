"""Celery 应用：broker=Redis，队列名与并发见 settings。

注意：骨架期如果没装 celery，这里会退化为一个提示对象（不影响 FastAPI 启动与其他模块 import）。
"""
from __future__ import annotations

from app.config import get_settings

_settings = get_settings()

try:
    from celery import Celery

    celery_app = Celery(
        "rqc",
        broker=_settings.redis_url,
        backend=_settings.redis_url,
    )
    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        task_acks_late=True,              # 任务被中断会重新投递（配合幂等）
        worker_prefetch_multiplier=1,     # 长任务不要预取，否则一个 worker 卡住别人排队
    )
except ModuleNotFoundError:               # pragma: no cover
    celery_app = None                     # type: ignore[assignment]
