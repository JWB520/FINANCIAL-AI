/**
 * api/mock/mockDataMore.ts —— 假数据（续）：报告列表、任务与阶段、审计、知识库、经验学习、帮助
 *
 * 与 mockData.ts 是一套数据：这里的报告 rpt-001 就是 mockData.ts 里那份中瓷电子研报。
 * 拆成两个文件只是因为单个文件太长不好读；两者都由 mockHandlers.ts 使用。
 *
 * 【本文件导出的内容】
 *   MOCK_REPORTS / MOCK_REPORTS_TOTAL   研报列表（三份，覆盖"已核查 / 核查中 / 待核查"）
 *   MOCK_TASKS / MOCK_TASK_STAGES       任务与阶段（含一个正在跑的，用于演示 SSE 进度）
 *   MOCK_AUDIT_EVENTS                   审计日志（模型调用、工具调用、人工裁决都有）
 *   MOCK_KNOWLEDGE_DOCS / CHUNKS        知识库文档与分片
 *   MOCK_EXPERIENCE_CASES / CANDIDATES / RULE_VERSIONS   经验学习三部曲
 *   MOCK_HELP_ARTICLES                  帮助文档
 */
import type {
  AuditEvent,
  ExperienceCase,
  KnowledgeChunk,
  KnowledgeDoc,
  KnowledgeType,
  LearningCandidate,
  Report,
  ReportVersion,
  RuleVersion,
  StageCode,
  StageStatus,
  Task,
  TaskStage,
} from '../types'
import { hoursAgo, daysAgo, MOCK_BATCH_ID, MOCK_VERSION_ID } from './mockData'

/* ============================================================================
 * 一、研报列表（三份，覆盖不同状态，方便演示列表页的筛选与状态标签）
 * ==========================================================================*/

/** 报告版本（中瓷电子那份就是 mockData 里原文对应的版本） */
export const MOCK_REPORT_VERSION: ReportVersion = {
  id: MOCK_VERSION_ID,
  report_id: 'rpt-001',
  version_no: 1,
  file_uri: 's3://rqc/reports/003031-2026h1.pdf',
  file_hash: 'a3f1c9d2e77b41f0b8c5d6e4f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4',
  char_count: 1180,
  parse_status: 'done',
  created_at: daysAgo(2),
}

export const MOCK_REPORTS: Report[] = [
  {
    id: 'rpt-001',
    title: '中瓷电子（003031.SZ）2026 年半年报点评：产能释放驱动业绩增长',
    company: '中瓷电子',
    ticker: '003031.SZ',
    report_date: '2026-08-28',
    owner_id: 'usr-001',
    owner_name: '王小明',
    status: 'checked',
    latest_version_no: 1,
    findings_high: 3,
    findings_medium: 2,
    findings_low: 1,
    uncovered: 3,
    pending_review: 12,
    // 已复核 4 / 待复核总数 16 → 进度 25%
    reviewed_count: 4,
    review_total: 16,
    created_at: daysAgo(2),
    updated_at: hoursAgo(4),
  },
  {
    id: 'rpt-002',
    title: '源杰科技（688498.SH）2026 年半年报点评：高速光芯片需求回暖',
    company: '源杰科技',
    ticker: '688498.SH',
    report_date: '2026-08-30',
    owner_id: 'usr-001',
    owner_name: '王小明',
    status: 'checking',
    latest_version_no: 1,
    findings_high: 2,
    findings_medium: 1,
    findings_low: 0,
    uncovered: 1,
    pending_review: 0,
    reviewed_count: 0,
    review_total: 0,
    created_at: daysAgo(1),
    updated_at: hoursAgo(1),
  },
  {
    id: 'rpt-003',
    title: '圣邦股份（300661.SZ）2026 年二季报点评：模拟芯片周期底部确认',
    company: '圣邦股份',
    ticker: '300661.SZ',
    report_date: '2026-08-31',
    owner_id: 'usr-002',
    owner_name: '李岚',
    status: 'draft',
    latest_version_no: 1,
    created_at: hoursAgo(20),
    updated_at: hoursAgo(20),
  },
]

/* ============================================================================
 * 二、任务与阶段
 *
 * task-001 已完成（对应演示报告，看得到结果）
 * task-002 正在跑（进度页演示 SSE，会从当前进度继续往前走）
 * task-003 排队中（新建核查后就是这个状态）
 * ==========================================================================*/

