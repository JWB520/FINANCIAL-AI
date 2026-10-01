"""研报用例：ensure（幂等对齐）、上传、版本、原文块、主张、导出。

对应路由：app/api/routers/reports.py
依赖端口：domain.ports.ReportRepository（实现放 infra/repos）
"""
from __future__ import annotations

from typing import Any

from app.domain.entities import Report


class ReportService:
    """实现顺序建议：ensure -> list_blocks -> list_claims（P0 三条）。"""

    async def ensure(self, project_id: str, report_path: str, **fields: Any) -> Report:
        """★ P0-1：按 project_id + report_path 确保报告存在（幂等，不许重复建）。"""
        raise NotImplementedError("ReportService.ensure")

    async def list_blocks(self, report_id: str) -> list[Any]:
        """★ P0-5：按 block_index 升序返回原文块；未知 id 抛 404（不要兜底成第一条）。"""
        raise NotImplementedError("ReportService.list_blocks")

    async def list_claims(self, report_id: str) -> list[Any]:
        """★ P0-6：按 block_index 升序返回主张；返回空数组必须是真的没有主张。"""
        raise NotImplementedError("ReportService.list_claims")

    async def upload(self, **fields: Any) -> Report:
        """multipart 上传：存文件 -> 建 version -> 投 parse 阶段。"""
        raise NotImplementedError("ReportService.upload")

    async def export(self, report_id: str, fmt: str) -> bytes:
        """导出 docx/pdf：直接返回字节流（前端 window.open 下载）。"""
        raise NotImplementedError("ReportService.export")
