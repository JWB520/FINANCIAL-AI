/**
 * features/risk-badge/RiskBadge.tsx —— 风险徽标与图例（全系统风险显示的唯一来源）
 *
 * 【本文件导出】
 *   RiskBadge   一个小圆点 + 文字的徽标，用于列表和卡片头部
 *   RiskLegend  图例，解释五种状态分别是什么意思（放在结果总览与复核裁决页顶部）
 *
 * 【两条设计纪律（04_前端架构.md §9.1）】
 *   1. 只用 api/enums.ts 里的颜色，业务代码不写死色值；
 *   2. **颜色之外必须有文字**：只用颜色区分风险等级，色盲用户和黑白打印就废了。
 *      "未覆盖"更是必须带斜纹 + 文字，因为它是"没查"，看起来绝不能像"通过"。
 */
import type { FindingStatus, RiskLevel } from '@/api'
import { FINDING_STATUS_LABEL, RISK_LEVEL_HEX, RISK_LEVEL_LABEL } from '@/api'

/** 状态 -> 圆点样式（未覆盖用斜纹，与"通过"彻底区分开） */
function dotStyle(status: FindingStatus | 'none', risk: RiskLevel | null): React.CSSProperties {
  if (status === 'risk' && risk) return { background: RISK_LEVEL_HEX[risk] }
  if (status === 'pass') return { background: 'transparent', border: '2px solid #389e0d' }
  if (status === 'error') return { background: '#d4380d' }
  if (status === 'uncovered') {
    // 灰底斜纹：既是颜色区分，也是纹理区分（灰度打印也能看出来）
    return {
      background:
        'repeating-linear-gradient(45deg, #8c8c8c, #8c8c8c 2px, #ffffff 2px, #ffffff 4px)',
      border: '1px solid #bfbfbf',
    }
  }
  return { background: '#d9d9d9' }
}

export function RiskBadge({
  risk,
  status,
  size = 'default',
}: {
  /** 风险等级；通过/未覆盖时为 null */
  risk: RiskLevel | null
  /** 结论状态；不传则只显示风险等级 */
  status?: FindingStatus
  size?: 'default' | 'small'
}) {
  const label = status === 'risk' && risk ? RISK_LEVEL_LABEL[risk] : status ? FINDING_STATUS_LABEL[status] : '—'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: size === 'small' ? 12 : 13,
        fontWeight: status === 'risk' ? 600 : 400,
        color: 'var(--ink-1)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: size === 'small' ? 8 : 10,
          height: size === 'small' ? 8 : 10,
          borderRadius: '50%',
          flexShrink: 0,
          ...dotStyle(status ?? (risk ? 'risk' : 'none'), risk),
        }}
      />
      {label}
    </span>
  )
}

/**
 * 图例：五种状态各是什么意思。
 * 放在结果总览和复核裁决页顶部，让第一次用的人不用猜颜色含义。
 */
export function RiskLegend({ compact = false }: { compact?: boolean }) {
  const items: Array<{ risk: RiskLevel | null; status: FindingStatus; hint: string }> = [
    { risk: 'high', status: 'risk', hint: '必须人工处理（如计算与原文不符、前后矛盾）' },
    { risk: 'medium', status: 'risk', hint: '建议人工确认' },
    { risk: 'low', status: 'risk', hint: '可批量确认' },
    { risk: null, status: 'pass', hint: '已核查，未发现问题' },
    { risk: null, status: 'uncovered', hint: '本次没查到（缺资料），不代表没问题' },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 12 : 18, alignItems: 'center' }}>
      {items.map((item) => (
        <span key={item.status + String(item.risk)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RiskBadge risk={item.risk} status={item.status} size="small" />
          {!compact ? <span className="meta-text">{item.hint}</span> : null}
        </span>
      ))}
    </div>
  )
}
