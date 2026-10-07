/**
 * features/task-request/errataCatalog.ts —— 勘误类型目录（发起勘误任务时勾选的东西）
 *
 * 【这份清单是怎么来的】
 *   照着"一个人拿着研报逐句挑错时，实际会挑哪几类错"总结的，按**错的种类**分五组：
 *     数据与计算 / 事实与出处 / 逻辑与一致性 / 表述与合规 / 估值与预测，外加格式呈现。
 *   每项都写了"它在查什么"（hint）与**单项预估耗时**（minutes）——
 *   勾选后界面会把耗时加起来，用户才知道"这一趟大概要等多久"（这是他能选择少勾几项的依据）。
 *
 * 【改这个清单时注意】
 *   · code 一旦上线就不要改（任务请求与审计日志里存的是 code）；
 *   · minutes 是"整篇估算"，实际耗时会按选择的页码范围等比缩放（见 estimateErrataMinutes）；
 *   · 新增项要同时想清楚：它是"查错"还是"评价"？评价类属于评估，不属于勘误。
 *
 * 【本文件导出】
 *   ErrataOption / ErrataCategory   类型
 *   ERRATA_CATALOG                  分组清单（界面按组渲染）
 *   ERRATA_ALL_OPTIONS              拍平的全部选项
 *   estimateErrataMinutes()         按勾选项 + 页码范围估算总耗时（分钟）
 */
export interface ErrataOption {
  code: string
  name: string
  /** 一句话说明它在查什么（界面上直接显示，别写术语） */
  hint: string
  /** 整篇核对时的预估耗时（分钟） */
  minutes: number
}

export interface ErrataCategory {
  category: string
  items: ErrataOption[]
}

export const ERRATA_CATALOG: ErrataCategory[] = [
  {
    category: '一、数据与计算',
    items: [
      { code: 'calc_number', name: '数字复算', hint: '正文里的比率、增速、占比，用文中数据重算一遍对不对', minutes: 3 },
      { code: 'calc_unit', name: '单位与量纲', hint: '亿元 / 万元 / 元、百分比与百分点有没有混用', minutes: 2 },
      { code: 'calc_table', name: '表格与正文一致', hint: '表格里的数字和正文描述是否说同一件事', minutes: 3 },
      { code: 'calc_sum', name: '合计与分项', hint: '合计是否等于分项之和，漏项、重复计算', minutes: 2 },
      { code: 'calc_period', name: '时间口径', hint: '同比 / 环比、单季 / 累计、区间口径是否说清楚', minutes: 3 },
      { code: 'calc_tie', name: '财务勾稽', hint: '利润、资产负债、现金流三张表之间的基本勾稽关系', minutes: 4 },
    ],
  },
  {
    category: '二、事实与出处',
    items: [
      { code: 'fact_company', name: '公司数据核对', hint: '营收、利润、产能、客户等与公开披露是否一致', minutes: 4 },
      { code: 'fact_industry', name: '行业与市场数据', hint: '行业规模、增速、市占率是否有可靠出处', minutes: 4 },
      { code: 'fact_source', name: '出处完整性', hint: '关键数字是否标注来源与统计时点', minutes: 2 },
      { code: 'fact_timeliness', name: '时效性', hint: '用的数据是否过时，特别是出现「最新」这类表述时', minutes: 2 },
    ],
  },
  {
    category: '三、逻辑与一致性',
    items: [
      { code: 'logic_contradict', name: '前后矛盾', hint: '同一指标在不同段落说法不一致（最常见的高风险项）', minutes: 3 },
      { code: 'logic_chain', name: '因果与论证', hint: '结论是否由前文数据支撑，有没有跳步', minutes: 4 },
      { code: 'logic_concept', name: '概念一致', hint: '同一个概念前后是否同名同义（如毛利率口径变化）', minutes: 2 },
      { code: 'logic_assumption', name: '隐含假设', hint: '关键假设有没有显式写出来', minutes: 3 },
    ],
  },
  {
    category: '四、表述与合规',
    items: [
      { code: 'norm_forbidden', name: '禁用 / 夸大表达', hint: '必将、翻倍、稳赚、零风险这类词', minutes: 3 },
      { code: 'norm_forecast', name: '预测口径', hint: '预测是否说明假设、区间与依据，而非只给数字', minutes: 4 },
      { code: 'norm_risk', name: '风险披露', hint: '需求、供给、成本、政策等主要风险是否覆盖', minutes: 3 },
      { code: 'norm_vague', name: '模糊表述', hint: '大幅、明显、较高这类词能否量化', minutes: 2 },
      { code: 'norm_compliance', name: '合规红线', hint: '未公开信息、荐股式表述、承诺收益等', minutes: 3 },
    ],
  },
  {
    category: '五、估值与预测',
    items: [
      { code: 'val_method', name: '估值方法适用性', hint: 'PE / PB / DCF 的选择与行业特性是否匹配', minutes: 4 },
      { code: 'val_peer', name: '可比公司', hint: '可比公司选取是否合理、口径是否一致', minutes: 4 },
      { code: 'val_param', name: '估值参数依据', hint: '增长率、折现率、永续增速等参数有没有依据', minutes: 4 },
      { code: 'val_target', name: '目标价与评级自洽', hint: '目标价、评级、盈利预测三者能不能对上', minutes: 3 },
    ],
  },
  {
    category: '六、格式与呈现',
    items: [
      { code: 'fmt_chart', name: '图表与正文对应', hint: '图表编号、引用与解读是否一致', minutes: 2 },
      { code: 'fmt_toc', name: '章节与目录', hint: '章节标题、编号、目录是否一致', minutes: 1 },
      { code: 'fmt_typo', name: '错别字与标点', hint: '错别字、全半角混用、单位符号', minutes: 1 },
    ],
  },
]

/** 拍平后的全部选项（按 code 查名字/耗时用） */
export const ERRATA_ALL_OPTIONS: ErrataOption[] = ERRATA_CATALOG.flatMap((group) => group.items)

/**
 * 估算勘误总耗时（分钟）。
 * 规则：勾选项耗时之和 × （选中页数 / 总页数）。
 * 页数未知时按整篇算 —— 宁可估多，不让用户等超预期。
 */
export function estimateErrataMinutes(codes: string[], range?: { from: number; to: number } | null, totalPages?: number | null): number {
  const base = ERRATA_ALL_OPTIONS.filter((option) => codes.includes(option.code)).reduce((sum, option) => sum + option.minutes, 0)
  if (!base) return 0
  if (!range || !totalPages || totalPages <= 0) return Math.max(1, Math.round(base))
  const picked = Math.max(1, range.to - range.from + 1)
  const ratio = Math.min(1, picked / totalPages)
  return Math.max(1, Math.round(base * ratio))
}