/**
 * pages/reviews/ClaimQueuePage.tsx —— 复核队列（第二层：主张级）
 *
 * 【这一页的目标：让用户在前 20% 的条目里覆盖 80% 的风险】
 *   所以默认排序是"风险降序 → 有证据优先 → 原文顺序"（由后端写死，前端不传排序参数，
 *   免得不同页面口径不一致）。用户从上往下处理即可，不用自己判断先看哪条。
 *
 * 【批量操作只开放一个】
 *   批量"标记已核实"：低风险/通过项成批处理，效率提升明显；
 *   **批量驳回是被刻意禁止的** —— 驳回必须逐条给理由，理由不齐的驳回对经验学习毫无价值，
 *   等于批量制造噪声（这条规则前后端都做了拦截）。
 *
 * 【本文件导出】ClaimQueuePage 组件（默认导出）
 */
import { useState } from 'react'
import { Alert, App as AntdApp, Button, Card, Collapse, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { reviewApi, type ClaimQueueRow } from '@/api'
import { desktop } from '@/api/local/desktop'
import { formatDateTime, formatNumber } from '@/shared/utils/format'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ReportLineNav } from '@/features/report-nav/ReportLineNav'
import { EmptyState, ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { ClaimTypeTag, FindingStatusTag, ReviewStateTag, RiskTag } from '@/shared/ui/StatusTags'
import { useUrlState, parseMulti, stringifyMulti } from '@/shared/hooks/useUrlState'
import { useGoBack } from '@/shared/hooks/useGoBack'

/** 三方判定的中文说法（机器 / AI 复核 / 人工）—— 三行并排就是这条批注的完整推理链 */
const MACHINE_LABEL: Record<string, string> = {
  risk: '有问题',
  pass: '复算一致',
  uncovered: '待人工确认',
  error: '核查失败',
}
const AI_LABEL: Record<string, string> = {
  report_error: '原文有误',
  consistent: '只是四舍五入',
  tool_mispair: '机器配错',
  unclear: '判断不了',
}

export default function ClaimQueuePage() {
  const { reportId = '' } = useParams()
  const navigate = useNavigate()
  const { message, modal } = AntdApp.useApp()
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [filters, setFilters] = useUrlState({ risk: '', status: '', page: '1' })

  const query = useQuery({
    queryKey: ['reviews', reportId, 'queue', { ...filters }],
    queryFn: () =>
      reviewApi.queue(reportId, {
        risk: parseMulti(filters.risk),
        status: parseMulti(filters.status),
        page: Number(filters.page || 1),
        page_size: 50,
      }),
  })

  // 本页从项目界面 / 复核裁决 / 勘误结果都进得来，所以"返回"按历史回退；
  // 直接打开（没有应用内历史）时退回这份报告的勘误结果页，拿不到就回工作台。
  const goBack = useGoBack('/errata/' + reportId + '/overview')

  /** 批量标记已核实（只允许这一个批量动作） */
  const batchMutation = useMutation({
    mutationFn: (claimIds: string[]) => reviewApi.batchVerify(reportId, claimIds, '批量核实'),
    onSuccess: (result) => {
      message.success('已批量核实 ' + result.updated + ' 条')
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      queryClient.invalidateQueries({ queryKey: ['claims'] })
      query.refetch()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '批量操作失败'),
  })

  const rows = query.data?.items ?? []

  /** 本机保存的「勘误人工裁决」记录（在勘误批注页点"保存结果"落盘的那些）。
   *  它不是后端数据而是桌面端本地文件 —— 放在复核这一页，复核时不必再翻 PDF 逐条找。 */
  const localReviews = useQuery({
    queryKey: ['errata-reviews', 'local'],
    queryFn: () => desktop.listErrataReviews(),
    enabled: desktop.isDesktop(),
    retry: false,
  })
  // 只有"待复核"的行才允许被选中核实（已裁决过的不用再动）
  const selectableIds = rows.filter((row) => row.review_state === 'pending').map((row) => row.claim_id)

  return (
    <div className="page">
      <div style={{ marginBottom: 10 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
          返回上一步
        </Button>
      </div>
      <PageHeader
        title="复核队列"
        description="按风险从高到低排；低风险项可批量核实"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => query.refetch()}>
              刷新
            </Button>
          </Space>
        }
      >
        <ReportLineNav reportId={reportId} />
      </PageHeader>

      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Space wrap size={16}>
        <Select
          mode="multiple"
          allowClear
          size="small"
          placeholder="风险"
          style={{ minWidth: 116 }}
          value={parseMulti(filters.risk)}
          onChange={(values) => setFilters({ risk: stringifyMulti(values as string[]), page: '1' })}
          options={[
            { label: '高风险', value: 'high' },
            { label: '中风险', value: 'medium' },
            { label: '低风险', value: 'low' },
          ]}
        />
        <Select
          mode="multiple"
          allowClear
          size="small"
          placeholder="结论状态"
          style={{ minWidth: 140 }}
          value={parseMulti(filters.status)}
          onChange={(values) => setFilters({ status: stringifyMulti(values as string[]), page: '1' })}
          options={[
            { label: '有问题', value: 'risk' },
            { label: '通过', value: 'pass' },
            { label: '未覆盖', value: 'uncovered' },
            { label: '失败', value: 'error' },
          ]}
        />
        <span className="toolbar__count">共 {query.data?.total ?? 0} 条</span>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="meta-text">
              已选 {selectedIds.length} 条（可批量核实的共 {selectableIds.length} 条）
            </span>
            <Tooltip title="只开放这一个批量动作：驳回必须逐条给理由，理由不齐的驳回等于制造噪声">
              <Button
                type="primary"
                disabled={!selectedIds.length}
                loading={batchMutation.isPending}
                onClick={() =>
                  modal.confirm({
                    title: '批量标记为已核实？',
                    content: '将对选中的 ' + selectedIds.length + ' 条结论写入"已核实"记录（可追溯谁在什么时候核实的）。',
                    onOk: () => batchMutation.mutateAsync(selectedIds),
                  })
                }
              >
                批量标记已核实
              </Button>
            </Tooltip>
          </div>
        </Space>
      </Card>

      {/* 本机保存的勘误裁决：机器判断 / AI 复核 / 人的判断与备注，一次裁决一条记录 */}
      {desktop.isDesktop() ? (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          styles={{ body: { padding: 12 } }}
          title={
            <Space size={8}>
              <span>本机保存的勘误裁决</span>
              <Tag color="blue">{localReviews.data?.length ?? 0} 条记录</Tag>
            </Space>
          }
        >
          {localReviews.isLoading ? (
            <Typography.Text type="secondary">正在读取本地裁决记录…</Typography.Text>
          ) : localReviews.isError ? (
            <Alert
              type="error"
              showIcon
              message="读取本地裁决记录失败"
              description={(localReviews.error as Error)?.message || '请确认桌面端工作区可读（见设置页）'}
              action={
                <Button size="small" onClick={() => void localReviews.refetch()}>
                  重试
                </Button>
              }
            />
          ) : !localReviews.data?.length ? (
            <Typography.Text type="secondary">
              还没有裁决记录。在「勘误批注」页对每条做保留 / 舍弃（可加备注）并点「保存结果」，记录就会出现在这里。
            </Typography.Text>
          ) : (
            <Collapse
              ghost
              items={localReviews.data.map((record) => {
                const file = record.file
                return {
                  key: file || record.saved_at,
                  label: (
                    <Space size={8} wrap>
                      <span style={{ fontWeight: 600 }}>{record.report_name}</span>
                      <Tag>{record.project_name || '未知项目'}</Tag>
                      <Tag>共 {record.stats.total} 条</Tag>
                      <Tag color="green">保留 {record.stats.keep}</Tag>
                      <Tag color="red">舍弃 {record.stats.discard}</Tag>
                      {record.stats.undecided ? <Tag color="orange">未判 {record.stats.undecided}</Tag> : null}
                      <span className="meta-text">{formatDateTime(record.saved_at)}</span>
                    </Space>
                  ),
                  children: (
                    <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                      {record.items.map((item, index) => (
                        <div
                          key={item.id}
                          style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #f0f0f0' }}
                        >
                          <Space size={6} wrap>
                            <span style={{ fontWeight: 600 }}>#{index + 1}</span>
                            <Tag color="blue">第 {item.page} 页</Tag>
                            <Tag color={item.machine.status === 'risk' ? 'red' : item.machine.status === 'pass' ? 'green' : 'default'}>
                              机器：{MACHINE_LABEL[item.machine.status] || item.machine.status}
                            </Tag>
                            {item.ai.review_verdict ? (
                              <Tag color="purple">AI 复核：{AI_LABEL[item.ai.review_verdict] || item.ai.review_verdict}</Tag>
                            ) : null}
                            <Tag
                              color={
                                item.human.verdict === 'keep' ? 'green' : item.human.verdict === 'discard' ? 'red' : 'orange'
                              }
                            >
                              人工：
                              {item.human.verdict === 'keep' ? '保留' : item.human.verdict === 'discard' ? '舍弃' : '未判'}
                            </Tag>
                          </Space>
                          <div style={{ color: 'var(--ink-2)' }}>{item.statement}</div>
                          {item.expression ? (
                            <div className="meta-text">
                              算式 <span className="num">{item.expression}</span>｜机器算出{' '}
                              <span className="num">
                                {formatNumber(item.computed)}
                                {item.unit}
                              </span>{' '}
                              vs 原文写{' '}
                              <span className="num">
                                {formatNumber(item.claimed)}
                                {item.unit}
                              </span>
                            </div>
                          ) : null}
                          {item.machine.conclusion ? (
                            <div className="meta-text">机器结论：{item.machine.conclusion}</div>
                          ) : null}
                          {item.ai.review_note ? (
                            <div style={{ color: '#2f54eb' }}>AI 备注：{item.ai.review_note}</div>
                          ) : null}
                          {item.human.note ? (
                            <div style={{ color: '#389e0d' }}>人工备注：{item.human.note}</div>
                          ) : null}
                        </div>
                      ))}
                      {file ? (
                        <Button
                          size="small"
                          type="text"
                          icon={<FolderOpenOutlined />}
                          onClick={() => void desktop.openInExplorer(file)}
                        >
                          打开记录文件所在文件夹
                        </Button>
                      ) : null}
                    </div>
                  ),
                }
              })}
            />
          )}
        </Card>
      ) : null}

      {query.isLoading ? (
        <LoadingBlock rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState description="当前筛选下没有待处理的结论。可以清空筛选，或者换一份报告。" />
      ) : (
        <Table<ClaimQueueRow>
          rowKey="claim_id"
          size="small"
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
            getCheckboxProps: (row) => ({ disabled: row.review_state !== 'pending' }),
          }}
          pagination={{
            current: Number(filters.page || 1),
            pageSize: 50,
            total: query.data?.total ?? 0,
            showSizeChanger: false,
            onChange: (page) => setFilters({ page: String(page) }),
          }}
          columns={[
            {
              title: '风险',
              width: 90,
              render: (_v, row) => <RiskTag level={row.risk_level} />,
            },
            {
              title: '状态',
              width: 100,
              render: (_v, row) => <FindingStatusTag status={row.status} />,
            },
            {
              title: '结论（原文摘要）',
              render: (_v, row) => (
                <div>
                  <a onClick={() => navigate('/reviews/' + reportId + '/review?claim=' + row.claim_id)}>
                    {row.excerpt}
                  </a>
                  <div className="meta-text">
                    <ClaimTypeTag type={row.claim_type} />
                    <span style={{ marginLeft: 6 }}>{row.dimension_name}</span>
                    {row.has_evidence ? (
                      <Tag color="blue" style={{ marginLeft: 6 }}>
                        有证据
                      </Tag>
                    ) : (
                      <Tooltip title="没有证据的结论权重较低，请人工判断">
                        <Tag style={{ marginLeft: 6 }}>无证据</Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ),
            },
            {
              title: 'AI 建议',
              width: 260,
              render: (_v, row) => (
                <Tooltip title={row.suggestion ?? ''}>
                  <span className="meta-text">{row.suggestion ? row.suggestion.slice(0, 40) + '…' : '—'}</span>
                </Tooltip>
              ),
            },
            {
              title: '复核状态',
              width: 130,
              render: (_v, row) => <ReviewStateTag state={row.review_state} />,
            },
            {
              title: '操作',
              width: 160,
              fixed: 'right',
              render: (_v, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => navigate('/reviews/' + reportId + '/review?claim=' + row.claim_id)}
                  >
                    逐条裁决
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      )}

      {/* 队列排序与处理顺序的建议移进帮助文档《复核顺序建议与操作要点》 */}

    </div>
  )
}
