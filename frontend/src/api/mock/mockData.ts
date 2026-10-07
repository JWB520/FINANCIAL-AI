/**
 * api/mock/mockData.ts —— 假数据（后端未就绪时，前端靠它独立开发与演示）
 *
 * 【这个文件是什么】
 *   一份"看起来像真的"演示数据集：中瓷电子（003031.SZ）的一份半年报点评。
 *   包含原文块、16 条可核查主张、结论、证据、复算过程、报告级评估、任务与阶段、
 *   审计日志、知识库、经验学习与帮助文档。所有数字之间是**自洽**的
 *   （风险分布 3 高 + 2 中 + 1 低 + 6 通过 + 3 未覆盖 + 1 失败 = 16 条主张），
 *   因为演示时最怕被问"你这个数对不上"。
 *
 * 【★ 重要：结构与真实后端返回完全一致】
 *   字段名、枚举取值、JSON 结构严格对齐 05_数据模型与接口契约.md，
 *   把 VITE_USE_MOCK 改成 false 就切到真实后端，业务代码一个字都不用改。
 *
 * 【偏移量怎么保证不出错】
 *   手写字符偏移一定会错（那是复核裁决页最致命的 bug），所以这里只写"原文片段"，
 *   由 locate() 在块文本里自动算出 start/end；找不到就返回空区间（渲染层会过滤），
 *   绝不会出现"高亮错位"这种阻断级缺陷。
 */
import { RISK_LEVEL_LABEL } from '../enums'
import type {
  Assessment,
  Block,
  BlockType,
  Claim,
  ClaimConclusion,
  ClaimSpan,
  ClaimType,
  Dimension,
  Evidence,
  Finding,
  ReviewAction,
  RiskLevel,
  User,
} from '../types'

/* ============================================================================
 * 一、构造原文块与主张的小工具
 * ==========================================================================*/

/** 相对当前时间往前推几小时，让列表里的"多久以前"看起来自然 */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

/** 相对当前时间往前推几天 */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
}

/**
 * 在一段原文里定位某个片段，返回它在块内的局部偏移。
 * 找不到时返回空区间（end == start），渲染层会忽略它 —— 宁可少一个高亮，也不能错位。
 */
function locate(blockText: string, snippet: string): { start: number; end: number } {
  const index = blockText.indexOf(snippet)
  if (index < 0) {
    console.warn('[mock] 原文片段定位失败，已跳过该高亮:', snippet)
    return { start: 0, end: 0 }
  }
  return { start: index, end: index + snippet.length }
}

/** 一块原文的原始定义（id 与偏移由 buildBlocks 自动生成） */
interface BlockSeed {
  type: BlockType
  section: string
  text: string
}

/**
 * 演示研报的原文（20 块）。
 * 注意：这些文本与后面 claims 里的 snippet 必须能对上，改文本要同时改 snippet。
 */
const BLOCK_SEEDS: BlockSeed[] = [
  { type: 'heading', section: '一、公司概览', text: '一、公司概览' },
  {
    type: 'paragraph',
    section: '一、公司概览',
    text: '公司是国内陶瓷封装基座（CPGA）与电子陶瓷领域的领先企业。2026 年上半年，公司实现营业收入 12.3 亿元，同比增长 25%；归母净利润 2.1 亿元，同比增长 18%。',
  },
  { type: 'heading', section: '二、经营情况回顾', text: '二、经营情况回顾' },
  {
    type: 'paragraph',
    section: '二、经营情况回顾',
    text: '2025 年上半年公司实现营业收入 10.1 亿元，归母净利润 1.87 亿元，毛利率 31.4%。',
  },
  {
    type: 'bullet',
    section: '二、经营情况回顾',
    text: '公司上半年新增陶瓷基座产能 2000 万只，产能利用率维持在 85% 以上。',
  },
  {
    type: 'paragraph',
    section: '二、经营情况回顾',
    text: '下半年随着新产能爬坡，公司业绩必将翻倍增长，订单能见度持续提升。',
  },
  { type: 'heading', section: '三、盈利预测与估值', text: '三、盈利预测与估值' },
  {
    type: 'paragraph',
    section: '三、盈利预测与估值',
    text: '我们预计公司 2026-2028 年营业收入分别为 26.5 亿元、34.2 亿元、43.8 亿元，对应同比增速 32%、29%、28%。',
  },
  {
    type: 'paragraph',
    section: '三、盈利预测与估值',
    text: '公司 2026 年上半年毛利率 32.6%，同比提升 1.2 个百分点，主要受益于产品结构优化。',
  },
  {
    type: 'paragraph',
    section: '三、盈利预测与估值',
    text: '我们给予公司 2027 年 45 倍 PE，对应目标价 58.6 元，首次覆盖给予买入评级。',
  },
  {
    type: 'paragraph',
    section: '三、盈利预测与估值',
    text: '公司陶瓷基座扩产项目预计于 2027 年一季度达产，达产后年产能将提升至 1.2 亿只。',
  },
  { type: 'heading', section: '四、产能与客户情况', text: '四、产能与客户情况' },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司 2026 年上半年新增产能 1500 万只，扩产进度略低于此前指引。',
  },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司是电子陶瓷封装领域具备全球竞争力的龙头企业，技术壁垒深厚，客户结构优质。',
  },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司在陶瓷基座细分领域的市场份额持续领先，竞争力突出。',
  },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司 2026 年上半年研发费用率 8.5%，较 2025 年全年的 7.9% 提升 0.6 个百分点。',
  },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司客户集中度较高，前五大客户收入占比约 62%。',
  },
  {
    type: 'paragraph',
    section: '四、产能与客户情况',
    text: '公司 2026 年上半年经营活动现金流净额 1.42 亿元。',
  },
  { type: 'heading', section: '五、风险提示', text: '五、风险提示' },
  {
    type: 'paragraph',
    section: '五、风险提示',
    text: '风险提示：行业需求不及预期、新产能爬坡不及预期、原材料价格上涨、客户集中度较高的风险。',
  },
]
/** 报告版本 id，所有块与主张都挂在这个版本下 */
export const MOCK_VERSION_ID = 'rv-003031-2026h1-v1'

