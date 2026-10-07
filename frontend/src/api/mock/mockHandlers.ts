/**
 * api/mock/mockHandlers.ts —— 假后端：把前端发出的请求按"路由"分派到假数据
 *
 * 【它是怎么被用上的】
 *   client.ts 里的 request() 发现 VITE_USE_MOCK=true 时，就把请求交给 handleMockRequest()，
 *   于是**不发网络请求**，前端也能把全部页面点一遍（比赛演示、后端未就绪时的独立开发）。
 *
 * 【设计要点（也是给后端工程师看的对照表）】
 *   1. 每个路由的注释里都写了对应的真实接口路径，可以逐条对照 05_数据模型与接口契约.md §5。
 *   2. 这里实现了**分页、筛选、写操作**（复核、批量核实、启停知识库、审核候选、重试阶段），
 *      所以演示时点按钮会有真实的反应，而不是"点了没动静"。
 *   3. 写操作会改内存里的副本（例如提交复核后 revision +1、状态变化），
 *      页面之间切来切去是一致的；刷新浏览器会重置（后端接上后就由数据库负责了）。
 *   4. 刻意模拟了两种错误路径，用来演示前端的兜底：
 *      - 提交复核时若 revision 与内存里的不一致 → 409 CLAIM_REVISION_CONFLICT（"该条已被他人复核"）
 *      - 驳回但不填理由 → 400 REVIEW_REASON_REQUIRED（前端会定位到理由输入框）
 *   5. 每个请求人为延迟 120~300ms，让骨架屏、加载态真的能被看到（否则演示时接口"瞬间返回"，
 *      加载态永远测不出来）。
 */
import type {
  ClaimQueueRow,
  ClaimWithFindings,
  Finding,
  Page,
  ReportReviewRow,
  ReviewsSummary,
  RiskLevel,
  StageCode,
  Task,
  TaskStage,
} from '../types'
import { ApiError, type RequestOptions } from '../client'
import { RISK_LEVEL_LABEL, STAGE_CODE_LABEL, riskRank } from '../enums'
import {
  MOCK_ASSESSMENT,
  MOCK_BLOCKS,
  MOCK_CLAIMS,
  MOCK_FINDINGS,
  MOCK_REVIEW_ACTIONS,
  MOCK_USER,
  MOCK_DIMENSIONS,
  MOCK_BATCH_ID,
  MOCK_VERSION_ID,
  buildClaimSpans,
  buildConclusion,
} from './mockData'
import {
  MOCK_AUDIT_EVENTS,
  MOCK_EXPERIENCE_CASES,
  MOCK_HELP_ARTICLES,
  MOCK_KNOWLEDGE_CHUNKS,
  MOCK_KNOWLEDGE_DOCS,
  MOCK_LEARNING_CANDIDATES,
  MOCK_REPORTS,
  MOCK_REPORT_VERSION,
  MOCK_RULE_VERSIONS,
  MOCK_TASKS,
} from './mockDataMore'

/* ============================================================================
 * 一、内存里的可变状态（写操作改这里）
 *
 * 用"副本"而不是直接改导入的常量，是为了让"重置"变得简单，
 * 也避免别的模块误改这份演示数据。
 * ==========================================================================*/

import { buildAssessmentRows } from './mockAssessments'
const db = {
  user: { ...MOCK_USER },
  reports: MOCK_REPORTS.map((r) => ({ ...r })),
  tasks: MOCK_TASKS.map((t) => ({ ...t, stages: t.stages?.map((s) => ({ ...s })) })),
  claims: MOCK_CLAIMS.map((c) => ({ ...c })),
  findings: MOCK_FINDINGS.map((f) => ({ ...f })),
  /** 人工动作：提交复核会往这里 push，revision 也会 +1 */
  reviewActions: MOCK_REVIEW_ACTIONS.map((a) => ({ ...a })),
  knowledgeDocs: MOCK_KNOWLEDGE_DOCS.map((d) => ({ ...d })),
  /** 经验案例：可删除（案例是学习素材，允许清理） */
  cases: MOCK_EXPERIENCE_CASES.map((c) => ({ ...c })),
  candidates: MOCK_LEARNING_CANDIDATES.map((c) => ({ ...c })),
  ruleVersions: MOCK_RULE_VERSIONS.map((v) => ({ ...v })),
  /** 追踪号 → 事件列表，用于"按 trace_id 拉全链路" */
  auditEvents: MOCK_AUDIT_EVENTS.map((e) => ({ ...e })),
}

/* ============================================================================
 * 二、小工具
 * ==========================================================================*/

/** 模拟网络延迟：让加载态可见（演示时也别太快，否则用户以为页面卡了） */
function delay(ms?: number): Promise<void> {
  const wait = ms ?? 120 + Math.floor(Math.random() * 180)
  return new Promise((resolve) => setTimeout(resolve, wait))
}

/** 统一分页：所有列表接口都用它，行为与后端一致（05 §8） */
function paginate<T>(items: T[], params?: Record<string, unknown>): Page<T> {
  const page = Number(params?.page || 1)
  const pageSize = Number(params?.page_size || 20)
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize }
}

/** 把 "high,medium" 这样的筛选参数拆成数组（后端约定逗号分隔） */
function csv(value: unknown): string[] {
  if (!value) return []
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 取某条主张的当前结论集合 */
function findingsOf(claimId: string): Finding[] {
  return db.findings.filter((f) => f.claim_id === claimId)
}

/** 取某条主张当前最高的风险等级 */
function riskOf(claimId: string): RiskLevel | null {
  const list = findingsOf(claimId)
  let best: 'high' | 'medium' | 'low' | null = null
  for (const f of list) {
    if (f.risk_level && riskRank(f.risk_level) > riskRank(best)) best = f.risk_level
  }
  return best
}

/* ============================================================================
 * 三、路由表
 *
 * 每条规则 = 方法 + 路径正则 + 处理函数。
 * 正则里的捕获组按顺序传给 handle({ params })，写注释说明每个参数是什么。
 * ==========================================================================*/

interface MockContext {
  /** 正则捕获组（URL 里的动态段，例如 claim id） */
  params: string[]
  /** 查询参数（client 把 params 对象传进来了） */
  query: Record<string, unknown>
  /** 请求体 */
  body: any
  /** 原始请求选项（复核动作要用 headers 里的 If-Match） */
  options: RequestOptions
}

interface MockRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  pattern: RegExp
  /** 一句话说明这条路由对应哪个真实接口 */
  note: string
  handle: (ctx: MockContext) => unknown | Promise<unknown>
}

/* ============================================================================
 * 演示任务的流水线阶段（新建任务用）
 *
 * 【为什么必须按契约生成】阶段代号是后端契约（types.ts 的 StageCode，只有 5 个值），
 *   进度页靠 STAGE_CODE_LABEL / STAGE_CODE_ORDER / stage.stage_code 渲染。
 *   之前这里写的是自造的 { code: 'stage_1', name: '解析文档' } —— 字段名与页面读的
 *   stage_code 对不上，于是新建任务的阶段列表永远匹配不到进度事件（进度条不动、
 *   状态不更新）。现在一律按 TaskStage 契约生成，字段一个都不少。
 * ==========================================================================*/

