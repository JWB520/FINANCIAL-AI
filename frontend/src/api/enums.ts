/**
 * api/enums.ts —— 后端枚举代号 -> 中文说法 / 颜色 / 图标的唯一映射处
 *
 * 对应文档：05_数据模型与接口契约.md §3 枚举字典
 *
 * 【为什么要有这个文件】
 *   后端返回的是英文代号（pass / risk / uncovered / high ...）。
 *   如果每个页面自己写 if (status === 'risk') return '有风险'，那么：
 *     - 同一个状态在三个页面上会有三种说法（用户会以为它们是不同的东西）；
 *     - 改文案要改十个文件，一定漏。
 *   所以规矩是：**页面里不许出现裸的英文代号判断，一律查这张表。**
 *
 * 【本文件导出什么】
 *   风险：RISK_LEVEL_LABEL / RISK_LEVEL_TAG_COLOR / RISK_LEVEL_HEX / RISK_ORDER / riskRank()
 *   结论状态：FINDING_STATUS_LABEL / FINDING_STATUS_TAG_COLOR / FINDING_STATUS_HINT
 *   主张类型：CLAIM_TYPE_LABEL / CLAIM_TYPE_TAG_COLOR
 *   维度：DIMENSION_NAME / DIMENSION_GROUP_LABEL
 *   任务与阶段：TASK_STATUS_LABEL / TASK_STATUS_TAG_COLOR / STAGE_CODE_LABEL / STAGE_STATUS_LABEL ...
 *   复核：REVIEW_STATE_LABEL / REVIEW_ACTION_LABEL / REVIEW_ACTION_HINT
 *   证据：EVIDENCE_TYPE_LABEL / EVIDENCE_TYPE_HINT
 *   知识/学习/审计/用户：KNOWLEDGE_TYPE_LABEL、CANDIDATE_*、AUDIT_EVENT_TYPE_LABEL、USER_ROLE_LABEL
 *   资料依赖：REQUIRED_INPUT_LABEL / REQUIRED_INPUT_HINT
 */
import type {
  AuditEventType,
  CheckMode,
  ClaimType,
  DimensionGroup,
  EvidenceType,
  FindingStatus,
  KnowledgeType,
  ReportStatus,
  RequiredInputCode,
  ReviewActionType,
  ReviewState,
  RiskLevel,
  StageCode,
  StageStatus,
  TaskStatus,
  UserRole,
} from './types'

/* ============================================================================
 * 风险等级（全系统唯一配色来源，见 04_前端架构.md §9.1）
 *
 * 硬要求：
 *   1. "未覆盖"必须与"通过"在视觉上明显不同（灰底斜纹 vs 绿色描边），
 *      因为"没查"和"查了没问题"是完全相反的两件事；
 *   2. 颜色之外必须有文字，色盲用户与灰度打印也要能分辨。
 * ==========================================================================*/

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
}

/** antd Tag 的预设色名（想换成自定义色只改这一处） */
export const RISK_LEVEL_TAG_COLOR: Record<RiskLevel, string> = {
  high: 'red',
  medium: 'orange',
  low: 'gold',
}

/** 真实色值：给风险色带、下划线、图表这类不能用 antd 预设色的地方用 */
export const RISK_LEVEL_HEX: Record<RiskLevel, string> = {
  high: '#cf1322',
  medium: '#d46b08',
  low: '#d4a017',
}

/** 排序权重：数字越大越严重，用于"高风险排前面" */
export const RISK_ORDER: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 }

/** 取风险的排序权重；没有风险等级（通过/未覆盖）按 0 处理 */
export function riskRank(level: RiskLevel | null | undefined): number {
  return level ? RISK_ORDER[level] : 0
}

/** 总体风险（报告级）：在三种风险外多一个"未见明显问题" */
export const OVERALL_RISK_LABEL: Record<RiskLevel | 'pass', string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  pass: '未见明显问题',
}

/* ============================================================================
 * 结论的四种状态（D12：四种缺一不可）
 * ==========================================================================*/

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  pass: '通过',
  risk: '有问题',
  // 注意：不是"没问题"，而是"这次没查成"——文案上永远要跟一句原因
  uncovered: '未覆盖',
  error: '核查失败',
}

export const FINDING_STATUS_TAG_COLOR: Record<FindingStatus, string> = {
  pass: 'green',
  risk: 'red',
  uncovered: 'default',
  error: 'volcano',
}

/** 一种状态在界面上的补充解释（鼠标悬停或帮助页展示） */
export const FINDING_STATUS_HINT: Record<FindingStatus, string> = {
  pass: '已核查，未发现问题',
  risk: '核查发现与原文或事实不符，需要人工确认',
  uncovered: '本次没有查到（缺资料或解析失败）。未覆盖不等于通过',
  error: '核查过程出错，该条没有结论，可重试',
}

