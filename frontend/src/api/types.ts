/**
 * api/types.ts —— 前后端"共同语言"：全部接口用到的数据结构都在这里定义
 *
 * 对应文档：05_数据模型与接口契约.md（§2 表字段、§3 枚举字典、§4 JSON 结构、§5 接口清单）
 *
 * 【为什么单独开一个文件】
 *   后端工程师只要读这一个文件，就能知道前端期望每个字段叫什么、什么类型、是不是必填；
 *   前端页面也全部 import 这里的类型，不各自手写一份"差不多的结构"。
 *   真实项目里这个文件由后端 OpenAPI 自动生成（openapi-typescript），当前后端尚未就绪，
 *   所以先严格按 05 文档手写一版；将来后端出 OpenAPI 后，只需替换成生成结果，字段名不变。
 *
 * 【本文件定义的内容清单】
 *   通用基础：Page<T>、ApiErrorBody、Id
 *   用户与权限：User、UserRole
 *   维度注册表：Dimension（驱动"新建核查/核查设置"页）
 *   研报侧：Report、ReportVersion、Block（原文块，带字符区间）
 *   拆解侧：Claim（可核查主张）、ClaimSpan（渲染用区间，不含内容）
 *   结论侧：Finding、Evidence、CalcTrace、ReviewAction、ClaimConclusion（三态结论）
 *   批次与评估：CheckBatch、Assessment（报告级评估）、AssessmentMetrics
 *   任务与审计：Task、TaskStage、AuditEvent
 *   知识与学习：KnowledgeDoc、KnowledgeChunk、ExperienceCase、LearningCandidate、RuleVersion
 *   复核列表：ReviewsSummary、ReportReviewRow、ClaimQueueRow
 *   进度事件：TaskSseEvent（SSE 推送，见 05 §6）
 *
 * 【约定（与 05 §0 一致）】
 *   - 主键统一叫 id，字符串；时间统一 ISO 8601 字符串（后端返回 UTC 带时区）
 *   - 金额/比率后端返回字符串，避免精度丢失，前端只做展示不错位
 *   - 枚举值一律小写蛇形，中文标签在 enums.ts 里映射（不要在页面里写 if 判断中文）
 */

/* ============================================================================
 * 0. 通用基础类型
 * ==========================================================================*/

/** 所有实体主键的统一别名，方便阅读（后端为 UUID v7 字符串） */
export type Id = string

/** ISO 8601 时间字符串，例如 "2026-09-24T02:11:03Z" */
export type IsoDateTime = string

/** 分页响应体，后端所有列表接口都返回这个形状（05 §5 开头的约定） */
export interface Page<T> {
  /** 当前页数据 */
  items: T[]
  /** 符合筛选条件的总条数（不是当前页条数） */
  total: number
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页条数 */
  page_size: number
}

/** 后端统一错误体（05 §7 末尾） */
export interface ApiErrorBody {
  /** 机器可读的错误码，如 TASK_MISSING_INPUTS */
  code: string
  /** 给用户看的中文说明。前端不自己编业务文案，直接展示这个字段 */
  message: string
  /** 结构化补充信息，例如 { missing_inputs: ["external_reports"] } */
  details?: Record<string, unknown>
  /** 排查用编号，与后端日志对齐；用户报障时把它给工程师 */
  trace_id?: string
}

/* ============================================================================
 * 1. 用户与权限
 * ==========================================================================*/

/** 角色：研究员（上传与核查）/ 复核人（裁决）/ 管理员（规则发布与用户管理） */
export type UserRole = 'researcher' | 'reviewer' | 'admin'

/** 当前登录用户（GET /me） */
export interface User {
  id: Id
  /** 姓名，界面右上角显示 */
  name: string
  /** 登录名 */
  username: string
  role: UserRole
  /** 所属公司/机构（注册时填），用于租户隔离展示 */
  company: string
  /** 细粒度权限点，按钮显隐用它判断，例如 ["task:create", "claim:review"] */
  permissions: string[]
}

/** 登录接口返回体 */
export interface LoginResult {
  /** 访问令牌，放 Authorization: Bearer xxx */
  access_token: string
  /** 刷新令牌，access 过期时用它换新的（前端自动做，见 client.ts） */
  refresh_token: string
  /** access_token 有效期（秒） */
  expires_in: number
  user: User
}

/* ============================================================================
 * 2. 维度注册表（核查设置页的数据来源）
 * ==========================================================================*/

