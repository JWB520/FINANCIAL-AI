/**
 * pages/task-run/TaskRunPage.tsx —— 核查执行（进度页）
 *
 * 【用户在几分钟的等待里，最想知道三件事，这一页就按这个顺序排】
 *   1. 到哪一步了？      → 总进度条（加权进度，不是阶段数平均）+ 阶段列表
 *   2. 卡在哪、为什么？  → 失败阶段标红 + 原因 + "重试该阶段"
 *   3. 我能不能不等了？  → "终止任务"（已完成阶段的产物会保留，之后可以只补跑没跑完的）
 *
 * 【连接断了怎么办（这是最容易做砸的地方）】
 *   实时连接断了不会静默：页面顶部会显示"已切换为轮询"，并且数字仍在自动刷新。
 *   绝不出现"进度条停在 65% 一动不动、用户不知道是卡住了还是没连上"这种情况。
 *
 * 【本文件导出】TaskRunPage 组件（默认导出）
 */
import { useEffect, useState } from 'react'
import { Alert, App as AntdApp, Button, Card, Col, Progress, Row, Space, Statistic, Tag, Tooltip } from 'antd'
import { ArrowLeftOutlined, AuditOutlined, CheckCircleOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { taskApi, TERMINAL_TASK_STATUS, type StageCode } from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { TaskStatusTag } from '@/shared/ui/StatusTags'
import { TaskProgressList } from '@/features/task-progress/TaskProgressList'
import { useTaskProgress } from '@/features/task-progress/useTaskProgress'
import { formatDuration } from '@/shared/utils/format'
import { useGoBack } from '@/shared/hooks/useGoBack'

export default function TaskRunPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { message, modal } = AntdApp.useApp()
  const { task, stages, counters, connection, degradedReason, isLoading, error, refresh } = useTaskProgress(taskId)
  const [retryingStage, setRetryingStage] = useState<StageCode | null>(null)

  // 每秒刷新一次"已耗时"，让用户看到任务确实在动（不是只有进度条在动）
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  /** 重试某个阶段：只补跑失败的那一步，已完成的不重跑 */
  const retryMutation = useMutation({
    mutationFn: (stageCode: StageCode) => taskApi.retryStage(taskId, stageCode),
    onMutate: (stageCode) => setRetryingStage(stageCode),
    onSuccess: () => {
      message.success('已重新提交该阶段，进度会继续往前跑')
      refresh()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '重试失败'),
    onSettled: () => setRetryingStage(null),
  })

  /** 终止任务：二次确认，并明确告知"已完成阶段的产物保留" */
  const cancelMutation = useMutation({
    mutationFn: () => taskApi.cancel(taskId, '用户手动终止'),
    onSuccess: () => {
      message.info('任务已终止，已完成阶段的结果保留在系统里')
      refresh()
    },
    onError: (error) => message.error((error as { userMessage?: string }).userMessage || '终止失败'),
  })

  // 本页是"点发送之后"的落点，也可能从项目界面/工作台重新进来：返回按历史回退，
  // 直接打开时退回这份报告的结果页（读不到 report_id 就回工作台）。
  // 位置必须在下面的提前 return 之前（hook 不能排在条件分支后面）。
  const goBack = useGoBack(task?.report_id ? '/errata/' + task.report_id + '/overview' : '/')

  // 区分"还在加载"与"查询失败"：以前只判断 !task，
  // 任务不存在时（后端 404）页面会永远停在加载骨架屏，用户看不到任何解释。
  if (isLoading) return <LoadingBlock rows={6} />
  if (error || !task) {
    return (
      <div className="page">
        <div style={{ marginBottom: 10 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回上一步
          </Button>
        </div>
        <ErrorState error={error} onRetry={refresh} />
      </div>
    )
  }

  const isRunning = task.status === 'running' || task.status === 'pending'
  const isFinished = TERMINAL_TASK_STATUS.includes(task.status)
  const elapsedMs = task.started_at ? new Date(task.finished_at ?? now).getTime() - new Date(task.started_at).getTime() : 0
  const failedStage = stages.find((stage) => stage.status === 'failed')

  return (
    <div className="page">
      <div style={{ marginBottom: 10 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
          返回上一步
        </Button>
      </div>
      <PageHeader
        title="核查执行"
        description={task.report_title}
        extra={
          <Space>
            <Button icon={<AuditOutlined />} onClick={() => navigate('/tasks/' + taskId + '/audit')}>
              审计日志
            </Button>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
            {isRunning ? (
              <Button
                danger
                icon={<StopOutlined />}
                loading={cancelMutation.isPending}
                onClick={() =>
                  modal.confirm({
                    title: '终止这次核查？',
                    content: '已完成阶段（如解析、拆解）的产物会保留，之后可以只补跑没跑完的阶段，不会从零开始。',
                    okText: '终止任务',
                    okButtonProps: { danger: true },
                    onOk: () => cancelMutation.mutateAsync(),
                  })
                }
              >
                终止任务
              </Button>
            ) : (
              // 结果入口按任务类型分流：评估任务的结果是"质量维度明细"，不是逐句勘误。
              // 以前这里写死勘误总览，评估任务跑完点进去看到的是另一套东西。
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() =>
                  navigate(task.kind === 'assessment' ? '/assessment/' + task.report_id : '/errata/' + task.report_id + '/overview')
                }
              >
                查看结果
              </Button>
            )}
          </Space>
        }
      />

      {/* 连接状态提示：实时连接中断时明确告知（已自动降级为轮询，数字仍会刷新） */}
      {connection === 'polling' && degradedReason ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={degradedReason} />
      ) : null}

      {/* 任务失败/部分失败：说明发生了什么、哪些还能用 */}
      {task.status === 'partial_failed' || task.status === 'failed' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={task.status === 'partial_failed' ? '部分失败：已有可用结论，但有个别维度没跑成' : '任务失败'}
          description={
            <div>
              <div>{task.message || '请查看下方失败阶段的具体原因。'}</div>
            </div>
          }
        />
      ) : null}

      {/* ---------- 总览：进度 + 计数 ---------- */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} lg={10}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <TaskStatusTag status={task.status} />
              <span className="meta-text">
                {connection === 'live' ? '实时更新中' : connection === 'polling' ? '轮询更新中' : '连接中…'}
              </span>
              {task.trace_id ? (
                <Tooltip title="报障时把这个追踪号给工程师，能查到整个任务的日志">
                  <Tag className="num" style={{ fontSize: 11 }}>
                    trace {task.trace_id.slice(0, 8)}
                  </Tag>
                </Tooltip>
              ) : null}
            </div>
            <Progress
              percent={task.progress}
              status={failedStage ? 'exception' : isFinished && task.status === 'completed' ? 'success' : 'active'}
            />
            <div className="meta-text" style={{ marginTop: 4 }}>
              {task.message || (isRunning ? '正在执行…' : '已结束')}
              {task.started_at ? ' · 耗时 ' + formatDuration(elapsedMs) : ''}
            </div>
          </Col>

          <Col xs={24} lg={14}>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="已拆出主张" value={counters?.claims_total ?? 0} valueStyle={{ fontSize: 20 }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="高风险"
                  value={counters?.findings_high ?? 0}
                  valueStyle={{ fontSize: 20, color: '#cf1322' }}
                />
              </Col>
              <Col span={6}>
                <Statistic title="中风险" value={counters?.findings_medium ?? 0} valueStyle={{ fontSize: 20, color: '#d46b08' }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="未覆盖"
                  value={counters?.uncovered ?? 0}
                  valueStyle={{ fontSize: 20, color: '#8c8c8c' }}
                  suffix={
                    <Tooltip title="本次没查到（缺资料或数据源不可用）。未覆盖不等于通过。">
                      <span className="meta-text" style={{ fontSize: 11 }}>
                        ?
                      </span>
                    </Tooltip>
                  }
                />
              </Col>
            </Row>
          </Col>
        </Row>
      </Card>

      {/* ---------- 阶段列表 ---------- */}
      <div className="meta-text" style={{ marginBottom: 8 }}>
        <Tooltip title="点开某阶段看日志摘要；失败的阶段可以直接重试">流水线阶段</Tooltip>
      </div>
      {stages.length ? (
        <TaskProgressList stages={stages} onRetry={(code) => retryMutation.mutate(code)} retrying={retryingStage} />
      ) : (
        <LoadingBlock rows={4} />
      )}

      {/* 彩蛋功能：运行中可以顺手看已经产出的结论（不用等全部跑完） */}
      {counters && counters.findings_high + counters.findings_medium > 0 ? (
        <Card size="small" style={{ marginTop: 12 }} title="已经产出的高/中风险结论">
          <Space>
            {/* 同一条规则：评估任务去评估明细，勘误任务去带筛选项的复核裁决页 */}
            <Button
              onClick={() =>
                navigate(
                  task.kind === 'assessment'
                    ? '/assessment/' + task.report_id
                    : '/reviews/' + task.report_id + '/review?risk=high,medium'
                )
              }
            >
              {task.kind === 'assessment' ? '去看评估明细' : '现在就看高风险与中风险'}
            </Button>
          </Space>
        </Card>
      ) : null}
    </div>
  )
}
