/**
 * features/audit/AuditEventTable.tsx —— 审计日志表格（任务级与全局审计页共用）
 *
 * 【它回答一个问题：这条结论凭什么、花了多少代价】
 *   每一行是一次"事件"：阶段开始/结束、模型调用、工具调用、人工裁决、规则发布。
 *   列里给出模型、提示词版本、工具名、耗时、token、状态，
 *   点开能看到输入输出摘要与追踪号（追踪号可以直接给工程师去后端日志里搜）。
 *
 * 【注意】这里显示的输入输出都是**摘要**，不是全文 —— 后端不存全文（06 §1.3），
 *   前端也不该指望拿到全文。
 *
 * 【本文件导出】AuditEventTable 组件
 */
import { Table, Tag, Tooltip, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import type { AuditEvent } from '@/api'
import { AUDIT_EVENT_TYPE_LABEL, STAGE_CODE_LABEL } from '@/api'
import { formatDateTime, formatDuration, formatTokens } from '@/shared/utils/format'

/** 事件状态的展示：ok 绿、degraded 黄（降级但有产物）、error 红 */
function StatusTag({ status }: { status: AuditEvent['status'] }) {
  if (status === 'ok') return <Tag color="success">成功</Tag>
  if (status === 'degraded') return <Tag color="warning">降级</Tag>
  return <Tag color="error">失败</Tag>
}

export function AuditEventTable({
  events,
  loading,
  emptyHint,
}: {
  events: AuditEvent[]
  loading?: boolean
  /** 空态提示（不同页面说法不同） */
  emptyHint?: string
}) {
  return (
    <Table<AuditEvent>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={events}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      locale={{ emptyText: emptyHint ?? '没有审计记录' }}
      expandable={{
        expandedRowRender: (event) => (
          <div style={{ padding: '4px 8px', fontSize: 12.5, lineHeight: 2 }}>
            <div>
              <b>输入摘要：</b>
              {event.input_digest || '—'}
            </div>
            <div>
              <b>输出摘要：</b>
              {event.output_digest || '—'}
            </div>
            {event.error_message ? (
              <div style={{ color: '#cf1322' }}>
                <b>错误信息：</b>
                {event.error_message}
              </div>
            ) : null}
            <div>
              <b>追踪号：</b>
              <Typography.Text copyable={{ icon: <CopyOutlined />, text: event.trace_id }} code>
                {event.trace_id}
              </Typography.Text>
            </div>
          </div>
        ),
      }}
      columns={[
        {
          title: '时间',
          dataIndex: 'created_at',
          width: 140,
          render: (value: string) => <span className="num meta-text">{formatDateTime(value)}</span>,
        },
        {
          title: '事件',
          dataIndex: 'event_type',
          width: 110,
          render: (value: AuditEvent['event_type']) => <Tag>{AUDIT_EVENT_TYPE_LABEL[value]}</Tag>,
        },
        {
          title: '阶段',
          dataIndex: 'stage_code',
          width: 110,
          render: (value: AuditEvent['stage_code']) =>
            value ? STAGE_CODE_LABEL[value] : <span className="meta-text">—</span>,
        },
        {
          title: '模型 / 工具',
          width: 180,
          render: (_v, event) => (
            <span className="num" style={{ fontSize: 12.5 }}>
              {event.model || event.tool_name || '—'}
              {event.prompt_version ? <span className="meta-text"> · {event.prompt_version}</span> : null}
            </span>
          ),
        },
        {
          title: '触发者',
          dataIndex: 'actor',
          width: 100,
          render: (value: string) => <span className="meta-text">{value}</span>,
        },
        {
          title: '耗时',
          dataIndex: 'duration_ms',
          width: 100,
          render: (value?: number | null) => <span className="num">{formatDuration(value)}</span>,
        },
        {
          title: 'Token',
          dataIndex: 'tokens',
          width: 90,
          render: (value?: number | null) => <span className="num">{formatTokens(value)}</span>,
        },
        {
          title: '摘要',
          dataIndex: 'output_digest',
          ellipsis: true,
          render: (value: string | null | undefined, event: AuditEvent) => (
            <Tooltip title={value ?? ''}>
              <span className="meta-text">{value || event.input_digest || '—'}</span>
            </Tooltip>
          ),
        },
        {
          title: '状态',
          dataIndex: 'status',
          width: 90,
          render: (value: AuditEvent['status']) => <StatusTag status={value} />,
        },
      ]}
    />
  )
}