function makeStage(
  taskId: string,
  stageCode: StageCode,
  status: StageStatus,
  progress: number,
  extra?: Partial<TaskStage>
): TaskStage {
  return {
    id: 'stg-' + taskId + '-' + stageCode,
    task_id: taskId,
    stage_code: stageCode,
    status,
    attempt: 1,
    progress,
    stat: extra?.stat ?? null,
    skip_reason: extra?.skip_reason ?? null,
    error: extra?.error ?? null,
    started_at: extra?.started_at ?? null,
    finished_at: extra?.finished_at ?? null,
    duration_ms: extra?.duration_ms ?? null,
  }
}

/** 已完成任务的五个阶段（进度 100%） */
export const MOCK_TASK_STAGES_DONE: TaskStage[] = [
  makeStage('task-001', 'parse', 'done', 100, { stat: { blocks: 20, chars: 1180 }, duration_ms: 12000 }),
  makeStage('task-001', 'claim_split', 'done', 100, { stat: { claims_total: 16 }, duration_ms: 38000 }),
  makeStage('task-001', 'claim_classify', 'done', 100, { stat: { done: 16 } , duration_ms: 26000 }),
  makeStage('task-001', 'check', 'done', 100, { stat: { done: 16, findings: 16 }, duration_ms: 94000 }),
  makeStage('task-001', 'aggregate', 'done', 100, { stat: { dimensions: 9 }, duration_ms: 8000 }),
]

/** 正在跑的任务：前两阶段完成，第三阶段进行到 78%，后面还等着 */
export const MOCK_TASK_STAGES_RUNNING: TaskStage[] = [
  makeStage('task-002', 'parse', 'done', 100, { stat: { blocks: 18, chars: 1042 }, duration_ms: 11000 }),
  makeStage('task-002', 'claim_split', 'done', 100, { stat: { claims_total: 21 }, duration_ms: 41000 }),
  makeStage('task-002', 'claim_classify', 'running', 78, { stat: { done: 16, claims_total: 21 } }),
  makeStage('task-002', 'check', 'pending', 0, { stat: { dimensions: 5 } }),
  makeStage('task-002', 'aggregate', 'pending', 0),
]

