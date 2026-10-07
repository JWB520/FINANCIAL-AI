/**
 * api/mock/mockAssessments.ts —— "研报评估"列表的假数据
 *
 * 【这份假数据只服务一个接口】GET /assessments（评估结果列表）。
 *   项目本身已经不由后端管理了（改成桌面端的工作区文件夹），所以这里不再有项目假数据。
 *
 * 【演示口径】
 *   只有"中瓷电子"那份报告真做过评估，其余报告显示"未评估"（status = not_started、参考分为 null）。
 *   刻意不把未评估的写成 0 分 —— "没做"和"做出来是 0 分"在界面上必须是两件事。
 *
 * 【本文件导出】
 *   ASSESSED_REPORT_IDS   演示环境里已评估的报告 id
 *   buildAssessmentRows() 评估列表行（一份报告一行）
 */
import type { AssessmentRow } from '../types'
import { MOCK_ASSESSMENT } from './mockData'
import { MOCK_REPORTS } from './mockDataMore'

/** 演示环境里只有这份报告真做了评估，其余用来演示"未评估"状态 */
const ASSESSED_REPORT_IDS = ['rpt-001']

/** 一份报告的评估行：状态、参考分、质量问题数、平均覆盖率、未覆盖的维度名 */
export function buildAssessmentRows(): AssessmentRow[] {
  return MOCK_REPORTS.map((report) => {
    const assessed = ASSESSED_REPORT_IDS.includes(report.id)
    const qualityDims = assessed ? MOCK_ASSESSMENT.metrics.by_dimension.filter((dim) => dim.code.startsWith('quality_')) : []
    const uncovered = qualityDims.filter((dim) => dim.coverage < 1).map((dim) => dim.name)
    const coverage = qualityDims.length ? qualityDims.reduce((sum, dim) => sum + dim.coverage, 0) / qualityDims.length : 0
    return {
      report_id: report.id,
      project_id: report.project_id ?? '',
      project_name: report.project_name ?? '',
      title: report.title,
      company: report.company,
      ticker: report.ticker,
      report_date: report.report_date,
      status: assessed ? 'completed' : 'not_started',
      reference_score: assessed ? (MOCK_ASSESSMENT.reference_score ?? null) : null,
      quality_problems: qualityDims.reduce((sum, dim) => sum + dim.problems, 0),
      quality_coverage: coverage,
      uncovered_dimensions: uncovered,
      created_at: assessed ? MOCK_ASSESSMENT.created_at : null,
      updated_at: assessed ? MOCK_ASSESSMENT.created_at : report.updated_at,
    }
  })
}