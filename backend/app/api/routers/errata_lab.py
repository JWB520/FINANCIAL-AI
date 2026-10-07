"""研报勘误实验路由（数字复算）—— 自包含，不替换既有 60 条端点里的任何一条。

三条接口：
  POST /errata/run     跑一次勘误，返回批注列表 + 统计 + 模型留痕
  GET  /errata/pdf     把本地研报 PDF 以字节流交给前端（页面左栏的"PDF 原件"靠它）
  GET  /errata/status  模型是否接入 / 提示词版本 / 已实现的勘误项

【为什么 PDF 要过一道后端】前端页面是 http://localhost:5173（Electron 里也一样），
浏览器/Electron 的安全策略不允许网页直接读 file:// 的本地文件。让后端把字节流出来，
前端拿到的就是同源的 /api/v1/errata/pdf?path=...，能直接塞进 PDF 阅读器，也顺便
让"看的是不是同一份文件"这件事有据可查。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.application.errata_lab_service import (
    IMPLEMENTED_TYPE_CODES,
    SUPPORTED_TYPE_CODES,
    ErrataLabService,
)
from app.config import Settings, get_settings
from app.infra.parsers.pdf_parser import PdfParseError
from app.schemas.errata_lab import ErrataRunRequest, ErrataRunResponse, ErrataStatusResponse

router = APIRouter(tags=["研报勘误实验"])


@router.post("/errata/run", response_model=ErrataRunResponse, summary="跑一次数字复算勘误")
async def run_errata(body: ErrataRunRequest, settings: Settings = Depends(get_settings)) -> ErrataRunResponse:
    service = ErrataLabService(settings)
    page_range = body.page_range.model_dump(by_alias=True) if body.page_range else None
    try:
        result = await service.run(
            report_path=body.report_path,
            types=list(body.types),
            page_range=page_range,
            use_llm=body.use_llm,
            max_pages=body.max_pages,
            tolerance_pct=body.tolerance_pct,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PdfParseError as exc:
        # 与既有契约一致：解析失败是 422 REPORT_PARSE_FAILED，前端提示"换可复制文本的版本"
        raise HTTPException(status_code=422, detail=f"REPORT_PARSE_FAILED：{exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ErrataRunResponse(**result)


@router.get("/errata/pdf", summary="把本地研报 PDF 以字节流返回（供页面左栏渲染原件）")
async def serve_pdf(path: str = Query(..., description="研报文件绝对路径")) -> FileResponse:
    target = Path(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"文件不存在：{path}")
    if target.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="只支持 PDF 文件")
    # inline：让浏览器/Electron 内置阅读器直接显示，而不是触发下载
    return FileResponse(
        str(target),
        media_type="application/pdf",
        filename=target.name,
        content_disposition_type="inline",
    )


@router.get("/errata/status", response_model=ErrataStatusResponse, summary="勘误实验能力与模型状态")
async def errata_status(settings: Settings = Depends(get_settings)) -> ErrataStatusResponse:
    service = ErrataLabService(settings)
    llm = service.llm_status()
    notes: list[str] = []
    if not llm["available"]:
        notes.append("大模型未接入 → 本次实验会走规则兜底（只报一致）。配置 backend/.env 的 RQC_LLM_API_KEY 后即可启用 AI 提取与批注。")
    notes.append(f"已实现的勘误项：{', '.join(IMPLEMENTED_TYPE_CODES)}；其余 {len(SUPPORTED_TYPE_CODES) - len(IMPLEMENTED_TYPE_CODES)} 项 calc 系列尚未实现。")
    return ErrataStatusResponse(
        supported_type_codes=SUPPORTED_TYPE_CODES,
        llm_available=bool(llm["available"]),
        llm_provider=str(llm["provider"]),
        llm_model=str(llm["model"]),
        prompt_versions=service.prompt_versions(),
        notes=notes,
    )