export const MOCK_TASKS: Task[] = [
  {
    id: 'task-001',
    report_id: 'rpt-001',
    report_title: MOCK_REPORTS[0].title,
    company: '中瓷电子',
    ticker: '003031.SZ',
    check_batch_id: MOCK_BATCH_ID,
    mode: 'deep',
    dimensions: ['calc', 'norm', 'fact', 'consistency', 'valuation', 'quality_logic', 'quality_data', 'quality_risk'],
    status: 'completed',
    // 加权总进度：parse 5 + split 20 + classify 25 + check 45 + aggregate 5 = 100
    progress: 100,
    owner_id: 'usr-001',
    owner_name: '王小明',
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    message: '核查完成，发现 3 条高风险',
    current_stage: null,
    created_at: daysAgo(2),
    updated_at: hoursAgo(4),
    started_at: daysAgo(2),
    finished_at: hoursAgo(30),
    stages: MOCK_TASK_STAGES_DONE,
    counters: {
      claims_total: 16,
      findings_high: 3,
      findings_medium: 2,
      findings_low: 1,
      uncovered: 3,
    },
  },
  {
    id: 'task-002',
    report_id: 'rpt-002',
    report_title: MOCK_REPORTS[1].title,
    company: '源杰科技',
    ticker: '688498.SH',
    check_batch_id: 'bat-688498-01',
    mode: 'deep',
    dimensions: ['calc', 'norm', 'fact', 'consistency', 'valuation'],
    status: 'running',
    // 前两阶段满分 + 第三阶段 78% × 25% ≈ 65
    progress: 65,
    owner_id: 'usr-001',
    owner_name: '王小明',
    trace_id: '9c7d2e41-5b83-4a06-8f19-2e3d4c5b6a71',
    message: '语句分类进行中',
    current_stage: 'claim_classify',
    created_at: daysAgo(1),
    updated_at: hoursAgo(1),
    started_at: hoursAgo(2),
    stages: MOCK_TASK_STAGES_RUNNING,
    counters: {
      claims_total: 21,
      findings_high: 2,
      findings_medium: 1,
      findings_low: 0,
      uncovered: 1,
    },
  },
  {
    id: 'task-003',
    report_id: 'rpt-003',
    report_title: MOCK_REPORTS[2].title,
    company: '圣邦股份',
    ticker: '300661.SZ',
    check_batch_id: null,
    mode: 'quick',
    dimensions: ['calc', 'norm'],
    status: 'pending',
    progress: 0,
    owner_id: 'usr-002',
    owner_name: '李岚',
    trace_id: '1a2b3c4d-5e6f-7081-9203-a4b5c6d7e8f9',
    message: '排队中，前面还有 0 个任务',
    current_stage: null,
    created_at: hoursAgo(20),
    updated_at: hoursAgo(20),
    stages: [
      makeStage('task-003', 'parse', 'pending', 0),
      makeStage('task-003', 'claim_split', 'pending', 0),
      makeStage('task-003', 'claim_classify', 'pending', 0),
      makeStage('task-003', 'check', 'pending', 0),
      makeStage('task-003', 'aggregate', 'pending', 0),
    ],
  },
]
/* ============================================================================
 * 三、审计日志
 *
 * 时间线按"阶段开始 → 模型调用/工具调用 → 阶段结束"排，最后是个人工裁决与一次规则发布。
 * 注意：只存输入输出**摘要**，不存全文（06_工程规范.md §1.3 的硬要求）。
 * ==========================================================================*/

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: 'aud-001',
    task_id: 'task-001',
    stage_code: 'parse',
    event_type: 'stage_start',
    actor: 'system',
    model: null,
    prompt_version: null,
    tool_name: null,
    input_digest: null,
    output_digest: null,
    duration_ms: null,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-002',
    task_id: 'task-001',
    stage_code: 'parse',
    event_type: 'tool_call',
    actor: 'system',
    model: null,
    prompt_version: null,
    tool_name: 'pdf_parser',
    input_digest: 'sha256:8ac1…df20（文件 2.1MB）',
    output_digest: '20 个 block，1180 字符，偏移已写入',
    duration_ms: 11800,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-003',
    task_id: 'task-001',
    stage_code: 'claim_split',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-fast-v1',
    prompt_version: 'claim_split.v4',
    tool_name: null,
    input_digest: '输入：20 个 block 的文本块（截断展示前 120 字）',
    output_digest: '输出：16 条主张，平均置信度 0.90',
    duration_ms: 38000,
    tokens: 12480,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-004',
    task_id: 'task-001',
    stage_code: 'claim_classify',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-fast-v1',
    prompt_version: 'claim_classify.v3',
    tool_name: null,
    input_digest: '输入：16 条主张文本',
    output_digest: '输出：calc 5 / fact 3 / norm 2 / forecast 2 / valuation 1 / judgement 3',
    duration_ms: 26000,
    tokens: 8120,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-005',
    task_id: 'task-001',
    stage_code: 'check',
    event_type: 'tool_call',
    actor: 'system',
    model: null,
    prompt_version: null,
    tool_name: 'calc_eval',
    input_digest: '表达式 (12.3 - 10.1) / 10.1',
    output_digest: '结果 0.2178，与原文 25% 偏差 -3.22pct，超容差',
    duration_ms: 120,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-006',
    task_id: 'task-001',
    stage_code: 'check',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-think-v1',
    prompt_version: 'calc_check.v3',
    tool_name: null,
    input_digest: '输入：主张 clm-01 + 复算结果 + 规则 R-CALC-01',
    output_digest: '输出：高风险，命中 R-CALC-01，含证据 2 条',
    duration_ms: 4200,
    tokens: 3210,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-007',
    task_id: 'task-001',
    stage_code: 'check',
    event_type: 'tool_call',
    actor: 'system',
    model: null,
    prompt_version: null,
    tool_name: 'market_data_query',
    input_digest: '接口 /finance/customer_concentration?code=003031.SZ',
    output_digest: '超时 3 次，未返回数据',
    duration_ms: 30000,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    // 降级而不是失败：其它结论照常产出，这条标记为"核查失败"
    status: 'degraded',
    error_message: '数据源不可用（超时 3 次），该条结论标记为核查失败，可重试',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-008',
    task_id: 'task-001',
    stage_code: 'aggregate',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-think-v1',
    prompt_version: 'aggregate.v2',
    tool_name: null,
    input_digest: '输入：16 条结论的维度、状态、风险等级',
    output_digest: '输出：报告级摘要 + 5 条复核优先级建议',
    duration_ms: 8000,
    tokens: 2640,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-009',
    task_id: 'task-001',
    stage_code: 'aggregate',
    event_type: 'stage_end',
    actor: 'system',
    model: null,
    prompt_version: null,
    tool_name: null,
    input_digest: null,
    output_digest: '任务完成，共 16 条结论',
    duration_ms: 178000,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: daysAgo(2),
  },
  {
    id: 'aud-010',
    task_id: 'task-001',
    stage_code: null,
    event_type: 'review_action',
    actor: '李岚',
    model: null,
    prompt_version: null,
    tool_name: null,
    input_digest: 'claim clm-11 驳回（附理由：有行业协会市占率数据支撑）',
    output_digest: '生成经验案例 case-03（AI 判错）',
    duration_ms: null,
    tokens: null,
    trace_id: '4f2a91c7-e0b3-4d15-9a62-7c1d8e5f3a20',
    status: 'ok',
    created_at: hoursAgo(6),
  },
  {
    id: 'aud-011',
    task_id: null,
    stage_code: null,
    event_type: 'rule_publish',
    actor: '管理员',
    model: null,
    prompt_version: null,
    tool_name: null,
    input_digest: '规则 quality_logic 升版：无数据支撑表述判定放宽（来自 3 条人工驳回）',
    output_digest: 'risk_rule/quality_logic v5 → active，v4 归档',
    duration_ms: null,
    tokens: null,
    trace_id: 'c31e5f88-7a02-4b9d-8e11-6f7a8b9c0d12',
    status: 'ok',
    created_at: hoursAgo(14),
  },
  {
    id: 'aud-012',
    task_id: 'task-002',
    stage_code: 'claim_classify',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-fast-v1',
    prompt_version: 'claim_classify.v3',
    tool_name: null,
    input_digest: '输入：第 4 批（共 21 条主张，批大小 5）',
    output_digest: '输出：本批 5 条分类完成',
    duration_ms: 3100,
    tokens: 1480,
    trace_id: '9c7d2e41-5b83-4a06-8f19-2e3d4c5b6a71',
    status: 'ok',
    created_at: hoursAgo(1),
  },
  {
    id: 'aud-013',
    task_id: 'task-002',
    stage_code: 'claim_split',
    event_type: 'llm_call',
    actor: 'system',
    model: 'deep-fast-v1',
    prompt_version: 'claim_split.v4',
    tool_name: null,
    input_digest: '输入：18 个 block',
    output_digest: '输出：21 条主张',
    duration_ms: 41000,
    tokens: 15320,
    trace_id: '9c7d2e41-5b83-4a06-8f19-2e3d4c5b6a71',
    status: 'ok',
    created_at: hoursAgo(2),
  },
]