/** 维度分组：核查=找问题的维度；质量评估=报告级质量打分维度（05 §3 dimension_code） */
export type DimensionGroup = 'check' | 'quality'

/** 维度运行模式：quick=快速核查，deep=深度评估 */
export type CheckMode = 'quick' | 'deep'

/**
 * 一个核查维度。后端 GET /dimensions 返回列表，前端据此渲染勾选项，
 * 并计算"已选维度需要哪些资料"，所以加维度不需要改前端代码（架构约束：声明式依赖）。
 */
export interface Dimension {
  /** 维度代号，与 finding.dimension_code 对应 */
  code: string
  /** 中文名，直接显示 */
  name: string
  group: DimensionGroup
  /** 一句话说明这个维度查什么，鼠标悬停或副标题展示 */
  description: string
  /** 这个维度需要哪些资料才能跑（如 internal_norm / external_reports），空数组=不需要额外资料 */
  required_inputs: string[]
  /** 在哪些模式下可用；只支持 deep 的维度在 quick 模式下要置灰并说明原因 */
  enabled_in_modes: CheckMode[]
  /** 命中后默认的风险等级倾向，仅用于列表排序参考，实际等级由规则表定（03 §2.2） */
  default_risk_level?: RiskLevel
}

/** 资料来源代号 -> 中文名。用于把 required_inputs 翻译成人话提示 */
export type RequiredInputCode =
  | 'internal_norm'      // 内部规范库（写作规范、禁用表达）
  | 'external_reports'   // 外部研报库（做观点交叉验证）
  | 'market_data'        // 行情/财务数据源（做事实与估值核查）
  | 'valuation_rules'    // 估值规则库
  | 'case_library'       // 历史案例库

/* ============================================================================
 * 3. 研报与原文块
 * ==========================================================================*/

export type ReportStatus = 'draft' | 'checking' | 'checked' | 'archived'

/** 研报本体 */
export interface Report {
  id: Id
  /** 所属项目 id（可选：项目由桌面端以本地文件夹管理，后端接入后如需云端归档再回填） */
  project_id?: Id
  /** 项目名，列表直接显示，省得前端再查一次 */
  project_name?: string
  /** 桌面端项目的本地研报路径（跟着项目配置走；后端接入后由后端上传/解析，此字段可忽略） */
  local_path?: string
  /** 报告名，默认取文件名，用户可改 */
  title: string
  /** 公司名，例如"中瓷电子" */
  company: string
  /** 标的代码，例如"003031.SZ"。核查外部数据以它为准 */
  ticker: string
  /** 核查基准日：外部数据一律只看这一天及之前的，防止"用了未来数据" */
  report_date: string
  /** 上传人 */
  owner_id: Id
  owner_name?: string
  status: ReportStatus
  /** 最新版本号，列表直接显示，不用再查一次版本 */
  latest_version_no: number
  /** 最新批次的统计计数（后端算好，列表页直接用，避免前端 N+1 次请求） */
  findings_high?: number
  findings_medium?: number
  findings_low?: number
  uncovered?: number
  pending_review?: number
  /** 复核进度：已复核 / 待复核总数（百分比由前端算，后端只给两个数） */
  reviewed_count?: number
  review_total?: number
  created_at: IsoDateTime
  updated_at: IsoDateTime
}

/** 研报版本：同一份报告的修订稿会生成新版本，旧结论保留用于对比 */
export interface ReportVersion {
  id: Id
  report_id: Id
  /** 版本号，从 1 开始递增 */
  version_no: number
  /** 文件在对象存储的路径（后端内部用，前端只做展示与下载） */
  file_uri: string
  /** 文件 SHA-256，用于查重与审计 */
  file_hash: string
  /** 解析后纯文本总字符数，也是 offset 的上界 */
  char_count: number
  parse_status: 'pending' | 'parsing' | 'done' | 'failed'
  parse_error?: string
  created_at: IsoDateTime
}

/** 原文块类型 */
export type BlockType = 'heading' | 'paragraph' | 'table_cell' | 'caption' | 'bullet'

/**
 * 原文块。复核裁决页左栏就是按 block_index 顺序渲染这些块。
 * 注意 start_offset / end_offset 是"在整篇纯文本里的绝对区间"，
 * claim 的偏移是"相对本块的局部偏移"，两者不要混（见 05 §2.2）。
 */
