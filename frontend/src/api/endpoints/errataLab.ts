/**
 * api/endpoints/errataLab.ts —— 研报勘误实验（数字复算）的接口层
 *
 * 【它和后端哪些路由对应】
 *   GET  /errata/status   模型是否接入 / 已实现的勘误项 / 提示词版本
 *   POST /errata/run      跑一次勘误 → 返回批注列表
 *   GET  /errata/pdf      本地 PDF 的字节流（页面左栏的"PDF 原件"用）
 *
 * 【为什么这几个请求都带 noMock: true】
 *   本功能是**真后端能力**，故意不走演示假数据：
 *   假数据里没有这份研报的批注，硬造一套只会让人以为"已经做完了"。
 *   后端没起时页面会明确报"网络连接失败"，而不是显示一份假的批注列表。
 *
 * 【字段与后端 app/schemas/errata_lab.py 一一对应】
 */
import { buildUrl, client } from '../client'

/** 复算的一步（前端"核算过程"面板逐行展示） */
export interface CalcStep {
  step: number
  expression: string
  value: string
  value_raw: number
}

/** 一条批注 = 左栏 PDF 上的一个锚点 + 右栏的一张卡 */
/** 页面上的一个矩形框（单位：PDF 点；前端换算成"占页面宽高的百分比"再摆放） */
export interface ErrataRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ErrataAnnotation {
  id: string
  page: number
  block_id: string
  start_offset: number
  end_offset: number
  statement: string

  expression: string
  normalized: string
  steps: CalcStep[]
  computed: number | null
  claimed: number | null
  unit: string
  deviation: number | null
  rel_deviation: number | null
  tolerance_pct: number

  status: 'pass' | 'risk' | 'uncovered' | 'error'
  risk_level: 'high' | 'medium' | 'low' | null
  rule_codes: string[]
  conclusion: string
  suggestion: string | null
  confidence: number | null
  /** 算式是谁给的：llm=模型抽的；rule=老规则兜底；rule_selfcontained=本句自证（输入全在同一句，本地算术） */
  extracted_by: 'llm' | 'rule' | 'rule_selfcontained'
  extract_reason: string
  /** 算式输入是否全部来自本句：sentence=句内自证；context=借用了上下文基数（这类只报一致） */
  scope: 'sentence' | 'context'
  scope_label: string

  /** 复核结论：这条"算不平"在呈现前由模型带原文确认过一次（详见 verify_mismatches 提示词）
   *  report_error = 原文确实有误（只有这一档才作为问题呈现）
   *  tool_mispair = 机器自己配错了（后端已从结果里剔除，前端一般见不到）
   *  unclear      = 判断不了（保留为待人工确认） */
  review_verdict: 'consistent' | 'report_error' | 'tool_mispair' | 'unclear' | null
  /** 复核备注：一句话说明问题出在哪里、或者可能出在哪里（给读者看） */
  review_note: string | null

  /** 版面定位：这条批注在 PDF 页面上的矩形框（行框，可能多行）。空 = 没定位到 → 不画框 */
  rects: ErrataRect[]
  /** 该页宽高（点）。前端用它把 rects 换算成百分比，于是与缩放 / 高分屏 / DPR 全无关 */
  page_width: number
  page_height: number
  /** 框是怎么定出来的：statement=按原文句子；number=退回用原文数字；none=没定位到 */
  rect_match: 'statement' | 'number' | 'none'
}

export interface ErrataStats {
  /** 核查了多少页（核查单元是页：一页一次模型调用） */
  pages_scanned: number
  /** 这些页里含数字的句子总数（用于说明"扫了多少句"） */
  sentences_scanned: number
  annotations_total: number
  risk: number
  pass: number
  uncovered: number
  extracted_by_llm: number
  extracted_by_rule: number
  /** 被本地硬校验挡下的条数（模型给的数字在原文找不到 → 属"自算自对"，不计入结论） */
  dropped_by_validation: number
  /** 复核：进入复核的"算不平"条目数 */
  review_candidates: number
  /** 复核：确认原文有误（作为问题呈现）的条数 */
  review_confirmed: number
  /** 复核：确认只是四舍五入、判为一致的条数 */
  review_consistent: number
  /** 复核：判定为机器配错、已从结果剔除的条数 */
  review_dropped: number
  /** 复核：无法判定、保留为待人工确认的条数 */
  review_unclear: number
  /** 成功在 PDF 版面上定位到矩形框的批注条数 */
  rects_located: number
  /** 「本句自证」型确定性核对的条数（占比之和 / 分项合计 / 同句增速：输入全在同一句，不经模型） */
  self_contained: number
}

export interface LlmCallTrace {
  prompt_key: string
  prompt_version: number
  model: string
  elapsed_ms: number
  chars_in: number
  chars_out: number
  tokens_est: number
  ok: boolean
  error: string
}

export interface LlmSummary {
  available: boolean
  model: string
  calls: number
  elapsed_ms: number
  tokens_est: number
  failed: number
  detail: LlmCallTrace[]
}

export interface ErrataRunResult {
  report_path: string
  report_name: string
  pages_total: number
  page_range: { from: number; to: number } | null
  requested_types: string[]
  unsupported_types: string[]
  annotations: ErrataAnnotation[]
  /** 被复核排除的条目（判定为"机器自己配错"）：不列为问题，但保留可查，便于人工抽查有没有误杀真问题 */
  review_excluded: ErrataExcludedItem[]
  stats: ErrataStats
  llm: LlmSummary
  elapsed_ms: number
  generated_at: string
  notes: string[]
}

/** 被复核排除的一条（对应后端 ExcludedAnnotation） */
export interface ErrataExcludedItem {
  page: number
  statement: string
  expression: string
  computed: number | null
  claimed: number | null
  unit: string
  /** 复核给的排除理由（给读者看） */
  note: string
}

export interface ErrataStatus {
  supported_type_codes: string[]
  llm_available: boolean
  llm_provider: string
  llm_model: string
  prompt_versions: Record<string, number>
  notes: string[]
}

export interface ErrataRunPayload {
  report_path: string
  types: string[]
  page_range?: { from: number; to: number } | null
  use_llm?: boolean
  max_pages?: number | null
  tolerance_pct?: number
}

export const errataLabApi = {
  /** 能力与模型状态（页面顶部横幅要靠它说清"这次有没有 AI 参与"） */
  status: () => client.get<ErrataStatus>('/errata/status', { noMock: true, timeout: 8000 }),

  /** 跑一次勘误。全篇可能跑几十秒，所以超时给足 5 分钟 */
  run: (payload: ErrataRunPayload) =>
    client.post<ErrataRunResult>('/errata/run', { body: payload, noMock: true, timeout: 300_000 }),

  /** PDF 原件地址（交给 pdf.js 去取；带 #page= 可跳到指定页） */
  pdfUrl: (reportPath: string, page?: number) => {
    const url = buildUrl('/errata/pdf', { path: reportPath })
    return page && page > 1 ? `${url}#page=${page}` : url
  },
}
