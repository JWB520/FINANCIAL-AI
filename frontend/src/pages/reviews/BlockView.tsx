/**
 * pages/reviews/BlockView.tsx —— 渲染"一块原文"，把结论区间变成可点击的高亮
 *
 * 【它是复核裁决页高亮不错位的关键】
 *   输入：一块纯文本 + 落在这一块里的结论区间；
 *   输出：一串 span，没结论的部分原样渲染，有结论的部分带上风险样式并可点击。
 *   切分逻辑在 shared/utils/segment.ts（纯函数，可单测），这里只负责"样式 + 点击"。
 *
 * 【三条实现约束（都是踩过坑的）】
 *   1. 不用 dangerouslySetInnerHTML：那等于放弃精确控制，还会引入 XSS 风险；
 *   2. 不用富文本编辑器：会重排 DOM，导致偏移量与真实 DOM 对不上（高亮错位）；
 *   3. 片段拼接必须与原文一字不差 —— 用户看到的必须是报告原文，不是被改写过的版本。
 *
 * 【本文件导出】BlockView 组件
 */
import type { Block, ClaimSpan } from '@/api'
import { buildSegments, type Segment } from '@/shared/utils/segment'

/** 片段 -> 样式类名。风险色、未覆盖斜纹、选中的描边都在这里决定 */
function segmentClassName(segment: Segment, activeClaimId: string | null): string {
  const classes = ['seg']
  if (segment.claimIds.length) classes.push('seg--clickable')

  if (segment.status === 'risk' && segment.risk) classes.push('seg--' + segment.risk)
  else if (segment.status === 'uncovered') classes.push('seg--uncovered')
  else if (segment.status === 'error') classes.push('seg--error')
  else if (segment.status === 'pass') classes.push('seg--pass')

  // 当前选中的那条结论：加描边并闪烁，帮用户把"右边卡片"和"左边这句话"对上
  if (activeClaimId && segment.claimIds.includes(activeClaimId)) classes.push('seg--active')

  return classes.join(' ')
}

export function BlockView({
  block,
  spans,
  activeClaimId,
  onPick,
}: {
  block: Block
  /** 落在这一块里的结论区间（相对本块的局部偏移） */
  spans: ClaimSpan[]
  /** 当前选中的主张 id（来自 URL 的 ?claim=） */
  activeClaimId: string | null
  /** 点击高亮片段时回调，参数是这一段命中的主张 id 列表（可能不止一个） */
  onPick: (claimIds: string[]) => void
}) {
  const segments = buildSegments(block.text, spans)

  // 标题块单独排版，读起来更像报告
  if (block.block_type === 'heading') {
    return <h3 className="doc-block doc-block--heading">{block.text}</h3>
  }

  return (
    <p className={'doc-block' + (block.block_type === 'bullet' ? ' doc-block--bullet' : '')}>
      {segments.map((segment, index) => {
        // 没有结论覆盖：原样渲染，不做任何装饰（原文要能正常阅读）
        if (!segment.claimIds.length) {
          return <span key={index}>{segment.text}</span>
        }
        return (
          <span
            key={index}
            className={segmentClassName(segment, activeClaimId)}
            data-claim-ids={segment.claimIds.join(',')}
            title={'点击查看这一句的结论，共 ' + segment.claimIds.length + ' 条'}
            onClick={() => onPick(segment.claimIds)}
          >
            {segment.text}
          </span>
        )
      })}
    </p>
  )
}
