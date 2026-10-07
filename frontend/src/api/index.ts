/**
 * api/index.ts —— API 层的统一出口
 *
 * 【规矩】页面与组件**只允许**从 '@/api' 引入接口与类型，不允许直接去 '@/api/endpoints/xxx' 引。
 *   这样做的好处是：将来接口路径变了、某个资源拆成两个文件了，页面代码一行都不用改。
 *
 * 用法：
 *   import { reportApi, taskApi, type Report } from '@/api'
 *   const reports = await reportApi.list({ page: 1 })
 */
export * from './types'
export * from './enums'

export {
  ApiError,
  client,
  authToken,
  USE_MOCK,
  API_BASE_URL,
  ERROR_CODE,
  setUnauthorizedHandler,
  setRuntimeApiOptions,
  isUsingMock,
  currentApiBaseUrl,
} from './client'
// 运行时配置注入：应用启动与设置页保存时调用，改完立刻生效（不用重启）
export type { RequestOptions } from './client'
export { subscribeTaskProgress, askClaimStream } from './sse'
export type { TaskStreamHandlers, AskStreamHandlers } from './sse'

export { authApi } from './endpoints/auth'
export { dimensionApi } from './endpoints/dimensions'
export { reportApi } from './endpoints/reports'
export { taskApi } from './endpoints/tasks'
export { claimApi } from './endpoints/claims'
export { reviewApi } from './endpoints/reviews'
export { knowledgeApi } from './endpoints/knowledge'
export { learningApi } from './endpoints/learning'
export { auditApi } from './endpoints/audit'
export { helpApi } from './endpoints/help'
/* 研报勘误实验（数字复算）：/errata/run、/errata/pdf、/errata/status */
export { errataLabApi } from './endpoints/errataLab'
export type {
  ErrataAnnotation,
  ErrataRunPayload,
  ErrataRunResult,
  ErrataStats,
  ErrataStatus,
  CalcStep,
  LlmSummary,
} from './endpoints/errataLab'

export type { RegisterPayload } from './endpoints/auth'
export type { ReportListParams, UploadReportPayload, UploadReportResult, VersionDiff } from './endpoints/reports'
export type { TaskListParams, CreateTaskPayload } from './endpoints/tasks'
export type { ClaimListParams, SubmitReviewPayload, ClaimDetailResult } from './endpoints/claims'
export type { ReviewReportParams, ReviewQueueParams } from './endpoints/reviews'
export type { KnowledgeListParams, UploadKnowledgePayload } from './endpoints/knowledge'
export type { AuditEventParams } from './endpoints/audit'
export type { HelpArticle } from './endpoints/help'
/* 项目（管理核查任务的基本单元）与评估列表 —— 本次新增 */
export * from './endpoints/projects'
export * from './endpoints/assessments'
