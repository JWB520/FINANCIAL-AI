/**
 * features/finding-card/FindingCard.tsx —— 单条核查结论的卡片（复核裁决页右栏的主体）
 *
 * 【这张卡片要回答用户的四个问题】
 *   1. 哪里有问题？  → 头部（维度 + 风险 + 原文片段，点一下跳到原文位置）
 *   2. 凭什么这么判？→ 判断理由 + 命中规则 + 证据 + 核算过程
 *   3. 我该怎么办？  → 修改建议（可复制、可采纳）
 *   4. 我处理过了吗？→ 三态结论 + 复核状态 + 复核动作栏 + 历史
 *
 * 【为什么默认折叠】
 *   一条报告可能有几十条结论。如果每条都展开全部细节，用户根本扫不过来。
 *   所以默认只显示"左边一条线 + 风险色 + 原文 + 一句话理由"，
 *   想看细节再点开（展开时才去拉复核历史，省一次请求）。
 *
 * 【本文件导出】FindingCard 组件
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { App as AntdApp, Button, Collapse, Divider, Space, Tooltip, Typography } from 'antd'
import {
  AimOutlined,
  CopyOutlined,
  DownOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  UpOutlined,
} from '@ant-design/icons'
import type { ClaimWithFindings, Evidence } from '@/api'
import { claimApi } from '@/api'
import { ClaimTypeTag, ReviewStateTag } from '@/shared/ui/StatusTags'
import { RiskBadge } from '@/features/risk-badge/RiskBadge'
import { CalcTraceTable } from '@/features/calc-trace/CalcTraceTable'
import { EvidenceList } from '@/features/finding-card/EvidenceList'
import { ReviewActionBar } from '@/features/review-actions/ReviewActionBar'
import { ReviewHistoryTimeline } from '@/features/review-actions/ReviewHistoryTimeline'
import { copyText } from '@/shared/utils/clipboard'
import { formatPercent } from '@/shared/utils/format'

export function FindingCard({
  item,
  active,
  onLocate,
  onAsk,
  onEvidenceJump,
}: {
  /** 主张 + 它的全部维度结论 + 三态结论 */
  item: ClaimWithFindings
  /** 是否被原文选中（选中时卡片描边高亮） */
  active: boolean
  /** 点击"定位原文"（参数是主张 id） */
  onLocate: (claimId: string) => void
  /** 点击"问一问"（参数是主张 id） */
  onAsk: (claimId: string) => void
  /** 点击证据里的"文内互证"（跳到原文对应位置） */
  onEvidenceJump: (evidence: Evidence) => void
}) {
  const { message } = AntdApp.useApp()
  const [expanded, setExpanded] = useState(false)
  const { claim, findings, review } = item

  // 主结论：取第一条（后端已按"最需要人看"的顺序返回）
  const primary = findings[0]

  // 复核历史：只有展开时才拉，省一次请求
  const { data: history = [] } = useQuery({
    queryKey: ['claim', claim.id, 'reviews'],
    queryFn: () => claimApi.reviewHistory(claim.id),
    enabled: expanded,
  })

  /** 卡片左侧的那条竖线：颜色就是结论状态，扫一眼列表就知道哪条最要紧 */
  const stripeKey =
    primary?.status === 'risk' && primary.risk_level
      ? primary.risk_level
      : primary?.status === 'error'
        ? 'error'
        : primary?.status === 'uncovered'
          ? 'uncovered'
          : 'pass'

  return (
    <div
      id={'claim-card-' + claim.id}
      className={'finding-card' + (active ? ' finding-card--active' : '')}
      style={{ display: 'flex', gap: 10, padding: 12 }}
      onClick={() => !expanded && setExpanded(true)}
    >
      <div className={'finding-card__stripe finding-card__stripe--' + stripeKey} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ---------- 头部：结论概览 ---------- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {primary ? (
            <RiskBadge risk={primary.risk_level} status={primary.status} />
          ) : (
            <span className="meta-text">暂无结论</span>
          )}
          <span style={{ fontWeight: 600, fontSize: 13 }}>{primary?.dimension_name ?? '—'}</span>
          {claim.confidence < 0.6 ? (
            <Tooltip title="拆解置信度较低，建议人工确认这句话是不是一条完整的可核查主张">
              <span className="meta-text">拆解待确认</span>
            </Tooltip>
          ) : null}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReviewStateTag state={review.state} />
            <span className="meta-text">{claim.section_path}</span>
          </span>
        </div>

        {/* ---------- 原文片段（点一下跳到左栏对应高亮句） ---------- */}
        <div
          style={{
            marginTop: 8,
            padding: '8px 10px',
            background: '#fafafa',
            borderLeft: '3px solid #e6e6e6',
            borderRadius: 4,
            fontSize: 13,
            lineHeight: 1.7,
            cursor: 'pointer',
          }}
          onClick={(event) => {
            event.stopPropagation()
            onLocate(claim.id)
          }}
          title="点击定位到左侧原文"
        >
          {claim.text}
        </div>

        {/* ---------- 判断理由（人话，直接展示） ---------- */}
        {primary?.reason ? (
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.75, color: 'var(--ink-2)' }}>
            {expanded ? primary.reason : primary.reason.slice(0, 90) + (primary.reason.length > 90 ? '…' : '')}
          </div>
        ) : null}

        {/* 未覆盖 / 失败：必须把原因显式写出来（未覆盖 ≠ 通过） */}
        {primary?.uncovered_reason && primary.status !== 'pass' ? (
          <div className="meta-text" style={{ marginTop: 6 }}>
            {primary.status === 'uncovered' ? '未覆盖原因：' : '失败原因：'}
            {primary.uncovered_reason}
          </div>
        ) : null}

        {/* ---------- 展开区：证据 / 规则 / 核算 / 建议 / 复核 ---------- */}
        {expanded ? (
          <div style={{ marginTop: 12 }} onClick={(event) => event.stopPropagation()}>
            <div className="meta-text" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              结论类型
              <ClaimTypeTag type={claim.claim_type} />
              <span>拆解置信度 {formatPercent(claim.confidence, 0)}</span>
            </div>
            <Collapse
              ghost
              defaultActiveKey={['evidence']}
              items={[
                ...(primary?.calc_trace
                  ? [
                      {
                        key: 'calc',
                        label: '核算过程',
                        children: (
                          <CalcTraceTable
                            trace={primary.calc_trace}
                            onCopy={async (text) => {
                              // 必须等结果：writeText 可能被拒绝（无权限/非安全上下文），
                              // 以前不看结果就提示"已复制"，用户粘贴时才发现是空的
                              const ok = await copyText(text)
                              if (ok) message.success('算式已复制')
                              else message.error('复制失败，请手动选中后复制')
                            }}
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  key: 'evidence',
                  label: '证据 ' + (primary?.evidences.length ?? 0),
                  children: <EvidenceList evidences={primary?.evidences ?? []} onJumpToText={onEvidenceJump} />,
                },
                {
                  key: 'rule',
                  label: '规则',
                  children:
                    primary && primary.rule_hits.length ? (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {primary.rule_hits.map((rule) => (
                          <div key={rule.code} style={{ fontSize: 13 }}>
                            <span className="num" style={{ fontWeight: 600 }}>
                              {rule.code}
                            </span>
                            <span style={{ marginLeft: 8, color: 'var(--ink-2)' }}>{rule.desc}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="meta-text">该结论没有命中规则（可能是通过项或未覆盖项）</div>
                    ),
                },
                {
                  key: 'suggestion',
                  label: '修改建议',
                  children: primary?.suggestion ? (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13, lineHeight: 1.8 }}>
                        {primary.suggestion}
                      </Typography.Paragraph>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          void copyText(primary.suggestion || '').then((ok) => {
                            if (ok) message.success('建议已复制，可粘贴到报告中')
                            else message.error('复制失败，请手动选中后复制')
                          })
                        }}
                      >
                        复制建议
                      </Button>
                    </Space>
                  ) : (
                    <div className="meta-text">这条结论没有修改建议</div>
                  ),
                },
                {
                  key: 'review',
                  label: '复核',
                  children: (
                    <div>
                      <ReviewActionBar claimId={claim.id} revision={claim.revision} />
                      <Divider style={{ margin: '14px 0' }} />
                      <ReviewHistoryTimeline conclusion={review} actions={history} />
                    </div>
                  ),
                },
                {
                  key: 'trace',
                  label: '溯源',
                  children: (
                    <div style={{ fontSize: 12.5, lineHeight: 2 }} className="meta-text">
                      <div>模型 / 提示词 / 规则版本：deep-think-v1 · calc_check.v3 · r2026.09</div>
                      <div>
                        追踪号：{' '}
                        <span className="num" style={{ userSelect: 'all' }}>
                          {claim.id}-trace
                        </span>
                      </div>
                    </div>
                  ),
                },
              ]}
            />

            {/* 卡片底部操作区：定位原文 / 追问 / 折叠 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Button size="small" icon={<AimOutlined />} onClick={() => onLocate(claim.id)}>
                定位原文
              </Button>
              <Button size="small" icon={<MessageOutlined />} onClick={() => onAsk(claim.id)}>
                问一问
              </Button>
              <Tooltip title="为什么被判这个等级？可以追问，回答是流式的">
                <QuestionCircleOutlined className="meta-text" />
              </Tooltip>
              <Button
                size="small"
                type="text"
                icon={<UpOutlined />}
                style={{ marginLeft: 'auto' }}
                onClick={() => setExpanded(false)}
              >
                收起
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="meta-text">
              <DownOutlined /> 展开查看证据、核算过程与复核操作
            </span>
            <Button size="small" type="link" icon={<MessageOutlined />} onClick={() => onAsk(claim.id)}>
              问一问
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