/** 把 BLOCK_SEEDS 变成真正的 Block 列表（自动累加全文绝对偏移） */
function buildBlocks(): Block[] {
  let offset = 0
  return BLOCK_SEEDS.map((seed, index) => {
    const start = offset
    // 块之间用换行连接，模拟后端从 PDF 解析出的纯文本
    offset += seed.text.length + 1
    return {
      id: 'blk-' + String(index + 1).padStart(2, '0'),
      report_version_id: MOCK_VERSION_ID,
      block_index: index,
      block_type: seed.type,
      start_offset: start,
      end_offset: start + seed.text.length,
      text: seed.text,
      section_path: seed.section,
    }
  })
}

export const MOCK_BLOCKS: Block[] = buildBlocks()

/* ============================================================================
 * 二、主张（16 条，覆盖"通过 / 高 / 中 / 低 / 未覆盖 / 失败"全部状态）
 * ==========================================================================*/

interface ClaimSeed {
  id: string
  /** 属于第几块（block_index） */
  blockIndex: number
  /** 在块原文里精确出现的一段话，偏移由 locate 自动算 */
  snippet: string
  type: ClaimType
  /** 拆解置信度；低于 0.6 的界面上会标"待人工确认" */
  confidence: number
  /** 人工改过的话版本号 +1；这里给一条设成 2，用于演示并发控制 */
  revision?: number
}

const CLAIM_SEEDS: ClaimSeed[] = [
  { id: 'clm-01', blockIndex: 1, snippet: '实现营业收入 12.3 亿元，同比增长 25%', type: 'calc', confidence: 0.96 },
  { id: 'clm-02', blockIndex: 1, snippet: '归母净利润 2.1 亿元，同比增长 18%', type: 'calc', confidence: 0.95 },
  { id: 'clm-03', blockIndex: 3, snippet: '2025 年上半年公司实现营业收入 10.1 亿元', type: 'fact', confidence: 0.93 },
  { id: 'clm-04', blockIndex: 4, snippet: '新增陶瓷基座产能 2000 万只', type: 'fact', confidence: 0.91 },
  { id: 'clm-05', blockIndex: 5, snippet: '公司业绩必将翻倍增长', type: 'norm', confidence: 0.97 },
  {
    id: 'clm-06',
    blockIndex: 7,
    snippet: '2026-2028 年营业收入分别为 26.5 亿元、34.2 亿元、43.8 亿元',
    type: 'forecast',
    confidence: 0.9,
  },
  { id: 'clm-07', blockIndex: 9, snippet: '给予公司 2027 年 45 倍 PE', type: 'valuation', confidence: 0.88 },
  { id: 'clm-08', blockIndex: 8, snippet: '毛利率 32.6%，同比提升 1.2 个百分点', type: 'calc', confidence: 0.94 },
  { id: 'clm-09', blockIndex: 12, snippet: '新增产能 1500 万只', type: 'fact', confidence: 0.92 },
  { id: 'clm-10', blockIndex: 19, snippet: '行业需求不及预期、新产能爬坡不及预期', type: 'norm', confidence: 0.89 },
  { id: 'clm-11', blockIndex: 13, snippet: '具备全球竞争力的龙头企业，技术壁垒深厚', type: 'judgement', confidence: 0.84 },
  { id: 'clm-12', blockIndex: 14, snippet: '在陶瓷基座细分领域的市场份额持续领先', type: 'judgement', confidence: 0.82 },
  {
    id: 'clm-13',
    blockIndex: 15,
    snippet: '研发费用率 8.5%，较 2025 年全年的 7.9% 提升 0.6 个百分点',
    type: 'calc',
    confidence: 0.9,
  },
  { id: 'clm-14', blockIndex: 16, snippet: '前五大客户收入占比约 62%', type: 'fact', confidence: 0.87 },
  { id: 'clm-15', blockIndex: 17, snippet: '经营活动现金流净额 1.42 亿元', type: 'fact', confidence: 0.86, revision: 2 },
  { id: 'clm-16', blockIndex: 10, snippet: '扩产项目预计于 2027 年一季度达产', type: 'forecast', confidence: 0.8 },
]

