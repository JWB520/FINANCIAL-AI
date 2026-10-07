/**
 * api/endpoints/assessments.ts —— 研报评估接口（"研报评估"这条主线的列表入口）
 *
 * 【为什么单独一个文件，而不是挂在 reportApi 下面】
 *   "研报评估"和"研报勘误"是两条独立的主线：勘误看"哪句话有错"，评估看"整篇写得怎么样"。
 *   它们的列表页也是分开的（导航里是两个入口），所以接口文件分开，后端实现时也好分工。
 *
 * 【本文件导出的函数】
 *   assessmentApi.list(params?)      评估结果列表（一份报告一行，支持按项目/状态筛选）
 *   assessmentApi.detail(reportId)   单份报告的评估结果（四个质量维度的明细）
 *
 * 【与 reportApi.assessment 的关系】
 *   reportApi.assessment 是"从报告视角"取评估结果（进入某个报告的评估页时用）；
 *   本文件是"从评估视角"列全部结果（评估列表页用）。两者返回同一个 Assessment 结构，
 *   后端只需实现一个接口，路径分别是 /reports/{id}/assessment 与 /assessments。
 *
 * 【后端实现要点】
 *   列表里的 status / reference_score / quality_problems / quality_coverage /
 *   uncovered_dimensions 都由后端算好：前端只负责展示，不在浏览器里做加权。
 *   未评估的报告请返回 status='not_started' 且 score 为 null，
 *   **不要用 0 分代替** —— 0 分和"没做"是两回事，用户会误解。
 */
import { client } from '../client'
import type { Assessment, AssessmentListParams, AssessmentRow, Page } from '../types'

export const assessmentApi = {
  /** 评估结果列表 */
  list(params?: AssessmentListParams): Promise<Page<AssessmentRow>> {
    return client.get<Page<AssessmentRow>>('/assessments', { params })
  },

  /** 单份报告的评估明细（四个质量维度 + 参考分） */
  detail(reportId: string): Promise<Assessment> {
    return client.get<Assessment>('/reports/' + reportId + '/assessment')
  },
}