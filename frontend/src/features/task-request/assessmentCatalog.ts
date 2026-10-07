/**
 * features/task-request/assessmentCatalog.ts —— 评估类型与深度（发起评估任务时选的东西）
 *
 * 【和勘误的分工（这是最容易混的地方）】
 *   勘误 = 查错：这句话算错了没、前后矛盾没、有没有出处（**按句**）。
 *   评估 = 评价：整篇报告的论证、数据、风险、同业、写作、估值做得怎么样（**按篇**）。
 *   所以这里每一项都是"评价维度"，而不是"找错项"。
 *
 * 【两个东西一起决定耗时】
 *   勾了哪些维度（type）× 深度（depth）。深度是乘数：快速 0.4 / 标准 1 / 深度 2.5。
 *
 * 【本文件导出】
 *   AssessmentOption / AssessmentCategory / AssessmentDepth  类型
 *   ASSESSMENT_CATALOG      分组清单
 *   ASSESSMENT_DEPTHS       三档深度（界面用单选）
 *   ASSESSMENT_ALL_OPTIONS  拍平的全部维度
 *   estimateAssessmentMinutes()  按维度 + 深度估算总耗时（分钟）
 */
export interface AssessmentOption {
  code: string
  name: string
  hint: string
  /** 标准深度下的预估耗时（分钟） */
  minutes: number
}

export interface AssessmentCategory {
  category: string
  items: AssessmentOption[]
}

export interface AssessmentDepth {
  code: 'quick' | 'standard' | 'deep'
  name: string
  hint: string
  /** 相对于标准深度的耗时倍数 */
  factor: number
}

export const ASSESSMENT_CATALOG: AssessmentCategory[] = [
  {
    category: '一、论证质量',
    items: [
      { code: 'arg_chain', name: '论证链完整性', hint: '结论有没有数据与推理支撑，中间有没有跳步', minutes: 4 },
      { code: 'arg_assumption', name: '假设显式性', hint: '关键假设是否写明，是否给了可验证的依据', minutes: 3 },
      { code: 'arg_sensitivity', name: '反方视角与敏感性', hint: '有没有考虑不利情形、给出敏感性区间', minutes: 4 },
    ],
  },
  {
    category: '二、数据与证据质量',
    items: [
      { code: 'data_sufficiency', name: '数据充分性', hint: '关键判断是否都有数据支撑，有没有"讲故事"', minutes: 4 },
      { code: 'data_authority', name: '来源权威性', hint: '数据来源是公司公告、行业协会还是一般网络', minutes: 3 },
      { code: 'data_timeliness', name: '数据时效性', hint: '是否用了过时数据、统计时点是否说明', minutes: 2 },
    ],
  },
  {
    category: '三、风险与合规',
    items: [
      { code: 'risk_disclosure', name: '风险披露充分性', hint: '需求、供给、成本、政策、竞争等风险是否覆盖', minutes: 3 },
      { code: 'risk_compliance', name: '表述合规性', hint: '有无夸大、保证收益、未公开信息等表述', minutes: 3 },
      { code: 'risk_disclaimer', name: '免责与利益冲突', hint: '免责声明、评级说明、利益冲突披露是否齐全', minutes: 2 },
    ],
  },
  {
    category: '四、观点与同业一致性',
    items: [
      { code: 'peer_deviation', name: '与同业观点偏离度', hint: '与市场上主流判断的差异有多大', minutes: 4 },
      { code: 'peer_rationale', name: '独家判断是否有解释', hint: '与众不同的结论是否说明了理由', minutes: 3 },
    ],
  },
  {
    category: '五、写作与呈现',
    items: [
      { code: 'write_structure', name: '结构清晰度', hint: '章节安排是否好读，重点是否突出', minutes: 2 },
      { code: 'write_chart', name: '图表质量', hint: '图表是否能支撑结论、是否好读', minutes: 3 },
      { code: 'write_summary', name: '摘要与正文一致', hint: '摘要里的结论与正文是否一致', minutes: 2 },
    ],
  },
  {
    category: '六、估值合理性',
    items: [
      { code: 'val_method_fit', name: '估值方法选择', hint: '选的方法（PE/PB/DCF/EV-EBITDA）是否适合这个行业', minutes: 3 },
      { code: 'val_param_rationale', name: '估值参数合理性', hint: '增长率、折现率、永续增速等是否与行业和历史相符', minutes: 4 },
      { code: 'val_target_support', name: '目标价支撑', hint: '目标价与盈利预测、估值倍数能否对上', minutes: 3 },
    ],
  },
]

export const ASSESSMENT_ALL_OPTIONS: AssessmentOption[] = ASSESSMENT_CATALOG.flatMap((group) => group.items)

/** 三档深度：给用户一个"用多少时间换多少确定性"的旋钮 */
export const ASSESSMENT_DEPTHS: AssessmentDepth[] = [
  { code: 'quick', name: '快速', hint: '只看结论、关键数据与明显风险，适合初筛', factor: 0.4 },
  { code: 'standard', name: '标准', hint: '按勾选的维度逐项看一遍，给出覆盖率与问题数', factor: 1 },
  { code: 'deep', name: '深度', hint: '逐段追论证链，补同业对比与敏感性，耗时明显更长', factor: 2.5 },
]

/**
 * 估算评估总耗时（分钟）= 勾选维度耗时之和 × 深度倍数。
 * 至少 1 分钟，避免界面上出现"0 分钟"这种不可信的数字。
 */
export function estimateAssessmentMinutes(codes: string[], depth: AssessmentDepth['code']): number {
  const base = ASSESSMENT_ALL_OPTIONS.filter((option) => codes.includes(option.code)).reduce((sum, option) => sum + option.minutes, 0)
  if (!base) return 0
  const depthOption = ASSESSMENT_DEPTHS.find((item) => item.code === depth) ?? ASSESSMENT_DEPTHS[1]
  return Math.max(1, Math.round(base * depthOption.factor))
}