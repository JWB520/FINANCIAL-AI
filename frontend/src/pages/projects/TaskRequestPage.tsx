/**
 * pages/projects/TaskRequestPage.tsx —— 发起任务（勘误 / 评估）的表单页
 *
 * 【它解决什么问题】
 *   项目界面点了"勘误"或"评估"之后，用户得先交代清楚"查什么、查哪儿、有没有特别要看的"，
 *   否则跑出来的东西只能是一份"通用体检报告"。所以这一页把话说清楚：
 *     勘误：选类型（多选/全选，勾了才显示预估时长）→ 每项可填分项备注 → 用页码圈定范围 → 任务备注 → 发送
 *     评估：选类型（同样有分项备注）→ 选深度 → 任务备注 → 发送
 *
 * 【三个刻意的设计】
 *   1. **勾选后立刻显示预估时长** —— 用户要拿它决定"少勾两项还是多等十分钟"；
 *   2. **分项备注只对勾选项出现** —— 没勾的项不需要备注，避免一屏全是输入框；
 *   3. **发送前先把请求写进项目文件夹**（`data/tasks/`）—— 后端没接的时候这是唯一真实的落点，
 *      接了后端之后它也是"这次任务是谁、用什么参数发的"的本地凭证。
 *
 * 【本文件定义】
 *   TaskRequestPage      组件（默认导出）
 *   OptionRow            单个类型选项（勾选框 + 说明 + 时长 + 分项备注）
 *   minutesText()        把分钟数说成人话（如 "约 25 分钟 / 约 1 小时"）
 */
import { useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Checkbox, Input, InputNumber, Radio, Space, Tag, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, SendOutlined } from '@ant-design/icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { taskApi } from '@/api'
import { desktop, type TaskKind } from '@/api/local/desktop'
import { useLocalProject } from '@/features/project/useLocalProject'
import {
  ERRATA_CATALOG,
  ERRATA_ALL_OPTIONS,
  estimateErrataMinutes,
  type ErrataOption,
} from '@/features/task-request/errataCatalog'
import {
  ASSESSMENT_CATALOG,
  ASSESSMENT_ALL_OPTIONS,
  ASSESSMENT_DEPTHS,
  estimateAssessmentMinutes,
  type AssessmentOption,
} from '@/features/task-request/assessmentCatalog'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'

/** 把分钟数说成人话：80 分钟比"1 小时 20 分"更难读 */
function minutesText(minutes: number): string {
  if (minutes <= 0) return '—'
  if (minutes < 60) return '约 ' + minutes + ' 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? '约 ' + hours + ' 小时 ' + rest + ' 分' : '约 ' + hours + ' 小时'
}

/** 单个类型选项：勾选框 + 名称 + 一句话说明 + 单耗时；勾上后出现分项备注 */
function OptionRow(props: {
  option: ErrataOption | AssessmentOption
  checked: boolean
  note: string
  onToggle: (checked: boolean) => void
  onNoteChange: (note: string) => void
}) {
  const { option, checked, note, onToggle, onNoteChange } = props
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #f7f8fa' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Checkbox checked={checked} onChange={(event) => onToggle(event.target.checked)} style={{ marginTop: 3 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5 }}>
            {option.name}
            <span className="meta-text" style={{ marginLeft: 8 }}>
              约 {option.minutes} 分钟
            </span>
          </div>
          <div className="meta-text">{option.hint}</div>
        </div>
      </div>

      {checked ? (
        <div style={{ marginTop: 8, marginLeft: 26 }}>
          <Input.TextArea
            rows={1}
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="这一项有什么特别要关注的？（可空）"
          />
        </div>
      ) : null}
    </div>
  )
}