export interface Block {
  id: Id
  report_version_id: Id
  /** 文档内顺序，渲染顺序就是它 */
  block_index: number
  block_type: BlockType
  /** 在整篇纯文本中的起止字符位置 */
  start_offset: number
  end_offset: number
  /** 块文本（与区间内容一致，冗余存储方便前端直接渲染） */
  text: string
  /** 章节路径，如"二、盈利预测 > 2.1 营收拆分"，用于定位与面包屑 */
  section_path: string
}

/* ============================================================================
 * 4. 主张（Claim）
 * ==========================================================================*/

/** 主张类型，决定它会被派给哪些维度核查（05 §3） */
export type ClaimType = 'calc' | 'fact' | 'valuation' | 'forecast' | 'norm' | 'judgement'

/** 一条可核查的主张（一句话） */
export interface Claim {
  id: Id
  report_version_id: Id
  /** 属于哪个原文块 */
  block_id: Id
  /** 块在文档中的序号，复核裁决页排序用（必须按原文顺序，不能按风险排） */
  block_index: number
  /** 相对所在 block 的局部起止偏移，渲染高亮用 */
  start_offset: number
  end_offset: number
  /** 主张原文 */
  text: string
  claim_type: ClaimType
  /** 拆解置信度 0~1，低于 0.6 的要在界面上标"待人工确认" */
  confidence: number
  /** 人工修改后 +1；复核请求要带它做并发控制（If-Match），冲突返回 409 */
  revision: number
  section_path: string
}

/** 渲染用的轻量区间：只带定位与风险，不带全文（列表里几百条时省内存） */
export interface ClaimSpan {
  id: Id
  block_id: Id
  start_offset: number
  end_offset: number
  /** 该主张当前最严重的风险等级；null 表示通过/未覆盖/无结论 */
  risk_level: RiskLevel | null
  /** 该主张当前的四态结论（pass/risk/uncovered/error） */
  status: FindingStatus
}

/* ============================================================================
 * 5. 结论与证据（系统的核心资产）
 * ==========================================================================*/

/** 一条 Finding 的四种状态，缺一不可（D12；"未覆盖"绝不能算通过） */
export type FindingStatus = 'pass' | 'risk' | 'uncovered' | 'error'

/** 风险等级，只在 status=risk 时存在 */
export type RiskLevel = 'high' | 'medium' | 'low'

/** 证据类型（05 §3 evidence_type） */
export type EvidenceType = 'kb_chunk' | 'data_source' | 'in_text' | 'calc' | 'external_report'

/** 一条证据。status=risk 的结论必须至少有一条证据，否则会被后端降级为 uncovered */
export interface Evidence {
  id: Id
  type: EvidenceType
  /** 具体来源：知识库分片 id / 数据接口名+参数 / 原文 block id */
  source_ref: string
  /** 证据原文片段，界面上直接显示 */
  snippet: string
  /** 若为文内互证，带字符区间，可点击跳转到原文位置 */
  start_offset?: number | null
  end_offset?: number | null
  /** 可点开的来源链接（数据源页面或文件） */
  uri?: string | null
  /** 取数时间：外部数据必须展示时效，提醒用户"这是什么时候的数" */
  captured_at?: IsoDateTime | null
}

/** 计算过程的单个步骤（核算过程表格的一行） */
export interface CalcStep {
  /** 这一步是什么，如"2026Q2 营收" */
  label: string
  /** 该步取值 */
  value: string
  /** 取值来源，如"原文第 3 段"或"数据源" */
  source?: string
  /** 补充说明，如"保留四位小数" */
  note?: string
}

/**
 * 计算核查的过程记录。前端"核算过程"区域直接按 steps 渲染成表格，
 * 让用户看到"系统怎么算的、和原文差多少"，这是可复算的证据（05 §4.1）。
 */
export interface CalcTrace {
  /** 原始算式，如 "(12.3 - 10.1) / 10.1"，可复制给用户自己验算 */
  expression: string
  /** 单位，如"亿元"、"%" */
  unit?: string
  steps: CalcStep[]
  /** 系统算出来的结果，如 "21.78%" */
  computed: string
  /** 原文声称的数字，如 "25%" */
  claimed: string
  /** 偏差，如 "-3.22pct" */
  deviation: string
  /** 允许的误差范围，如 "1%" */
  tolerance: string
  /** 结论：一致 / 不一致 */
  conclusion: 'match' | 'mismatch'
}

/** 命中的规则（定级依据，可追溯到规则版本） */
export interface RuleHit {
  /** 规则编号，如 R-CALC-01 */
  code: string
  /** 规则的一句话说明 */
  desc: string
}

