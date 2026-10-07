/**
 * shared/utils/segment.ts —— 把一段原文按"结论区间"切成可点击的片段
 *
 * 这是复核裁决页最核心的一个纯函数（04_前端架构.md §5.5）：
 * 左侧原文要能一段段高亮，点击高亮句要能选中右侧对应的结论卡片。
 *
 * 【为什么不用富文本编辑器】
 *   编辑器会重排 DOM、额外包 span、改写文本，导致"偏移量"和真实 DOM 对不上 → 高亮错位。
 *   高亮错位是这类系统的致命缺陷（用户会直接不信任结论），所以我们只做一件事：
 *   按字符区间把纯文本切成若干片段，每段自己决定颜色。
 *
 * 【本文件导出】
 *   type Segment（片段结构）
 *   buildSegments(blockText, spans)  —— 主函数
 *   pickPrimaryRisk(spans)           —— 取一段里最严重的风险（列表排序与色带复用）
 *
 * 注意：blockText 与 spans 的偏移必须是"同一坐标系"——即都相对本 block 的局部偏移
 * （后端约定见 05_数据模型与接口契约.md §2.2），不要混入全文绝对偏移。
 */
import type { ClaimSpan, RiskLevel } from '@/api/types'
import { riskRank } from '@/api/enums'

/** 切分后的一个片段：要么整段没有结论覆盖（claimIds 为空），要么属于一条或多条结论 */
export interface Segment {
  /** 这一段的原文（原样，不改一个字，保证拼回去与原文一致） */
  text: string
  /** 覆盖这一段的全部主张 id（一句双问题时会大于 1，点击时弹出让用户选） */
  claimIds: string[]
  /** 主色风险：取覆盖它的结论里最严重的那个，null 表示无结论 */
  risk: RiskLevel | null
  /** 状态：决定是实线高亮（有问题）还是灰色斜纹（未覆盖） */
  status: ClaimSpan['status'] | null
  /** 片段在 block 内的起始偏移，定位滚动时用 */
  start: number
}

/**
 * 从一组区间里挑出最严重的风险等级。
 * 用途：色带与列表排序（"高风险排前面"就靠它）。
 */
export function pickPrimaryRisk(spans: Array<Pick<ClaimSpan, 'risk_level'>>): RiskLevel | null {
  let best: RiskLevel | null = null
  for (const s of spans) {
    if (s.risk_level && riskRank(s.risk_level) > riskRank(best)) best = s.risk_level
  }
  return best
}

/**
 * 主函数：把 blockText 按 spans 切分成互不重叠的片段序列。
 *
 * 处理规则（写在注释里是因为这些是业务约定，不是随手写的）：
 *   1. 区间可能重叠（同一句话既是"计算错误"也是"禁用表达"），
 *      重叠时该片段同时属于多条结论，颜色取最严重的那条，其余靠点击弹窗区分；
 *   2. 没被任何区间覆盖的部分原样保留，保证原文可完整阅读；
 *   3. 片段拼起来必须与原文一字不差（有单测保证）。
 */
export function buildSegments(blockText: string, spans: ClaimSpan[]): Segment[] {
  // 没有结论：整块就是一个片段，直接返回，省掉后面的计算
  if (!spans.length) {
    return blockText ? [{ text: blockText, claimIds: [], risk: null, status: null, start: 0 }] : []
  }

  // 只保留落在本块范围内、且区间合法的结论
  const valid = spans
    .filter((s) => s.start_offset >= 0 && s.end_offset <= blockText.length && s.end_offset > s.start_offset)
    .map((s) => ({ ...s, start_offset: Math.max(0, s.start_offset), end_offset: Math.min(blockText.length, s.end_offset) }))
    .sort((a, b) => a.start_offset - b.start_offset || b.end_offset - a.end_offset)

  if (!valid.length) {
    return blockText ? [{ text: blockText, claimIds: [], risk: null, status: null, start: 0 }] : []
  }

  // 1) 收集所有边界点，切成最小片段
  const boundaries = new Set<number>([0, blockText.length])
  for (const s of valid) {
    boundaries.add(s.start_offset)
    boundaries.add(s.end_offset)
  }
  const points = Array.from(boundaries).sort((a, b) => a - b)

  // 2) 每个最小片段，找出覆盖它的全部结论
  const result: Segment[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]
    const end = points[i + 1]
    const covering = valid.filter((s) => s.start_offset <= start && s.end_offset >= end)
    const text = blockText.slice(start, end)
    if (!text) continue
    result.push({
      text,
      claimIds: covering.map((s) => s.id),
      risk: pickPrimaryRisk(covering),
      status: covering.length ? covering[0].status : null,
      start,
    })
  }

  // 3) 相邻且"归属完全一致"的片段合并，减少 DOM 数量（长报告性能）
  const merged: Segment[] = []
  for (const seg of result) {
    const last = merged[merged.length - 1]
    const sameOwner =
      last && last.risk === seg.risk && last.status === seg.status && last.claimIds.join(',') === seg.claimIds.join(',')
    if (sameOwner) {
      last.text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}
