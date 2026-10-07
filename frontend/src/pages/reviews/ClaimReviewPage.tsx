/**
 * pages/reviews/ClaimReviewPage.tsx —— 复核裁决页（人工复核主线的落点）
 *
 * 【这一页要解决的唯一问题：把"看一条结论"和"看它在原文哪里"变成本能动作】
 *   左边是原文（逐句高亮），右边是结论列表，两边双向联动：
 *     点右边的卡片 → 左边跳到对应句子并闪烁
 *     点左边的高亮句 → 右边定位到对应卡片
 *     滚动原文     → 只提示"你正在看的这几条在右边哪几个"，**绝不自动滚动右边**
 *                    （自动滚动会劫持用户的视角，是这类工具最招人烦的设计）
 *
 * 【高亮为什么必须按偏移量自己渲染（不用富文本编辑器）】
 *   编辑器会重排 DOM、额外包标签，导致字符偏移和真实 DOM 对不上 → 高亮错位。
 *   高亮错位是这类系统的阻断级缺陷（用户会立刻不信任所有结论），
 *   所以这里只做一件事：把原文纯文本按区间切成片段，每段自己决定样式（见 shared/utils/segment.ts）。
 *
 * 【三件"能干活"的设计】
 *   1. 键盘流：j/k 上下条，1 接受、2 驳回（弹理由）、3 已核实，a 追问，o 定位原文，? 帮助；
 *   2. 风险色带：左边缘一条细条，一眼看出问题集中在报告哪一段，点一下跳过去；
 *   3. 筛选进 URL：把"只看高风险"的链接发给同事，他打开就是同一个视图。
 *
 * 【本文件导出】ReportReviewPage 组件（默认导出）
 * 内部小组件：ReviewToolbar（工具栏）、RejectModal（键盘驳回用的理由弹窗）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { InfoCircleOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  claimApi,
  reportApi,
  riskRank,
  type Block,
  type ClaimSpan,
  type ClaimWithFindings,
} from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ReportLineNav } from '@/features/report-nav/ReportLineNav'
import { EmptyState, ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { RiskLegend } from '@/features/risk-badge/RiskBadge'
import { FindingCard } from '@/features/finding-card/FindingCard'
import { AskDrawer } from '@/features/ask-drawer/AskDrawer'
import { RiskRibbon } from '@/features/risk-ribbon/RiskRibbon'
import { buildRibbonBlocks } from '@/shared/utils/ribbon'
import { useUrlState, parseMulti, stringifyMulti } from '@/shared/hooks/useUrlState'
import { BlockView } from './BlockView'

/* ============================================================================
 * 纯函数：把"主张+结论"压成渲染需要的最小结构（高亮只要 id / 区间 / 风险 / 状态）
 * 单独抽出来是为了能单元测试，也让渲染层看不到业务细节
 * ==========================================================================*/
export function buildSpans(items: ClaimWithFindings[]): ClaimSpan[] {
  return items.map((item) => {
    const findings = item.findings
    // 风险取最严重的那一条（一条主张可能被多个维度报问题）
    const risk = findings.reduce<ClaimSpan['risk_level']>((best, finding) => {
      if (!finding.risk_level) return best
      return riskRank(finding.risk_level) > riskRank(best) ? finding.risk_level : best
    }, null)
    // 状态取"最需要人看"的一个：有问题 > 失败 > 未覆盖 > 通过
    const priority: Array<ClaimWithFindings['findings'][number]['status']> = ['risk', 'error', 'uncovered', 'pass']
    const status = priority.find((s) => findings.some((f) => f.status === s)) ?? 'pass'
    return {
      id: item.claim.id,
      block_id: item.claim.block_id,
      start_offset: item.claim.start_offset,
      end_offset: item.claim.end_offset,
      risk_level: risk,
      status,
    }
  })
}

/** 按原文块把区间分组：渲染每一块时只取属于它的区间，避免每次全量过滤 */
export function groupSpansByBlock(spans: ClaimSpan[]): Map<string, ClaimSpan[]> {
  const map = new Map<string, ClaimSpan[]>()
  spans.forEach((span) => {
    const list = map.get(span.block_id) ?? []
    list.push(span)
    map.set(span.block_id, list)
  })
  return map
}

