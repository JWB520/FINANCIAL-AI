/**
 * features/risk-ribbon/RiskRibbon.tsx —— 原文左侧的"风险色带"
 *
 * 【它解决什么问题】
 *   一份几十段的报告，问题往往集中在某几段。用户不想一段段翻，
 *   只想「一眼看到问题集中在报告哪个位置，并且点一下就跳过去」。
 *
 * 【怎么实现的】
 *   一条竖直细条，高度对应整篇原文；每条结论按它在全文中的相对位置占一小段，
 *   颜色就是它的风险色（未覆盖用斜纹，与"通过"不同 —— 这是硬要求）。
 *   点击某个色块 = 跳到对应的原文位置。
 *
 * 【本文件导出】RiskRibbon 组件
 *   注意：位置换算与配色的纯逻辑在 shared/utils/ribbon.ts（那边能单测），这里只负责渲染与交互。
 */
import { Tooltip } from 'antd'
import { FINDING_STATUS_LABEL, RISK_LEVEL_LABEL, type ClaimSpan } from '@/api'
import { ribbonBlockColor, type RibbonBlock } from '@/shared/utils/ribbon'

// 这个导出是为了兼容既有引用（构建色块的纯函数在 shared/utils/ribbon.ts）
export { buildRibbonBlocks } from '@/shared/utils/ribbon'
export type { RibbonBlock } from '@/shared/utils/ribbon'

export function RiskRibbon({ blocks, onJump }: { blocks: RibbonBlock[]; onJump: (claimId: string) => void }) {
  return (
    <Tooltip title="全文风险分布：色块越靠上表示位置越靠前，点一下跳到该处" placement="right">
      <div className="risk-ribbon" style={{ height: '100%', minHeight: 320 }}>
        {blocks.map((block) => (
          <div
            key={block.claimId}
            className="risk-ribbon__block"
            style={{
              top: block.top + '%',
              height: block.height + '%',
              background: ribbonBlockColor(block),
            }}
            onClick={() => onJump(block.claimId)}
            title={block.status === 'risk' && block.risk ? RISK_LEVEL_LABEL[block.risk] : FINDING_STATUS_LABEL[block.status]}
          />
        ))}
      </div>
    </Tooltip>
  )
}

/** 供别处复用的类型（避免每个页面都从 shared 里引） */
export type { ClaimSpan }