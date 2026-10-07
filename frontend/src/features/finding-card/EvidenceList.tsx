/**
 * features/finding-card/EvidenceList.tsx —— 证据列表
 *
 * 【为什么证据是这个系统的命门】
 *   一条"高风险"结论如果没有证据，用户只能选择信或不信 —— 那就跟拍脑袋没区别。
 *   所以规则是：**没有证据的高风险结论一律降级为"未覆盖"**（后端保证），
 *   前端这边要做的是把证据摆得清清楚楚：来源是什么、原文是什么、什么时候取的数。
 *
 * 【本文件导出】EvidenceList 组件（纯展示，点击回调交给上层）
 */
import { Empty, Tag, Tooltip } from 'antd'
import {
  CalculatorOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  LinkOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import type { Evidence, EvidenceType } from '@/api'
import { EVIDENCE_TYPE_HINT, EVIDENCE_TYPE_LABEL } from '@/api'
import { formatDateTime } from '@/shared/utils/format'

/** 证据类型 -> 图标。视觉上区分"内部知识库 / 外部数据 / 文内互证"，用户扫一眼就知道来源可靠度 */
function EvidenceIcon({ type }: { type: EvidenceType }) {
  const map: Record<EvidenceType, React.ReactNode> = {
    kb_chunk: <ReadOutlined />,
    data_source: <DatabaseOutlined />,
    in_text: <FileTextOutlined />,
    calc: <CalculatorOutlined />,
    external_report: <FileTextOutlined />,
  }
  return <>{map[type]}</>
}

export function EvidenceList({
  evidences,
  onJumpToText,
}: {
  evidences: Evidence[]
  /** 文内互证证据点击时跳到原文位置（参数是证据本身） */
  onJumpToText?: (evidence: Evidence) => void
}) {
  if (!evidences.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这条结论没有附证据" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {evidences.map((item) => {
        const canJump = item.type === 'in_text' && item.start_offset !== null && item.start_offset !== undefined
        return (
          <div
            key={item.id}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: '8px 10px',
              background: '#fff',
              cursor: canJump ? 'pointer' : 'default',
            }}
            onClick={() => canJump && onJumpToText?.(item)}
          >
            {/* 第一行：来源类型 + 来源标识 + 取数时间 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <Tooltip title={EVIDENCE_TYPE_HINT[item.type]}>
                <Tag icon={<EvidenceIcon type={item.type} />} color="blue" style={{ marginInlineEnd: 0 }}>
                  {EVIDENCE_TYPE_LABEL[item.type]}
                </Tag>
              </Tooltip>
              <span className="meta-text" style={{ wordBreak: 'break-all' }}>
                {item.source_ref}
              </span>
              {/* 外部数据的取数时间必须显示：用户要知道"这是什么时候的数" */}
              {item.captured_at ? <span className="meta-text">取数于 {formatDateTime(item.captured_at)}</span> : null}
              {canJump ? (
                <span style={{ marginLeft: 'auto', color: '#1677ff', fontSize: 12 }}>
                  <LinkOutlined /> 点击定位原文
                </span>
              ) : null}
            </div>

            {/* 第二行：证据原文片段 */}
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink-1)' }}>{item.snippet}</div>
          </div>
        )
      })}
    </div>
  )
}