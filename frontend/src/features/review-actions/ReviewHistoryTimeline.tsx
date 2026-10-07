/**
 * features/review-actions/ReviewHistoryTimeline.tsx —— 三态结论 + 复核历史
 *
 * 【为什么要同时显示三种结论】
 *   AI 说的、人说的、最终生效的，缺一个都会让用户不放心：
 *     - 只看生效结论 → 不知道 AI 原本怎么判，没法复盘"AI 错在哪"；
 *     - 只看 AI 结论 → 不知道人改过没有，可能把人工修正当成 AI 能力。
 *   所以三者并排显示，复核历史按时间倒序列出"谁、什么时候、做了什么、为什么"。
 *
 * 【本文件导出】ReviewHistoryTimeline 组件（纯展示）
 */
import { Alert, Timeline, Tag } from 'antd'
import type { ClaimConclusion, ReviewAction, ReviewActionType } from '@/api'
import { REVIEW_ACTION_LABEL, REVIEW_STATE_LABEL } from '@/api'
import { formatDateTime } from '@/shared/utils/format'

/** 动作 -> 时间线节点颜色（接受=绿、驳回=红、核实=蓝、修改=紫） */
const ACTION_COLOR: Record<ReviewActionType, string> = {
  accept: 'green',
  reject: 'red',
  verify: 'blue',
  add_evidence: 'gray',
  manual_edit: 'purple',
}

export function ReviewHistoryTimeline({
  conclusion,
  actions,
}: {
  conclusion: ClaimConclusion
  actions: ReviewAction[]
}) {
  return (
    <div>
      {/* 三态结论：一眼看清"AI 说什么、人说什么、最终算什么" */}
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <Alert
          type="info"
          showIcon={false}
          message={
            <span>
              <Tag color="default">AI 结论</Tag>
              {conclusion.ai_conclusion}
            </span>
          }
          style={{ padding: '6px 10px' }}
        />
        <Alert
          type={conclusion.human_conclusion ? 'warning' : 'info'}
          showIcon={false}
          message={
            <span>
              <Tag color="default">人工结论</Tag>
              {conclusion.human_conclusion ?? '（还没有人工裁决）'}
            </span>
          }
          style={{ padding: '6px 10px' }}
        />
        <Alert
          type="success"
          showIcon={false}
          message={
            <span>
              <Tag color="default">生效结论</Tag>
              {conclusion.effective_conclusion}
              <span className="meta-text" style={{ marginLeft: 8 }}>
                （{REVIEW_STATE_LABEL[conclusion.state]}）
              </span>
            </span>
          }
          style={{ padding: '6px 10px' }}
        />
      </div>

      {/* 复核历史：只追加、不覆盖，所以这里永远不会"少一条" */}
      <div className="meta-text" style={{ marginBottom: 6 }}>
        复核历史（{actions.length} 条，只追加不修改）
      </div>
      {actions.length ? (
        <Timeline
          items={actions.map((action) => ({
            color: ACTION_COLOR[action.action],
            children: (
              <div>
                <div style={{ fontSize: 13 }}>
                  <b>{action.actor_name}</b> {REVIEW_ACTION_LABEL[action.action]}
                  <span className="meta-text" style={{ marginLeft: 8 }}>
                    {formatDateTime(action.created_at)}
                  </span>
                </div>
                {action.reason ? (
                  <div className="meta-text" style={{ marginTop: 2, lineHeight: 1.6 }}>
                    理由：{action.reason}
                  </div>
                ) : null}
              </div>
            ),
          }))}
        />
      ) : (
        <div className="meta-text">还没有人工裁决记录</div>
      )}
    </div>
  )
}