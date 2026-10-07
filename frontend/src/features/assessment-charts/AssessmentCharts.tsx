/**
 * features/assessment-charts/AssessmentCharts.tsx —— 结果总览与质量评估的图表/可视化
 *
 * 【本文件导出】
 *   RiskDistributionBar  风险分布条（五类计数 + 可点击）
 *   DimensionTable       维度表现表（问题数 / 检查数 / 覆盖率 / 未覆盖原因）
 *   QualityRadar         质量评估雷达图（4 个质量维度）
 *
 * 【设计上的两个坚持】
 *   1. 图表只是"入口"：点任何一个数字或色块，都跳到已经筛好的复核裁决页/复核队列，
 *      不做"二级筛选页面"（用户最烦的就是点了之后还要自己再筛一遍）；
 *   2. "未覆盖"永远与"通过"分开显示，并且带原因 —— 这个原则贯穿所有可视化。
 */
import { Card, Progress, Table, Tooltip } from 'antd'
import type { AssessmentMetrics, DimensionMetric } from '@/api'
import { FINDING_STATUS_LABEL, RISK_LEVEL_HEX, RISK_LEVEL_LABEL, riskRank } from '@/api'
import { formatPercent } from '@/shared/utils/format'
import { EChart } from './EChart'
import { buildQualityRadarOption } from './radarOption'

