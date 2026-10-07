/**
 * api/endpoints/reviews.ts —— 人工复核列表（两层）与批量动作
 *
 * 对应 05 §5.5：
 *   GET  /reviews/summary               工作台汇总：待复核 / 高风险 / 近 7 天
 *   GET  /reviews/reports               第一层：报告级列表（含复核进度）
 *   GET  /reviews/{reportId}/queue      第二层：主张级复核队列
 *   POST /reviews/batch                 批量动作（只允许 verify）
 *
 * 【后端实现要点（两条硬规则）】
 *   1. 复核进度 = 已复核 / 待复核总数，**未覆盖的条目也要计入待复核总数**。
 *      如果把未覆盖的排除掉，进度会虚高，用户以为做完了，其实有一批"根本没查"。
 *   2. 批量只允许"标记已核实"；批量驳回必须逐条给理由（理由不齐直接 400）。
 *      这不是限制用户，而是保护经验学习的原料质量（D5）。
 *   3. 默认排序：待复核且高风险优先 → 最近更新倒序。
 */
import { client } from '../client'
import type { ClaimQueueRow, Page, ReportReviewRow, ReviewsSummary } from '../types'

/** 报告级列表筛选条件 */
export interface ReviewReportParams {
  status?: string
  risk?: string
  company?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

/** 主张级队列筛选条件 */
export interface ReviewQueueParams {
  risk?: string[]
  status?: string[]
  dimension?: string
  /** 只看待复核（默认） / 全部 */
  only_pending?: boolean
  page?: number
  page_size?: number
}

export const reviewApi = {
  /** 工作台的汇总数字（待复核报告数、待复核条数、高风险数、近 7 天高风险清单） */
  summary: () => client.get<ReviewsSummary>('/reviews/summary'),

  /** 第一层：一行一份报告，带复核进度与风险计数 */
  reportRows: (params: ReviewReportParams) => client.get<Page<ReportReviewRow>>('/reviews/reports', { params }),

  /** 第二层：一行一条主张，默认按风险降序 + 有证据优先 */
  queue: (reportId: string, params: ReviewQueueParams) =>
    client.get<Page<ClaimQueueRow>>(`/reviews/${reportId}/queue`, { params }),

  /**
   * 批量标记已核实。
   * 只开放这一个批量动作：批量驳回等于批量制造无理由的噪声，宁可让用户多花点时间。
   */
  batchVerify: (reportId: string, claimIds: string[], reason?: string) =>
    client.post<{ updated: number; skipped: Array<{ claim_id: string; reason: string }> }>('/reviews/batch', {
      body: { report_id: reportId, claim_ids: claimIds, action: 'verify', reason },
    }),
}