export const MOCK_CLAIMS: Claim[] = CLAIM_SEEDS.map((seed) => {
  const block = MOCK_BLOCKS[seed.blockIndex]
  const { start, end } = locate(block.text, seed.snippet)
  return {
    id: seed.id,
    report_version_id: MOCK_VERSION_ID,
    block_id: block.id,
    block_index: seed.blockIndex,
    start_offset: start,
    end_offset: end,
    text: seed.snippet,
    claim_type: seed.type,
    confidence: seed.confidence,
    revision: seed.revision ?? 1,
    section_path: block.section_path,
  }
})

/** 演示报告的批次 id（"重新核查"会产生新批次，旧批次完整保留） */
export const MOCK_BATCH_ID = 'bat-003031-01'
/* ============================================================================
 * 三、结论（16 条，与 16 条主张一一对应）
 * ==========================================================================*/

interface FindingSeed {
  id: string
  claimId: string
  dimension: string
  dimensionName: string
  status: Finding['status']
  risk: RiskLevel | null
  rules: Array<{ code: string; desc: string }>
  reason: string
  suggestion: string | null
  evidences: Evidence[]
  uncoveredReason?: string
  confidence: number
  calc?: Finding['calc_trace']
}

/**
 * 结论种子。注意 reason 的写法：**不写"这句话错了"这种绝对化判断**，
 * 而要写清"与什么不一致、差多少、来源是什么"（04_前端架构.md §9.2 文案规范）。
 */
