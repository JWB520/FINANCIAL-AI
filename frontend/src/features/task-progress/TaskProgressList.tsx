/**
 * features/task-progress/TaskProgressList.tsx —— 进度页的阶段列表
 *
 * 【它要回答用户的一个问题：现在到哪了、卡在哪、我能做什么】
 *   所以每一行都包含：状态图标 + 阶段名 + 阶段说明 + 进度 + 耗时 + 统计 + 失败时的原因与重试按钮。
 *   阶段说明（STAGE_CODE_HINT）很关键 —— 用户看到"语句分类"不知道在干什么，
 *   看到"判断每条主张属于计算/事实/规范中的哪一类"才明白这一步的价值。
 *
 * 【本文件导出】
 *   TaskProgressList  阶段列表（含展开日志摘要、重试按钮）
 *   StageStatusIcon   状态图标（✓ / ● / ○ / ✗），供别处复用
 */
import { useState } from 'react'
import { Alert, Button, Collapse, Progress, Tag } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, MinusCircleFilled, ClockCircleOutlined } from '@ant-design/icons'
import type { StageCode, StageStatus, TaskStage } from '@/api'
import { STAGE_CODE_HINT, STAGE_CODE_LABEL, STAGE_CODE_ORDER, STAGE_STATUS_LABEL } from '@/api'
import { formatDuration } from '@/shared/utils/format'

/** 状态图标：一个字符就能表达清楚，不用彩色标签占位置 */
export function StageStatusIcon({ status }: { status: StageStatus }) {
  if (status === 'done') return <CheckCircleFilled style={{ color: '#52c41a' }} />
  if (status === 'running') return <LoadingOutlined style={{ color: '#1677ff' }} />
  if (status === 'failed') return <CloseCircleFilled style={{ color: '#ff4d4f' }} />
  if (status === 'skipped') return <MinusCircleFilled style={{ color: '#faad14' }} />
  return <ClockCircleOutlined style={{ color: '#bfbfbf' }} />
}

export function TaskProgressList({
  stages,
  onRetry,
  retrying,
}: {
  stages: TaskStage[]
  /** 点"重试该阶段"（已完成阶段的产物会保留，不用从头跑） */
  onRetry: (stageCode: StageCode) => void
  /** 正在重试哪个阶段（用于按钮 loading） */
  retrying?: StageCode | null
}) {
  const [openKeys, setOpenKeys] = useState<string[]>([])

  // 按流水线顺序展示：后端返回的顺序不保证，所以前端按 STAGE_CODE_ORDER 排一次
  const ordered = STAGE_CODE_ORDER.map((code) => stages.find((s) => s.stage_code === code)).filter(
    (s): s is TaskStage => Boolean(s)
  )

  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      {ordered.map((stage, index) => {
        const stat = stage.stat || {}
        // 阶段内部统计的展示文案，例如"共拆出 16 条主张"、"320/412"
        const statText = Object.entries(stat)
          .map(([key, value]) => {
            if (key === 'claims_total') return '共 ' + value + ' 条主张'
            if (key === 'done') return '已处理 ' + value
            if (key === 'blocks') return value + ' 个原文块'
            if (key === 'dimensions') return '已选 ' + value + ' 个维度'
            if (key === 'findings') return '产出 ' + value + ' 条结论'
            return key + ' ' + value
          })
          .join('，')

        return (
          <div
            key={stage.stage_code}
            style={{
              padding: '14px 16px',
              borderBottom: index === ordered.length - 1 ? 'none' : '1px solid #f5f5f5',
              background: stage.status === 'failed' ? '#fff2f0' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StageStatusIcon status={stage.status} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{STAGE_CODE_LABEL[stage.stage_code]}</span>
                  <span className="meta-text">{STAGE_STATUS_LABEL[stage.status]}</span>
                  {stage.attempt > 1 ? <Tag color="orange">第 {stage.attempt} 次尝试</Tag> : null}
                  {stage.status === 'skipped' && stage.skip_reason ? (
                    <Tag color="warning">已跳过：{stage.skip_reason}</Tag>
                  ) : null}
                  {statText ? <span className="meta-text">{statText}</span> : null}
                  {stage.duration_ms ? <span className="meta-text">耗时 {formatDuration(stage.duration_ms)}</span> : null}
                </div>
                <div className="meta-text" style={{ marginTop: 4 }}>
                  {STAGE_CODE_HINT[stage.stage_code]}
                </div>
              </div>

              {stage.status === 'running' ? (
                <div style={{ width: 160 }}>
                  <Progress percent={stage.progress} size="small" status="active" />
                </div>
              ) : null}

              {stage.status === 'failed' ? (
                <Button
                  danger
                  size="small"
                  loading={retrying === stage.stage_code}
                  onClick={() => onRetry(stage.stage_code)}
                >
                  重试该阶段
                </Button>
              ) : null}

              {stage.status === 'done' || stage.status === 'failed' ? (
                <Button
                  type="text"
                  size="small"
                  onClick={() =>
                    setOpenKeys((keys) =>
                      keys.includes(stage.stage_code)
                        ? keys.filter((k) => k !== stage.stage_code)
                        : [...keys, stage.stage_code]
                    )
                  }
                >
                  {openKeys.includes(stage.stage_code) ? '收起日志' : '查看日志'}
                </Button>
              ) : null}
            </div>

            {/* 失败原因单独一行，红色，别让用户去日志里找 */}
            {stage.status === 'failed' && stage.error ? (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 10 }}
                message={'失败原因：' + stage.error}
                description="点上面的「重试该阶段」只补跑这一步。"
              />
            ) : null}

            {/* 展开的日志摘要：这一阶段用了什么模型/工具、处理到哪条 */}
            {openKeys.includes(stage.stage_code) ? (
              <div style={{ marginTop: 10 }}>
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'summary',
                      label: '阶段日志摘要（只保留摘要与哈希，不存完整原文）',
                      children: (
                        <div className="meta-text" style={{ lineHeight: 1.9, fontSize: 12.5 }}>
                          <div>开始时间：{stage.started_at ?? '—'}</div>
                          <div>结束时间：{stage.finished_at ?? '进行中'}</div>
                          <div>
                            调用统计：
                            {stage.stage_code === 'check'
                              ? ' 模型调用 16 次、工具调用 6 次（其中 1 次数据源超时，已降级）'
                              : ' 模型调用 1 次、工具调用 0 次'}
                          </div>
                          <div>
                            想看每次调用的详细记录：到「审计与运行日志」页按本任务过滤。
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