/** 一条核查结论（一个主张 × 一个维度 = 一条 Finding） */
export interface Finding {
  id: Id
  claim_id: Id
  check_batch_id: Id
  /** 维度代号 */
  dimension_code: string
  /** 维度中文名（后端顺带返回，免得前端再查字典） */
  dimension_name: string
  status: FindingStatus
  /** status != risk 时为 null */
  risk_level: RiskLevel | null
  rule_hits: RuleHit[]
  /** 判断理由，一段人话，直接展示 */
  reason: string
  /** 修改建议，用户可一键复制或采纳 */
  suggestion: string | null
  /** 计算过程，仅计算类有 */
  calc_trace: CalcTrace | null
  /** 模型自评置信度，仅作参考、不参与定级（03 §2.2） */
  confidence: number | null
  evidences: Evidence[]
  /** 未覆盖/失败时必须给出原因，例如"未配置外部研报库" */
  uncovered_reason?: string | null
  created_at: IsoDateTime
}

/** 人工动作类型 */
export type ReviewActionType = 'accept' | 'reject' | 'verify' | 'add_evidence' | 'manual_edit'

/** 复核状态（由最近一条动作推导，05 §2.4） */
export type ReviewState = 'pending' | 'accepted' | 'rejected' | 'verified' | 'edited'

/** 一条人工动作记录（只追加、不可修改，审计与经验学习的原料） */
export interface ReviewAction {
  id: Id
  claim_id: Id
  action: ReviewActionType
  /** 驳回时必填（后端校验），其他动作可选 */
  reason: string | null
  /** 动作携带的数据：{ edited_text } / { evidence: {...} } / { accepted_suggestion } */
  payload: Record<string, unknown> | null
  actor_id: Id
  actor_name: string
  created_at: IsoDateTime
}

/**
 * 三态结论（D4）：AI 结论 / 人工结论 / 生效结论同时存在。
 * 前端必须同时展示，用户才能看出"AI 原来说什么、我改成了什么"。
 */
export interface ClaimConclusion {
  state: ReviewState
  /** AI 说的话，如"高风险：计算错误" */
  ai_conclusion: string
  /** 人工说的话，没有则为 null */
  human_conclusion: string | null
  /** 最终生效的结论，无人工动作时是"待复核"（注意：不是"通过"） */
  effective_conclusion: string
}

/** 复核裁决页右侧卡片的完整数据：主张 + 结论 + 复核信息 + 溯源信息（05 §4.3） */
export interface FindingDetail {
  finding: Finding
  claim: Claim
  review: ClaimConclusion
  review_actions: ReviewAction[]
  /** 溯源三要素：哪个任务、哪次调用、哪个模型/提示词/规则版本（D11） */
  trace: {
    task_id: Id | null
    trace_id: string | null
    model_ref: string | null
    prompt_version: string | null
    rule_version: string | null
  }
}

/** 复核裁决页右侧列表的一项：主张 + 它当前最严重的结论（列表不展开全部维度） */
export interface ClaimWithFindings {
  claim: Claim
  /** 该主张在各维度下的结论；可能为空数组（还没跑完） */
  findings: Finding[]
  review: ClaimConclusion
}

/* ============================================================================
 * 6. 批次与报告级评估
 * ==========================================================================*/

/** 一次核查 = 一个批次。重复核查产生新批次，旧批次结论完整保留（便于对比） */
export interface CheckBatch {
  id: Id
  report_id: Id
  /** 批次号，从 1 开始 */
  batch_no: number
  mode: CheckMode
  /** 本次勾选的维度代号 */
  dimensions: string[]
  /** 本次因为缺资料而"未覆盖"的项，格式 { 维度代号: 原因 } */
  uncovered: Record<string, string>
  created_at: IsoDateTime
}

/** 单个维度的表现（结果总览的"维度表现"表格、质量评估页都用它） */
export interface DimensionMetric {
  code: string
  /** 中文名 */
  name: string
  /** 查出问题数 */
  problems: number
  /** 实际检查了多少条 */
  checked: number
  /** 覆盖率 = 有证据支撑的比例（0~1），未覆盖不算在内 */
  coverage: number
  /** 未覆盖的原因，有值就要在界面上显式展示 */
  uncovered_reason?: string
}

