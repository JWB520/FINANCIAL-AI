/**
 * pages/task-run/TaskAuditPage.tsx —— 任务审计日志（路由 /tasks/:taskId/audit）
 *
 * 【为什么必须补这一页】
 *   进度页上的「审计日志」按钮早就指向 /tasks/:taskId/audit，但这个路由一直不存在，
 *   于是被通配路由接住、直接跳回工作台 —— 用户点一下就像"被踢出去了"。
 *   审计表组件（features/audit/AuditEventTable）与接口（auditApi）本来就写好了，
 *   缺的只是把它们接起来的这一页。
 *
 * 【它回答两个问题】"这条结论凭什么"、"花了多少代价"：
 *   每次阶段开始/结束、模型调用、工具调用、人工裁决的模型名、提示词版本、耗时、
 *   token 数与状态，展开还能看到输入输出摘要与追踪号（追踪号可直接给工程师去后端日志里搜）。
 *
 * 【筛选为什么放在这一页】审计数据量大，必须能按事件类型和追踪号收窄；
 *   默认只看"当前这条任务"的记录（task_id 从路由取），避免用户在一堆任务的日志里翻找。
 *
 * 【本文件导出】TaskAuditPage（默认导出）
 */
import { useState } from 'react'
import { Button, Input, Select, Space, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { auditApi, taskApi, AUDIT_EVENT_TYPE_LABEL, type AuditEventType } from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { AuditEventTable } from '@/features/audit/AuditEventTable'
import { useGoBack } from '@/shared/hooks/useGoBack'

/** 事件类型清单（与 enums 的 AUDIT_EVENT_TYPE_LABEL 一一对应，供筛选下拉用） */
const EVENT_TYPES: AuditEventType[] = [
  'stage_start',
  'stage_end',
  'llm_call',
  'tool_call',
  'review_action',
  'rule_publish',
]

export default function TaskAuditPage() {
  const { taskId = '' } = useParams()
  // 直接打开本页（没有应用内历史）时退到这条任务的进度页 —— 它是本页的天然上级
  const goBack = useGoBack('/tasks/' + taskId + '/run')
  const [eventType, setEventType] = useState<string | undefined>(undefined)
  const [traceId, setTraceId] = useState('')

  // 任务信息只用来显示标题（哪个报告的日志）
  const taskQuery = useQuery({ queryKey: ['task', taskId], queryFn: () => taskApi.detail(taskId) })

  const auditQuery = useQuery({
    queryKey: ['audit', taskId, eventType ?? '', traceId],
    queryFn: () =>
      auditApi.events({
        task_id: taskId,
        event_type: eventType || undefined,
        trace_id: traceId.trim() || undefined,
        page: 1,
        // 单任务的事件量在演示规模内，一次取回后由表格分页；真实后端请改成分页请求
        page_size: 200,
      }),
  })

  const events = auditQuery.data?.items ?? []

  return (
    <div className="page">
      <div style={{ marginBottom: 10 }}>
        <Button onClick={goBack} icon={undefined}>
          返回上一步
        </Button>
      </div>

      <PageHeader
        title="审计日志"
        description={taskQuery.data ? taskQuery.data.report_title : '这条任务的全部运行记录'}
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => auditQuery.refetch()}>
            刷新
          </Button>
        }
      />

      {/* 一行筛选：事件类型 + 追踪号（图例/说明都收进悬停提示） */}
      <div className="toolbar">
        <Select
          allowClear
          size="small"
          placeholder="事件类型"
          style={{ minWidth: 150 }}
          value={eventType}
          onChange={(value) => setEventType(value)}
          options={EVENT_TYPES.map((type) => ({ label: AUDIT_EVENT_TYPE_LABEL[type], value: type }))}
        />
        <Input
          size="small"
          allowClear
          placeholder="按追踪号查（trace id）"
          style={{ width: 280 }}
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
        />
        <span className="toolbar__divider" />
        <span className="toolbar__count">
          <Tooltip title="只显示这条任务产生的事件；追踪号是模型调用链路，给工程师排查时用">
            {events.length} 条记录 ⓘ
          </Tooltip>
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <Space>
            <Button
              size="small"
              type="text"
              onClick={() => {
                setEventType(undefined)
                setTraceId('')
              }}
            >
              重置筛选
            </Button>
          </Space>
        </div>
      </div>

      {taskQuery.isError ? (
        <ErrorState error={taskQuery.error} onRetry={() => taskQuery.refetch()} />
      ) : auditQuery.isLoading ? (
        <LoadingBlock rows={6} />
      ) : auditQuery.isError ? (
        <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} />
      ) : (
        <AuditEventTable
          events={events}
          loading={auditQuery.isFetching}
          emptyHint={eventType || traceId ? '当前筛选下没有记录，换个条件试试' : '这条任务还没有产生运行记录'}
        />
      )}
    </div>
  )
}
