/**
 * pages/learning/LearningPage.tsx —— 经验学习（系统会越用越准，但判据由人掌握）
 *
 * 【三步闭环，也就是这一页的三个页签】
 *   经验案例 ← 每次人工裁决（尤其是「驳回 AI + 写理由」）都会沉淀成一条案例
 *   学习候选 ← 系统从案例里归纳出「规则/提示词该怎么改」的建议（**不会自动生效**）
 *   已发布版本 ← 人点发布才生效，版本化、可回滚
 *
 * 【为什么"来源"要摆在最显眼的位置】
 *   看不到来源的候选，用户是不敢批的。所以每条候选下面都列出它来自哪几条人工裁决。
 *
 * 【本文件定义】
 *   LearningPage  组件（默认导出）
 *   renderCandidate()  候选卡片（内容 + 来源 + 影响维度 + 审核按钮）
 */
import { useState } from 'react'
import { App as AntdApp, Button, Card, Descriptions, Form, Input, Modal, Space, Table, Tabs, Tag, Tooltip } from 'antd'
import { CheckOutlined, DeleteOutlined, ReloadOutlined, RollbackOutlined, StopOutlined } from '@ant-design/icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  learningApi,
  CASE_TYPE_LABEL,
  CANDIDATE_STATE_LABEL,
  CANDIDATE_TYPE_LABEL,
  type ExperienceCase,
  type LearningCandidate,
  type RuleVersion,
} from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState, ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { formatDateTime } from '@/shared/utils/format'