/* ============================================================================
 * 主张类型（拆解阶段的分类结果）
 * ==========================================================================*/

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  calc: '计算类',
  fact: '事实类',
  valuation: '估值类',
  forecast: '预测类',
  norm: '规范类',
  judgement: '观点类',
}

export const CLAIM_TYPE_TAG_COLOR: Record<ClaimType, string> = {
  calc: 'blue',
  fact: 'cyan',
  valuation: 'purple',
  forecast: 'geekblue',
  norm: 'magenta',
  judgement: 'default',
}

/* ============================================================================
 * 维度（后端注册表返回 code，中文名后端也会带回来，这里只做兜底与分组标题）
 * ==========================================================================*/

export const DIMENSION_NAME_FALLBACK: Record<string, string> = {
  calc: '计算核查',
  fact: '事实核查',
  norm: '规范核查',
  valuation: '估值核查',
  consistency: '一致性核查',
  quality_logic: '逻辑质量',
  quality_data: '数据支撑',
  quality_risk: '风险披露',
  quality_cross: '观点交叉验证',
}

export const DIMENSION_GROUP_LABEL: Record<DimensionGroup, string> = {
  check: '核查维度（找问题）',
  quality: '质量评估维度（评整体质量）',
}

/* ============================================================================
 * 任务与阶段
 * ==========================================================================*/

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '排队中',
  running: '核查中',
  completed: '核查完成',
  partial_failed: '部分失败',
  failed: '核查失败',
  cancelled: '已终止',
}

export const TASK_STATUS_TAG_COLOR: Record<TaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  completed: 'success',
  partial_failed: 'warning',
  failed: 'error',
  cancelled: 'default',
}

/** 任务是否已经跑完（跑完就能看结果；部分失败也算，因为产物已保留） */
export const TERMINAL_TASK_STATUS: TaskStatus[] = ['completed', 'partial_failed', 'failed', 'cancelled']

export const STAGE_CODE_LABEL: Record<StageCode, string> = {
  parse: '文档解析',
  claim_split: '语句拆解',
  claim_classify: '语句分类',
  check: '维度核查',
  aggregate: '报告级汇总',
}

/** 阶段的展示顺序（进度页按这个顺序列出，与后端流水线一致） */
export const STAGE_CODE_ORDER: StageCode[] = ['parse', 'claim_split', 'claim_classify', 'check', 'aggregate']

/** 每个阶段在干什么——用户看进度条时最想知道的其实是这个 */
export const STAGE_CODE_HINT: Record<StageCode, string> = {
  parse: '把 PDF/Word 拆成文字块，并记下每一块的字符位置（后面高亮定位靠它）',
  claim_split: '把段落切成一条条可核查的主张（一句话一条）',
  claim_classify: '判断每条主张属于计算/事实/规范/估值/预测/观点中的哪一类',
  check: '把主张派给各个维度核查，产出带证据的结论',
  aggregate: '汇总成报告级评估：风险分布、覆盖率、复核优先级',
}

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  pending: '等待中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

export const STAGE_STATUS_TAG_COLOR: Record<StageStatus, string> = {
  pending: 'default',
  running: 'processing',
  done: 'success',
  failed: 'error',
  skipped: 'warning',
}

/* ============================================================================
 * 复核（人工动作与状态）
 * ==========================================================================*/

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  pending: '待复核',
  accepted: '已接受 AI 建议',
  rejected: '已驳回 AI',
  verified: '已核实',
  edited: '已人工修改',
}

export const REVIEW_STATE_TAG_COLOR: Record<ReviewState, string> = {
  pending: 'default',
  accepted: 'green',
  rejected: 'red',
  verified: 'blue',
  edited: 'purple',
}

export const REVIEW_ACTION_LABEL: Record<ReviewActionType, string> = {
  accept: '接受修改',
  reject: '驳回 AI',
  verify: '标记已核实',
  add_evidence: '补充证据',
  manual_edit: '人工修改',
}

/** 每个动作的语义说明——复核人第一次用时必须看得懂这四个按钮的区别 */
export const REVIEW_ACTION_HINT: Record<ReviewActionType, string> = {
  accept: '采纳 AI 的建议文本，作为生效结论',
  reject: '认为 AI 判错了，必须填写理由（这是系统学习的原料，不允许跳过）',
  verify: '人工确认原文本身没问题，该条从待复核队列中移出',
  add_evidence: '人工追加一条证据，让结论更有据可查',
  manual_edit: '直接改写原文或结论，系统会保留修改前后的对比',
}

