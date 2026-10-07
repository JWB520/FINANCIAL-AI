/**
 * api/endpoints/reports.ts —— 研报上传、列表、原文块、版本
 *
 * 对应 05 §5.2：
 *   POST /reports                          上传研报（multipart）
 *   GET  /reports                          报告列表
 *   GET  /reports/{id}                     报告详情（含版本、最新批次、统计计数）
 *   POST /reports/{id}/versions            上传新版本
 *   GET  /reports/{id}/blocks              原文块（复核裁决页左栏数据源）
 *   GET  /reports/{id}/versions/{v}/diff   版本差异
 *   GET  /reports/{id}/export              导出评估报告
 *
 * 【后端实现要点】
 *   - 上传时 company / ticker / report_date 必填：外部取数以 ticker 为准、以 report_date 为基准日
 *   - blocks 的 start_offset / end_offset 是"整篇纯文本的绝对区间"，claim 的是块内局部偏移，
 *     两者坐标系不同，前端渲染前会做转换（见 pages/report-review）
 *   - blocks 接口要支持按章节分页，长报告一次拉全部会很慢
 */
import { client, currentApiBaseUrl } from '../client'
import type { Assessment, Block, Page, Report, ReportVersion, Task } from '../types'

/** 报告列表筛选条件（都会进 URL，保证刷新与分享链接后视图一致） */
export interface ReportListParams {
  company?: string
  status?: string
  owner?: string
  keyword?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

/** 上传研报时随文件一起提交的表单元数据 */
export interface UploadReportPayload {
  /** 所属项目 id —— 项目是管理核查任务的基本单元，研报必须先归到某个项目下 */
  project_id: string
  file: File
  /** 报告名，默认取文件名，用户可改 */
  title: string
  /** 公司名 */
  company: string
  /** 标的代码，如 003031.SZ */
  ticker: string
  /** 核查基准日（YYYY-MM-DD） */
  report_date: string
}

export interface UploadReportResult {
  report: Report
  version: ReportVersion
}

/** 版本差异结果：改了哪些块、哪些结论消失了、哪些新增了 */
export interface VersionDiff {
  from_version: number
  to_version: number
  changed_blocks: Array<{
    block_index: number
    change_type: 'added' | 'removed' | 'modified'
    old_text: string | null
    new_text: string | null
  }>
  /** 上一版有、这一版没有的主张（对应结论也一并失效） */
  removed_claim_ids: string[]
  added_claim_ids: string[]
}

export const reportApi = {
  /**
   * 确保某个项目对应的报告已就绪（桌面端专用）。
   *
   * 【为什么需要它】
   *   桌面端的项目配置里存的是**本地文件路径**（project.json 的 report_path），
   *   而勘误/评估/复核的结论都挂在"报告"这个后端实体上。打开项目时用这个接口把两者对上：
   *     · 后端（或演示数据）里已有该路径的报告 → 直接返回它；
   *     · 还没有 → 创建一条报告记录并把它和项目关联（真实后端此时应触发解析与核查）。
   *   这样"新建项目 → 立刻看到三个入口"就能跑通，不必让用户再手动上传一次。
   *
   * 【后端实现要点】按 project_id + local_path 做幂等：同一个项目重复打开不能造出多条报告。
   */
  ensureProject(payload: { project_id: string; report_path: string; report_name: string }): Promise<Report> {
    return client.post<Report>('/reports/ensure', { body: payload })
  },
  /** 上传研报。用 multipart，文件与元数据一起发 */
  upload: (payload: UploadReportPayload) => {
    const form = new FormData()
    form.append('file', payload.file)
    form.append('project_id', payload.project_id)
    form.append('title', payload.title)
    form.append('company', payload.company)
    form.append('ticker', payload.ticker)
    form.append('report_date', payload.report_date)
    return client.upload<UploadReportResult>('/reports', form)
  },

  /** 报告列表（分页） */
  list: (params: ReportListParams) => client.get<Page<Report>>('/reports', { params }),

  /** 报告详情：含版本列表、最新批次、统计计数 */
  detail: (reportId: string) =>
    client.get<Report & { versions: ReportVersion[]; latest_task?: Task | null }>(`/reports/${reportId}`),

  /** 上传同一份报告的新版本（修订稿） */
  uploadVersion: (reportId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return client.upload<ReportVersion>(`/reports/${reportId}/versions`, form)
  },

  /**
   * 原文块列表（复核裁决页左栏）。
   * 参数 versionNo 可选；不传则取最新版本。
   * 后端支持 ?section= 只拉某一章，前端长文档懒加载时用。
   */
  blocks: (reportId: string, params?: { version?: number; section?: string }) =>
    client.get<Block[]>(`/reports/${reportId}/blocks`, { params }),

  /**
   * 报告级评估（结果总览页的主数据）。
   * 对应 05 §5.5：GET /reports/{id}/assessment?batch=<批次>。
   * 不传 batch 就取最新批次；重复核查后可以按批次对比"改前改后"。
   */
  assessment: (reportId: string, batchId?: string) =>
    client.get<Assessment>(`/reports/${reportId}/assessment`, { params: { batch: batchId } }),

  /** 版本差异对比 */
  diff: (reportId: string, fromVersion: number, toVersion: number) =>
    client.get<VersionDiff>(`/reports/${reportId}/versions/${fromVersion}/diff`, {
      params: { to: toVersion },
    }),

  /**
   * 导出评估报告（docx/pdf）—— 返回**完整**下载地址，前端用 window.open 直接下载（大文件不占内存）。
   *
   * 【之前错在哪】这里返回的是 `rpt-001/export?format=docx`：既没有 /reports 前缀、
   *   也没有接口前缀，window.open 打开的是"相对当前页面"的地址，会被前端通配路由接住
   *   （表现为点导出毫无反应或跳回工作台），下载永远不会发生。
   * 【为什么拼 currentApiBaseUrl()】接口前缀可能被设置页改过（运行时覆盖），
   *   拼环境变量会与真正的请求出口不一致。
   */
  exportUrl: (reportId: string, format: 'docx' | 'pdf', batchId?: string) => {
    const query = new URLSearchParams({ format })
    if (batchId) query.set('batch', batchId)
    return `${currentApiBaseUrl()}/reports/${reportId}/export?${query.toString()}`
  },

  /**
   * 演示模式用的"导出预览"：假后端没有真实 docx/pdf 字节，
   * 所以它返回一份**文本摘要**（标题、结论统计、未覆盖项），由前端下载。
   * 真后端不需要这个接口 —— 接入后前端会走 exportUrl()。
   */
  previewText: (reportId: string, batchId?: string) =>
    client.get<{ filename: string; text: string }>(`/reports/${reportId}/export-preview`, {
      params: { batch: batchId },
    }),
}