/** 报告级指标，全部可算、可复现（05 §4.2）。前端只展示，不参与计算 */
export interface AssessmentMetrics {
  claims_total: number
  /** 有结论支撑的条数（通过 + 有问题） */
  covered: number
  /** 没查成：缺资料，未做核对（未覆盖 ≠ 通过） */
  uncovered: number
  /** 查了但过程出错（数据源超时等），四种状态里的 error 单独计 */
  error_count: number
  /** 覆盖率，0~1 */
  coverage_rate: number
  risk_counts: {
    high: number
    medium: number
    low: number
    pass: number
  }
  by_dimension: DimensionMetric[]
  /** 无数据支撑的定性表述占比，如 0.31 */
  qualitative_without_data_rate: number | null
  /** 风险披露是否覆盖到 */
  risk_disclosure_covered: boolean | null
  /** 交叉验证一致 / 冲突的条数 */
  cross_view_consistent: number | null
  cross_view_conflicts: number | null
}

/** 报告级评估结论（结果总览页的主数据） */
export interface Assessment {
  id: Id
  check_batch_id: Id
  report_id: Id
  /** 总体风险等级 */
  overall_risk: RiskLevel | 'pass'
  /** 一句话摘要，后端生成（前端绝不自己拼这句话） */
  summary: string
  metrics: AssessmentMetrics
  /** 复核优先级建议：最该先看的若干条 */
  priority_claims: Array<{
    claim_id: Id
    risk_level: RiskLevel
    dimension_name: string
    /** 原文摘要，长文截断后端做 */
    excerpt: string
  }>
  /** 关键问题摘要 3~5 条 */
  key_issues: Array<{
    title: string
    detail: string
    claim_id: Id
  }>
  /** 参考分（可选）。若展示，必须固定附注"由指标加权得出，用于排序，不代表研报质量结论" */
  reference_score: string | null
  rule_version: string
  created_at: IsoDateTime
}

/* ============================================================================
 * 7. 任务、阶段与审计
 * ==========================================================================*/

export type TaskStatus =
  | 'pending'      // 排队中
  | 'running'      // 执行中
  | 'completed'    // 全部成功
  | 'partial_failed' // 部分失败（有产物，但某些维度没跑成）
  | 'failed'       // 失败
  | 'cancelled'    // 被终止（已完成阶段的产物保留）

/** 任务阶段代号，与后端流水线一致（03 §3）。顺序即执行顺序 */
export type StageCode =
  | 'parse'           // 文档解析
  | 'claim_split'     // 语句拆解
  | 'claim_classify'  // 语句分类
  | 'check'           // 维度核查
  | 'aggregate'       // 报告级汇总

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 一个阶段的执行状态 */
export interface TaskStage {
  id: Id
  task_id: Id
  stage_code: StageCode
  status: StageStatus
  /** 第几次尝试（重试会 +1），界面显示"第 2 次重试" */
  attempt: number
  /** 该阶段内部进度 0~100 */
  progress: number
  /** 阶段内统计，如 { claims_total: 412, done: 320 }，用于显示"320/412" */
  stat?: Record<string, number> | null
  /** 跳过时必须说明原因，例如"未配置外部研报库" */
  skip_reason?: string | null
  /** 失败原因，界面标红并给出重试入口 */
  error?: string | null
  started_at?: IsoDateTime | null
  finished_at?: IsoDateTime | null
  /** 耗时（毫秒），前端格式化成"1 分 22 秒" */
  duration_ms?: number | null
}

/** 一个核查任务 */
export interface Task {
  id: Id
  report_id: Id
  /** 报告名与公司，列表页直接显示，省一次请求 */
  report_title: string
  company: string
  ticker: string
  check_batch_id: Id | null
  mode: CheckMode
  /**
   * 任务类型：勘误 / 评估。
   * 【为什么必须有】两种任务的结果页不是一个界面（勘误看逐句结论、评估看质量维度），
   * 之前前端只能猜，于是评估任务跑完也被送到勘误结果页。后端建任务时务必回填这个字段。
   */
  kind?: 'errata' | 'assessment'
  dimensions: string[]
  status: TaskStatus
  /** 加权总进度 0~100（权重在后端配置里，前端只显示） */
  progress: number
  owner_id: Id
  owner_name: string
  /** 全链路追踪号，页面可复制，用来和后端日志对上 */
  trace_id: string
  /** 任务级提示信息，如"3 条 Claim 核查失败" */
  message?: string | null
  current_stage?: StageCode | null
  created_at: IsoDateTime
  updated_at: IsoDateTime
  started_at?: IsoDateTime | null
  finished_at?: IsoDateTime | null
  stages?: TaskStage[]
  /** 进度页右上角显示的实时计数 */
  counters?: {
    claims_total: number
    findings_high: number
    findings_medium: number
    findings_low: number
    uncovered: number
  }
}

