"""研报勘误实验（数字复算）· 请求与响应契约。

【为什么单独一个 schema 文件】本实验是新增能力，**不动既有 60 条端点的契约**
（那些字段名有 test_contract.py 在防漂移）。这里的模型只服务于 /errata/* 三条路由。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_CONFIG = ConfigDict(populate_by_name=True, extra="ignore")


class PageRangeIn(BaseModel):
    """页码范围。前端传 {from, to}；from 是 Python 关键字，所以用别名接。"""

    model_config = CONTRACT_CONFIG

    from_page: int = Field(alias="from", ge=1)
    to: int = Field(ge=1)


class ErrataRunRequest(BaseModel):
    """跑一次"数字复算"勘误。"""

    model_config = CONTRACT_CONFIG

    report_path: str = Field(description="研报文件绝对路径（桌面端从 project.json 拿）")
    types: list[str] = Field(default_factory=list, description="勾选的勘误项 code（本实验只实现 calc 系列）")
    page_range: PageRangeIn | None = None
    use_llm: bool = Field(default=True, description="是否允许调用大模型（没有 Key 时自动降级为规则模式）")
    max_pages: int | None = Field(default=None, ge=1, le=300, description="最多核查多少页（核查单元是页：一页一次模型调用）")
    tolerance_pct: float = Field(default=0.5, ge=0.0, le=10.0, description="复算容差（百分比）")


class CalcStep(BaseModel):
    model_config = CONTRACT_CONFIG

    step: int
    expression: str
    value: str
    value_raw: float


class Rect(BaseModel):
    """页面上的一个矩形框（单位：PDF 点，左上原点）。前端按"占页面宽高的百分比"摆放，
    因此与缩放、高分屏、devicePixelRatio 全部无关。"""

    model_config = CONTRACT_CONFIG

    x0: float
    y0: float
    x1: float
    y1: float


class Annotation(BaseModel):
    """一条批注 = 右侧列表里的一张卡，也是 PDF 上的一个锚点。"""

    model_config = CONTRACT_CONFIG

    id: str
    page: int = Field(description="批注位于第几页（前端跳 PDF 用）")
    block_id: str
    start_offset: int
    end_offset: int
    statement: str = Field(description="承载这条批注的原文句子")

    expression: str
    normalized: str
    steps: list[CalcStep] = Field(default_factory=list)
    computed: float | None = None
    claimed: float | None = None
    unit: str = ""
    deviation: float | None = None
    rel_deviation: float | None = None
    tolerance_pct: float = 0.5

    status: Literal["pass", "risk", "uncovered", "error"]
    risk_level: Literal["high", "medium", "low"] | None = None
    rule_codes: list[str] = Field(default_factory=list)
    conclusion: str = Field(default="", description="结论（AI 说的那份话）")
    suggestion: str | None = None
    confidence: float | None = None
    extracted_by: Literal["llm", "rule", "rule_selfcontained"] = Field(
        default="llm",
        description=(
            "算式是谁给的：llm=模型抽的；rule=老规则兜底；"
            "rule_selfcontained=本句自证（输入全在同一句，纯本地算术，不经模型复核也不被推翻）"
        ),
    )
    extract_reason: str = ""
    scope: Literal["sentence", "context"] = Field(
        default="sentence",
        description="算式输入是否全部来自本句：sentence=句内自证；context=借用了上下文基数（这类只报一致）",
    )
    scope_label: str = ""

    # ---- 复核结论（"算不平"的条目在呈现前由模型带原文确认过一次）----
    review_verdict: Literal["consistent", "report_error", "tool_mispair", "unclear"] | None = Field(
        default=None,
        description="复核结论：consistent=只是四舍五入（判为一致）；report_error=原文确实有误（才作为问题呈现）；tool_mispair=机器自己配错（已从结果剔除）；unclear=判断不了（保留待人工确认）",
    )
    review_note: str | None = Field(
        default=None,
        description="复核备注：给读者看的一句话，说明问题出在哪里、或者可能出在哪里",
    )

    # ---- 版面定位（"别让我满篇找它在哪一行"）----
    rects: list[Rect] = Field(
        default_factory=list,
        description="这条批注在 PDF 版面上的矩形框（行框，可能多行）。空 = 没定位到，此时前端不画框、也不假装知道位置",
    )
    page_width: float = Field(default=0.0, description="该页宽度（点），前端换算百分比用")
    page_height: float = Field(default=0.0, description="该页高度（点）")
    rect_match: Literal["statement", "number", "none"] = Field(
        default="none",
        description="框是怎么定出来的：statement=按原文句子匹配到；number=句子没匹配上、退回用原文数字定位；none=没定位到",
    )


class ErratalStats(BaseModel):
    model_config = CONTRACT_CONFIG

    pages_scanned: int = 0
    sentences_scanned: int = 0
    annotations_total: int = 0
    risk: int = 0
    pass_count: int = Field(default=0, alias="pass")
    uncovered: int = 0
    extracted_by_llm: int = 0
    extracted_by_rule: int = 0
    dropped_by_validation: int = Field(
        default=0,
        description="被本地硬校验挡下的算式条数（模型给的数字在原文找不到，属「自算自对」，不计入结论）",
    )
    review_candidates: int = Field(default=0, description="本次「复算算不平」、进入复核的条目数")
    review_confirmed: int = Field(default=0, description="复核确认原文有误的条数（作为问题呈现）")
    review_consistent: int = Field(default=0, description="复核确认只是四舍五入、判为一致的条数")
    review_dropped: int = Field(default=0, description="复核判定为机器配错、已从结果剔除的条数")
    review_unclear: int = Field(default=0, description="复核无法判定、保留为待人工确认的条数")
    rects_located: int = Field(default=0, description="成功在 PDF 版面上定位到矩形框的批注条数")
    self_contained: int = Field(
        default=0,
        description="「本句自证」型确定性核对的条数（占比之和 / 分项合计 / 同句增速：输入全在同一句，不经模型、不被推翻）",
    )


class LlmSummary(BaseModel):
    model_config = CONTRACT_CONFIG

    available: bool = False
    model: str = ""
    calls: int = 0
    elapsed_ms: int = 0
    tokens_est: int = 0
    failed: int = 0
    detail: list[dict[str, Any]] = Field(default_factory=list)


class ExcludedAnnotation(BaseModel):
    """被复核排除的条目（判定为"机器自己配错"）。

    【为什么排除的也要返回】只报一个"已排除 13 条"的数字，用户没法判断里面有没有被误杀的真问题。
    把原文、算式、两个数、以及复核的理由一并带上，前端折叠起来 —— 平时不占版面，想抽查随时能翻。
    """

    model_config = CONTRACT_CONFIG

    page: int = 0
    statement: str = ""
    expression: str = ""
    computed: float | None = None
    claimed: float | None = None
    unit: str = ""
    note: str = Field(default="", description="复核给的排除理由")


class ErrataRunResponse(BaseModel):
    """一次勘误的完整结果：批注 + 统计 + 模型留痕。"""

    model_config = CONTRACT_CONFIG

    report_path: str
    report_name: str
    pages_total: int
    page_range: dict[str, int] | None = None
    requested_types: list[str] = Field(default_factory=list)
    unsupported_types: list[str] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    review_excluded: list[ExcludedAnnotation] = Field(
        default_factory=list,
        description="复核判定为「机器配错」而被排除的条目（不呈现为问题，但保留可查，便于人工抽查有没有漏掉真问题）",
    )
    stats: ErratalStats = Field(default_factory=ErratalStats)
    llm: LlmSummary = Field(default_factory=LlmSummary)
    elapsed_ms: int = 0
    generated_at: str = ""
    notes: list[str] = Field(default_factory=list, description="本次跑的说明/降级提示，页面直接展示")


class ErrataStatusResponse(BaseModel):
    model_config = CONTRACT_CONFIG

    supported_type_codes: list[str] = Field(default_factory=list)
    llm_available: bool = False
    llm_provider: str = ""
    llm_model: str = ""
    prompt_versions: dict[str, int] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