/** 风险分布条：一条横条按比例分五段，下面配可点击的计数 */
export function RiskDistributionBar({
  metrics,
  onFilter,
}: {
  metrics: AssessmentMetrics
  /** 点击某类计数时跳转（参数是筛选用法，例如 { risk: 'high' }） */
  onFilter: (filter: { risk?: string; status?: string }) => void
}) {
  const { risk_counts: risks, uncovered, error_count: errorCount, claims_total: total } = metrics

  const segments = [
    { key: 'high', label: RISK_LEVEL_LABEL.high, value: risks.high, color: RISK_LEVEL_HEX.high, filter: { risk: 'high' } },
    { key: 'medium', label: RISK_LEVEL_LABEL.medium, value: risks.medium, color: RISK_LEVEL_HEX.medium, filter: { risk: 'medium' } },
    { key: 'low', label: RISK_LEVEL_LABEL.low, value: risks.low, color: RISK_LEVEL_HEX.low, filter: { risk: 'low' } },
    { key: 'pass', label: FINDING_STATUS_LABEL.pass, value: risks.pass, color: '#95de64', filter: { status: 'pass' } },
    {
      key: 'uncovered',
      label: FINDING_STATUS_LABEL.uncovered,
      value: uncovered,
      color: '#d9d9d9',
      filter: { status: 'uncovered' },
    },
    {
      key: 'error',
      label: FINDING_STATUS_LABEL.error,
      value: errorCount,
      color: '#ffa39e',
      filter: { status: 'error' },
    },
  ].filter((s) => s.value > 0)

  return (
    <div>
      {/* 堆叠条：一眼看到"问题占多少、没查的占多少" */}
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
        {segments.map((seg) => (
          <Tooltip key={seg.key} title={seg.label + '：' + seg.value + ' 条'}>
            <div
              style={{
                width: (seg.value / Math.max(total, 1)) * 100 + '%',
                background: seg.color,
                cursor: 'pointer',
              }}
              onClick={() => onFilter(seg.filter)}
            />
          </Tooltip>
        ))}
      </div>

      {/* 计数区：每个数字都能点进去看明细 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {segments.map((seg) => (
          <div key={seg.key}>
            <div className="meta-text">{seg.label}</div>
            <div
              className="clickable-count"
              style={{ fontSize: 22, lineHeight: 1.3, color: seg.filter.risk ? RISK_LEVEL_HEX[seg.filter.risk as 'high'] : undefined }}
              onClick={() => onFilter(seg.filter)}
              title="点击查看这一类明细"
            >
              {seg.value}
            </div>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="meta-text">覆盖率（有结论 / 总数）</div>
          <div style={{ fontSize: 22, lineHeight: 1.3 }}>
            {formatPercent(metrics.coverage_rate)}
            <span className="meta-text" style={{ fontSize: 13, marginLeft: 6 }}>
              {metrics.covered}/{total}
            </span>
          </div>
        </div>
      </div>

      {uncovered > 0 ? (
        <div className="meta-text" style={{ marginTop: 10 }}>
          另有 {uncovered} 条未覆盖、{errorCount} 条核查失败
        </div>
      ) : null}
    </div>
  )
}

/** 维度表现表：哪个维度查出问题最多、哪个维度覆盖不全（带原因） */
export function DimensionTable({ metrics, onFilter }: { metrics: AssessmentMetrics; onFilter: (dimension: string) => void }) {
  const columns = [
    {
      title: '维度',
      dataIndex: 'name',
      render: (name: string, row: DimensionMetric) => (
        <a onClick={() => onFilter(row.code)} title="查看该维度的全部结论">
          {name}
        </a>
      ),
    },
    { title: '查出问题', dataIndex: 'problems', align: 'right' as const, className: 'num' },
    { title: '检查条数', dataIndex: 'checked', align: 'right' as const, className: 'num' },
    {
      title: '覆盖率',
      dataIndex: 'coverage',
      width: 160,
      render: (coverage: number) => (
        <Progress
          percent={Math.round(coverage * 100)}
          size="small"
          status={coverage >= 0.99 ? 'success' : 'normal'}
        />
      ),
    },
    {
      title: '未覆盖原因',
      dataIndex: 'uncovered_reason',
      render: (reason?: string) =>
        reason ? <span style={{ color: '#d46b08', fontSize: 12.5 }}>{reason}</span> : <span className="meta-text">—</span>,
    },
  ]

  return (
    <Table
      size="small"
      rowKey="code"
      pagination={false}
      dataSource={metrics.by_dimension}
      columns={columns}
    />
  )
}

/** 质量评估雷达图：把 4 个质量维度画成一张图，直观看出"这块弱在哪" */
export function QualityRadar({ metrics }: { metrics: AssessmentMetrics }) {
  const qualityDims = metrics.by_dimension.filter((d) => d.code.startsWith('quality_'))
  if (!qualityDims.length) return null

  // 配置由纯函数生成（src/features/assessment-charts/radarOption.ts）——
  // 纯函数才能在 Node 里跑无头渲染自检（npm run verify:charts）
  const option = buildQualityRadarOption(qualityDims.map((dim) => ({ name: dim.name, coverage: dim.coverage })))

  return (
    // 图注（"数值是覆盖率、别当成结论"）收进悬停提示；完整口径见帮助《页面上的数字是什么意思》
    <Tooltip title="图中数值是各质量维度的覆盖率，只用于直观对比；具体问题看下方明细">
      <div>
        <EChart option={option} height={260} />
      </div>
    </Tooltip>
  )
}

/** 复核优先级建议卡片：把最该先看的几条列出来，一键进队列 */
export function PriorityList({
  items,
  onOpen,
}: {
  items: Array<{ claim_id: string; risk_level: 'high' | 'medium' | 'low'; dimension_name: string; excerpt: string }>
  onOpen: (claimId: string) => void
}) {
  const sorted = [...items].sort((a, b) => riskRank(b.risk_level) - riskRank(a.risk_level))
  return (
    <Card size="small" title="复核优先级建议（按风险从高到低）" styles={{ body: { padding: 0 } }}>
      {sorted.map((item, index) => (
        <div
          key={item.claim_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: index === sorted.length - 1 ? 'none' : '1px solid #f5f5f5',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: RISK_LEVEL_HEX[item.risk_level],
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 12.5, flexShrink: 0 }}>{RISK_LEVEL_LABEL[item.risk_level]}</span>
          <span className="meta-text" style={{ flexShrink: 0 }}>
            {item.dimension_name}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.excerpt}
          </span>
          <a onClick={() => onOpen(item.claim_id)}>去处理</a>
        </div>
      ))}
    </Card>
  )
}
