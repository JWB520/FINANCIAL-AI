/**
 * shared/ui/StatusTags.tsx —— 全站统一的状态标签
 *
 * 【为什么集中在一起】
 *   "中风险"这个说法在整个系统里必须长得一模一样、用同一种颜色。
 *   如果每个页面自己写 <Tag color="orange">，迟早会出现"中风险"和"橙色中等"两种说法。
 *   所以所有 Tag 都从这里取，文案与配色一律查 api/enums.ts 的字典。
 *
 * 【本文件导出】
 *   RiskTag          风险等级标签（高/中/低）
 *   FindingStatusTag 结论状态标签（通过 / 有问题 / 未覆盖 / 核查失败）
 *   TaskStatusTag    任务状态标签
 *   StageStatusTag   阶段状态标签
 *   ReviewStateTag   复核状态标签
 *   ClaimTypeTag     主张类型标签
 *   DimensionTag     维度标签
 */
import { Tag, Tooltip } from 'antd'
import type { ClaimType, FindingStatus, ReviewState, RiskLevel, StageStatus, TaskStatus } from '@/api'
import {
  CLAIM_TYPE_LABEL,
  CLAIM_TYPE_TAG_COLOR,
  FINDING_STATUS_HINT,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TAG_COLOR,
  REVIEW_STATE_LABEL,
  REVIEW_STATE_TAG_COLOR,
  RISK_LEVEL_LABEL,
  RISK_LEVEL_TAG_COLOR,
  STAGE_STATUS_LABEL,
  STAGE_STATUS_TAG_COLOR,
  TASK_STATUS_LABEL,
  TASK_STATUS_TAG_COLOR,
} from '@/api'

/** 风险等级标签。字重加粗，保证在密集列表里也能被一眼看到 */
export function RiskTag({ level, showNone = true }: { level: RiskLevel | null; showNone?: boolean }) {
  if (!level) return showNone ? <span className="meta-text">—</span> : null
  return (
    <Tag color={RISK_LEVEL_TAG_COLOR[level]} style={{ fontWeight: 600, marginInlineEnd: 0 }}>
      {RISK_LEVEL_LABEL[level]}
    </Tag>
  )
}

/** 结论状态标签。四种状态都带悬停解释（"未覆盖"尤其需要解释清楚） */
export function FindingStatusTag({ status }: { status: FindingStatus }) {
  return (
    <Tooltip title={FINDING_STATUS_HINT[status]}>
      <Tag color={FINDING_STATUS_TAG_COLOR[status]} style={{ marginInlineEnd: 0 }}>
        {FINDING_STATUS_LABEL[status]}
      </Tag>
    </Tooltip>
  )
}

export function TaskStatusTag({ status }: { status: TaskStatus }) {
  return (
    <Tag color={TASK_STATUS_TAG_COLOR[status]} style={{ marginInlineEnd: 0 }}>
      {TASK_STATUS_LABEL[status]}
    </Tag>
  )
}

export function StageStatusTag({ status }: { status: StageStatus }) {
  return (
    <Tag color={STAGE_STATUS_TAG_COLOR[status]} style={{ marginInlineEnd: 0 }}>
      {STAGE_STATUS_LABEL[status]}
    </Tag>
  )
}

export function ReviewStateTag({ state }: { state: ReviewState }) {
  return (
    <Tag color={REVIEW_STATE_TAG_COLOR[state]} style={{ marginInlineEnd: 0 }}>
      {REVIEW_STATE_LABEL[state]}
    </Tag>
  )
}

export function ClaimTypeTag({ type }: { type: ClaimType }) {
  return (
    <Tag color={CLAIM_TYPE_TAG_COLOR[type]} style={{ marginInlineEnd: 0 }}>
      {CLAIM_TYPE_LABEL[type]}
    </Tag>
  )
}

export function DimensionTag({ name }: { name: string }) {
  return (
    <Tag color="blue" style={{ marginInlineEnd: 0 }}>
      {name}
    </Tag>
  )
}