/* ============================================================================
 * 四、知识库（文档 + 分片）
 *
 * 注意"外部研报库"没有出现在列表里 —— 这正是演示时"未覆盖"的来源：
 * 没上传它，观点交叉验证就跑不了，于是相关条目标记为"未覆盖"而不是"通过"。
 * ==========================================================================*/

function makeDoc(
  id: string,
  type: KnowledgeType,
  title: string,
  enabled: boolean,
  chunks: number,
  scope: string[],
  createdHoursAgo: number
): KnowledgeDoc {
  return {
    id,
    type,
    title,
    version: 1,
    enabled,
    effective_from: '2026-01-01',
    scope,
    file_uri: 's3://rqc/knowledge/' + id + '.pdf',
    chunk_count: chunks,
    parse_status: 'done',
    uploaded_by: '王小明',
    created_at: hoursAgo(createdHoursAgo),
  }
}

export const MOCK_KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  makeDoc('kdoc-001', 'norm', '研究所研报写作规范（2026 版）', true, 128, ['norm', 'quality_risk'], 240),
  makeDoc('kdoc-002', 'forbidden_expr', '禁用表达清单与合规提示', true, 36, ['norm'], 240),
  makeDoc('kdoc-003', 'valuation', '估值方法与假设核查规则', true, 54, ['valuation'], 200),
  makeDoc('kdoc-004', 'metric_def', '财务指标定义与常用口径手册', true, 96, ['fact', 'calc', 'quality_data'], 200),
  makeDoc('kdoc-005', 'case', '历史典型问题案例集（2025）', false, 212, [], 120),
  makeDoc('kdoc-006', 'external_report', '同业研报库（2026 上半年）', false, 0, ['quality_cross'], 20),
]