export default function LearningPage() {
  const { message, modal } = AntdApp.useApp()
  const [tab, setTab] = useState('candidates')
  const [rejecting, setRejecting] = useState<LearningCandidate | null>(null)
  const [rejectForm] = Form.useForm<{ note: string }>()
  /** 删除弹窗里的理由输入（只有需要理由时才用） */
  const [removeForm] = Form.useForm<{ reason: string }>()

  const casesQuery = useQuery({ queryKey: ['learning', 'cases'], queryFn: () => learningApi.cases({ page: 1 }) })
  const candidatesQuery = useQuery({ queryKey: ['learning', 'candidates'], queryFn: () => learningApi.candidates({ page: 1 }) })
  const versionsQuery = useQuery({ queryKey: ['learning', 'versions'], queryFn: () => learningApi.versions({ page: 1 }) })

  /** 审核候选：通过=发布新版本并生效；驳回必须写理由（和驳回 AI 结论一个道理） */
  const reviewMutation = useMutation({
    mutationFn: (payload: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      learningApi.reviewCandidate(payload.id, payload.decision, payload.note),
    onSuccess: (_data, variables) => {
      message.success(variables.decision === 'approve' ? '已发布：生成新版本并置为生效中（旧版本自动归档）' : '已驳回候选')
      candidatesQuery.refetch()
      versionsQuery.refetch()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '操作失败'),
  })

  /** 回滚：不删历史，把旧版本内容生成为一个新的生效版本（审计链完整） */
  const rollbackMutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) => learningApi.rollback(payload.id, payload.reason),
    onSuccess: () => {
      message.success('已回滚：生成了一个新的生效版本（历史版本保留）')
      versionsQuery.refetch()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '回滚失败'),
  })

  /**
   * 删除（候选 / 案例 / 版本）。
   *
   * 【三条不同的规矩，后端也各自拦着】
   *   候选：只有还没审核过的能删（已通过/已驳回的是决策记录）
   *   版本：只有已归档的能删（生效中的删了系统就没判据了）
   *   案例：可以删
   * 删除一律写审计事件 —— 东西没了，但"谁在什么时候删的"查得到。
   */
  const removeMutation = useMutation({
    mutationFn: (payload: { kind: 'candidate' | 'case' | 'version'; id: string; reason?: string }) => {
      if (payload.kind === 'candidate') return learningApi.removeCandidate(payload.id, payload.reason)
      if (payload.kind === 'case') return learningApi.removeCase(payload.id)
      return learningApi.removeVersion(payload.id, payload.reason)
    },
    onSuccess: (result: unknown) => {
      const promoted = (result as { promoted?: { version: number } | null } | null)?.promoted
      if (promoted) {
        message.success('已删除。这条规则已自动切回 v' + promoted.version + ' 生效（系统不会没有判据）')
      } else {
        message.success('已删除（审计里留了痕，查得到是谁删的）')
      }
      candidatesQuery.refetch()
      casesQuery.refetch()
      versionsQuery.refetch()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '删除失败'),
  })

  /**
   * 二次确认后再删。
   *
   * 【三种东西，三种后果，弹窗要说清楚】
   *   候选：都能删；**已审核过的必须填理由**（它承载"当初为什么通过/驳回"的决策信息）
   *   案例：都能删，说清"不再参与后续归纳"即可
   *   版本：都能删；删"生效中"的那一版要提醒"会自动切回上一个版本"或"这条规则将退回默认判据"
   */
  const [removeTarget, setRemoveTarget] = useState<{
    kind: 'candidate' | 'case' | 'version'
    id: string
    version?: number
    /** 已审核候选 / 生效中版本 → 必须填理由 */
    requireReason: boolean
    /** 生效中的版本被删时，是否有历史版本可自动切回 */
    willPromote: boolean
  } | null>(null)

  const confirmRemove = (kind: 'candidate' | 'case' | 'version', row: LearningCandidate | ExperienceCase | RuleVersion) => {
    if (kind === 'candidate') {
      const candidate = row as LearningCandidate
      setRemoveTarget({ kind, id: candidate.id, requireReason: candidate.state !== 'pending', willPromote: false })
      return
    }
    if (kind === 'case') {
      setRemoveTarget({ kind, id: (row as ExperienceCase).id, requireReason: false, willPromote: false })
      return
    }
    const version = row as RuleVersion
    setRemoveTarget({
      kind,
      id: version.id,
      version: version.version,
      requireReason: version.state === 'active',
      willPromote: version.state === 'active',
    })
  }
  const candidates = candidatesQuery.data?.items ?? []
  const cases = casesQuery.data?.items ?? []
  const versions = versionsQuery.data?.items ?? []
  const pendingCount = candidates.filter((item) => item.state === 'pending').length

  /** 候选卡片：内容 + 来源裁决 + 影响维度 + 审核按钮 */
  const renderCandidate = (candidate: LearningCandidate) => (
    <Card
      key={candidate.id}
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space size={8}>
          <Tag color="blue">{CANDIDATE_TYPE_LABEL[candidate.type]}</Tag>
          <span className="meta-text">{formatDateTime(candidate.created_at)}</span>
        </Space>
      }
      extra={
        <Space>
          {candidate.state === 'pending' ? (
            <>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={reviewMutation.isPending}
              onClick={() =>
                modal.confirm({
                  title: '发布这条候选？',
                  content: '发布后生成一个新的规则版本并立即生效，旧版本自动归档（可随时回滚）。',
                  okText: '确认发布',
                  onOk: () => reviewMutation.mutateAsync({ id: candidate.id, decision: 'approve' }),
                })
              }
            >
              审核通过并发布
            </Button>
            <Button danger size="small" icon={<StopOutlined />} onClick={() => setRejecting(candidate)}>
              驳回
            </Button>
            </>
          ) : (
            <Tag color={candidate.state === 'approved' ? 'success' : 'default'}>{CANDIDATE_STATE_LABEL[candidate.state]}</Tag>
          )}
          <Tooltip
            title={
              candidate.state === 'pending'
                ? '删除这条还没审核的候选'
                : '删除这条已审核的候选（需要填理由，因为它记着当初为什么通过 / 驳回）'
            }
          >
            <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => confirmRemove('candidate', candidate)} />
          </Tooltip>
        </Space>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.9, marginBottom: 10 }}>{candidate.content}</div>

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="来源裁决">
          {(candidate.source_summaries ?? []).length
            ? (candidate.source_summaries ?? []).map((summary) => <div key={summary}>· {summary}</div>)
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="影响维度">
          <Space wrap size={4}>
            {candidate.impact_dimensions.map((dim) => (
              <Tag key={dim}>{dim}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
        {candidate.review_note ? <Descriptions.Item label="审核意见">{candidate.review_note}</Descriptions.Item> : null}
      </Descriptions>
    </Card>
  )

  return (
    <div className="page">
      <PageHeader
        title="经验学习"
        description="人工裁决 → 案例 → 修改候选 → 审核发布，可回滚"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                casesQuery.refetch()
                candidatesQuery.refetch()
                versionsQuery.refetch()
              }}
            >
              刷新
            </Button>
            <Button
              onClick={() =>
                learningApi.generateCandidates().then((result) => {
                  message.success('已触发候选生成，新增 ' + result.created + ' 条')
                  candidatesQuery.refetch()
                })
              }
            >
              手动生成候选
            </Button>
          </Space>
        }
      />

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'candidates',
            label: '学习候选（' + pendingCount + ' 条待审核）',
            children: candidatesQuery.isLoading ? (
              <LoadingBlock rows={5} />
            ) : candidatesQuery.isError ? (
              <ErrorState error={candidatesQuery.error} onRetry={() => candidatesQuery.refetch()} />
            ) : candidates.length ? (
              candidates.map(renderCandidate)
            ) : (
              <EmptyState description="还没有学习候选。多处理几条复核（尤其是驳回并写清理由），系统就会归纳出候选。" />
            ),
          },
          {
            key: 'cases',
            label: '经验案例（' + cases.length + ' 条）',
            children: casesQuery.isLoading ? (
              <LoadingBlock rows={5} />
            ) : (
              <Table<ExperienceCase>
                rowKey="id"
                size="small"
                dataSource={cases}
                pagination={false}
                columns={[
                  {
                    title: '类型',
                    dataIndex: 'case_type',
                    width: 160,
                    render: (value: ExperienceCase['case_type']) => (
                      <Tag color={value === 'ai_wrong' ? 'red' : value === 'ai_right' ? 'green' : 'blue'}>
                        {CASE_TYPE_LABEL[value]}
                      </Tag>
                    ),
                  },
                  { title: '案例摘要', dataIndex: 'summary' },
                  {
                    title: '标签',
                    dataIndex: 'labels',
                    width: 200,
                    render: (labels: string[]) => (
                      <Space size={4} wrap>
                        {labels.map((label) => (
                          <Tag key={label}>{label}</Tag>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    title: '时间',
                    dataIndex: 'created_at',
                    width: 150,
                    render: (value: string) => <span className="meta-text">{formatDateTime(value)}</span>,
                  },
                  {
                    title: '操作',
                    width: 90,
                    render: (_v, row) => (
                      <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => confirmRemove('case', row)}>
                        删除
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'versions',
            label: '已发布版本（可回滚）',
            children: versionsQuery.isLoading ? (
              <LoadingBlock rows={5} />
            ) : (
              <Table<RuleVersion>
                rowKey="id"
                size="small"
                dataSource={versions}
                pagination={false}
                columns={[
                  { title: '类型', dataIndex: 'kind', width: 110, render: (value: string) => <Tag>{value}</Tag> },
                  { title: '键', dataIndex: 'key', width: 160, render: (value: string) => <span className="num">{value}</span> },
                  { title: '版本', dataIndex: 'version', width: 80, render: (value: number) => <span className="num">v{value}</span> },
                  {
                    title: '状态',
                    dataIndex: 'state',
                    width: 100,
                    render: (value: RuleVersion['state']) => (
                      <Tag color={value === 'active' ? 'success' : value === 'canary' ? 'processing' : 'default'}>
                        {value === 'active' ? '生效中' : value === 'canary' ? '灰度' : '已归档'}
                      </Tag>
                    ),
                  },
                  { title: '内容', dataIndex: 'content', ellipsis: true },
                  {
                    title: '发布',
                    width: 190,
                    render: (_v, row) => (
                      <span className="meta-text">
                        {row.published_by} · {formatDateTime(row.published_at)}
                        {row.note ? <div>说明：{row.note}</div> : null}
                      </span>
                    ),
                  },
                  {
                    title: '操作',
                    width: 170,
                    render: (_v, row) =>
                      row.state === 'archived' ? (
                        <Space size={4}>
                        <Tooltip title="回滚不删历史：把该版本的内容生成为一个新的生效版本">
                          <Button
                            size="small"
                            icon={<RollbackOutlined />}
                            onClick={() =>
                              modal.confirm({
                                title: '回滚到 v' + row.version + '？',
                                content: (
                                  <div>
                                    <p>回滚会生成一个新的生效版本（历史版本仍保留）。</p>
                                    <Input.TextArea id="rollback-reason" rows={2} placeholder="回滚原因（必填）" />
                                  </div>
                                ),
                                onOk: () => {
                                  const input = document.getElementById('rollback-reason') as HTMLTextAreaElement | null
                                  const reason = input?.value?.trim()
                                  if (!reason) {
                                    message.warning('请填写回滚原因')
                                    return Promise.reject(new Error('no reason'))
                                  }
                                  return rollbackMutation.mutateAsync({ id: row.id, reason })
                                },
                              })
                            }
                          >
                            回滚
                          </Button>
                        </Tooltip>
                        <Tooltip title="删除这个历史版本（删了就不能再回滚到它）">
                          <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => confirmRemove('version', row)} />
                        </Tooltip>
                        </Space>
                      ) : (
                        <Tooltip title="删除生效中的版本：系统会自动把上一个历史版本切回生效，不会出现「没有判据」">
                          <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => confirmRemove('version', row)} />
                        </Tooltip>
                      ),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      {/* 驳回候选：理由必填（理由才是下一次归纳的原料） */}
      <Modal
        title="驳回候选"
        open={Boolean(rejecting)}
        okText="提交驳回"
        okButtonProps={{ danger: true, loading: reviewMutation.isPending }}
        onCancel={() => {
          setRejecting(null)
          rejectForm.resetFields()
        }}
        onOk={async () => {
          const values = await rejectForm.validateFields()
          if (rejecting) reviewMutation.mutate({ id: rejecting.id, decision: 'reject', note: values.note })
          setRejecting(null)
          rejectForm.resetFields()
        }}
      >
        <p className="meta-text" style={{ marginTop: 0 }}>
          驳回理由会记进候选记录（复盘时用）。
        </p>
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="note" label="驳回理由" rules={[{ required: true, message: '请填写理由' }]}>
            <Input.TextArea rows={3} placeholder="例如：样本太少，暂不调整规则；先再观察几条同类裁决" />
          </Form.Item>
        </Form>
      </Modal>
      {/* ---------- 删除确认：需要理由的（已审核候选 / 生效中版本）在这里填 ---------- */}
      <Modal
        title={
          removeTarget?.kind === 'candidate'
            ? '删除这条学习候选？'
            : removeTarget?.kind === 'case'
              ? '删除这条经验案例？'
              : '删除这个规则版本（v' + (removeTarget?.version ?? '') + '）？'
        }
        open={Boolean(removeTarget)}
        okText="删除"
        okButtonProps={{ danger: true, loading: removeMutation.isPending }}
        onCancel={() => {
          setRemoveTarget(null)
          removeForm.resetFields()
        }}
        onOk={async () => {
          if (!removeTarget) return
          let reason: string | undefined
          if (removeTarget.requireReason) {
            const values = await removeForm.validateFields()
            reason = values.reason
          }
          await removeMutation.mutateAsync({ kind: removeTarget.kind, id: removeTarget.id, reason })
          setRemoveTarget(null)
          removeForm.resetFields()
        }}
      >
        <div style={{ lineHeight: 1.9, marginBottom: 12 }}>
          {removeTarget?.kind === 'candidate' ? (
            removeTarget.requireReason ? (
              <>这条候选已经审核过，它记着"当初为什么通过 / 驳回"。删除前请写清理由 —— 理由会进审计，以后还查得到。</>
            ) : (
              <>这条候选还没审核过，删除后不再出现在列表里（删除动作本身会写进审计）。</>
            )
          ) : removeTarget?.kind === 'case' ? (
            <>案例删除后不再参与后续归纳；如果它已经被用进某条候选，那条候选不受影响。</>
          ) : removeTarget?.willPromote ? (
            <>这是<b>正在生效</b>的版本。删除后系统会自动把同一条规则的上一个历史版本切回生效；若已无历史版本，该规则退回默认判据。</>
          ) : (
            <>删除后不能再回滚到这个历史版本。</>
          )}
        </div>
        {removeTarget?.requireReason ? (
          <Form form={removeForm} layout="vertical">
            <Form.Item name="reason" label="删除理由（必填）" rules={[{ required: true, message: '请填写理由' }]}>
              <Input.TextArea rows={3} placeholder="例如：这条规则与最新合规要求冲突，先撤下再重做" />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  )
}