const FINDING_SEEDS: FindingSeed[] = [
  {
    id: 'fnd-01',
    claimId: 'clm-01',
    dimension: 'calc',
    dimensionName: '计算核查',
    status: 'risk',
    risk: 'high',
    rules: [{ code: 'R-CALC-01', desc: '复算结果与原文数字不一致（相对误差 > 1%）' }],
    reason:
      '根据本文第 4 段给出的 2025 年上半年营业收入 10.1 亿元复算，2026 年上半年同比增速为 21.78%，与文中的 25% 相差 3.22 个百分点，超出 ±1% 的容差。',
    suggestion: '建议将同比增速修改为 21.78%；若 25% 另有口径（如剔除汇率影响），请补充说明计算口径。',
    confidence: 0.93,
    calc: {
      expression: '(12.3 - 10.1) / 10.1',
      unit: '亿元',
      steps: [
        { label: '2026 年上半年营业收入', value: '12.3', source: '本文第 2 段' },
        { label: '2025 年上半年营业收入', value: '10.1', source: '本文第 4 段' },
        { label: '同比增速', value: '0.2178', note: '保留四位小数' },
      ],
      computed: '21.78%',
      claimed: '25%',
      deviation: '-3.22pct',
      tolerance: '1%',
      conclusion: 'mismatch',
    },
    evidences: [
      {
        id: 'evd-01',
        type: 'in_text',
        source_ref: 'blk-04',
        snippet: '2025 年上半年公司实现营业收入 10.1 亿元',
        start_offset: 0,
        end_offset: 22,
        uri: null,
        captured_at: null,
      },
      {
        id: 'evd-02',
        type: 'data_source',
        source_ref: '财务数据接口 /finance/income/003031.SZ?period=2026H1',
        snippet: '2026 年上半年营业收入 1,230,000,000 元（合并报表口径）',
        start_offset: null,
        end_offset: null,
        uri: 'internal://financial/003031.SZ/2026H1',
        captured_at: daysAgo(1),
      },
    ],
  },
  {
    id: 'fnd-02',
    claimId: 'clm-02',
    dimension: 'calc',
    dimensionName: '计算核查',
    status: 'risk',
    risk: 'high',
    rules: [{ code: 'R-CALC-01', desc: '复算结果与原文数字不一致（相对误差 > 1%）' }],
    reason:
      '按本文第 4 段给出的 2025 年上半年归母净利润 1.87 亿元复算，同比增速为 12.30%，与文中的 18% 相差 5.70 个百分点。',
    suggestion: '建议将归母净利润同比增速修改为 12.30%，或核实净利润基数是否包含少数股东权益调整。',
    confidence: 0.91,
    calc: {
      expression: '(2.1 - 1.87) / 1.87',
      unit: '亿元',
      steps: [
        { label: '2026 年上半年归母净利润', value: '2.1', source: '本文第 2 段' },
        { label: '2025 年上半年归母净利润', value: '1.87', source: '本文第 4 段' },
        { label: '同比增速', value: '0.1230', note: '保留四位小数' },
      ],
      computed: '12.30%',
      claimed: '18%',
      deviation: '-5.70pct',
      tolerance: '1%',
      conclusion: 'mismatch',
    },
    evidences: [
      {
        id: 'evd-03',
        type: 'in_text',
        source_ref: 'blk-04',
        snippet: '归母净利润 1.87 亿元',
        start_offset: 0,
        end_offset: 12,
        uri: null,
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-03',
    claimId: 'clm-03',
    dimension: 'fact',
    dimensionName: '事实核查',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '该数据与本文其他位置及财务数据源一致，未发现矛盾。',
    suggestion: null,
    confidence: 0.9,
    evidences: [
      {
        id: 'evd-04',
        type: 'data_source',
        source_ref: '财务数据接口 /finance/income/003031.SZ?period=2025H1',
        snippet: '2025 年上半年营业收入 1,010,000,000 元',
        start_offset: null,
        end_offset: null,
        uri: 'internal://financial/003031.SZ/2025H1',
        captured_at: daysAgo(1),
      },
    ],
  },
  {
    id: 'fnd-04',
    claimId: 'clm-04',
    dimension: 'fact',
    dimensionName: '事实核查',
    status: 'uncovered',
    risk: null,
    rules: [],
    reason: '产能数据需要行业产能数据库核对，本次未取得该数据源，无法判断真伪。',
    suggestion: null,
    confidence: 0.4,
    uncoveredReason: '未配置行业产能数据库（数据源不可用），该条未做外部核对',
    evidences: [],
  },
  {
    id: 'fnd-05',
    claimId: 'clm-05',
    dimension: 'norm',
    dimensionName: '规范核查',
    status: 'risk',
    risk: 'medium',
    rules: [{ code: 'R-NORM-07', desc: '命中禁用表达：对未来业绩作确定性承诺（必将 / 翻倍）' }],
    reason:
      '命中内部写作规范的禁用表达清单：必将、翻倍增长属于对未来业绩的确定性表述，缺少前提条件与不确定性说明。',
    suggestion: '建议改为：若新产能如期爬坡，公司下半年业绩有望实现较快增长。',
    confidence: 0.95,
    evidences: [
      {
        id: 'evd-05',
        type: 'kb_chunk',
        source_ref: 'kc-forbidden-012',
        snippet:
          '禁用表达清单第 12 条：不得使用必将、一定、翻倍等对未来业绩作确定性承诺的表述，应改为有望、预计。',
        start_offset: null,
        end_offset: null,
        uri: 'kb://docs/kdoc-002#chunk-12',
        captured_at: null,
      },
    ],
  },  {
    id: 'fnd-06',
    claimId: 'clm-06',
    dimension: 'consistency',
    dimensionName: '一致性核查',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '预测区间与文中的历史增速、行业增速假设方向一致，未发现前后矛盾。',
    suggestion: null,
    confidence: 0.78,
    evidences: [
      {
        id: 'evd-06',
        type: 'in_text',
        source_ref: 'blk-08',
        snippet: '对应同比增速 32%、29%、28%',
        start_offset: 0,
        end_offset: 18,
        uri: null,
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-07',
    claimId: 'clm-07',
    dimension: 'valuation',
    dimensionName: '估值核查',
    status: 'risk',
    risk: 'low',
    rules: [{ code: 'R-VAL-03', desc: '可比公司法估值高于可比公司中位数 30% 以上，且未说明溢价理由' }],
    reason: '2027 年 45 倍 PE 高于可比公司中位数（约 32 倍）约 40%，文中未给出溢价理由与可比公司清单。',
    suggestion: '建议补充可比公司估值对照表，并说明给予估值溢价的具体理由。',
    confidence: 0.72,
    evidences: [
      {
        id: 'evd-07',
        type: 'kb_chunk',
        source_ref: 'kc-valuation-004',
        snippet: '估值核查规则第 3 条：目标估值高于可比公司中位数 30% 以上时，必须给出溢价理由并列出可比公司。',
        start_offset: null,
        end_offset: null,
        uri: 'kb://docs/kdoc-003#chunk-4',
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-08',
    claimId: 'clm-08',
    dimension: 'calc',
    dimensionName: '计算核查',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '复算：32.6 - 31.4 = 1.2 个百分点，与文中"同比提升 1.2 个百分点"一致。',
    suggestion: null,
    confidence: 0.92,
    calc: {
      expression: '32.6 - 31.4',
      unit: 'pct',
      steps: [
        { label: '2026 年上半年毛利率', value: '32.6', source: '本文第 9 段' },
        { label: '2025 年上半年毛利率', value: '31.4', source: '本文第 4 段' },
      ],
      computed: '1.2pct',
      claimed: '1.2 个百分点',
      deviation: '0.00pct',
      tolerance: '0.1pct',
      conclusion: 'match',
    },
    evidences: [
      {
        id: 'evd-08',
        type: 'in_text',
        source_ref: 'blk-04',
        snippet: '毛利率 31.4%',
        start_offset: 0,
        end_offset: 8,
        uri: null,
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-09',
    claimId: 'clm-09',
    dimension: 'consistency',
    dimensionName: '一致性核查',
    status: 'risk',
    risk: 'high',
    rules: [{ code: 'R-CONS-01', desc: '同一报告内对同一事实给出互相矛盾的表述' }],
    reason:
      '本文第 13 段称"新增产能 1500 万只"，而第 5 段称"新增陶瓷基座产能 2000 万只"，两处相差 500 万只，报告内部自相矛盾。',
    suggestion: '请确认产能数据后统一表述；若两者口径不同（如新增产能与达产产能），需在文中说明。',
    confidence: 0.9,
    evidences: [
      {
        id: 'evd-09',
        type: 'in_text',
        source_ref: 'blk-05',
        snippet: '公司上半年新增陶瓷基座产能 2000 万只',
        start_offset: 0,
        end_offset: 20,
        uri: null,
        captured_at: null,
      },
      {
        id: 'evd-10',
        type: 'in_text',
        source_ref: 'blk-13',
        snippet: '公司 2026 年上半年新增产能 1500 万只',
        start_offset: 0,
        end_offset: 21,
        uri: null,
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-10',
    claimId: 'clm-10',
    dimension: 'quality_risk',
    dimensionName: '风险披露',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '报告已披露需求、产能爬坡、原材料价格三类主要风险，符合风险披露的完整性要求。',
    suggestion: null,
    confidence: 0.8,
    evidences: [
      {
        id: 'evd-11',
        type: 'kb_chunk',
        source_ref: 'kc-norm-021',
        snippet: '风险披露要求：应覆盖需求、供给、成本三类主要风险，并说明对业绩的影响方向。',
        start_offset: null,
        end_offset: null,
        uri: 'kb://docs/kdoc-001#chunk-21',
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-11',
    claimId: 'clm-11',
    dimension: 'quality_logic',
    dimensionName: '逻辑质量',
    status: 'risk',
    risk: 'medium',
    rules: [{ code: 'R-QLOG-02', desc: '结论性表述缺少数据或来源支撑（无数据支撑的定性表述）' }],
    reason:
      '"具备全球竞争力的龙头企业""技术壁垒深厚"属于结论性定性表述，全篇未给出市占率、专利数或客户认证等可核对的数据支撑。',
    suggestion: '建议补充支撑数据（如市占率、核心客户认证进度、专利数量），或改为更克制的表述。',
    confidence: 0.75,
    evidences: [
      {
        id: 'evd-12',
        type: 'in_text',
        source_ref: 'blk-14',
        snippet: '公司是电子陶瓷封装领域具备全球竞争力的龙头企业',
        start_offset: 0,
        end_offset: 24,
        uri: null,
        captured_at: null,
      },
    ],
  },  {
    id: 'fnd-12',
    claimId: 'clm-12',
    dimension: 'quality_cross',
    dimensionName: '观点交叉验证',
    status: 'uncovered',
    risk: null,
    rules: [],
    reason: '交叉验证需要外部研报库比对同业观点，当前未配置该资料，未做核对。',
    suggestion: null,
    confidence: 0.3,
    uncoveredReason: '未配置外部研报库，观点交叉验证无法运行',
    evidences: [],
  },
  {
    id: 'fnd-13',
    claimId: 'clm-13',
    dimension: 'calc',
    dimensionName: '计算核查',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '复算：8.5 - 7.9 = 0.6 个百分点，与文中"提升 0.6 个百分点"一致。',
    suggestion: null,
    confidence: 0.9,
    calc: {
      expression: '8.5 - 7.9',
      unit: 'pct',
      steps: [
        { label: '2026 年上半年研发费用率', value: '8.5', source: '本文第 16 段' },
        { label: '2025 年全年研发费用率', value: '7.9', source: '本文第 16 段' },
      ],
      computed: '0.6pct',
      claimed: '0.6 个百分点',
      deviation: '0.00pct',
      tolerance: '0.1pct',
      conclusion: 'match',
    },
    evidences: [
      {
        id: 'evd-13',
        type: 'calc',
        source_ref: 'tool:calc_eval',
        snippet: '复算表达式 8.5 - 7.9 = 0.6，误差在容差 0.1 以内',
        start_offset: null,
        end_offset: null,
        uri: null,
        captured_at: null,
      },
    ],
  },
  {
    id: 'fnd-14',
    claimId: 'clm-14',
    dimension: 'quality_data',
    dimensionName: '数据支撑',
    status: 'error',
    risk: null,
    rules: [],
    reason: '核查过程出错：财务数据源请求超时 3 次，未取得客户集中度数据，该条没有结论。',
    suggestion: null,
    confidence: 0,
    uncoveredReason: '数据源不可用（超时 3 次），可稍后重试该维度',
    evidences: [],
  },
  {
    id: 'fnd-15',
    claimId: 'clm-15',
    dimension: 'quality_data',
    dimensionName: '数据支撑',
    status: 'uncovered',
    risk: null,
    rules: [],
    reason: '现金流量表数据未接入，无法核对现金流与净利润的匹配度。',
    suggestion: null,
    confidence: 0.35,
    uncoveredReason: '未接入现金流量表数据源',
    evidences: [],
  },
  {
    id: 'fnd-16',
    claimId: 'clm-16',
    dimension: 'forecast',
    dimensionName: '预测核查',
    status: 'pass',
    risk: null,
    rules: [],
    reason: '达产时间与产能规划在文中前后一致（对应前期公告的 2027 年一季度达产计划），未发现矛盾。',
    suggestion: null,
    confidence: 0.7,
    evidences: [
      {
        id: 'evd-14',
        type: 'in_text',
        source_ref: 'blk-11',
        snippet: '达产后年产能将提升至 1.2 亿只',
        start_offset: 0,
        end_offset: 15,
        uri: null,
        captured_at: null,
      },
    ],
  },
]

export const MOCK_FINDINGS: Finding[] = FINDING_SEEDS.map((seed) => ({
  id: seed.id,
  claim_id: seed.claimId,
  check_batch_id: MOCK_BATCH_ID,
  dimension_code: seed.dimension,
  dimension_name: seed.dimensionName,
  status: seed.status,
  risk_level: seed.risk,
  rule_hits: seed.rules,
  reason: seed.reason,
  suggestion: seed.suggestion,
  calc_trace: seed.calc ?? null,
  confidence: seed.confidence,
  evidences: seed.evidences,
  uncovered_reason: seed.uncoveredReason ?? null,
  created_at: hoursAgo(30),
}))

/* ============================================================================
 * 四、人工复核记录（4 条已复核 / 16 条待复核，复核进度 25%）
 *
 * 四条刻意覆盖不同动作，方便演示"三态结论"同时存在：
 *   verify（已核实）、accept（接受 AI 建议）、reject（驳回并填理由）、verify
 * ==========================================================================*/

export const MOCK_REVIEW_ACTIONS: ReviewAction[] = [
  {
    id: 'act-01',
    claim_id: 'clm-07',
    action: 'verify',
    reason: '估值溢价在文中已说明理由，人工确认无误',
    payload: null,
    actor_id: 'usr-002',
    actor_name: '李岚',
    created_at: hoursAgo(20),
  },
  {
    id: 'act-02',
    claim_id: 'clm-05',
    action: 'accept',
    reason: '同意修改为更克制的表述',
    payload: { accepted_suggestion: '建议改为：若新产能如期爬坡，公司下半年业绩有望实现较快增长。' },
    actor_id: 'usr-002',
    actor_name: '李岚',
    created_at: hoursAgo(18),
  },
  {
    id: 'act-03',
    claim_id: 'clm-11',
    action: 'reject',
    reason: '该表述有行业协会发布的市占率数据支撑（2026 年 3 月发布），判定为逻辑问题过严',
    payload: null,
    actor_id: 'usr-002',
    actor_name: '李岚',
    created_at: hoursAgo(6),
  },
  {
    id: 'act-04',
    claim_id: 'clm-03',
    action: 'verify',
    reason: '与财报一致，确认无误',
    payload: null,
    actor_id: 'usr-001',
    actor_name: '王小明',
    created_at: hoursAgo(4),
  },
]
/* ============================================================================
 * 五、报告级评估
 *
 * 数字必须自洽：16 = 3 高 + 2 中 + 1 低 + 6 通过 + 3 未覆盖 + 1 失败
 * 覆盖率 = 有结论的条数 / 总条数 = 12 / 16 = 75%
 * ==========================================================================*/

export const MOCK_ASSESSMENT: Assessment = {
  id: 'asm-01',
  check_batch_id: MOCK_BATCH_ID,
  report_id: 'rpt-001',
  overall_risk: 'high',
  summary:
    '本次深度评估共核查 16 条主张，发现 3 条高风险、2 条中风险、1 条低风险；另有 3 条因资料缺失未覆盖、1 条核查失败。主要问题集中在财务增速的计算一致性与产能数据的前后矛盾，建议优先处理。',
  metrics: {
    claims_total: 16,
    covered: 12,
    uncovered: 3,
    error_count: 1,
    // 覆盖率 = 有结论支撑的条数 / 总条数 = 12 / 16
    coverage_rate: 0.75,
    risk_counts: { high: 3, medium: 2, low: 1, pass: 6 },
    by_dimension: [
      { code: 'calc', name: '计算核查', problems: 2, checked: 5, coverage: 1.0 },
      {
        code: 'fact',
        name: '事实核查',
        problems: 0,
        checked: 3,
        coverage: 0.67,
        uncovered_reason: '行业产能数据库不可用',
      },
      { code: 'norm', name: '规范核查', problems: 1, checked: 16, coverage: 1.0 },
      { code: 'consistency', name: '一致性核查', problems: 1, checked: 16, coverage: 1.0 },
      {
        code: 'valuation',
        name: '估值核查',
        problems: 1,
        checked: 2,
        coverage: 0.5,
        uncovered_reason: '缺少可比公司估值数据',
      },
      { code: 'quality_logic', name: '逻辑质量', problems: 1, checked: 16, coverage: 1.0 },
      {
        code: 'quality_data',
        name: '数据支撑',
        problems: 0,
        checked: 16,
        coverage: 0.88,
        uncovered_reason: '现金流量表未接入',
      },
      { code: 'quality_risk', name: '风险披露', problems: 0, checked: 16, coverage: 1.0 },
      {
        code: 'quality_cross',
        name: '观点交叉验证',
        problems: 0,
        checked: 0,
        coverage: 0,
        uncovered_reason: '未配置外部研报库',
      },
    ],
    // 无数据支撑的定性表述占比：约 5 条定性表述里 1 条明显缺少数据支撑
    qualitative_without_data_rate: 0.2,
    risk_disclosure_covered: true,
    cross_view_consistent: 0,
    cross_view_conflicts: 0,
  },
  priority_claims: [
    {
      claim_id: 'clm-01',
      risk_level: 'high',
      dimension_name: '计算核查',
      excerpt: '2026 年上半年实现营业收入 12.3 亿元，同比增长 25%',
    },
    {
      claim_id: 'clm-09',
      risk_level: 'high',
      dimension_name: '一致性核查',
      excerpt: '公司 2026 年上半年新增产能 1500 万只，与文中另一处 2000 万只矛盾',
    },
    {
      claim_id: 'clm-02',
      risk_level: 'high',
      dimension_name: '计算核查',
      excerpt: '归母净利润 2.1 亿元，同比增长 18%',
    },
    {
      claim_id: 'clm-05',
      risk_level: 'medium',
      dimension_name: '规范核查',
      excerpt: '下半年公司业绩必将翻倍增长',
    },
    {
      claim_id: 'clm-11',
      risk_level: 'medium',
      dimension_name: '逻辑质量',
      excerpt: '具备全球竞争力的龙头企业，技术壁垒深厚',
    },
  ],
  key_issues: [
    {
      title: '财务增速与原文数据不一致（2 处）',
      detail:
        '营收增速文中为 25%，按本文数据复算为 21.78%；净利增速文中为 18%，复算为 12.30%。两处偏差均超过 1% 容差。',
      claim_id: 'clm-01',
    },
    {
      title: '同一类数据前后矛盾（产能）',
      detail: '第 5 段写"新增陶瓷基座产能 2000 万只"，第 13 段写"新增产能 1500 万只"，相差 500 万只。',
      claim_id: 'clm-09',
    },
    {
      title: '存在对未来业绩的确定性表述',
      detail: '"必将翻倍增长"命中内部规范禁用表达清单，建议改为"有望"类表述。',
      claim_id: 'clm-05',
    },
  ],
  // 参考分必须固定附注"仅用于排序"，避免被当成研报质量结论
  reference_score: '78.5',
  rule_version: 'r2026.09',
  created_at: hoursAgo(30),
}
/* ============================================================================
 * 六、复核裁决页需要的两个派生函数
 * ==========================================================================*/

/** 风险严重度排序权重，用于"取最严重的那个" */
const RISK_RANK: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 }

/**
 * 从 claims + findings 推导每条主张的当前状态与最高风险。
 * 口径与后端一致（05 §2.4）：状态取"最需要人看"的那个 —— 有问题 > 失败 > 未覆盖 > 通过。
 */
export function buildClaimSpans(): ClaimSpan[] {
  return MOCK_CLAIMS.map((claim) => {
    const findings = MOCK_FINDINGS.filter((f) => f.claim_id === claim.id)
    const risk = findings.reduce<RiskLevel | null>((best, f) => {
      if (!f.risk_level) return best
      return !best || RISK_RANK[f.risk_level] > RISK_RANK[best] ? f.risk_level : best
    }, null)
    const priority: Array<Finding['status']> = ['risk', 'error', 'uncovered', 'pass']
    const status = priority.find((s) => findings.some((f) => f.status === s)) ?? 'pass'
    return {
      id: claim.id,
      block_id: claim.block_id,
      start_offset: claim.start_offset,
      end_offset: claim.end_offset,
      risk_level: risk,
      status,
    }
  })
}

/**
 * 三态结论（AI / 人工 / 生效）与复核状态，按 05 §2.4 的规则算。
 * 关键点：**没有人工动作时生效结论是"待复核"，不是"通过"** —— 这是全系统信任的基础。
 */
export function buildConclusion(claimId: string): ClaimConclusion {
  const findings = MOCK_FINDINGS.filter((f) => f.claim_id === claimId)
  const actions = MOCK_REVIEW_ACTIONS.filter((a) => a.claim_id === claimId).sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1
  )
  const primary = findings[0]

  let aiConclusion = '暂无结论'
  if (primary) {
    if (primary.status === 'risk' && primary.risk_level) {
      aiConclusion = RISK_LEVEL_LABEL[primary.risk_level] + '：' + primary.dimension_name + '发现问题'
    } else if (primary.status === 'pass') {
      aiConclusion = '未发现问题'
    } else if (primary.status === 'uncovered') {
      aiConclusion = '未覆盖：' + (primary.uncovered_reason ?? '缺少必要资料')
    } else {
      aiConclusion = '核查失败：' + (primary.uncovered_reason ?? '核查过程出错')
    }
  }

  const latest = actions[0]
  let humanConclusion: string | null = null
  let state: ClaimConclusion['state'] = 'pending'
  let effective = '待复核'

  if (latest) {
    if (latest.action === 'accept') {
      state = 'accepted'
      humanConclusion = '已接受 AI 建议（' + latest.actor_name + '）'
      effective = '按 AI 建议修改后的文本'
    } else if (latest.action === 'reject') {
      state = 'rejected'
      humanConclusion = '已驳回 AI：' + (latest.reason ?? '')
      effective = '原文通过（人工判定 AI 误报）'
    } else if (latest.action === 'verify') {
      state = 'verified'
      humanConclusion = '已核实无误（' + latest.actor_name + '）'
      effective = '原文通过（人工核实）'
    } else {
      state = 'edited'
      humanConclusion = '已人工修改（' + latest.actor_name + '）'
      effective = '人工修改后的文本'
    }
  }

  return { state, ai_conclusion: aiConclusion, human_conclusion: humanConclusion, effective_conclusion: effective }
}
/* ============================================================================
 * 七、用户与维度注册表
 * ==========================================================================*/

/** 当前登录用户（演示账号，登录页直接用它登录） */
export const MOCK_USER: User = {
  id: 'usr-001',
  name: '王小明',
  username: 'wangxiaoming',
  role: 'researcher',
  company: '中信证券研究部',
  permissions: ['task:create', 'claim:review', 'report:upload', 'knowledge:manage', 'learning:review'],
}

/** 同事账号，用于演示"该条已被他人复核"的并发冲突（409） */
export const MOCK_COLLEAGUE: User = {
  id: 'usr-002',
  name: '李岚',
  username: 'lilan',
  role: 'reviewer',
  company: '中信证券研究部',
  permissions: ['claim:review'],
}

/**
 * 维度注册表（9 个）。
 * required_inputs 是"依赖声明"：前端勾选维度后自动算出缺哪些资料并给上传引导，
 * 后端新增维度时前端不用改代码（架构约束：声明式依赖）。
 */
export const MOCK_DIMENSIONS: Dimension[] = [
  {
    code: 'calc',
    name: '计算核查',
    group: 'check',
    description: '复算文中的同比增速、毛利率、费用率等，检查数字能否对上',
    required_inputs: [],
    enabled_in_modes: ['quick', 'deep'],
    default_risk_level: 'high',
  },
  {
    code: 'norm',
    name: '规范核查',
    group: 'check',
    description: '按内部写作规范与禁用表达清单检查表述合规性',
    required_inputs: ['internal_norm'],
    enabled_in_modes: ['quick', 'deep'],
    default_risk_level: 'medium',
  },
  {
    code: 'fact',
    name: '事实核查',
    group: 'check',
    description: '核对文中事实与外部数据源、文内其他表述是否一致',
    required_inputs: ['market_data'],
    enabled_in_modes: ['deep'],
    default_risk_level: 'high',
  },
  {
    code: 'consistency',
    name: '一致性核查',
    group: 'check',
    description: '在报告内部找前后矛盾的说法（同一事实出现两种数据）',
    required_inputs: [],
    enabled_in_modes: ['deep'],
    default_risk_level: 'high',
  },
  {
    code: 'valuation',
    name: '估值核查',
    group: 'check',
    description: '检查估值方法与假设是否站得住、是否给出可比公司依据',
    required_inputs: ['valuation_rules'],
    enabled_in_modes: ['deep'],
    default_risk_level: 'medium',
  },
  {
    code: 'quality_logic',
    name: '逻辑质量',
    group: 'quality',
    description: '评估论证链是否完整、结论是否有数据支撑',
    required_inputs: [],
    enabled_in_modes: ['deep'],
    default_risk_level: 'medium',
  },
  {
    code: 'quality_data',
    name: '数据支撑',
    group: 'quality',
    description: '统计定性表述中有多少缺少数据来源',
    required_inputs: ['market_data'],
    enabled_in_modes: ['deep'],
  },
  {
    code: 'quality_risk',
    name: '风险披露',
    group: 'quality',
    description: '检查风险提示是否覆盖需求、供给、成本等主要风险',
    required_inputs: ['internal_norm'],
    enabled_in_modes: ['deep'],
  },
  {
    code: 'quality_cross',
    name: '观点交叉验证',
    group: 'quality',
    description: '与同业研报观点交叉比对，找出明显偏离市场共识的判断',
    required_inputs: ['external_reports'],
    enabled_in_modes: ['deep'],
  },
]