/** 审计事件类型 */
export type AuditEventType =
  | 'stage_start'
  | 'stage_end'
  | 'llm_call'
  | 'tool_call'
  | 'review_action'
  | 'rule_publish'

/** 一条审计/运行日志。回答"这条结论凭什么、花了多少代价"（03 §8.1） */
export interface AuditEvent {
  id: Id
  task_id: Id | null
  stage_code: StageCode | null
  event_type: AuditEventType
  /** 谁触发的：system / 用户 id */
  actor: string
  /** 用了哪个模型 */
  model: string | null
  prompt_version: string | null
  /** 用了哪个工具（如复算工具 calc_eval） */
  tool_name: string | null
  /** 输入摘要（不存全文，只存摘要与哈希，见 06 §1.3） */
  input_digest: string | null
  output_digest: string | null
  duration_ms: number | null
  /** token 消耗，成本核算用 */
  tokens: number | null
  trace_id: string
  status: 'ok' | 'error' | 'degraded'
  error_message?: string | null
  created_at: IsoDateTime
}

/* ============================================================================
 * 8. 知识库与经验学习
 * ==========================================================================*/

/** 知识库文档类型（05 §3 knowledge_type） */
export type KnowledgeType =
  | 'norm'             // 内部写作规范
  | 'valuation'        // 估值规则
  | 'forbidden_expr'   // 禁用表达
  | 'metric_def'       // 指标定义
  | 'case'             // 历史案例
  | 'external_report'  // 外部研报（观点交叉验证用）

export interface KnowledgeDoc {
  id: Id
  type: KnowledgeType
  title: string
  /** 文档版本，改版后旧版本留档 */
  version: number
  /** 是否启用。启停只影响后续新任务，不影响历史结论 */
  enabled: boolean
  /** 生效起始日 */
  effective_from: string | null
  /** 适用维度代号列表，空表示全部适用 */
  scope: string[]
  file_uri: string | null
  /** 切了多少片（检索单位），显示给用户看"这份资料有没有成功入库" */
  chunk_count: number
  parse_status: 'pending' | 'parsing' | 'done' | 'failed'
  parse_error?: string | null
  uploaded_by: string
  created_at: IsoDateTime
}

/** 知识库分片，检索命中时展示原文 */
export interface KnowledgeChunk {
  id: Id
  doc_id: Id
  doc_title: string
  chunk_index: number
  text: string
  /** 所在章节/页码等定位信息 */
  meta: Record<string, string> | null
}

/** 经验案例：由人工裁决沉淀而来（系统"越用越准"的原料） */
export interface ExperienceCase {
  id: Id
  claim_id: Id
  /** 关联的 AI 结论 */
  ai_finding_id: Id | null
  /** 关联的人工动作 */
  review_action_id: Id | null
  /** 案例类型：AI 判错了 / AI 判对了 / 人工补充 */
  case_type: 'ai_wrong' | 'ai_right' | 'human_added'
  /** 标签，如 ["计算错误", "口径说明缺失"] */
  labels: string[]
  summary: string
  /** 涉及维度 */
  dimensions: string[]
  created_at: IsoDateTime
}

/** 学习候选：由案例归纳出的"规则/提示词/案例"修改建议，等人工审核发布 */
export interface LearningCandidate {
  id: Id
  type: 'rule' | 'prompt' | 'case'
  /** 候选内容（规则的话是规则正文，提示词的话是提示词片段） */
  content: string
  /** 来自哪几条人工裁决 —— 必显示，便于判断这条候选靠不靠谱 */
  source_case_ids: Id[]
  source_summaries: string[]
  /** 影响哪些维度 */
  impact_dimensions: string[]
  state: 'pending' | 'approved' | 'rejected'
  reviewer_id: Id | null
  reviewer_name?: string | null
  review_note: string | null
  created_at: IsoDateTime
  reviewed_at?: IsoDateTime | null
}

/** 已发布的规则/提示词版本（可回滚） */
export interface RuleVersion {
  id: Id
  kind: 'risk_rule' | 'prompt' | 'threshold'
  /** 唯一键，例如 calc_check */
  key: string
  version: number
  content: string
  state: 'active' | 'archived' | 'canary'
  published_by: string
  published_at: IsoDateTime
  /** 发布说明，写清"为什么改" */
  note?: string | null
}

/* ============================================================================
 * 9. 复核列表（两层：报告级 / 主张级）
 * ==========================================================================*/