export default function TaskRequestPage() {
  const { projectId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const kind = (searchParams.get('kind') === 'assessment' ? 'assessment' : 'errata') as TaskKind
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()

  const { config, report, isLoading, error, refetch } = useLocalProject(projectId)

  /** 勾选的类型、每项的分项备注 */
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  /** 勘误范围（页码）与评估深度 */
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard')
  /** 本次任务的总体备注 */
  const [taskNote, setTaskNote] = useState('')

  /** 读研报元信息：用来做页码上下限与"共 N 页"的显示 */
  const metaQuery = useQuery({
    queryKey: ['report-meta', config?.report_path],
    queryFn: () => desktop.reportMeta(config!.report_path),
    enabled: Boolean(config?.report_path) && desktop.isDesktop(),
    retry: false,
  })
  const totalPages = metaQuery.data?.pages ?? null

  const catalog = kind === 'errata' ? ERRATA_CATALOG : ASSESSMENT_CATALOG
  const allOptions: Array<ErrataOption | AssessmentOption> = kind === 'errata' ? ERRATA_ALL_OPTIONS : ASSESSMENT_ALL_OPTIONS

  /** 有效范围：没设置过就默认整篇 */
  const effectiveRange = useMemo(() => {
    if (kind !== 'errata') return null
    if (range) return range
    return { from: 1, to: totalPages && totalPages > 0 ? totalPages : 1 }
  }, [kind, range, totalPages])

  /** 预估耗时：勘误随页码范围缩放，评估随深度成倍 */
  const minutes = useMemo(() => {
    if (kind === 'errata') return estimateErrataMinutes(selected, effectiveRange, totalPages)
    return estimateAssessmentMinutes(selected, depth)
  }, [kind, selected, effectiveRange, totalPages, depth])

  const nameOf = (code: string) => allOptions.find((option) => option.code === code)?.name ?? code

  const toggle = (code: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, code] : prev.filter((item) => item !== code)))
    if (!checked) setNotes((prev) => ({ ...prev, [code]: '' }))
  }

  /** 发送：先写本地留档，再提交后端任务，最后跳进度页 */
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error('项目信息还没加载出来')
      if (!selected.length) throw new Error('请至少勾选一项')
      const request = {
        project_id: projectId,
        project_name: config.name,
        report_path: config.report_path,
        knowledge_dir: config.knowledge_dir,
        report_id: report?.id ?? null,
        kind,
        types: selected.map((code) => ({ code, name: nameOf(code), note: notes[code]?.trim() || null })),
        page_range: kind === 'errata' ? effectiveRange : null,
        total_pages: kind === 'errata' ? totalPages : null,
        depth: kind === 'assessment' ? depth : null,
        note: taskNote.trim() || null,
        estimated_minutes: minutes,
        submitted_at: new Date().toISOString(),
      }
      // ① 本地留档（用户能在项目文件夹里看到自己发过什么）
      const archivePath = await desktop.saveTaskRequest({ projectId, kind, request })
      // ② 勘误：落点是"PDF 批注页"，**不进后端任务队列**。
      //    原因：后端的任务编排（parse / claim_split / check 五阶段）还是骨架，
      //    发过去只会拿回 501；而勘误这条链路本身是自包含的（/errata/run）。
      //    等任务编排做完了，把这两行换回 taskApi.submit() + 进度页即可。
      if (kind === 'errata') return { task: null, archivePath }
      // ③ 评估：仍走后端任务（保持既有行为不变）
      const task = await taskApi.submit(request)
      return { task, archivePath }
    },
    onSuccess: ({ task, archivePath }) => {
      message.success('任务已发送（本地留档：' + archivePath + '）')
      if (kind === 'errata') {
        // 勾选项与页码范围带进 URL：刷新这一页就能复现同一次勘误
        const params = new URLSearchParams({ types: selected.join(',') })
        if (effectiveRange) {
          params.set('from', String(effectiveRange.from))
          params.set('to', String(effectiveRange.to))
        }
        navigate('/errata/' + projectId + '/annotate?' + params.toString())
        return
      }
      if (task) navigate('/tasks/' + task.id + '/run')
    },
    onError: (err) => message.error((err as Error).message || '发送失败'),
  })

  if (isLoading) return <LoadingBlock rows={6} />
  if (error || !config) {
    return (
      <div className="page">
        {/* 重试要真的重试：以前这里 onRetry 是"回工作台"，
            用户点"重试"却被踢出这一页，任务单也得重填一遍 */}
        <ErrorState error={error} onRetry={refetch} />
      </div>
    )
  }

  const kindName = kind === 'errata' ? '勘误' : '评估'

  return (
    <div className="page">
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects/' + projectId)} style={{ marginBottom: 10 }}>
          返回项目
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          发起{kindName}任务
        </Typography.Title>
        <div className="meta-text" style={{ marginTop: 4 }}>
          {config.name} · {config.report_path.split(/[\\/]/).pop()}
          {kind === 'errata' && totalPages ? '（共 ' + totalPages + ' 页）' : ''}
        </div>
      </div>

      {/* 工具条：勾选数 + 预估时长 + 全选/清空 */}
      <div className="toolbar">
        <span className="toolbar__count">
          已选 {selected.length} / {allOptions.length} 项
        </span>
        <span className="toolbar__divider" />
        <Tooltip title="预估时长按勾选的项目累加；勘误还会按你选的页码范围等比缩放">
          <Tag color={minutes ? 'blue' : 'default'}>预计 {minutesText(minutes)}</Tag>
        </Tooltip>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <a onClick={() => setSelected(allOptions.map((option) => option.code))}>全选</a>
          <a
            onClick={() => {
              setSelected([])
              setNotes({})
            }}
          >
            清空
          </a>
        </div>
      </div>

      <div className="form-split">
        {/* 左：类型清单（自己内部滚动，不带动整页） */}
        <div className="form-split__main">
          {catalog.map((group) => (
            <Card key={group.category} size="small" title={group.category} style={{ marginBottom: 12 }}>
              {group.items.map((option) => (
                <OptionRow
                  key={option.code}
                  option={option}
                  checked={selected.includes(option.code)}
                  note={notes[option.code] ?? ''}
                  onToggle={(checked) => toggle(option.code, checked)}
                  onNoteChange={(value) => setNotes((prev) => ({ ...prev, [option.code]: value }))}
                />
              ))}
            </Card>
          ))}
        </div>

        {/* 右：范围 / 深度 / 任务备注 / 发送（吸顶不动，勾选时始终在眼前） */}
        <div className="form-side">
          <Card
            size="small"
            style={{ marginBottom: 12 }}
            title={
              kind === 'errata' ? (
                <>
                  勘误范围
                  {/* 页数读不到时的兜底说明收进悬停提示：它只在个别文件上出现，不该常驻占屏 */}
                  <Tooltip title="读不到页数时请按实际页数填写；不确定就填大一点">
                    <span style={{ marginLeft: 6, cursor: 'help', color: '#bfbfbf' }}>ⓘ</span>
                  </Tooltip>
                </>
              ) : (
                '评估深度'
              )
            }
          >
            {kind === 'errata' ? (
              <div>
                <Space wrap>
                  <span className="meta-text">从</span>
                  <InputNumber
                    min={1}
                    max={totalPages ?? undefined}
                    value={effectiveRange?.from ?? 1}
                    onChange={(value) =>
                      setRange({ from: Number(value ?? 1), to: Math.max(Number(value ?? 1), effectiveRange?.to ?? 1) })
                    }
                    style={{ width: 80 }}
                  />
                  <span className="meta-text">页 到</span>
                  <InputNumber
                    min={1}
                    max={totalPages ?? undefined}
                    value={effectiveRange?.to ?? 1}
                    onChange={(value) => {
                      // 保证结束页 >= 起始页：以前只改 to，用户可以把范围改成"第 10 页到第 3 页"
                      // 并一路提交上去（后端拿到的是无效区间）。
                      const from = effectiveRange?.from ?? 1
                      const to = Number(value ?? 1)
                      setRange({ from, to: Math.max(from, to) })
                    }}
                    style={{ width: 80 }}
                  />
                  <span className="meta-text">页</span>
                </Space>
                <div style={{ marginTop: 10 }}>
                  <Space>
                    <Button
                      size="small"
                      onClick={() => setRange({ from: 1, to: totalPages && totalPages > 0 ? totalPages : effectiveRange?.to ?? 1 })}
                    >
                      全部页面
                    </Button>
                    <Button size="small" onClick={() => setRange({ from: 1, to: 5 })}>
                      仅前 5 页
                    </Button>
                    <Button size="small" onClick={() => setRange(null)}>
                      恢复默认
                    </Button>
                  </Space>
                </div>
              </div>
            ) : (
              <Radio.Group value={depth} onChange={(event) => setDepth(event.target.value)}>
                <Space direction="vertical">
                  {ASSESSMENT_DEPTHS.map((item) => (
                    <Radio key={item.code} value={item.code}>
                      {/* 三档深度的说明改成悬停显示：三行小字铺在选项旁边，会把"选哪个"淹掉 */}
                      <Tooltip title={item.hint}>
                        <span style={{ fontSize: 13.5 }}>{item.name}</span>
                      </Tooltip>
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            )}
          </Card>

          <Card size="small" title="任务备注（可空）" style={{ marginBottom: 12 }}>
            <Input.TextArea
              rows={3}
              value={taskNote}
              onChange={(event) => setTaskNote(event.target.value)}
              placeholder="这次任务的背景或关注点，例如：客户重点关注产能与客户集中度"
            />
          </Card>

          <Card size="small">
            {/* 发送后的三件事（本地留档 / 提交任务 / 跳进度页）移进帮助文档《发起任务之后会怎样》，
                这里只留一条最关键的悬停提示：参数会在本地留痕，用户找得到 */}
            <Tooltip title="本次任务参数会留档到项目文件夹 data\tasks\">
              <Button
                type="primary"
                size="large"
                block
                icon={<SendOutlined />}
                disabled={!selected.length}
                loading={submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                发送{kindName}任务
              </Button>
            </Tooltip>
            {!selected.length ? (
              <div className="meta-text" style={{ marginTop: 8, textAlign: 'center' }}>
                至少勾选一项
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}