export const MOCK_KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  {
    id: 'kc-forbidden-012',
    doc_id: 'kdoc-002',
    doc_title: '禁用表达清单与合规提示',
    chunk_index: 12,
    text: '不得使用"必将""一定""翻倍"等对未来业绩作确定性承诺的表述，应改为"有望""预计"；对无法验证的行业数据需注明来源与日期。',
    meta: { section: '二、确定性表述', page: '4' },
  },
  {
    id: 'kc-valuation-004',
    doc_id: 'kdoc-003',
    doc_title: '估值方法与假设核查规则',
    chunk_index: 4,
    text: '目标估值高于可比公司中位数 30% 以上时，必须给出溢价理由并列出可比公司清单，否则视为估值依据不足。',
    meta: { section: '三、可比公司法', page: '7' },
  },
  {
    id: 'kc-norm-021',
    doc_id: 'kdoc-001',
    doc_title: '研究所研报写作规范（2026 版）',
    chunk_index: 21,
    text: '风险提示应覆盖需求、供给、成本三类主要风险，并说明对公司业绩的影响方向；仅罗列风险名称视为披露不完整。',
    meta: { section: '五、风险披露', page: '15' },
  },
  {
    id: 'kc-metric-008',
    doc_id: 'kdoc-004',
    doc_title: '财务指标定义与常用口径手册',
    chunk_index: 8,
    text: '毛利率同比变动以"百分点（pct）"表示，不使用"%"；同比增速的计算基数应为上一年度同期可比数据。',
    meta: { section: '一、常用指标', page: '2' },
  },
]
/* ============================================================================
 * 五、经验学习：案例 → 候选 → 已发布版本
 *
 * 这条链是系统的"越用越准"闭环，也是答辩时的加分点：
 *   人工裁决产生案例 → 系统归纳出候选（规则/提示词改法）→ **人点发布才生效** → 可回滚。
 * ==========================================================================*/

export const MOCK_EXPERIENCE_CASES: ExperienceCase[] = [
  {
    id: 'case-01',
    claim_id: 'clm-05',
    ai_finding_id: 'fnd-05',
    review_action_id: 'act-02',
    case_type: 'ai_right',
    labels: ['禁用表达', '规范核查'],
    summary: 'AI 判定"必将翻倍增长"违规，人工接受修改建议 —— 该类判定有效，可作为正例保留。',
    dimensions: ['norm'],
    created_at: hoursAgo(18),
  },
  {
    id: 'case-02',
    claim_id: 'clm-07',
    ai_finding_id: 'fnd-07',
    review_action_id: 'act-01',
    case_type: 'human_added',
    labels: ['估值溢价', '可比公司'],
    summary: 'AI 报低风险提示补充可比公司，人工核实后确认溢价理由已在文中给出，补充说明该条不需要修改。',
    dimensions: ['valuation'],
    created_at: hoursAgo(20),
  },
  {
    id: 'case-03',
    claim_id: 'clm-11',
    ai_finding_id: 'fnd-11',
    review_action_id: 'act-03',
    case_type: 'ai_wrong',
    labels: ['误报', '定性表述'],
    summary:
      'AI 判定"龙头企业""技术壁垒深厚"缺少数据支撑为逻辑问题，人工驳回：该表述有行业协会 2026 年 3 月发布的市占率数据支撑，判定过严。',
    dimensions: ['quality_logic'],
    created_at: hoursAgo(6),
  },
  {
    id: 'case-04',
    claim_id: 'clm-03',
    ai_finding_id: 'fnd-03',
    review_action_id: 'act-04',
    case_type: 'ai_right',
    labels: ['事实核查', '数据一致'],
    summary: 'AI 判定 2025 年上半年营收与财报一致，人工核实确认 —— 正例。',
    dimensions: ['fact'],
    created_at: hoursAgo(4),
  },
]

export const MOCK_LEARNING_CANDIDATES: LearningCandidate[] = [
  {
    id: 'cand-01',
    type: 'rule',
    content:
      '风险规则 R-QLOG-02 收窄：仅当结论性表述同时缺少"市占率、专利、客户认证"三类数据支撑时才报中风险；若报告引用行业协会公开数据，不再报问题。',
    source_case_ids: ['case-03'],
    source_summaries: ['3 条人工驳回均因定性表述有外部数据支撑被判误报'],
    impact_dimensions: ['quality_logic'],
    state: 'pending',
    reviewer_id: null,
    review_note: null,
    created_at: hoursAgo(5),
  },
  {
    id: 'cand-02',
    type: 'prompt',
    content:
      '估值核查提示词补充：判定"估值依据不足"前，先在全文搜索是否存在可比公司对照表或溢价理由说明，避免重复报同一条。',
    source_case_ids: ['case-02'],
    source_summaries: ['2 条人工核实表明溢价理由已在文中给出'],
    impact_dimensions: ['valuation'],
    state: 'pending',
    reviewer_id: null,
    review_note: null,
    created_at: hoursAgo(19),
  },
  {
    id: 'cand-03',
    type: 'case',
    content: '把"产能数据前后矛盾"整理成典型案例，加入案例库供后续同类报告参考（含 2000 万只 / 1500 万只的对比片段）。',
    source_case_ids: ['case-01', 'case-04'],
    source_summaries: ['一致性核查命中率较高，值得作为示范案例'],
    impact_dimensions: ['consistency'],
    state: 'approved',
    reviewer_id: 'usr-001',
    reviewer_name: '王小明',
    review_note: '案例描述准确，同意入库',
    created_at: daysAgo(3),
    reviewed_at: hoursAgo(30),
  },
]