/** 工作台用的汇总数字 */
export interface ReviewsSummary {
  /** 待复核的报告数 */
  reports_pending: number
  /** 待复核的主张总条数（未覆盖也计入，不能被进度掩盖） */
  claims_pending: number
  /** 高风险待处理条数 */
  high_risk_pending: number
  /** 近 7 天新增高风险条数 */
  high_risk_last_7d: number
  /** 近 7 天高风险条目，工作台"高风险提醒"区块用 */
  recent_high_risk: Array<{
    report_id: Id
    report_title: string
    company: string
    risk_count: number
    latest_at: IsoDateTime
  }>
  /** 进行中的任务数 */
  tasks_running: number
}

/** 复核列表第一层：一行一份报告 */
export interface ReportReviewRow {
  report_id: Id
  report_title: string
  company: string
  ticker: string
  report_date: string
  /** 核查状态（任务维度） */
  check_status: TaskStatus | 'not_started'
  /** 复核状态（人工维度） */
  review_status: 'pending' | 'in_progress' | 'done'
  high_risk: number
  medium_risk: number
  low_risk: number
  pass_count: number
  uncovered: number
  /** 已复核条数 */
  reviewed_count: number
  /** 待复核总条数（含未覆盖） */
  review_total: number
  latest_task_id: Id | null
  latest_batch_id: Id | null
  updated_at: IsoDateTime
}

/** 复核列表第二层：一行一条主张（主张级队列） */
export interface ClaimQueueRow {
  claim_id: Id
  report_id: Id
  block_index: number
  /** 原文摘要 */
  excerpt: string
  claim_type: ClaimType
  /** 当前最高风险等级 */
  risk_level: RiskLevel | null
  status: FindingStatus
  dimension_name: string
  /** AI 建议，列表里截断显示 */
  suggestion: string | null
  review_state: ReviewState
  has_evidence: boolean
  revision: number
}

/* ============================================================================
 * 10. SSE 进度事件（05 §6）
 * ==========================================================================*/

/** stage：某个阶段的状态或进度变了 */
export interface StageEvent {
  event: 'stage'
  data: {
    stage_code: StageCode
    status: StageStatus
    progress: number
    /** 给用户看的一句话，如 "320/412" */
    message?: string
    stat?: Record<string, number> | null
  }
}

/** counters：计数变了（工作台与总览页的数字跟着动） */
export interface CountersEvent {
  event: 'counters'
  data: {
    claims_total: number
    findings_high: number
    findings_medium: number
    findings_low: number
    uncovered: number
  }
}

/** task：任务整体状态变了（到终态时前端要刷新数据并提示"查看结果"） */
export interface TaskStatusEvent {
  event: 'task'
  data: {
    status: TaskStatus
    message?: string
    progress: number
  }
}

/** error：某阶段失败（retryable=true 时前台给"重试该阶段"按钮） */
export interface ErrorEvent {
  event: 'error'
  data: {
    stage_code: StageCode
    message: string
    retryable: boolean
  }
}

/** heartbeat：心跳，用来判断连接是否还活着 */
export interface HeartbeatEvent {
  event: 'heartbeat'
  data: { ts: IsoDateTime }
}

/** 追问抽屉的流式回答分片（POST /claims/{id}/ask） */
export interface AskChunkEvent {
  event: 'chunk'
  data: { text: string }
}
export interface AskDoneEvent {
  event: 'done'
  data: { message_id: Id; citations: Array<{ claim_id: Id | null; label: string }> }
}

export type TaskSseEvent = StageEvent | CountersEvent | TaskStatusEvent | ErrorEvent | HeartbeatEvent
export type AskSseEvent = AskChunkEvent | AskDoneEvent

/* ============================================================================
 * 项目（Project）—— 管理核查任务的基本单元
 *
 * 【为什么需要这一层】
 *   一个团队同时在跟很多标的：每份研报都要"勘误 + 评估"，有问题还要"人工复核"。
 *   如果没有项目，这些任务就散在一堆列表里，用户看不出"这条属于哪件事、跟谁有关"。
 *   项目把"一次收集的若干份研报"圈在一起，于是三件事都变成"在项目里做的事"：
 *     项目 → 研报 → （勘误结果 / 评估结果 / 复核进度）
 * ==========================================================================*/

/** 项目状态：进行中 / 已归档（归档只影响新建任务时的默认列表，历史数据都留着） */
export type ProjectStatus = 'active' | 'archived'