export default function ClaimReviewPage() {
  const { reportId = '' } = useParams()
  const navigate = useNavigate()
  const { message, modal } = AntdApp.useApp()
  const queryClient = useQueryClient()

  // 所有会改变视图的筛选都进 URL（分享链接、刷新、后退都不丢）
  const [filters, setFilters] = useUrlState({ risk: '', status: '', dimension: '', claim: '', pending: '' })
  const activeClaimId = filters.claim || null
  const onlyPending = filters.pending === '1'

  const [flashClaimId, setFlashClaimId] = useState<string | null>(null)
  const [askClaimId, setAskClaimId] = useState<string | null>(null)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const [pendingPick, setPendingPick] = useState<string[] | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ClaimWithFindings | null>(null)
  // 注意：这里必须判 window 是否存在 —— 这一行在"渲染期"执行（useState 初始化），
  // 而渲染冒烟（scripts/smoke-render.tsx）是在 Node 里跑的，没有 window，会直接抛异常。
  // 取不到时按宽屏处理，挂载后的 resize 监听会立刻纠正（useEffect 在 Node 里本来就不执行）。
  const [narrowScreen, setNarrowScreen] = useState(typeof window !== 'undefined' ? window.innerWidth < 1280 : false)
  /** 窄屏时结论列表改用抽屉展示，这个开关控制它 */
  const [claimDrawerOpen, setClaimDrawerOpen] = useState(false)
  const [rejectForm] = Form.useForm<{ reason: string }>()

  // 窄屏（<1280px）时右栏改成抽屉，避免三栏挤成一条缝
  useEffect(() => {
    const onResize = () => setNarrowScreen(window.innerWidth < 1280)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* ---------------- 数据 ---------------- */
  const reportQuery = useQuery({ queryKey: ['report', reportId], queryFn: () => reportApi.detail(reportId) })
  const blocksQuery = useQuery({ queryKey: ['report', reportId, 'blocks'], queryFn: () => reportApi.blocks(reportId) })
  const claimsQuery = useQuery({
    queryKey: ['claims', reportId, { risk: filters.risk, status: filters.status, dimension: filters.dimension }],
    queryFn: () =>
      claimApi.listByReport(reportId, {
        risk: parseMulti(filters.risk),
        status: parseMulti(filters.status),
        dimension: filters.dimension || undefined,
        page_size: 200,
      }),
  })

  const blocks: Block[] = blocksQuery.data ?? []
  // 复核裁决页必须按原文顺序展示，所以哪怕后端排过序这里也再保证一次
  const items = useMemo(
    () => [...(claimsQuery.data?.items ?? [])].sort((a, b) => a.claim.block_index - b.claim.block_index),
    [claimsQuery.data]
  )
  const visibleItems = useMemo(
    () => (onlyPending ? items.filter((item) => item.review.state === 'pending') : items),
    [items, onlyPending]
  )

  const spans = useMemo(() => buildSpans(items), [items])
  const spansByBlock = useMemo(() => groupSpansByBlock(spans), [spans])
  const totalChars = useMemo(() => blocks.reduce((sum, block) => sum + block.text.length + 1, 0), [blocks])
  const ribbonBlocks = useMemo(() => {
    // 色带用"全文绝对偏移"定位：block 的绝对起点 + claim 的块内偏移
    const absoluteSpans = spans.map((span) => {
      const block = blocks.find((b) => b.id === span.block_id)
      const base = block?.start_offset ?? 0
      return { ...span, start_offset: base + span.start_offset, end_offset: base + span.end_offset }
    })
    return buildRibbonBlocks(absoluteSpans, totalChars)
  }, [spans, blocks, totalChars])

  // 原文块与结论卡片的 DOM 引用：双向联动就是靠它俩互相找
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const cardRefs = useRef(new Map<string, HTMLElement>())

  /* ---------------- 双向联动 ---------------- */
  /** 结论卡片 → 原文：滚动左栏到那一块，并让对应片段闪烁一下 */
  const locateInDocument = useCallback(
    (claimId: string) => {
      const item = items.find((i) => i.claim.id === claimId)
      if (!item) return
      const node = blockRefs.current.get(item.claim.block_id)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashClaimId(claimId)
      window.setTimeout(() => setFlashClaimId(null), 1600)
    },
    [items]
  )

  /** 原文 → 结论卡片：选中并滚动右栏（只有一条时直接滚，多条时先让用户选） */
  const selectClaim = useCallback(
    (claimId: string) => {
      setFilters({ claim: claimId })
      const node = cardRefs.current.get(claimId)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [setFilters]
  )

  const pickClaimFromText = useCallback(
    (claimIds: string[]) => {
      if (!claimIds.length) return
      if (claimIds.length === 1) selectClaim(claimIds[0])
      // 一句话被两条结论同时覆盖是常见情况，这时让用户明确选看哪一条
      else setPendingPick(claimIds)
    },
    [selectClaim]
  )

  /** 从总览页带着 ?claim=xxx 进来时，自动滚到那张卡片 */
  useEffect(() => {
    if (!filters.claim || !visibleItems.length) return
    const timer = window.setTimeout(() => {
      cardRefs.current.get(filters.claim)?.scrollIntoView({ block: 'center' })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [filters.claim, visibleItems.length])

  /* ---------------- 复核动作（键盘流复用同一套逻辑） ---------------- */
  const reviewMutation = useMutation({
    mutationFn: (payload: { claimId: string; revision: number; action: 'accept' | 'verify' | 'reject'; reason?: string }) =>
      claimApi.submitReview(payload.claimId, { action: payload.action, reason: payload.reason, revision: payload.revision }),
    onSuccess: (_data, variables) => {
      message.success(variables.action === 'accept' ? '已接受 AI 建议' : variables.action === 'verify' ? '已标记为核实' : '已驳回 AI')
      queryClient.invalidateQueries({ queryKey: ['claim', variables.claimId] })
      queryClient.invalidateQueries({ queryKey: ['claims'] })
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
    onError: (error: unknown, variables) => {
      const apiError = error as ApiError
      if (apiError?.isRevisionConflict) {
        modal.warning({ title: '该条已被他人复核', content: '已刷新为最新状态，请基于最新结论重新判断。' })
        queryClient.invalidateQueries({ queryKey: ['claims'] })
        return
      }
      message.error(apiError?.userMessage || '提交失败')
      void variables
    },
  })
  /**
   * 键盘流：复核一整天不用碰鼠标就靠这一段。
   * 注意两点：正在输入框里打字时不能抢键盘；所有动作都走同一个 mutation（含并发冲突处理）。
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const ids = visibleItems.map((item) => item.claim.id)
      const currentIndex = activeClaimId ? ids.indexOf(activeClaimId) : -1
      const current = activeClaimId ? visibleItems.find((item) => item.claim.id === activeClaimId) : undefined

      const move = (delta: number) => {
        if (!ids.length) return
        const nextIndex = currentIndex === -1 ? 0 : Math.min(Math.max(currentIndex + delta, 0), ids.length - 1)
        selectClaim(ids[nextIndex])
      }

      switch (event.key) {
        case 'j':
          move(1)
          break
        case 'k':
          move(-1)
          break
        case '1':
          if (current) reviewMutation.mutate({ claimId: current.claim.id, revision: current.claim.revision, action: 'accept' })
          break
        case '2':
          if (current) setRejectTarget(current)
          break
        case '3':
          if (current) reviewMutation.mutate({ claimId: current.claim.id, revision: current.claim.revision, action: 'verify', reason: '人工核实无误' })
          break
        case 'o':
          if (activeClaimId) locateInDocument(activeClaimId)
          break
        case 'a':
          if (activeClaimId) setAskClaimId(activeClaimId)
          break
        case '?':
          setShowKeyboardHelp(true)
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visibleItems, activeClaimId, locateInDocument, selectClaim, reviewMutation])

  /* ---------------- 各种状态：加载 / 错误 / 空 ---------------- */
  if (blocksQuery.isLoading || claimsQuery.isLoading) return <LoadingBlock rows={8} />
  if (blocksQuery.isError) return <ErrorState error={blocksQuery.error} onRetry={() => blocksQuery.refetch()} />
  // 结论查询失败也必须报错：以前只处理 blocksQuery 的错误，
  // claimsQuery 失败时右栏就是一个空列表，页面看着像"这份报告没有问题"——那是产品事故。
  if (claimsQuery.isError) return <ErrorState error={claimsQuery.error} onRetry={() => claimsQuery.refetch()} />
  if (!blocks.length) {
    return (
      <div className="page">
        <PageHeader title="复核裁决" />
        <EmptyState
          description="这份报告还没有解析出原文。请先在项目里确认核查任务是否已完成「文档解析」阶段。"
          action={<Button onClick={() => navigate('/')}>返回工作台</Button>}
        />
      </div>
    )
  }

  /** 右栏结论列表（窄屏时放进抽屉，宽屏时固定右侧） */
  const claimList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {visibleItems.length ? (
        visibleItems.map((item) => {
          return (
            <div
              key={item.claim.id}
              ref={(node) => {
                if (node) cardRefs.current.set(item.claim.id, node)
                else cardRefs.current.delete(item.claim.id)
              }}
            >
              <FindingCard
                item={item}
                active={activeClaimId === item.claim.id}
                onLocate={locateInDocument}
                onAsk={(claimId) => setAskClaimId(claimId)}
                onEvidenceJump={(evidence) => {
                  // 证据是文内互证时，跳到证据所在的位置（这里用当前主张定位近似处理）
                  if (evidence.source_ref) locateInDocument(item.claim.id)
                }}
              />
            </div>
          )
        })
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              当前筛选下没有结论。
              {onlyPending ? '可以关掉「只看待复核」看看全部。' : '换个筛选条件试试。'}
            </span>
          }
        />
      )}
    </div>
  )

  return (
    <div className="page">
      <PageHeader
        title="复核裁决"
        description={
          <span>
            {reportQuery.data?.company} · {reportQuery.data?.ticker}
          </span>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                claimsQuery.refetch()
                blocksQuery.refetch()
              }}
            >
              刷新
            </Button>
            {/* 快捷键是"查帮助"的入口，不是本页操作 —— 所以不能和上面两个按钮长一样：
                换成无边框图标按钮，中间加一道分隔线，视觉上明显低一级。
                它按 ? 键也能打开同一个弹窗，去掉文字不会丢发现性。 */}
            <span className="toolbar__divider" />
            <Tooltip title="快捷键（按 ? 也能打开）">
              <Button type="text" icon={<KeyOutlined />} onClick={() => setShowKeyboardHelp(true)} />
            </Tooltip>
          </Space>
        }
      >
        <ReportLineNav reportId={reportId} />
      </PageHeader>

      {/* ---------- 筛选：全部进 URL（链接可分享）；图例收进图标，减少视觉噪音 ---------- */}
      <div className="toolbar">
        <Select
          mode="multiple"
          allowClear
          size="small"
          placeholder="风险"
          style={{ minWidth: 116 }}
          value={parseMulti(filters.risk)}
          onChange={(values) => setFilters({ risk: stringifyMulti(values as string[]), claim: undefined })}
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
          onChange={(values) => setFilters({ status: stringifyMulti(values as string[]), claim: undefined })}
          options={[
            { label: '有问题', value: 'risk' },
            { label: '通过', value: 'pass' },
            { label: '未覆盖', value: 'uncovered' },
            { label: '核查失败', value: 'error' },
          ]}
        />
        <span className="toolbar__divider" />
        <Tooltip title="只看还没裁决过的结论，适合连续做完一轮复核">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Switch
              size="small"
              checked={onlyPending}
              onChange={(checked) => setFilters({ pending: checked ? '1' : undefined, claim: undefined })}
            />
            <span className="meta-text">只看待复核</span>
          </span>
        </Tooltip>

        <span className="toolbar__count">
          {visibleItems.length} 条{items.length !== visibleItems.length ? '（共 ' + items.length + '）' : ''}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {items.length !== visibleItems.length ? (
            <a
              onClick={() =>
                setFilters({ risk: undefined, status: undefined, dimension: undefined, claim: undefined, pending: undefined })
              }
            >
              清空筛选
            </a>
          ) : null}
          <Tooltip title={<RiskLegend />} placement="bottomRight">
            <Button type="text" size="small" icon={<InfoCircleOutlined />} />
          </Tooltip>
        </div>
      </div>

      {/* ---------- 主体：色带 + 原文 + 结论列表 ---------- */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        {/* 风险色带：一眼看到问题集中在哪一段 */}
        <div style={{ width: 14, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>

          <div style={{ flex: 1, minHeight: 0 }}>
            <RiskRibbon
              blocks={ribbonBlocks}
              onJump={(claimId) => {
                selectClaim(claimId)
                locateInDocument(claimId)
              }}
            />
          </div>
        </div>

        {/* 左：原文（按偏移渲染，点击高亮句选中右侧结论） */}
        <div className="doc-scroll" style={{ flex: 1, minWidth: 0 }}>
          {blocks.map((block) => (
            <div
              key={block.id}
              ref={(node) => {
                if (node) blockRefs.current.set(block.id, node)
                else blockRefs.current.delete(block.id)
              }}
            >
              <BlockView
                block={block}
                spans={spansByBlock.get(block.id) ?? []}
                activeClaimId={flashClaimId ?? activeClaimId}
                onPick={pickClaimFromText}
              />
            </div>
          ))}
        </div>

        {/* 右：结论列表（宽屏固定，窄屏收进抽屉） */}
        {!narrowScreen ? (
          <div style={{ width: 470, flexShrink: 0, maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 }}>
            <div className="meta-text" style={{ marginBottom: 8 }}>
              结论列表（按原文顺序）
            </div>
            {claimList}
          </div>
        ) : (
          <Button
            type="primary"
            style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 20 }}
            onClick={() => setClaimDrawerOpen(true)}
          >
            查看结论（{visibleItems.length}）
          </Button>
        )}
      </div>

      {/* 窄屏时结论列表放在抽屉里 */}
      {narrowScreen ? (
        <Drawer
          title={'结论列表（' + visibleItems.length + ' 条）'}
          placement="right"
          width={Math.min(540, window.innerWidth - 32)}
          open={claimDrawerOpen}
          onClose={() => setClaimDrawerOpen(false)}
          styles={{ body: { padding: 12 } }}
        >
          {claimList}
        </Drawer>
      ) : null}

      {/* 追问抽屉（流式回答，不写库） */}
      <AskDrawer
        open={Boolean(askClaimId)}
        claimId={askClaimId}
        claimText={items.find((item) => item.claim.id === askClaimId)?.claim.text}
        onClose={() => setAskClaimId(null)}
      />

      {/* 一句多结论：让用户选看哪一条（不替他做决定） */}
      <Modal
        open={Boolean(pendingPick)}
        title="这句话同时有多个结论"
        footer={null}
        onCancel={() => setPendingPick(null)}
      >
        <div className="meta-text" style={{ marginBottom: 10 }}>
          这句话命中多条结论，选择要查看的一条：
        </div>
        <Space direction="vertical" style={{ width: '100%' }}>
          {(pendingPick ?? []).map((claimId) => {
            const item = items.find((i) => i.claim.id === claimId)
            if (!item) return null
            const primary = item.findings[0]
            return (
              <Button
                key={claimId}
                block
                onClick={() => {
                  selectClaim(claimId)
                  setPendingPick(null)
                }}
              >
                {primary?.dimension_name ?? '未知维度'} · {primary?.risk_level ? '有风险' : '无风险等级'} ——
                {primary?.reason?.slice(0, 40) ?? '查看详情'}
              </Button>
            )
          })}
        </Space>
      </Modal>

      {/* 键盘流驳回：理由必填（和卡片里的按钮同一套规则） */}
      <Modal
        title="驳回 AI 结论"
        open={Boolean(rejectTarget)}
        okText="提交驳回"
        okButtonProps={{ danger: true, loading: reviewMutation.isPending }}
        onCancel={() => {
          setRejectTarget(null)
          rejectForm.resetFields()
        }}
        onOk={async () => {
          const values = await rejectForm.validateFields()
          if (rejectTarget) {
            reviewMutation.mutate({
              claimId: rejectTarget.claim.id,
              revision: rejectTarget.claim.revision,
              action: 'reject',
              reason: values.reason,
            })
          }
          setRejectTarget(null)
          rejectForm.resetFields()
        }}
      >
        <p className="meta-text" style={{ marginTop: 0 }}>
          理由会进入经验学习：多次相同理由的驳回会变成"规则该怎么改"的候选（经人审核后才生效）。
        </p>
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="驳回理由"
            rules={[{ required: true, message: '必须填写理由' }, { min: 5, message: '请写具体一点（至少 5 个字）' }]}
          >
            <Input.TextArea rows={3} placeholder="例如：该表述有行业协会公开数据支撑，判定过严" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 快捷键帮助 */}
      <Modal open={showKeyboardHelp} title="键盘快捷键（复核可以完全不碰鼠标）" footer={null} onCancel={() => setShowKeyboardHelp(false)}>
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          {[
            ['j / k', '下一条 / 上一条（按当前列表顺序）'],
            ['1', '接受 AI 建议'],
            ['2', '驳回 AI（弹出理由输入框，必填）'],
            ['3', '标记已核实'],
            ['a', '对当前条追问'],
            ['o', '定位到原文位置'],
            ['?', '打开这份帮助'],
          ].map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Tag className="num" style={{ minWidth: 44, textAlign: 'center' }}>
                {key}
              </Tag>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
