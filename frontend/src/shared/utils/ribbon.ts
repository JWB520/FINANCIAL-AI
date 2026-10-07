/**
 * shared/utils/ribbon.ts —— 风险色带的纯计算部分
 *
 * 【为什么单独放在 shared/utils，而不是和 RiskRibbon 组件放一起】
 *   因为它是纯函数：输入"区间 + 总字符数"，输出"色块的位置与颜色"，
 *   不碰任何 DOM。放在这里有两个好处：
 *     1. 能被自检脚本与单元测试直接跑（verify-core.ts 就在验它）；
 *     2. 组件文件只保留渲染，读起来更短。
 *
 * 【本文件导出】
 *   RibbonBlock         色块结构（top/height 都是相对整篇的百分比）
 *   buildRibbonBlocks() 把结论区间换算成色块，并过滤掉越界/空区间
 *   ribbonBlockColor()  色块的底色（未覆盖用斜纹，与"通过"彻底区分）
 */
import type { ClaimSpan, RiskLevel } from '@/api/types'
import { RISK_LEVEL_HEX } from '@/api/enums'

export interface RibbonBlock {
  claimId: string
  /** 距顶部的百分比（0~100） */
  top: number
  /** 高度百分比（最少 1.5%，否则太小的段落看不见） */
  height: number
  risk: RiskLevel | null
  status: ClaimSpan['status']
}

/**
 * 把一组主张换算成色带上的色块。
 * @param spans 区间的偏移必须是"整篇全文的绝对字符偏移"（调用方负责换算）
 * @param totalChars 整篇字符总数（分母）
 */
export function buildRibbonBlocks(spans: ClaimSpan[], totalChars: number): RibbonBlock[] {
  if (!totalChars || totalChars <= 0) return []
  return spans
    .filter((span) => span.end_offset > span.start_offset)
    .map((span) => {
      const top = Math.min(100, Math.max(0, (span.start_offset / totalChars) * 100))
      const rawHeight = ((span.end_offset - span.start_offset) / totalChars) * 100
      const height = Math.min(100 - top, Math.max(rawHeight, 1.5))
      return { claimId: span.id, top, height, risk: span.risk_level, status: span.status }
    })
    .sort((a, b) => a.top - b.top)
}

/** 色块底色：未覆盖与失败用斜纹/深色，其余用风险色；通过用浅绿（表示"查过了"） */
export function ribbonBlockColor(block: RibbonBlock): string {
  if (block.status === 'uncovered') {
    return 'repeating-linear-gradient(45deg, #bfbfbf, #bfbfbf 2px, #f5f5f5 2px, #f5f5f5 4px)'
  }
  if (block.status === 'error') return '#d4380d'
  if (block.status === 'pass') return '#b7eb8f'
  return block.risk ? RISK_LEVEL_HEX[block.risk] : '#d9d9d9'
}