/**
 * api/endpoints/claims.ts —— 主张、结论与人工复核动作
 *
 * 对应 05 §5.4：
 *   GET  /reports/{id}/claims       主张列表（复核裁决页右侧数据源，按原文顺序）
 *   GET  /claims/{id}               单条详情（含三态结论）
 *   GET  /claims/{id}/findings      该主张在各维度下的全部结论
 *   POST /claims/{id}/reviews       提交人工动作（并发控制：If-Match 带 revision）
 *   GET  /claims/{id}/reviews       复核历史（时间倒序，含 AI 原结论）
 *   GET  /claims/{id}/ask           历史追问记录
 *   POST /claims/{id}/ask           追问（SSE 流式，在 sse.ts 里实现）
 *
 * 【后端实现要点 —— 这里最容易出错，前端做了对应的兜底】
 *   1. 提交复核必须带 If-Match: <claim.revision>；别人先改过就返回 409 +
 *      CLAIM_REVISION_CONFLICT，前端会提示"该条已被他人复核，已刷新为最新状态"。
 *   2. action=reject 时 reason 必填，缺失返回 400 + REVIEW_REASON_REQUIRED。
 *      这条不能放宽：理由就是经验学习的原料，没理由的驳回等于制造噪声。
 *   3. 复核历史只追加不修改；AI 原始结论永远可见（三态结论，D4）。
 *   4. 排序：复核裁决页的 claims 必须按 block_index 升序（与原文顺序一致），
 *      **不能按风险排序**，否则左原文右结论的联动就断了。风险排序只在复核队列里用。
 */
import { client } from '../client'
import type {
  Block,
  Claim,
  ClaimConclusion,
  ClaimWithFindings,
  Finding,
  FindingDetail,
  Page,
  ReviewAction,
  ReviewActionType,
} from '../types'

/** 主张列表筛选条件（复核裁决页右侧的筛选栏用它，全部进 URL） */
export interface ClaimListParams {
  /** 只看这些风险等级，如 ['high','medium']；不传=全部（含未覆盖） */
  risk?: string[]
  /** 结论状态过滤：risk / pass / uncovered / error */
  status?: string[]
  /** 维度代号过滤 */
  dimension?: string
  /** 主张类型过滤 */
  type?: string
  /** 只看某个章节 */
  section?: string
  /** 只看某个块（从色带或证据跳转时用） */
  block_id?: string
  /** 关键词 */
  q?: string
  page?: number
  page_size?: number
}

/** 提交人工动作的请求体 */
export interface SubmitReviewPayload {
  action: ReviewActionType
  /** 动作的理由：驳回必填，其余可选但强烈建议填 */
  reason?: string
  /** 动作携带的数据 */
  payload?: {
    /** manual_edit：修改后的文本 */
    edited_text?: string
    /** add_evidence：人工补充的证据 */
    evidence?: {
      type: string
      snippet: string
      source_ref?: string
      uri?: string
    }
    /** accept：采纳的建议文本 */
    accepted_suggestion?: string
  }
  /** 并发控制：提交时该主张的版本号（后端比对，不一致返回 409） */
  revision: number
}

/** 带位置信息的主张 + 结论（复核裁决页右栏卡片的数据） */
export interface ClaimDetailResult {
  claim: Claim
  block: Block
  findings: Finding[]
  review: ClaimConclusion
  review_actions: ReviewAction[]
}

export const claimApi = {
  /**
   * 报告下的主张列表（含各自当前结论）。
   * 复核裁决页右侧列表、复核队列第二层都用它；
   * 注意默认按 block_index 升序（原文顺序），见本文件顶部第 4 条说明。
   */
  listByReport: (reportId: string, params: ClaimListParams) =>
    client.get<Page<ClaimWithFindings>>(`/reports/${reportId}/claims`, { params }),

  /** 单条主张详情（点开右侧卡片时拉，数据比列表项全） */
  detail: (claimId: string) => client.get<ClaimDetailResult>(`/claims/${claimId}`),

  /** 该主张在各维度下的全部结论（一条主张可能被多个维度同时报问题） */
  findings: (claimId: string) => client.get<Finding[]>(`/claims/${claimId}/findings`),

  /** 单条 Finding 的完整信息（含证据、核算过程、溯源三要素） */
  findingDetail: (findingId: string) => client.get<FindingDetail>(`/findings/${findingId}`),

  /**
   * 提交人工复核动作。
   * revision 通过 If-Match 头传给后端做乐观锁，防止"两个人同时裁同一条"互相覆盖。
   */
  submitReview: (claimId: string, body: SubmitReviewPayload) =>
    client.post<ReviewAction>(`/claims/${claimId}/reviews`, {
      body: { action: body.action, reason: body.reason, payload: body.payload },
      headers: { 'If-Match': String(body.revision) },
    }),

  /** 复核历史（时间倒序）。三条结论 + 历史一起看，才能复盘"AI 错在哪" */
  reviewHistory: (claimId: string) => client.get<ReviewAction[]>(`/claims/${claimId}/reviews`),

  /** 历史追问记录（追问内容不落库为结论，只作为对话记录） */
  askHistory: (claimId: string) =>
    client.get<Array<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }>>(
      `/claims/${claimId}/ask`
    ),
}