export const MOCK_RULE_VERSIONS: RuleVersion[] = [
  {
    id: 'rv-calc-03',
    kind: 'risk_rule',
    key: 'calc_check',
    version: 3,
    content: '计算核查：复算结果与原文相对误差 > 1% 时判高风险；0.5%~1% 判中风险；需要复算但缺少基数时判"未覆盖"。',
    state: 'active',
    published_by: '管理员',
    published_at: daysAgo(12),
    note: '把"缺基数"从低风险改为未覆盖，避免把没查当成没问题',
  },
  {
    // 同一条规则的历史版本：删掉「生效中」的版本时，系统会自动切回它 —— 演示数据里必须有，否则这条兜底逻辑没法验证
    id: 'rv-calc-02',
    kind: 'risk_rule',
    key: 'calc_check',
    version: 2,
    content: '计算核查：复算结果与原文相对误差 > 1% 时判高风险；需要复算但缺基数时判低风险（旧版，已被 v3 取代）。',
    state: 'archived',
    published_by: '管理员',
    published_at: daysAgo(40),
    note: null,
  },
  {
    id: 'rv-qlog-05',
    kind: 'risk_rule',
    key: 'quality_logic',
    version: 5,
    content:
      '逻辑质量：结论性表述缺少数据支撑判中风险；若引用行业协会、第三方机构公开数据，需人工判断是否足够，不再自动报问题。',
    state: 'active',
    published_by: '管理员',
    published_at: hoursAgo(14),
    note: '依据 3 条人工驳回放宽判定，降低误报',
  },
  {
    id: 'rv-qlog-04',
    kind: 'risk_rule',
    key: 'quality_logic',
    version: 4,
    content: '逻辑质量：结论性表述缺少数据支撑一律判中风险（旧版，已被 v5 取代）。',
    state: 'archived',
    published_by: '管理员',
    published_at: daysAgo(25),
    note: null,
  },
  {
    id: 'rv-norm-07',
    kind: 'risk_rule',
    key: 'norm_check',
    version: 7,
    content: '规范核查：命中禁用表达清单的表述判中风险；涉及业绩承诺的表述判高风险。',
    state: 'active',
    published_by: '管理员',
    published_at: daysAgo(8),
    note: '补充"业绩承诺"这一类',
  },
]

/* ============================================================================
 * 六、帮助文档
 *
 * 每个核查卡片上的"?"按钮会跳到对应 slug，所以 slug 要稳定、不要随意改。
 * ==========================================================================*/