/* ============================================================================
 * 证据类型
 * ==========================================================================*/

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  kb_chunk: '知识库',
  data_source: '外部数据源',
  in_text: '文内互证',
  calc: '计算过程',
  external_report: '外部研报',
}

export const EVIDENCE_TYPE_HINT: Record<EvidenceType, string> = {
  kb_chunk: '来自内部规范库/规则库的条目',
  data_source: '来自行情或财务数据接口，注意看取数时间',
  in_text: '同一篇报告内部前后的说法（用于发现自相矛盾）',
  calc: '系统复算的过程与结果',
  external_report: '其他机构的研报观点，用于交叉验证',
}

/* ============================================================================
 * 知识库 / 经验学习 / 审计 / 用户
 * ==========================================================================*/

export const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeType, string> = {
  norm: '内部写作规范',
  valuation: '估值规则',
  forbidden_expr: '禁用表达',
  metric_def: '指标定义',
  case: '历史案例',
  external_report: '外部研报库',
}

/** 知识库类型 -> 它能支撑哪些维度（界面上说明"上传它有什么用"） */
export const KNOWLEDGE_TYPE_HINT: Record<KnowledgeType, string> = {
  norm: '规范核查用它判断表达是否合规',
  valuation: '估值核查用它判断估值方法与假设是否站得住',
  forbidden_expr: '禁用表达命中即报风险，规则最硬、最不容易误判',
  metric_def: '指标定义用于核对口径与单位',
  case: '历史案例作为参考，帮助判断类似问题',
  external_report: '观点交叉验证用它比对同业观点，需要它就必须要上传',
}

export const CANDIDATE_TYPE_LABEL: Record<'rule' | 'prompt' | 'case', string> = {
  rule: '风险规则',
  prompt: '提示词',
  case: '案例',
}

export const CANDIDATE_STATE_LABEL: Record<'pending' | 'approved' | 'rejected', string> = {
  pending: '待审核',
  approved: '已发布',
  rejected: '已驳回',
}

export const CASE_TYPE_LABEL: Record<'ai_wrong' | 'ai_right' | 'human_added', string> = {
  ai_wrong: 'AI 判错（被驳回）',
  ai_right: 'AI 判对（被接受）',
  human_added: '人工补充',
}

export const AUDIT_EVENT_TYPE_LABEL: Record<AuditEventType, string> = {
  stage_start: '阶段开始',
  stage_end: '阶段结束',
  llm_call: '模型调用',
  tool_call: '工具调用',
  review_action: '人工裁决',
  rule_publish: '规则发布',
}

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  researcher: '研究员',
  reviewer: '复核人',
  admin: '管理员',
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  draft: '草稿',
  checking: '核查中',
  checked: '已核查',
  archived: '已归档',
}

/* ============================================================================
 * 模式与资料依赖（"新建核查"页的关键文案）
 * ==========================================================================*/

export const MODE_LABEL: Record<CheckMode, string> = {
  quick: '快速核查',
  deep: '深度评估',
}

export const MODE_HINT: Record<CheckMode, string> = {
  quick: '只跑计算、规范两类最硬的维度，通常在 1 分钟内出结果',
  deep: '加上事实、估值、一致性与质量评估，需要更长时间和更多资料',
}

/** 资料代号 -> 中文名 */
export const REQUIRED_INPUT_LABEL: Record<RequiredInputCode, string> = {
  internal_norm: '内部规范库',
  external_reports: '外部研报库',
  market_data: '财务/行情数据源',
  valuation_rules: '估值规则库',
  case_library: '历史案例库',
}

/**
 * 缺资料时给用户的解释。
 * 关键在于说清后果：**没这份资料，对应维度会标成"未覆盖"，而不是"通过"**。
 */
export const REQUIRED_INPUT_HINT: Record<RequiredInputCode, string> = {
  internal_norm: '未配置时，规范核查无法运行，相关条目将标记为"未覆盖"',
  external_reports: '未配置时，观点交叉验证将标记为"未覆盖"',
  market_data: '未配置时，事实核查只能做文内互证，外部数据核对将标记为"未覆盖"',
  valuation_rules: '未配置时，估值核查无法运行，相关条目将标记为"未覆盖"',
  case_library: '未配置时，历史案例参考不可用（不影响其他维度）',
}

/** 把后端给的英文代号翻成中文；查不到就原样返回，避免界面出现空白 */
export function requiredInputLabel(code: string): string {
  return REQUIRED_INPUT_LABEL[code as RequiredInputCode] || code
}

export function requiredInputHint(code: string): string {
  return REQUIRED_INPUT_HINT[code as RequiredInputCode] || '缺少该资料时，相关维度会被标记为"未覆盖"'
}