/** 阶段顺序（与后端流水线一致；两种任务共用同一套代号） */
const PIPELINE: StageCode[] = ['parse', 'claim_split', 'claim_classify', 'check', 'aggregate']

/** 按契约造一份阶段对象：页面要读 stage_code / attempt / stat / duration_ms，缺一个都会显示异常 */
function buildStages(taskId: string): TaskStage[] {
  const now = new Date().toISOString()
  return PIPELINE.map((stageCode, index) => ({
    id: taskId + '-st' + (index + 1),
    task_id: taskId,
    stage_code: stageCode,
    status: index === 0 ? 'running' : 'pending',
    attempt: 1,
    progress: 0,
    stat: null,
    skip_reason: null,
    error: null,
    started_at: index === 0 ? now : null,
    finished_at: null,
    duration_ms: null,
  }))
}

/**
 * 把演示数据库里的任务取给"进度流模拟"用（见 mock/mockStream.ts）。
 * 进度流需要真的推进任务并写回终态，否则刷新后任务永远停在 running。
 * 只给 mockStream 用 —— 真实后端没有这个概念，业务层不要 import 它。
 */
export function mockTaskById(id: string): Task | undefined {
  return db.tasks.find((task) => task.id === id) as Task | undefined
}

export const MOCK_ROUTES: MockRoute[] = [
  /* ==========================================================================
   * 提交任务（勘误 / 评估）：用户选的类型、范围、深度、备注在这里变成一条任务
   *
   * 演示环境里不会真的去跑核查，只是建一条"进行中"的任务并把意图挂上去，
   * 让进度页有东西可看、让用户在项目 data/tasks/ 的留档与这条任务对得上。
   * 真实后端要做的是：解析文件 → 按勾选的类型分派检查器 → 回填结论。
   * ========================================================================*/
  {
    method: 'POST',
    pattern: /^\/tasks\/submit$/,
    note: '对应 POST /tasks/submit：提交勘误/评估任务请求（带类型、范围、深度、备注）',
    handle: ({ body }) => {
      const payload = (body ?? {}) as {
        project_id?: string
        project_name?: string
        report_id?: string | null
        report_path?: string
        kind?: 'errata' | 'assessment'
        types?: Array<{ code: string; name: string; note: string | null }>
        page_range?: { from: number; to: number } | null
        depth?: string | null
        note?: string | null
        estimated_minutes?: number
      }
      const kind = payload.kind === 'assessment' ? 'assessment' : 'errata'
      const types = payload.types ?? []
      if (!types.length) {
        throw new ApiError({ code: 'VALIDATION_FAILED', message: '至少要勾选一个类型', httpStatus: 400 })
      }
      const reportId = payload.report_id || db.reports[0]?.id || 'rpt-demo'
      const report = db.reports.find((r) => r.id === reportId)
      const fileName = String(payload.report_path || '').split(/[\\/]/).pop() || '研报'
      const id = 'task-' + Math.random().toString(36).slice(2, 8)
      const task = {
        id,
        report_id: reportId,
        report_title: report?.title ?? fileName.replace(/\.[^.]+$/, ''),
        // 字段名以 types.ts 的 Task 为准（company / ticker）——
        // 之前写的 report_company 没有任何地方读，而页面读 company 拿到的是 undefined
        company: report?.company ?? '',
        ticker: report?.ticker ?? '—',
        check_batch_id: 'batch-' + id.slice(-4),
        mode: 'deep' as const,
        dimensions: types.map((item) => item.code),
        status: 'running' as const,
        progress: 6,
        owner_id: db.user.id,
        owner_name: db.user.name,
        trace_id: 'tr-' + id,
        message: '任务已提交，正在' + STAGE_CODE_LABEL[PIPELINE[0]],
        current_stage: PIPELINE[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        // 任务类型也进契约（types.ts 的 Task.kind）：进度页靠它决定"查看结果"去哪个界面
        kind,
        // 任务意图（真实后端会存进任务表；这里挂在对象上便于演示页展示）
        request_types: types,
        request_page_range: payload.page_range ?? null,
        request_depth: payload.depth ?? null,
        request_note: payload.note ?? null,
        request_estimated_minutes: payload.estimated_minutes ?? null,
        request_project_name: payload.project_name ?? '',
        stages: buildStages(id),
        // 计数器字段名同样以契约（Task['counters']）为准：findings_high / findings_medium / findings_low
        counters: { claims_total: 0, findings_high: 0, findings_medium: 0, findings_low: 0, uncovered: 0 },
      }
      db.tasks.unshift(task as never)
      return task
    },
  },

  /* ==========================================================================
   * 按本地项目确保报告就绪（桌面端专用）
   *
   * 演示环境里，任何报告都用同一份演示数据（原文、结论、评估），
   * 所以这里只要保证"一个项目对应一条报告记录"即可，结论页面自然有内容可看。
   * 真实后端要做的更多：解析文件、跑流水线、把结论挂回来。
   * ========================================================================*/
  {
    method: 'POST',
    pattern: /^\/reports\/ensure$/,
    note: '对应 POST /reports/ensure：按 project_id + 本地路径确保报告存在（幂等）',
    handle: ({ body }) => {
      const payload = (body ?? {}) as { project_id?: string; report_path?: string; report_name?: string }
      const projectId = String(payload.project_id || '')
      const reportPath = String(payload.report_path || '')
      if (!projectId || !reportPath) {
        throw new ApiError({ code: 'VALIDATION_FAILED', message: '缺少 project_id 或 report_path', httpStatus: 400 })
      }
      const existing = db.reports.find((r) => r.project_id === projectId && r.local_path === reportPath)
      if (existing) return existing

      const fileName = reportPath.split(/[\\/]/).pop() || '未命名研报'
      const report = {
        id: 'rpt-' + Math.random().toString(36).slice(2, 8),
        title: String(payload.report_name || fileName).replace(/\.[^.]+$/, ''),
        company: fileName.replace(/\.[^.]+$/, '').slice(0, 18),
        ticker: '—',
        report_date: new Date().toISOString().slice(0, 10),
        owner_id: db.user.id,
        owner_name: db.user.name,
        status: 'checked' as const,
        latest_version_no: 1,
        project_id: projectId,
        project_name: '',
        local_path: reportPath,
        findings_high: 3,
        findings_medium: 2,
        findings_low: 1,
        uncovered: 3,
        pending_review: 12,
        reviewed_count: 4,
        review_total: 16,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      db.reports.unshift(report as never)
      return report
    },
  },

  /* ==========================================================================
   * 评估列表（"研报评估"这条主线的入口）
   * 未评估的报告返回 status='not_started' 且 score 为 null —— 不用 0 分代替，
   * 因为"没做"和"做出来是 0 分"是两件事。
   * ========================================================================*/
  {
    method: 'GET',
    pattern: /^\/assessments$/,
    note: '对应 GET /assessments：评估结果列表（一份报告一行，支持按项目/状态筛选）',
    handle: ({ query }) => {
      let list = buildAssessmentRows()
      const projectId = query.project_id ? String(query.project_id) : ''
      const status = query.status ? String(query.status) : ''
      const q = query.q ? String(query.q) : ''
      if (projectId) list = list.filter((row) => row.project_id === projectId)
      if (status) list = list.filter((row) => row.status === status)
      if (q) list = list.filter((row) => row.title.includes(q) || row.company.includes(q))
      return paginate(list, query)
    },
  },

  /* ---------------- 认证（05 §5.1） ---------------- */
  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    note: '对应 POST /auth/login：演示账号随便填，直接返回登录态',
    handle: () => ({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      user: db.user,
    }),
  },
  {
    method: 'POST',
    pattern: /^\/auth\/register$/,
    note: '对应 POST /auth/register',
    handle: ({ body }) => {
      const patch = (body ?? {}) as { name?: string; username?: string; company?: string; role?: string }
      // 注册要把身份**写回演示数据库**：以前只改了返回值，刷新页面后 /me 又给出默认用户，
      // 用户的感受就是"注册完身份又变回去了"。
      if (patch.name) db.user.name = patch.name
      if (patch.username) db.user.username = patch.username
      if (patch.company) db.user.company = patch.company
      if (patch.role) db.user.role = patch.role as typeof db.user.role
      return {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        user: db.user,
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/auth\/refresh$/,
    note: '对应 POST /auth/refresh',
    handle: () => ({ access_token: 'mock-access-token-2', refresh_token: 'mock-refresh-token' }),
  },
  {
    method: 'POST',
    pattern: /^\/auth\/logout$/,
    note: '对应 POST /auth/logout',
    handle: () => null,
  },
  {
    method: 'GET',
    pattern: /^\/me$/,
    note: '对应 GET /me：刷新页面后恢复登录态用它',
    handle: () => db.user,
  },

  /* ---------------- 维度注册表 ---------------- */
  {
    method: 'GET',
    pattern: /^\/dimensions$/,
    note: '对应 GET /dimensions：驱动"新建核查/核查设置"页，含 required_inputs 依赖声明',
    handle: () => MOCK_DIMENSIONS,
  },  /* ---------------- 研报（05 §5.2） ---------------- */
  {
    method: 'GET',
    pattern: /^\/reports$/,
    note: '对应 GET /reports：报告列表，支持 company / status / keyword 筛选与分页',
    handle: ({ query }) => {
      let list = db.reports.slice()
      const company = query.company ? String(query.company) : ''
      const status = query.status ? String(query.status) : ''
      const projectId = query.project_id ? String(query.project_id) : ''
      const keyword = query.keyword ? String(query.keyword) : ''
      if (company) list = list.filter((r) => r.company.includes(company))
      if (status) list = list.filter((r) => r.status === status)
      if (projectId) list = list.filter((r) => r.project_id === projectId)
      if (keyword) list = list.filter((r) => r.title.includes(keyword) || r.company.includes(keyword))
      return paginate(list, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/reports$/,
    note: '对应 POST /reports：上传研报（multipart）。假数据里不解析文件，直接模拟一个解析成功的新报告',
    handle: async ({ body, query }) => {
      // FormData 里的字段要单独取（真实后端也是这么读的）
      const form = body as FormData
      const title = String(form?.get?.('title') || query.title || '未命名研报')
      const company = String(form?.get?.('company') || query.company || '未知公司')
      const ticker = String(form?.get?.('ticker') || query.ticker || '000000.SZ')
      const reportDate = String(form?.get?.('report_date') || query.report_date || '2026-09-01')
      const id = 'rpt-' + Math.random().toString(36).slice(2, 8)
      // 项目归属：前端新建核查时会把 project_id 一起传上来（不传就落到第一个项目）
      const projectId = String(form?.get?.('project_id') || query.project_id || 'prj-001')
      // 项目由桌面端本地文件夹管理，这里只记 project_id（历史字段，后端接入后由后端补项目名）
      const projectName = ''
      const report = {
        id,
        title,
        company,
        ticker,
        report_date: reportDate,
        project_id: projectId,
        project_name: projectName,
        owner_id: db.user.id,
        owner_name: db.user.name,
        status: 'draft' as const,
        latest_version_no: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      db.reports.unshift(report as never)
      // 上传成功但解析要等任务跑，所以状态还是 draft（真实后端也是先建报告再解析）
      return { report, version: { ...MOCK_REPORT_VERSION, id: 'rv-' + id, report_id: id } }
    },
  },
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)\/blocks$/,
    note: '对应 GET /reports/{id}/blocks：原文块（复核裁决页左栏）。参数1 = reportId',
    handle: () => MOCK_BLOCKS,
  },
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)\/claims$/,
    note: '对应 GET /reports/{id}/claims：主张+结论列表（复核裁决页右栏）。参数1 = reportId；必须按 block_index 升序',
    handle: ({ query }) => {
      const riskFilter = csv(query.risk)
      const statusFilter = csv(query.status)
      const dimension = query.dimension ? String(query.dimension) : ''
      const typeFilter = query.type ? String(query.type) : ''
      const keyword = query.q ? String(query.q) : ''

      let list: ClaimWithFindings[] = db.claims.map((claim) => ({
        claim,
        findings: findingsOf(claim.id),
        review: buildConclusion(claim.id),
      }))

      if (riskFilter.length) list = list.filter((x) => x.findings.some((f) => f.risk_level && riskFilter.includes(f.risk_level)))
      if (statusFilter.length) list = list.filter((x) => x.findings.some((f) => statusFilter.includes(f.status)))
      if (dimension) list = list.filter((x) => x.findings.some((f) => f.dimension_code === dimension))
      if (typeFilter) list = list.filter((x) => x.claim.claim_type === typeFilter)
      if (keyword) list = list.filter((x) => x.claim.text.includes(keyword))

      // 复核裁决页必须按原文顺序（不是风险顺序），否则左右联动会错乱
      list.sort((a, b) => a.claim.block_index - b.claim.block_index)
      return paginate(list, query)
    },
  },
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)\/assessment$/,
    note: '对应 GET /reports/{id}/assessment：报告级评估（结果总览页的主数据）',
    handle: () => MOCK_ASSESSMENT,
  },
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)\/versions\/(\d+)\/diff$/,
    note: '对应 GET /reports/{id}/versions/{v}/diff：版本差异。参数1 = reportId，参数2 = 起始版本',
    handle: () => ({
      from_version: 1,
      to_version: 2,
      changed_blocks: [],
      removed_claim_ids: [],
      added_claim_ids: [],
    }),
  },
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)$/,
    note: '对应 GET /reports/{id}：报告详情（含版本列表与最新任务）',
    handle: ({ params }) => {
      const report = db.reports.find((r) => r.id === params[0]) || db.reports[0]
      const task = db.tasks.find((t) => t.report_id === report.id) || null
      return { ...report, versions: [MOCK_REPORT_VERSION], latest_task: task }
    },
  },

  /* ---------------- 任务（05 §5.3） ---------------- */
  {
    method: 'GET',
    pattern: /^\/tasks$/,
    note: '对应 GET /tasks：任务列表，支持 status / company / owner 筛选',
    handle: ({ query }) => {
      let list = db.tasks.slice()
      const status = query.status ? String(query.status) : ''
      const company = query.company ? String(query.company) : ''
      if (status) list = list.filter((t) => t.status === status)
      if (company) list = list.filter((t) => t.company.includes(company))
      return paginate(list, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/tasks$/,
    note: '对应 POST /tasks：创建核查任务。演示时若选了需要外部研报库的维度，会返回 409 TASK_MISSING_INPUTS',
    handle: async ({ body }) => {
      const payload = body || {}
      const dimensions: string[] = payload.dimensions || []
      // 模拟"缺资料"：只要勾了观点交叉验证（quality_cross），而资料库里那份是停用状态
      const crossDoc = db.knowledgeDocs.find((d) => d.type === 'external_report')
      if (dimensions.includes('quality_cross') && crossDoc && !crossDoc.enabled) {
        throw new ApiError({
          code: 'TASK_MISSING_INPUTS',
          message: '观点交叉验证需要外部研报库，请先在知识库中上传并启用',
          httpStatus: 409,
          details: { missing_inputs: ['external_reports'] },
        })
      }
      const report = db.reports.find((r) => r.id === payload.report_id) || db.reports[0]
      // 重新核查沿用这个报告上一次任务的类型：评估报告重跑后仍应进评估结果页
      const previousKind =
        (db.tasks.find((t) => t.report_id === report.id) as { kind?: 'errata' | 'assessment' } | undefined)?.kind ?? 'errata'
      // 先把 id 取出来：阶段对象要回填 task_id（否则进度页按 stage_code 匹配时拿不到归属）
      const taskId = 'task-' + Math.random().toString(36).slice(2, 8)
      const task = {
        id: taskId,
        report_id: report.id,
        report_title: report.title,
        company: report.company,
        ticker: report.ticker,
        kind: previousKind,
        check_batch_id: null,
        mode: payload.mode || 'quick',
        dimensions,
        status: 'running' as const,
        progress: 0,
        owner_id: db.user.id,
        owner_name: db.user.name,
        trace_id: crypto.randomUUID?.() || String(Date.now()),
        message: '文档解析中',
        current_stage: 'parse' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // 以前这里是空数组：进度页会渲染成"没有任何阶段"，刷新也看不到推进
        stages: buildStages(taskId),
        counters: { claims_total: 0, findings_high: 0, findings_medium: 0, findings_low: 0, uncovered: 0 },
      }
      db.tasks.unshift(task as never)
      return task
    },
  },
  {
    method: 'POST',
    pattern: /^\/tasks\/([^/]+)\/cancel$/,
    note: '对应 POST /tasks/{id}/cancel：终止任务（保留已完成阶段的产物）',
    handle: ({ params }) => {
      const task = db.tasks.find((t) => t.id === params[0])
      if (task) {
        task.status = 'cancelled'
        task.message = '已终止，已完成阶段的产物保留'
      }
      return task
    },
  },
  {
    method: 'POST',
    pattern: /^\/tasks\/([^/]+)\/stages\/([^/]+)\/retry$/,
    note: '对应 POST /tasks/{id}/stages/{code}/retry：重试单个阶段。参数1 = taskId，参数2 = 阶段代号',
    handle: async ({ params }) => {
      const task = db.tasks.find((t) => t.id === params[0])
      if (task) {
        const stage = task.stages?.find((s) => s.stage_code === params[1])
        if (stage) {
          stage.status = 'running'
          stage.attempt += 1
          stage.progress = 0
          stage.error = null
        }
        task.status = 'running'
        task.message = '已重新提交该阶段'
      }
      // 延迟一点，示意"重试要等后端排队"
      await delay(400)
      return task
    },
  },
  {
    method: 'POST',
    pattern: /^\/reports\/([^/]+)\/recheck$/,
    note: '对应 POST /reports/{id}/recheck：重新核查（新批次，旧批次结论保留）',
    handle: async ({ params, body }) => {
      const report = db.reports.find((r) => r.id === params[0]) || db.reports[0]
      const task = {
        id: 'task-' + Math.random().toString(36).slice(2, 8),
        report_id: report.id,
        report_title: report.title,
        company: report.company,
        ticker: report.ticker,
        check_batch_id: 'bat-' + Math.random().toString(36).slice(2, 6),
        mode: body?.mode || 'deep',
        dimensions: body?.dimensions || [],
        status: 'running' as const,
        progress: 0,
        owner_id: db.user.id,
        owner_name: db.user.name,
        trace_id: crypto.randomUUID?.() || String(Date.now()),
        message: '第 2 次核查已开始（旧批次结果保留，可对比）',
        current_stage: 'parse' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stages: [],
      }
      db.tasks.unshift(task as never)
      await delay(300)
      return task
    },
  },
  {
    method: 'GET',
    pattern: /^\/tasks\/([^/]+)$/,
    note: '对应 GET /tasks/{id}：任务详情（含 stages 与 counters）。进度页每次收到 SSE 事件都会拉它做快照校正',
    // 找不到就报 404：以前这里静默返回第一条任务（db.tasks[0]），
    // 于是"打开一个不存在的任务"会变成"打开别人的任务"，页面还显示得像没事一样。
    handle: ({ params }) => {
      const task = db.tasks.find((t) => t.id === params[0])
      if (!task) {
        throw new ApiError({ code: 'NOT_FOUND', message: '任务不存在：' + params[0], httpStatus: 404 })
      }
      return task
    },
  },  /* ---------------- 主张、结论与复核动作（05 §5.4） ---------------- */
  {
    method: 'GET',
    pattern: /^\/claims\/([^/]+)\/findings$/,
    note: '对应 GET /claims/{id}/findings：该主张在各维度下的全部结论',
    handle: ({ params }) => findingsOf(params[0]),
  },
  {
    method: 'GET',
    pattern: /^\/claims\/([^/]+)\/reviews$/,
    note: '对应 GET /claims/{id}/reviews：复核历史（时间倒序，只追加不覆盖）',
    handle: ({ params }) =>
      db.reviewActions
        .filter((a) => a.claim_id === params[0])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  },
  {
    method: 'GET',
    pattern: /^\/claims\/([^/]+)\/ask$/,
    note: '对应 GET /claims/{id}/ask：历史追问记录（演示里返回空数组，追问走 SSE）',
    handle: () => [],
  },
  {
    method: 'POST',
    pattern: /^\/claims\/([^/]+)\/reviews$/,
    note: '对应 POST /claims/{id}/reviews：提交人工动作。带 If-Match 做乐观锁；驳回必须填理由',
    handle: async ({ params, body, options }) => {
      const claimId = params[0]
      const claim = db.claims.find((c) => c.id === claimId)
      if (!claim) {
        throw new ApiError({ code: 'NOT_FOUND', message: '找不到该主张', httpStatus: 404 })
      }

      // 1) 并发控制：前端带 If-Match: <revision>，与内存里的不一致就报冲突
      const ifMatch = options.headers?.['If-Match'] || options.headers?.['if-match']
      if (ifMatch && Number(ifMatch) !== claim.revision) {
        throw new ApiError({
          code: 'CLAIM_REVISION_CONFLICT',
          message: '该条已被他人复核，请刷新后再试',
          httpStatus: 409,
          details: { current_revision: claim.revision },
        })
      }

      // 2) 驳回必须填理由（这条不能放宽：理由就是经验学习的原料）
      if (body?.action === 'reject' && !String(body?.reason || '').trim()) {
        throw new ApiError({
          code: 'REVIEW_REASON_REQUIRED',
          message: '驳回 AI 需要填写理由，理由会用于系统改进',
          httpStatus: 400,
        })
      }

      // 3) 写入一条人工动作，并把主张的 revision +1（下次提交要用新的版本号）
      const action = {
        id: 'act-' + Math.random().toString(36).slice(2, 8),
        claim_id: claimId,
        action: body.action,
        reason: body.reason ?? null,
        payload: body.payload ?? null,
        actor_id: db.user.id,
        actor_name: db.user.name,
        created_at: new Date().toISOString(),
      }
      db.reviewActions.unshift(action as never)
      claim.revision += 1

      // 4) 顺带更新报告上的复核进度（真实后端是聚合查询算出来的）
      const report = db.reports.find((r) => r.id === 'rpt-001')
      if (report?.reviewed_count !== undefined) report.reviewed_count += 1

      await delay(200)
      return action
    },
  },
  {
    method: 'GET',
    pattern: /^\/claims\/([^/]+)$/,
    note: '对应 GET /claims/{id}：单条详情（含块位置、全部结论、三态结论、复核历史）',
    handle: ({ params }) => {
      const claim = db.claims.find((c) => c.id === params[0]) || db.claims[0]
      const block = MOCK_BLOCKS.find((b) => b.id === claim.block_id) || MOCK_BLOCKS[0]
      return {
        claim,
        block,
        findings: findingsOf(claim.id),
        review: buildConclusion(claim.id),
        review_actions: db.reviewActions.filter((a) => a.claim_id === claim.id),
      }
    },
  },
  {
    method: 'GET',
    pattern: /^\/findings\/([^/]+)$/,
    note: '对应 GET /findings/{id}：单条结论的完整信息（证据、核算过程、溯源三要素）',
    handle: ({ params }) => {
      const finding = db.findings.find((f) => f.id === params[0]) || db.findings[0]
      const claim = db.claims.find((c) => c.id === finding.claim_id) || db.claims[0]
      const task = db.tasks.find((t) => t.check_batch_id === finding.check_batch_id) || db.tasks[0]
      return {
        finding,
        claim,
        review: buildConclusion(finding.claim_id),
        review_actions: db.reviewActions.filter((a) => a.claim_id === finding.claim_id),
        trace: {
          task_id: task?.id ?? null,
          trace_id: task?.trace_id ?? null,
          model_ref: 'deep-think-v1',
          prompt_version: 'calc_check.v3',
          rule_version: MOCK_ASSESSMENT.rule_version,
        },
      }
    },
  },

  /* ---------------- 复核列表（05 §5.5） ---------------- */
  {
    method: 'GET',
    pattern: /^\/reviews\/summary$/,
    note: '对应 GET /reviews/summary：工作台的汇总数字（待复核、高风险、近 7 天）',
    handle: (): ReviewsSummary => {
      const pendingClaims = db.claims.filter((c) => buildConclusion(c.id).state === 'pending')
      const highPending = pendingClaims.filter((c) => riskOf(c.id) === 'high')
      return {
        reports_pending: 1,
        // 待复核条数：**含未覆盖的条目**（不能被进度掩盖，05 §2.4）
        claims_pending: pendingClaims.length,
        high_risk_pending: highPending.length,
        high_risk_last_7d: 5,
        recent_high_risk: [
          {
            report_id: 'rpt-001',
            report_title: db.reports[0].title,
            company: '中瓷电子',
            risk_count: 3,
            latest_at: hoursAgoInSummary(30),
          },
          {
            report_id: 'rpt-002',
            report_title: db.reports[1].title,
            company: '源杰科技',
            risk_count: 2,
            latest_at: hoursAgoInSummary(1),
          },
        ],
        tasks_running: db.tasks.filter((t) => t.status === 'running').length,
      }
    },
  },
  {
    method: 'GET',
    pattern: /^\/reviews\/reports$/,
    note: '对应 GET /reviews/reports：复核列表第一层（报告级，含复核进度）',
    handle: ({ query }) => {
      const rows: ReportReviewRow[] = db.reports.map((r) => {
        const reviewed = db.reviewActions.filter((a) => db.claims.some((c) => c.id === a.claim_id)).length
        const total = db.claims.length
        const status = r.status === 'checked' ? 'in_progress' : r.status === 'checking' ? 'pending' : 'pending'
        return {
          report_id: r.id,
          report_title: r.title,
          company: r.company,
          ticker: r.ticker,
          report_date: r.report_date,
          check_status: r.status === 'checked' ? 'completed' : r.status === 'checking' ? 'running' : 'not_started',
          review_status: status,
          high_risk: r.findings_high ?? 0,
          medium_risk: r.findings_medium ?? 0,
          low_risk: r.findings_low ?? 0,
          pass_count: 6,
          uncovered: r.uncovered ?? 0,
          reviewed_count: reviewed,
          review_total: total,
          latest_task_id: db.tasks.find((t) => t.report_id === r.id)?.id ?? null,
          latest_batch_id: r.status === 'checked' ? MOCK_BATCH_ID : null,
          updated_at: r.updated_at,
        }
      })
      // 默认排序：待复核且高风险优先 → 最近更新倒序（后端写死，前端不传排序参数）
      rows.sort((a, b) => Number(b.review_total > 0) - Number(a.review_total > 0) || (a.updated_at < b.updated_at ? 1 : -1))
      return paginate(rows, query)
    },
  },
  {
    method: 'GET',
    pattern: /^\/reviews\/([^/]+)\/queue$/,
    note: '对应 GET /reviews/{reportId}/queue：复核列表第二层（主张级队列，风险降序 + 有证据优先）',
    handle: ({ query }) => {
      const riskFilter = csv(query.risk)
      const dimension = query.dimension ? String(query.dimension) : ''
      let rows: ClaimQueueRow[] = db.claims.map((claim) => {
        const findings = findingsOf(claim.id)
        const primary = findings[0]
        return {
          claim_id: claim.id,
          report_id: 'rpt-001',
          block_index: claim.block_index,
          excerpt: claim.text,
          claim_type: claim.claim_type,
          risk_level: riskOf(claim.id),
          status: primary?.status ?? 'pass',
          dimension_name: primary?.dimension_name ?? '—',
          suggestion: primary?.suggestion ?? null,
          review_state: buildConclusion(claim.id).state,
          has_evidence: (primary?.evidences?.length ?? 0) > 0,
          revision: claim.revision,
        }
      })
      if (riskFilter.length) rows = rows.filter((r) => r.risk_level && riskFilter.includes(r.risk_level))
      if (dimension) rows = rows.filter((r) => r.dimension_name.includes(dimension))
      // 风险降序 → 有证据优先 → 原文顺序；让用户在前 20% 的条目里覆盖 80% 的风险
      rows.sort(
        (a, b) =>
          riskRank(b.risk_level) - riskRank(a.risk_level) ||
          Number(b.has_evidence) - Number(a.has_evidence) ||
          a.block_index - b.block_index
      )
      return paginate(rows, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/reviews\/batch$/,
    note: '对应 POST /reviews/batch：批量动作，只允许"标记已核实"（批量驳回会被后端拒绝）',
    handle: async ({ body }) => {
      const ids: string[] = body?.claim_ids || []
      if (body?.action !== 'verify') {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: '批量操作只支持"标记已核实"；驳回请逐条填写理由',
          httpStatus: 400,
        })
      }
      let updated = 0
      for (const id of ids) {
        const claim = db.claims.find((c) => c.id === id)
        if (!claim) continue
        // 已有结论的动作不重复写（幂等）
        if (buildConclusion(id).state !== 'pending') continue
        db.reviewActions.unshift({
          id: 'act-' + Math.random().toString(36).slice(2, 8),
          claim_id: id,
          action: 'verify',
          reason: '批量核实',
          payload: null,
          actor_id: db.user.id,
          actor_name: db.user.name,
          created_at: new Date().toISOString(),
        })
        claim.revision += 1
        updated += 1
      }
      await delay(400)
      return { updated, skipped: [] }
    },
  },  /* ---------------- 知识库（05 §5.6） ---------------- */
  {
    method: 'GET',
    pattern: /^\/knowledge\/docs$/,
    note: '对应 GET /knowledge/docs：知识库文档列表（含启用状态与切片数）',
    handle: ({ query }) => {
      let list = db.knowledgeDocs.slice()
      if (query.type) list = list.filter((d) => d.type === String(query.type))
      if (query.enabled !== undefined && query.enabled !== '') list = list.filter((d) => String(d.enabled) === String(query.enabled))
      if (query.q) list = list.filter((d) => d.title.includes(String(query.q)))
      return paginate(list, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/knowledge\/docs$/,
    note: '对应 POST /knowledge/docs：上传知识库文档（假数据里直接造一条"解析完成"的记录）',
    handle: async ({ body }) => {
      const form = body as FormData
      const doc = {
        id: 'kdoc-' + Math.random().toString(36).slice(2, 6),
        type: String(form?.get?.('type') || 'norm') as never,
        title: String(form?.get?.('title') || '未命名资料'),
        version: 1,
        enabled: true,
        effective_from: String(form?.get?.('effective_from') || '2026-01-01'),
        scope: String(form?.get?.('scope') || '')
          .split(',')
          .filter(Boolean),
        file_uri: 's3://rqc/knowledge/uploaded.pdf',
        chunk_count: 24,
        parse_status: 'done' as const,
        uploaded_by: db.user.name,
        created_at: new Date().toISOString(),
      }
      db.knowledgeDocs.unshift(doc as never)
      await delay(500)
      return doc
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/knowledge\/docs\/([^/]+)\/enable$/,
    note: '对应 PATCH /knowledge/docs/{id}/enable：启用/停用。只影响后续任务，历史结论不变',
    handle: ({ params, body }) => {
      const doc = db.knowledgeDocs.find((d) => d.id === params[0])
      if (doc) doc.enabled = Boolean(body?.enabled)
      return doc
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/knowledge\/docs\/([^/]+)$/,
    note: '对应 DELETE /knowledge/docs/{id}：软删（后端保留记录用于审计）',
    handle: ({ params }) => {
      const index = db.knowledgeDocs.findIndex((d) => d.id === params[0])
      if (index >= 0) db.knowledgeDocs.splice(index, 1)
      return null
    },
  },
  {
    method: 'GET',
    pattern: /^\/knowledge\/chunks$/,
    note: '对应 GET /knowledge/chunks：分片列表/检索，用于排查"为什么没检索到"',
    handle: ({ query }) => {
      let list = MOCK_KNOWLEDGE_CHUNKS.slice()
      if (query.doc_id) list = list.filter((c) => c.doc_id === String(query.doc_id))
      if (query.q) list = list.filter((c) => c.text.includes(String(query.q)))
      return paginate(list, query)
    },
  },

  /* ---------------- 经验学习（05 §5.6） ---------------- */
  {
    method: 'GET',
    pattern: /^\/learning\/cases$/,
    note: '对应 GET /learning/cases：经验案例（由人工裁决沉淀而来）',
    handle: ({ query }) => {
      let cases = db.cases.slice()
      if (query.case_type) cases = cases.filter((c) => c.case_type === String(query.case_type))
      return paginate(cases, query)
    },
  },
  {
    method: 'GET',
    pattern: /^\/learning\/candidates$/,
    note: '对应 GET /learning/candidates：学习候选（待审核的规则/提示词修改建议）',
    handle: ({ query }) => {
      let list = db.candidates.slice()
      if (query.state) list = list.filter((c) => c.state === String(query.state))
      if (query.type) list = list.filter((c) => c.type === String(query.type))
      return paginate(list, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/learning\/candidates\/([^/]+)\/review$/,
    note: '对应 POST /learning/candidates/{id}/review：审核候选。approve 会生成新版本并置 active',
    handle: async ({ params, body }) => {
      const candidate = db.candidates.find((c) => c.id === params[0])
      if (!candidate) {
        throw new ApiError({ code: 'NOT_FOUND', message: '找不到该候选', httpStatus: 404 })
      }
      if (body?.decision === 'reject' && !String(body?.note || '').trim()) {
        throw new ApiError({
          code: 'REVIEW_REASON_REQUIRED',
          message: '驳回候选需要填写理由，便于以后复盘',
          httpStatus: 400,
        })
      }
      candidate.state = body?.decision === 'approve' ? 'approved' : 'rejected'
      candidate.reviewer_id = db.user.id
      candidate.reviewer_name = db.user.name
      candidate.review_note = body?.note ?? null
      candidate.reviewed_at = new Date().toISOString()

      // 通过审核 → 生成一个新的规则版本并置为 active，旧版本自动归档（D5：人是唯一发布者）
      if (body?.decision === 'approve') {
        const key = (candidate.impact_dimensions[0] || 'general') + '_check'
        const sameKey = db.ruleVersions.filter((v) => v.key === key)
        sameKey.forEach((v) => {
          if (v.state === 'active') v.state = 'archived'
        })
        const nextVersion = sameKey.reduce((max, v) => Math.max(max, v.version), 0) + 1
        db.ruleVersions.unshift({
          id: 'rv-' + key + '-' + nextVersion,
          kind: 'risk_rule',
          key,
          version: nextVersion,
          content: candidate.content,
          state: 'active',
          published_by: db.user.name,
          published_at: new Date().toISOString(),
          note: '由学习候选 ' + candidate.id + ' 审核通过后发布',
        })
        // 顺便写一条审计事件，证明"判据变更可追溯"
        db.auditEvents.unshift({
          id: 'aud-' + Math.random().toString(36).slice(2, 8),
          task_id: null,
          stage_code: null,
          event_type: 'rule_publish',
          actor: db.user.name,
          model: null,
          prompt_version: null,
          tool_name: null,
          input_digest: '候选 ' + candidate.id + ' 审核通过',
          output_digest: key + ' v' + nextVersion + ' → active',
          duration_ms: null,
          tokens: null,
          trace_id: 'local-' + Date.now(),
          status: 'ok',
          created_at: new Date().toISOString(),
        } as never)
      }
      await delay(300)
      return candidate
    },
  },
  {
    method: 'GET',
    pattern: /^\/learning\/versions$/,
    note: '对应 GET /learning/versions：已发布的规则/提示词版本（可回滚）',
    handle: ({ query }) => {
      let list = db.ruleVersions.slice()
      if (query.kind) list = list.filter((v) => v.kind === String(query.kind))
      if (query.key) list = list.filter((v) => v.key === String(query.key))
      return paginate(list, query)
    },
  },
  {
    method: 'POST',
    pattern: /^\/learning\/versions\/([^/]+)\/rollback$/,
    note: '对应 POST /learning/versions/{id}/rollback：回滚（生成新版本，不删历史，保证审计链完整）',
    handle: async ({ params, body }) => {
      const target = db.ruleVersions.find((v) => v.id === params[0])
      if (!target) throw new ApiError({ code: 'NOT_FOUND', message: '找不到该版本', httpStatus: 404 })
      db.ruleVersions
        .filter((v) => v.key === target.key && v.state === 'active')
        .forEach((v) => {
          v.state = 'archived'
        })
      const rolled = {
        ...target,
        id: 'rv-' + target.key + '-rollback-' + Date.now(),
        version: target.version + 1,
        state: 'active' as const,
        published_by: db.user.name,
        published_at: new Date().toISOString(),
        note: '回滚到 v' + target.version + '，原因：' + (body?.reason || '未填写'),
      }
      db.ruleVersions.unshift(rolled)
      await delay(300)
      return rolled
    },
  },
  /* ---------------- 经验学习的删除（★ 本次新增） ----------------
   *
   * 【为什么候选和版本不能随便删】
   *   候选：只有"还没审核过（pending）"的能删 —— 已通过/已驳回的候选是**决策记录**，
   *         删了就没法回答"这条规则当初为什么没采纳"。
   *   版本：只有"已归档（archived）"的能删 —— 生效中的版本一旦删掉，系统就没有判据了。
   *   案例：可以删（它只是学习素材）。
   * 【删除一律留痕】
   *   每次删除都往审计事件里写一条，这样"东西怎么没了"永远查得到 —— 删除不等于抹掉痕迹。
   * -------------------------------------------------------------*/
  {
    method: 'DELETE',
    pattern: /^\/learning\/candidates\/([^/]+)$/,
    note: '对应 DELETE /learning/candidates/{id}：删除候选（已审核的必须填理由）',
    handle: ({ params, body }) => {
      const index = db.candidates.findIndex((c) => c.id === params[0])
      if (index < 0) throw new ApiError({ code: 'NOT_FOUND', message: '候选不存在', httpStatus: 404 })
      const candidate = db.candidates[index]
      const candidateReason = String(body?.reason || '').trim()
      // 已审核过的候选是"决策记录"，但不是不能删 —— 删它必须说明理由，理由会进审计
      if (candidate.state !== 'pending' && !candidateReason) {
        throw new ApiError({
          code: 'VALIDATION_FAILED',
          message: '这条候选已经审核过（属决策记录），删除必须填写理由',
          httpStatus: 400,
        })
      }
      db.candidates.splice(index, 1)
      db.auditEvents.unshift({
        id: 'ev-' + Math.random().toString(36).slice(2, 8),
        trace_id: 'tr-' + candidate.id,
        action: 'learning_candidate_deleted',
        summary: '删除学习候选：' + candidate.content.slice(0, 30) + (body?.reason ? '（原因：' + body.reason + '）' : ''),
        actor_id: db.user.id,
        actor_name: db.user.name,
        created_at: new Date().toISOString(),
      } as never)
      return { deleted: true }
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/learning\/cases\/([^/]+)$/,
    note: '对应 DELETE /learning/cases/{id}：删除经验案例',
    handle: ({ params }) => {
      const index = db.cases.findIndex((c) => c.id === params[0])
      if (index < 0) throw new ApiError({ code: 'NOT_FOUND', message: '案例不存在', httpStatus: 404 })
      const removed = db.cases.splice(index, 1)[0]
      db.auditEvents.unshift({
        id: 'ev-' + Math.random().toString(36).slice(2, 8),
        trace_id: 'tr-' + removed.id,
        action: 'experience_case_deleted',
        summary: '删除经验案例：' + String(removed.summary || '').slice(0, 30),
        actor_id: db.user.id,
        actor_name: db.user.name,
        created_at: new Date().toISOString(),
      } as never)
      return { deleted: true }
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/learning\/versions\/([^/]+)$/,
    note: '对应 DELETE /learning/versions/{id}：不限制状态；删生效中的会自动把上一个归档版本切回生效',
    handle: ({ params, body }) => {
      const index = db.ruleVersions.findIndex((v) => v.id === params[0])
      if (index < 0) throw new ApiError({ code: 'NOT_FOUND', message: '版本不存在', httpStatus: 404 })
      const version = db.ruleVersions[index]
      const versionReason = String(body?.reason || '').trim()
      const wasActive = version.state === 'active'
      db.ruleVersions.splice(index, 1)

      // ★ 删掉的是"生效中"的版本时，必须保证这条规则还有判据可用：
      //   把同一条规则下最近的归档版本自动切回生效（并在它的说明里记一笔），
      //   如果一个都没有，就明确告诉调用方"这条规则暂时没有生效版本"。
      let promoted = null
      if (wasActive) {
        const sameKey = db.ruleVersions
          .filter((v) => v.key === version.key)
          .sort((a, b) => b.version - a.version)
        const fallback = sameKey[0]
        if (fallback) {
          fallback.state = 'active'
          fallback.note = (fallback.note ? fallback.note + '；' : '') + '因 v' + version.version + ' 被删除而自动切回生效'
          promoted = { id: fallback.id, key: fallback.key, version: fallback.version }
        }
      }

      db.auditEvents.unshift({
        id: 'ev-' + Math.random().toString(36).slice(2, 8),
        trace_id: 'tr-' + version.id,
        action: 'rule_version_deleted',
        summary:
          '删除规则版本 ' + version.key + ' v' + version.version +
          (wasActive ? '（原生效版本' + (promoted ? '，已自动切回 v' + promoted.version : '，该规则暂无生效版本，将使用默认判据') + '）' : '') +
          (versionReason ? '（原因：' + versionReason + '）' : ''),
        actor_id: db.user.id,
        actor_name: db.user.name,
        created_at: new Date().toISOString(),
      } as never)
      return { deleted: true, promoted }
    },
  },

  {
    method: 'POST',
    pattern: /^\/learning\/candidates$/,
    note: '对应 POST /learning/candidates：手动触发生成候选（平时由定时任务产出）',
    handle: async () => {
      await delay(600)
      return { created: 0 }
    },
  },

  /* ---------------- 导出（演示模式） ---------------- */
  {
    method: 'GET',
    pattern: /^\/reports\/([^/]+)\/export-preview$/,
    note:
      '演示模式专用：假后端没有真实 docx/pdf 字节，返回一份文本摘要供前端下载；' +
      '真实后端只需实现 GET /reports/{id}/export（前端会直接打开它）',
    handle: ({ params }) => {
      const report = db.reports.find((r) => r.id === params[0]) || db.reports[0]
      const task = db.tasks.find((t) => t.report_id === report.id) as { counters?: Record<string, number> } | undefined
      const counters = task?.counters ?? {}
      const claims = db.claims.filter((c) => (c as { report_id?: string }).report_id === report.id)
      const claimIds = new Set(claims.map((c) => c.id))
      const findings = db.findings.filter((f) => claimIds.has(f.claim_id))
      const riskLines = findings
        .filter((f) => f.status === 'risk')
        .slice(0, 8)
        .map((f) => `· [${RISK_LEVEL_LABEL[f.risk_level ?? 'low']}] ${f.claim_id}：${f.reason ?? ''}`)

      const text = [
        '研报核查与质量评估平台 · 导出摘要（演示模式）',
        '',
        '报告：' + report.title,
        '公司 / 代码：' + report.company + ' / ' + report.ticker,
        '报告日期：' + report.report_date,
        '报告状态：' + report.status,
        '',
        '— 核查统计 —',
        '主张总数：' + (counters.claims_total ?? claims.length),
        '高风险：' + (counters.findings_high ?? 0),
        '中风险：' + (counters.findings_medium ?? 0),
        '低风险：' + (counters.findings_low ?? 0),
        '未覆盖（不等于通过）：' + (counters.uncovered ?? 0),
        '',
        '— 高风险结论（最多 8 条）—',
        riskLines.length ? riskLines.join('\n') : '（本次没有高风险结论）',
        '',
        '— 说明 —',
        '这份摘要是**演示数据**下生成的文本文件，不是真实导出件。',
        '接入后端后，前端会直接打开 GET /reports/{id}/export?format=docx 下载后端生成的 docx/pdf。',
        '生成时间：' + new Date().toLocaleString('zh-CN'),
      ].join('\n')

      return { filename: report.title + '-核查摘要（演示）.txt', text }
    },
  },

  /* ---------------- 审计 ---------------- */
  {
    method: 'GET',
    pattern: /^\/audit\/events$/,
    note: '对应 GET /audit/events：审计日志（按任务/阶段/事件类型/模型/工具/trace 过滤，必须分页）',
    handle: ({ query }) => {
      let list = db.auditEvents.slice()
      if (query.task_id) list = list.filter((e) => e.task_id === String(query.task_id))
      if (query.stage_code) list = list.filter((e) => e.stage_code === String(query.stage_code))
      if (query.event_type) list = list.filter((e) => e.event_type === String(query.event_type))
      if (query.model) list = list.filter((e) => e.model === String(query.model))
      if (query.tool) list = list.filter((e) => e.tool_name === String(query.tool))
      if (query.status) list = list.filter((e) => e.status === String(query.status))
      if (query.trace_id) list = list.filter((e) => e.trace_id === String(query.trace_id))
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return paginate(list, query)
    },
  },
  {
    method: 'GET',
    pattern: /^\/audit\/trace\/([^/]+)$/,
    note: '对应 GET /audit/trace/{traceId}：按追踪号拉全链路（按时间正序，看流程）',
    handle: ({ params }) => {
      const events = db.auditEvents
        .filter((e) => e.trace_id === params[0])
        .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
      return { trace_id: params[0], events }
    },
  },

  /* ---------------- 帮助 ---------------- */
  {
    method: 'GET',
    pattern: /^\/help\/articles$/,
    note: '对应 GET /help/articles：帮助文档（前端本地做搜索与目录）',
    handle: () => MOCK_HELP_ARTICLES,
  },
  {
    method: 'GET',
    pattern: /^\/help\/articles\/([^/]+)$/,
    note: '对应 GET /help/articles/{slug}：按 slug 取单篇（卡片上的"?"跳这里）',
    handle: ({ params }) => MOCK_HELP_ARTICLES.find((a) => a.slug === params[0]) || MOCK_HELP_ARTICLES[0],
  },
]

/* ============================================================================
 * 四、对外入口：handleMockRequest
 *
 * 职责：匹配路由 → 执行 → 返回数据；匹配不到就抛 404（与真实后端行为一致，
 * 这样"接口没写全"会被立刻发现，而不是静默返回空数据）。
 * ==========================================================================*/

/** 汇总卡片里用的"几小时前"，写成函数避免在对象里调用 Date */
function hoursAgoInSummary(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

/**
 * 匹配并处理一个请求。
 *
 * @param method HTTP 方法（GET/POST/PATCH/DELETE）
 * @param path   去掉 /api/v1 前缀后的路径，例如 "/claims/clm-01/reviews"
 * @param options 请求选项（params 是查询参数，body 是请求体，headers 里可能有 If-Match）
 */
export async function handleMockRequest<T>(
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const route = MOCK_ROUTES.find((r) => r.method === method && r.pattern.test(path))
  if (!route) {
    // 没匹配到 = 前端调了一个"假后端里还没实现"的接口，直接报错，别悄悄返回空数据
    throw new ApiError({
      code: 'MOCK_ROUTE_NOT_FOUND',
      message: `假数据里还没有实现这个接口：${method} ${path}`,
      httpStatus: 404,
    })
  }

  // 轻微延迟，让加载态可见
  await delay()

  const matched = route.pattern.exec(path)
  const params = matched ? matched.slice(1).map((v) => decodeURIComponent(v)) : []
  const result = await route.handle({
    params,
    // client 传进来的查询参数是个普通对象，这里收窄成字典供路由使用
    query: (options.params as Record<string, unknown>) || {},
    body: options.body as never,
    options,
  })
  // 真实后端返回 JSON，这里也走一次"序列化再反序列化"，
  // 保证页面拿到的对象和从网络回来的对象是同一种（避免共享引用导致的奇怪 bug）
  return JSON.parse(JSON.stringify(result ?? null)) as T
}