export const MOCK_HELP_ARTICLES = [
  {
    id: 'help-01b',
    group: '开始使用',
    title: '项目与本地文件：软件怎么管你的资料',
    slug: 'desktop-project',
    content:
      '软件用「项目」来组织一切：一个项目 = 一份研报 +（可选）一个知识库文件夹。' +
      '\n新建项目时：先弹出系统的「选择文件」窗口挑研报，弹窗里会显示它的完整路径；' +
      '\n然后问你要不要关联知识库 —— 选「是」会再弹一次系统的「选择文件夹」窗口，也可以直接跳过。' +
      '\n项目会以文件夹形式保存在「文档 / RQC 项目库」下：' +
      '\n· project.json：记录研报路径、知识库路径、创建时间（可以直接用记事本打开看）；' +
      '\n· data 文件夹：留给核查结果与将来导出的文件。' +
      '\n几条规矩：项目名里的非法字符会被自动清理；同名项目会自动加后缀（不会覆盖已有项目）；' +
      '\n导入已有项目时按创建时间倒序排列，并且可以按项目名或路径搜索。' +
      '\n想搬到别的电脑？把整个「RQC 项目库」文件夹拷过去即可（研报与知识库自己保留在原来的位置）。',
    updated_at: daysAgo(1),
  },
  {
    id: 'help-00',
    group: '开始使用',
    title: '先分清三件事：研报勘误 / 研报评估 / 人工复核',
    slug: 'three-mainlines',
    content:
      '系统里只有三个主角，别把它们混在一起：' +
      '\n· 研报勘误（逐句）：把报告拆成一句句可核查的主张，逐句判断"算错了没、前后矛盾没、有没有数据支撑"。每条结论都带原文位置、证据与核算过程。' +
      '\n· 研报评估（整篇）：看整份报告写得怎么样 —— 论证链、数据支撑、风险披露、观点与同业是否偏离。它不给"这句话有没有错"，只给四个质量维度的覆盖率与问题数。' +
      '\n· 人工复核（裁决）：AI 给出结论之后，人决定采纳还是推翻 —— 接受 / 驳回（必须写理由）/ 标记已核实 / 人工修改。人的裁决会沉淀成经验，用来改进判据。' +
      '\n这三件事都发生在"项目"里：一份研报先归属某个项目，然后才谈得上勘误、评估与复核。',
    updated_at: daysAgo(1),
  },
  {
    id: 'help-01',
    group: '开始使用',
    title: '五分钟跑通一次核查',
    slug: 'quick-start',
    content:
      '选项目 → 上传研报 → 选择核查模式与维度 → 等待进度完成 → 在勘误结果看风险分布 → 进复核裁决页逐条处理。\n复核时用键盘更快：j / k 上下切换，1 接受、2 驳回（需填理由）、3 标记已核实。',
    updated_at: daysAgo(5),
  },
  {
    id: 'help-02',
    group: '核心概念',
    title: '四种结论状态：通过 / 有问题 / 未覆盖 / 核查失败',
    slug: 'finding-status',
    content:
      '通过：查了，没发现问题。\n有问题：查了，发现问题，风险等级分高、中、低。\n未覆盖：没查成（缺资料或当前不具备核查条件）——**未覆盖不等于通过**，它会单独统计，不会被算进通过率。\n核查失败：核查过程出错（如数据源超时），该条没有结论，可以重试。',
    updated_at: daysAgo(5),
  },
  {
    id: 'help-03',
    group: '核心概念',
    title: '风险等级怎么定',
    slug: 'risk-level',
    content:
      '风险等级不由模型自由判断，而是按显式规则表算出并版本化（见"规则版本"页）。\n高风险：必须人工处理，例如计算与原文数据不一致、报告内部自相矛盾。\n中风险：建议人工确认，例如命中禁用表达、结论缺少数据支撑。\n低风险：可批量确认，例如估值依据不充分但已在文中说明。',
    updated_at: daysAgo(5),
  },
  {
    id: 'help-04',
    group: '核心概念',
    title: '三态结论：AI 结论 / 人工结论 / 生效结论',
    slug: 'three-state',
    content:
      '每条主张都同时保存三种结论：AI 说的、人说的、最终生效的。\n人工裁决只追加、不覆盖，所以随时能复盘"AI 在哪里判错了"，这些裁决也是系统学习改进的原料。\n没有人工动作时，生效结论是"待复核"，而不是"通过"。',
    updated_at: daysAgo(5),
  },
  {
    id: 'help-05',
    group: '复核流程',
    title: '四个复核按钮分别是什么含义',
    slug: 'review-actions',
    content:
      '接受修改：采纳 AI 的建议文本作为生效结论。\n驳回 AI：认为 AI 判错了，**必须填写理由**（理由会进入经验学习，不能跳过）。\n标记已核实：人工确认原文本身没问题，该条移出待复核队列。\n补充证据 / 人工修改：追加证据或直接改写，系统保留修改前后的对比。',
    updated_at: daysAgo(5),
  },
  {
    id: 'help-06',
    group: '资料与知识库',
    title: '为什么有的条目显示"未覆盖"',
    slug: 'uncovered',
    content:
      '未覆盖表示这次没查到，常见原因有三种：\n1）缺少资料（例如没上传外部研报库，观点交叉验证跑不了）；\n2）外部数据源不可用（超时、无权限）；\n3）文档解析失败导致该段无法定位。\n处理方式：补齐资料后重新核查，或对单条结果重试。系统会把原因写在条目上，不会只说"未覆盖"三个字。',
    updated_at: daysAgo(4),
  },
  {
    id: 'help-07',
    group: '常见问题',
    title: '进度条不动了怎么办',
    slug: 'progress-stuck',
    content:
      '进度页通过实时连接推送状态。若网络中断，系统会自动重连；连续三次失败会切换为每 5 秒轮询，并在页面上提示。\n如果长时间停在某个阶段：展开该阶段看日志摘要，确认是在等模型还是等数据源；必要时点"重试该阶段"（已完成阶段的产物会保留，不会重头再来）。',
    updated_at: daysAgo(2),
  },
  {
    id: 'help-08',
    group: '开始使用',
    title: '点「发送」之后会发生什么',
    slug: 'send-task',
    content:
      '点发送会做三件事：\n' +
      '1）把这次任务的参数（勾选的项目与分项备注、页码范围或评估深度、任务备注、预估时长）原样写进项目文件夹的 data\\tasks\\ 里，文件名带时间与类型；\n' +
      '2）把任务提交给核查流水线；\n' +
      '3）跳到进度页，可以实时看各阶段推进。\n' +
      '为什么要本地存一份：它是不依赖后端的留痕，不看服务端日志也能查到"这次是谁、用什么参数发起的"。\n' +
      '页码范围怎么定：打开项目时会自动读研报总页数；读不到（扫描件、加密 PDF、超大文件）就按你填的数字算，不确定就填大一点，宁多不少。\n' +
      '预估时长是按勾选项累加的整篇估算：勘误按页码范围等比缩放，评估按深度乘系数（快速 ×0.4、标准 ×1、深度 ×2.5），下限 1 分钟。',
    updated_at: daysAgo(1),
  },
  {
    id: 'help-09',
    group: '核心概念',
    title: '页面上的数字分别是什么意思',
    slug: 'metrics-meaning',
    content:
      '覆盖率 = 有结论的条数 ÷ 主张总数（"未覆盖"与"核查失败"都不算有结论）。\n' +
      '风险分布：高 / 中 / 低 / 通过 / 未覆盖 / 核查失败 六类计数，加总等于主张总数。\n' +
      '复核进度 = 已裁决条数 ÷ 待复核总数。\n' +
      '参考分（研报评估）：整篇质量的一个参考值；没做过评估时显示"—"，不是 0 分。\n' +
      '雷达图上的数值是各质量维度的覆盖率，只用于直观对比，它不是评分，具体问题看明细。\n' +
      '这些数字都由确定性计算得出（不是模型"感觉"出来的），可以自己复算。\n' +
      '演示数据里这些数字互相自洽（自检脚本会断言），页面上若对不上，那是缺陷，请报障。',
    updated_at: daysAgo(1),
  },
  {
    id: 'help-10',
    group: '核心概念',
    title: '系统里几条不能改的规矩',
    slug: 'system-redlines',
    content:
      '这几条是设计约束，不是配置项，所以在设置页里找不到开关：\n' +
      '· 驳回 AI 必须写理由 —— 理由会进经验学习，跳过等于让系统学不到东西；\n' +
      '· 未覆盖 ≠ 通过 —— 没查到就单独统计，永远不会被算成"没问题"；\n' +
      '· 审计记录只追加 —— 谁能删、什么时候删的，永远查得到；\n' +
      '· 没有人工动作时，生效结论是"待复核"而不是"通过"；\n' +
      '· 追问的回答只是对话记录，不会写进核查结论（结论只由核查流程与人工裁决产生）。\n' +
      '报障时请附结论卡片或审计表里的追踪编号（形如 某条 id-trace）：工程师用它在服务端日志里检索这一次调用的完整过程。',
    updated_at: daysAgo(1),
  },
  {
    id: 'help-11',
    group: '复核流程',
    title: '学习候选：从哪来、审核时看什么',
    slug: 'learning-candidates',
    content:
      '候选由系统从人工裁决里归纳而来（尤其是"驳回并写清理由"），但**不会自动生效**，必须人工审核。\n' +
      '审核前看三件事：\n' +
      '1）依据够不够 —— 看它来自哪些裁决；\n' +
      '2）影响面清楚吗 —— 看会影响哪些维度；\n' +
      '3）能不能回滚 —— 能。任何状态的版本都可以删，删掉生效中的版本时系统会自动把同一规则下最近的历史版本切回生效。\n' +
      '通过 = 发布新版本；驳回 = 必须填理由（它记着"当初为什么驳回"）。',
    updated_at: daysAgo(2),
  },
  {
    id: 'help-12',
    group: '复核流程',
    title: '复核顺序建议与操作要点',
    slug: 'review-order',
    content:
      '复核裁决页右侧的结论列表按原文顺序排；点卡片可以看证据、核算过程与命中的规则编号，展开后直接裁决。\n' +
      '建议顺序：先处理高风险的「计算不一致」与「前后矛盾」—— 它们最可能是真的错误；中低风险可以成批标记已核实。\n' +
      '键盘更快：j / k 切换上一条、下一条；1 接受、2 驳回（需填理由）、3 标记已核实、a 对当前条追问、o 定位原文、? 打开本帮助。\n' +
      '一条都没查成的条目怎么处理，见《为什么有的条目显示"未覆盖"》。',
    updated_at: daysAgo(1),
  },
]
