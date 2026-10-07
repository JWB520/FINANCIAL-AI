/**
 * features/calc-trace/CalcTraceTable.tsx —— "核算过程"展示组件
 *
 * 【为什么这个组件很重要】
 *   计算类结论是系统最硬的价值点：用户看到"这里算错了"，第一个念头是"你凭什么这么说"。
 *   这个组件把三件事同时摆出来：**系统怎么算的（步骤表）、算出来是多少、和原文差多少**。
 *   算式可以一键复制，用户能自己验算 —— 这就是"可复算的证据"。
 *
 * 【本文件导出】CalcTraceTable 组件（数据由 FindingCard 传入，自己不取数）
 */
import { Button, Table, Tag } from 'antd'
import { CheckCircleOutlined, CopyOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { CalcTrace } from '@/api'

export function CalcTraceTable({ trace, onCopy }: { trace: CalcTrace; onCopy?: (text: string) => void }) {
  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        overflow: 'hidden',
        background: '#fcfcfd',
      }}
    >
      {/* 顶部：算式 + 复制按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="meta-text">算式</span>
          <code style={{ fontSize: 13, background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>
            {trace.expression}
          </code>
          {trace.unit ? <span className="meta-text">单位 {trace.unit}</span> : null}
        </div>
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          onClick={() => onCopy?.(trace.expression)}
        >
          复制
        </Button>
      </div>

      {/* 中间：每一步的取值与来源 */}
      <Table
        size="small"
        pagination={false}
        rowKey={(row) => row.label}
        dataSource={trace.steps}
        style={{ background: '#fff' }}
        columns={[
          { title: '步骤', dataIndex: 'label', width: 190 },
          { title: '取值', dataIndex: 'value', width: 110, className: 'num' },
          { title: '来源', dataIndex: 'source', render: (v?: string) => <span className="meta-text">{v || '—'}</span> },
          {
            title: '说明',
            dataIndex: 'note',
            render: (v?: string) => <span className="meta-text">{v || '—'}</span>,
          },
        ]}
      />

      {/* 底部：结论对比 —— 这一行是整张卡片的"判决书" */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          padding: '10px 12px',
          borderTop: '1px solid #f0f0f0',
          background: trace.conclusion === 'match' ? '#f6ffed' : '#fff1f0',
          fontSize: 13,
        }}
      >
        <span>
          系统复算：<b className="num">{trace.computed}</b>
        </span>
        <span>
          原文声称：<b className="num">{trace.claimed}</b>
        </span>
        <span>
          偏差：<b className="num" style={{ color: trace.conclusion === 'match' ? '#389e0d' : '#cf1322' }}>{trace.deviation}</b>
        </span>
        <span className="meta-text">容差 {trace.tolerance}</span>
        <span style={{ marginLeft: 'auto' }}>
          {trace.conclusion === 'match' ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              在容差范围内，判为一致
            </Tag>
          ) : (
            <Tag icon={<CloseCircleOutlined />} color="error">
              超出容差，判为不一致
            </Tag>
          )}
        </span>
      </div>
    </div>
  )
}