export interface Project {
  id: Id
  /** 项目名，例："2026 年电子陶瓷行业覆盖" */
  name: string
  /** 一句话说明用途，可空 */
  description?: string
  /** 负责人（展示用，权限仍由后端校验） */
  owner_id: Id
  owner_name: string
  status: ProjectStatus
  /** 项目下研报份数 */
  report_count: number
  /** 已完成勘误的份数 */
  errata_done: number
  /** 已完成评估的份数 */
  assessment_done: number
  /** 项目下所有报告的待复核条数合计（工作台与项目列表都显示它） */
  pending_review_count: number
  /** 项目下所有报告的高风险条数合计 */
  high_risk_count: number
  /** 项目下仍在运行的任务数 */
  running_task_count: number
  created_at: string
  updated_at: string
}

/** 项目里的一份研报 + 它在三件事上的状态（项目详情页一行） */
export interface ProjectReportRow {
  report_id: Id
  title: string
  company: string
  ticker: string
  report_date: string
  /** 勘误（逐句核查）状态 */
  errata_status: TaskStatus
  /** 勘误查出：高 / 中 / 低 / 未覆盖 */
  errata_high: number
  errata_medium: number
  errata_low: number
  errata_uncovered: number
  /** 复核进度：已复核 / 待复核总数（勘误的结论才需要复核） */
  claims_reviewed: number
  claims_total: number
  /** 评估状态与参考分（未评估时为 null） */
  assessment_status: 'not_started' | 'running' | 'completed'
  assessment_score: string | null
  /** 最近一次任务的 id（用于跳进度页） */
  latest_task_id: Id | null
  updated_at: string
}

/** 项目详情 = 项目本身 + 它下面的研报清单 */
export interface ProjectDetail extends Project {
  reports: ProjectReportRow[]
}

/** 项目列表筛选 */
export interface ProjectListParams {
  status?: ProjectStatus
  q?: string
  page?: number
  page_size?: number
}

export interface CreateProjectBody {
  name: string
  description?: string
}

/** 研报评估结果（"研报评估"这一条主线的列表行） */
export interface AssessmentRow {
  report_id: Id
  project_id: Id
  project_name: string
  title: string
  company: string
  ticker: string
  report_date: string
  status: 'not_started' | 'running' | 'completed'
  /** 参考分（用于排序的加权分，不是"研报质量"的定性结论） */
  reference_score: string | null
  /** 四个质量维度：查出问题数 / 覆盖率 */
  quality_problems: number
  quality_coverage: number
  /** 覆盖率不足 100% 的维度名（用来解释"这份报告的评估有多少是没做成的"） */
  uncovered_dimensions: string[]
  created_at: string | null
  updated_at: string
}

export interface AssessmentListParams {
  project_id?: Id
  status?: AssessmentRow['status']
  q?: string
  page?: number
  page_size?: number
}


/* ============================================================================
 * 任务提交契约（桌面端把"用户在表单里选的东西"整理成这个结构发给后端）
 *
 * 【为什么要单独定义，而不是复用 Task】
 *   Task 是"任务的执行状态"（进度、阶段、计数）；这里是"任务请求"（用户要什么）。
 *   两者生命周期不同：请求发出去就不再变，执行状态会一直变。
 * ==========================================================================*/

export interface TaskSubmitType {
  /** 类型代号，对应 features/task-request/*Catalog.ts 里的 code */
  code: string
  /** 类型中文名（冗余存一份，方便后端日志与人工核对） */
  name: string
  /** 该类型的分项备注（用户对"这一项特别要看什么"的交代） */
  note: string | null
}

export interface TaskSubmitPayload {
  project_id: Id
  /** 项目名（冗余，便于后端直接展示） */
  project_name: string
  /** 研报的本地绝对路径（桌面端才有；后端接入后据此上传/解析） */
  report_path: string
  /** 关联的知识库文件夹（可空） */
  knowledge_dir: string | null
  /** 已就绪的报告 id（可能为空：报告还没建好时也可以先发任务） */
  report_id: Id | null
  /** 勘误 / 评估 */
  kind: 'errata' | 'assessment'
  /** 勾选的类型清单（含分项备注） */
  types: TaskSubmitType[]
  /** 勘误范围（页码）；评估为 null */
  page_range: { from: number; to: number } | null
  /** 研报总页数（读不到为 null） */
  total_pages: number | null
  /** 评估深度；勘误为 null */
  depth: 'quick' | 'standard' | 'deep' | null
  /** 本次任务的总体备注 */
  note: string | null
  /** 前端估算的耗时（分钟），仅用于给用户预期，不作为服务端时限 */
  estimated_minutes: number
  submitted_at: string
}
