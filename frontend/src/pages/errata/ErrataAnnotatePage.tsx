/**
 * pages/errata/ErrataAnnotatePage.tsx —— 勘误批注页（数字复算实验的落点）
 *
 * 【这一页要回答的问题】"系统查出来的问题，落在原文哪一句、为什么这么判、我该怎么改。"
 *   左栏：**PDF 原件**（逐页渲染，每页角上标着"本页 N 条批注"）
 *   右栏：**批注卡列表**（每条 = 一处原文 + 算式 + 本地复算对照 + 结论 + 建议）
 *   两栏双向联动：点批注卡 → 左栏滚到那一页；点 PDF 某一页 → 右栏定位到那页第一条。
 *
 * 【布局的两个硬约束（第一版被用户点名"一页都看不完整"）】
 *   ① 左栏必须**自己滚动**：整页高度固定成一屏（视口高度减去页头/工具栏），
 *      PDF 与批注各自在内部滚动。第一版用 100vh 硬减一个估计值，窗口一小就把
 *      两栏顶出屏幕，右侧批注露不出来。
 *   ② 缩放的宽度要有兜底：窗口很窄时左右两栏会挤，所以右栏设下限宽度、左栏设 minWidth: 0。
 *
 * 【为什么逐条显示"算式来源：AI / 规则"】没有配模型 Key 时会走规则兜底，
 *   两者能查到的东西差一个量级。把来源写在卡片上，用户才知道"这一条是 AI 读懂的，
 *   那一条是规则猜句式猜中的"，不会误以为系统能力就这么多。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntdApp, Button, Card, Collapse, Empty, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, errataLabApi, type ErrataAnnotation, type ErrataRunResult } from '@/api'
import { desktop, type ErratalReviewPayload, type HumanVerdict } from '@/api/local/desktop'
import { PdfDocumentViewer, type PageMark } from '@/features/pdf-viewer/PdfDocumentViewer'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { formatNumber, formatPercent } from '@/shared/utils/format'

/* ============================================================================
 * 展示用的常量与小件
 * ==========================================================================*/

/** 还没裁决时的默认值（模块级常量：别每次 render 造新对象，否则引用每次都变） */
const EMPTY_DECISION: { verdict: HumanVerdict | null; note: string } = { verdict: null, note: '' }

/** 结论状态 -> 展示样式（颜色与全站风险色一致：红=有问题、绿=一致、灰=未覆盖） */
const STATUS_META: Record<string, { label: string; color: string; bar: string; icon: JSX.Element }> = {
  risk: { label: '有问题', color: 'red', bar: '#cf1322', icon: <ExclamationCircleOutlined /> },
  pass: { label: '复算一致', color: 'green', bar: '#52c41a', icon: <CheckCircleOutlined /> },
  uncovered: { label: '待人工确认', color: 'default', bar: '#d4a017', icon: <QuestionCircleOutlined /> },
  error: { label: '核查失败', color: 'volcano', bar: '#fa541c', icon: <ExclamationCircleOutlined /> },
}

const RISK_LABEL: Record<string, string> = { high: '高风险', medium: '中风险', low: '低风险' }

/** 把原文里的数字拆成片段，与"原文声称值"相同的那个标黄（一眼看到问题数字在哪） */
function StatementText({ text, claimed }: { text: string; claimed: number | null }) {
  const parts = useMemo(() => {
    const out: Array<{ text: string; hit: boolean }> = []
    const pattern = /\d[\d,]*(?:\.\d+)?/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) out.push({ text: text.slice(last, match.index), hit: false })
      const value = Number.parseFloat(match[0].replace(/,/g, ''))
      out.push({ text: match[0], hit: claimed !== null && Math.abs(value - claimed) < 1e-9 })
      last = match.index + match[0].length
    }
    if (last < text.length) out.push({ text: text.slice(last), hit: false })
    return out
  }, [text, claimed])

  return (
    <span>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} style={{ background: '#fff1b8', padding: '0 2px', borderRadius: 2 }}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  )
}

/** 一个"复算 / 原文 / 偏差"的对照格（规范化的核心：三个数并排，谁对谁错一眼可见） */
function CompareCell({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'plain' }) {
  const color = tone === 'bad' ? '#cf1322' : tone === 'good' ? '#389e0d' : 'var(--ink-1)'
  return (
    // 格子给最小宽度 + 允许换行：数字再长也只挤自己这一格，不会压到隔壁格子的字
    <div style={{ flex: '1 1 96px', minWidth: 0 }}>
      <div className="meta-text" style={{ fontSize: 11, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }} className="num">
        {value}
      </div>
    </div>
  )
}

/** 一张批注卡 */
function AnnotationCard({
  annotation,
  index,
  active,
  human,
  onLocate,
  onDecide,
  onNote,
  cardRef,
}: {
  annotation: ErrataAnnotation
  index: number
  active: boolean
  /** 人的裁决（本页真正的产出：保存时落盘，人工复核界面据此呈现） */
  human: { verdict: HumanVerdict | null; note: string }
  onLocate: () => void
  onDecide: (verdict: HumanVerdict) => void
  onNote: (note: string) => void
  cardRef: (node: HTMLDivElement | null) => void
}) {
  const meta = STATUS_META[annotation.status] ?? STATUS_META.uncovered
  const isRule = annotation.extracted_by === 'rule'
  /** 本句自证：算式输入全在这一句里、算术唯一 —— 它的结论不经模型复核（本地算术说了算） */
  const isSelfContained = annotation.extracted_by === 'rule_selfcontained'
  const hasNumbers = annotation.computed !== null && annotation.claimed !== null
  const unit = annotation.unit || ''
  /** 算式是不是跨句拼出来的（=基数由机器自己找，最可能是它配错） */
  const isContext = annotation.scope === 'context'
  /** 复核结论 -> 展示标签（复核没给结论时这块不显示） */
  const reviewLabel =
    annotation.review_verdict === 'report_error'
      ? '已确认原文有误'
      : annotation.review_verdict === 'consistent'
        ? '复核确认一致'
        : annotation.review_verdict === 'tool_mispair'
          ? '判定为机器配错'
          : annotation.review_verdict === 'unclear'
            ? '未能确认原文有误'
            : ''
  /** 复核备注块配色：确认有误=红、确认一致=绿、其余（无法判定）=蓝 */
  const reviewBox =
    annotation.review_verdict === 'report_error'
      ? { bg: '#fff1f0', border: '#ffa39e', color: '#cf1322' }
      : annotation.review_verdict === 'consistent'
        ? { bg: '#f6ffed', border: '#b7eb8f', color: '#389e0d' }
        : { bg: '#f0f5ff', border: '#adc6ff', color: '#2f54eb' }
  // 偏差与相对偏差统一走 shared/utils/format（页面里不再手写 toFixed 与字符串拼接）；
  // 复算值本身是 ast 求出来的浮点数（69.8749131341209 这种），必须格式化后再上屏，
  // 否则四个对照格并排时长数字会挤出去、压住隔壁格子的文字。
  const deviation =
    annotation.computed !== null && annotation.claimed !== null ? annotation.computed - annotation.claimed : null
  const deviationText = deviation === null ? '—' : `${deviation >= 0 ? '+' : ''}${formatNumber(deviation)}${unit}`
  const relativeText = annotation.rel_deviation === null ? '—' : formatPercent(Math.abs(annotation.rel_deviation), 2)

  return (
    <div ref={cardRef}>
      <Card
        size="small"
        styles={{ body: { padding: '12px 14px' } }}
        style={{
          marginBottom: 12,
          borderLeft: `3px solid ${meta.bar}`,
          boxShadow: active ? '0 0 0 2px #91caff' : '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        {/* ① 头部：这一条是什么、在哪、机器有多确定 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>#{index + 1}</span>
          <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
            {meta.label}
          </Tag>
          {annotation.risk_level ? (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              {RISK_LABEL[annotation.risk_level]}
            </Tag>
          ) : null}
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            第 {annotation.page} 页
          </Tag>
          <Tooltip title={isRule ? '这条算式由规则按句式套出来的（本次没有调用大模型）' : '这条算式由大模型读懂原文后提取'}>
            <Tag
              icon={isRule ? <ThunderboltOutlined /> : <RobotOutlined />}
              color={isRule ? 'default' : 'purple'}
              style={{ marginInlineEnd: 0 }}
            >
              {isRule ? '规则提取' : 'AI 提取'}
            </Tag>
          </Tooltip>
          <Tooltip title={annotation.scope_label || '算式输入全部来自这一句，可信度最高'}>
            <Tag color={annotation.scope === 'sentence' ? 'cyan' : 'orange'} style={{ marginInlineEnd: 0 }}>
              {annotation.scope === 'sentence' ? '句内自证' : '跨句推断'}
            </Tag>
          </Tooltip>
          {annotation.confidence !== null ? (
            <span className="meta-text" style={{ marginLeft: 'auto' }}>
              置信度 {(annotation.confidence * 100).toFixed(0)}%
            </span>
          ) : null}
        </div>

        {/* ② 原文引用（问题数字标黄） */}
        <div
          style={{
            background: '#fafafa',
            borderLeft: '2px solid #e5e6eb',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 13,
            lineHeight: 1.85,
            color: 'var(--ink-2)',
            marginBottom: 10,
          }}
        >
          <StatementText text={annotation.statement} claimed={annotation.claimed} />
        </div>

        {/* ③ 复算 / 原文 / 偏差 三格对照（规范化的核心） */}
        {hasNumbers ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: '8px 12px',
              background: annotation.status === 'risk' ? '#fff1f0' : '#f6ffed',
              borderRadius: 4,
              marginBottom: 10,
            }}
          >
            {/* 颜色只表达"这条判定有多确定"：risk=红、pass=绿、其余（待确认/失败）一律中性灰。
                以前 uncovered 也涂绿，等于把"机器自己没算平"画成好消息，读者会误以为系统在说"原文没错"。 */}
            <CompareCell
              label={isContext ? '机器试算' : '本地复算'}
              value={`${formatNumber(annotation.computed)}${unit}`}
              tone={annotation.status === 'risk' ? 'bad' : annotation.status === 'pass' ? 'good' : 'plain'}
            />
            <CompareCell label="原文写" value={`${formatNumber(annotation.claimed)}${unit}`} tone="plain" />
            <CompareCell label="相差" value={deviationText} tone="plain" />
            <CompareCell label="相对偏差" value={relativeText} tone="plain" />
            {isContext ? (
              <div className="meta-text" style={{ flexBasis: '100%', fontSize: 11, lineHeight: 1.7 }}>
                这个算式是机器把同页其他语句的数字拼出来的（原文没有直接给出这个基数）——
                算不平不能当作「原文写错了」的证据，请人工核对口径。
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ④ 结论（机器说的那句完整的话） */}
        <div style={{ fontSize: 13, lineHeight: 1.9, marginBottom: annotation.review_note || annotation.suggestion ? 8 : 0 }}>
          {annotation.conclusion}
        </div>

        {/* ⑤ 复核备注：这条不一致到底是原文写错、还是机器自己配错 —— 复核说了什么 */}
        {annotation.review_note ? (
          <div
            style={{
              padding: '7px 10px',
              background: reviewBox.bg,
              border: `1px solid ${reviewBox.border}`,
              borderRadius: 4,
              fontSize: 12.5,
              lineHeight: 1.85,
              marginBottom: annotation.suggestion ? 8 : 0,
            }}
          >
            <span style={{ fontWeight: 600, color: reviewBox.color }}>
              {reviewLabel
                ? `复核备注（${reviewLabel}）：`
                : isSelfContained
                  ? '核对备注（本句自证 · 本地算术，不经模型）：'
                  : '复核备注：'}
            </span>
            {annotation.review_note}
          </div>
        ) : null}

        {/* ⑥ 建议 */}
        {annotation.suggestion ? (
          <div
            style={{
              padding: '7px 10px',
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 4,
              fontSize: 12.5,
              lineHeight: 1.85,
            }}
          >
            <span style={{ color: '#389e0d', fontWeight: 600 }}>建议：</span>
            {annotation.suggestion}
          </div>
        ) : null}

        {/* ⑦ 核算过程（折叠：原理上任何人都能照着验算一遍） */}
        {annotation.expression ? (
          <Collapse
            ghost
            size="small"
            style={{ marginTop: 2 }}
            items={[
              {
                key: 'calc',
                label: <span style={{ fontSize: 12.5 }}>核算过程（可自己验算）</span>,
                children: (
                  <div style={{ fontSize: 12.5, lineHeight: 2 }}>
                    <div className="meta-text">
                      算式：<span className="num">{annotation.normalized || annotation.expression}</span>
                    </div>
                    {annotation.steps.map((step) => (
                      <div key={step.step}>
                        第 {step.step} 步：{step.expression} = <span className="num">{step.value}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 4 }}>
                      容差 ±{annotation.tolerance_pct}%（研报数字普遍修约，零容差会把正常四舍五入全判成错）
                    </div>
                    {annotation.extract_reason ? <div className="meta-text">提取说明：{annotation.extract_reason}</div> : null}
                  </div>
                ),
              },
            ]}
          />
        ) : null}

        {/* ⑧ 人工裁决：保留 / 舍弃 + 备注。机器判断、AI 复核、人的判断三样一起保存，
            下一站「人工复核」界面直接读这份记录，不必再翻 PDF 找位置。 */}
        <div style={{ borderTop: '1px dashed #e5e6eb', marginTop: 10, paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="meta-text" style={{ fontSize: 12 }}>
              人工裁决
            </span>
            <Button
              size="small"
              type={human.verdict === 'keep' ? 'primary' : 'default'}
              icon={<CheckOutlined />}
              onClick={() => onDecide('keep')}
            >
              保留
            </Button>
            <Button
              size="small"
              danger
              type={human.verdict === 'discard' ? 'primary' : 'default'}
              icon={<CloseOutlined />}
              onClick={() => onDecide('discard')}
            >
              舍弃
            </Button>
            <span className="meta-text" style={{ fontSize: 12 }}>
              {human.verdict === 'keep' ? '已保留' : human.verdict === 'discard' ? '已舍弃' : '未判'}
            </span>
          </div>
          <Input.TextArea
            value={human.note}
            onChange={(event) => onNote(event.target.value)}
            placeholder="备注：为什么保留 / 为什么舍弃（会与机器判断、AI 复核一起保存下来）"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ fontSize: 12.5 }}
          />
        </div>

        <div style={{ marginTop: 6, textAlign: 'right' }}>
          <a style={{ fontSize: 12 }} onClick={onLocate}>
            在 PDF 中定位
          </a>
        </div>
      </Card>
    </div>
  )
}

/* ============================================================================
 * 页面
 * ==========================================================================*/
export default function ErrataAnnotatePage() {
  const { projectId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  /** 提示用 App.useApp() 取（antd v5 的规范用法；静态 message 会丢上下文） */
  const { message } = AntdApp.useApp()

  const types = useMemo(() => {
    const raw = searchParams.get('types')
    return raw ? raw.split(',').filter(Boolean) : ['calc_number']
  }, [searchParams])
  const pageRange = useMemo(() => {
    const from = Number(searchParams.get('from') || 0)
    const to = Number(searchParams.get('to') || 0)
    return from > 0 && to > 0 ? { from, to } : null
  }, [searchParams])
  const useLlm = searchParams.get('use_llm') !== '0'

  /* ---------------- 项目配置（拿研报绝对路径） ---------------- */
  const configQuery = useQuery({
    queryKey: ['local-project', projectId],
    queryFn: () => desktop.openProject(projectId),
    enabled: Boolean(projectId) && desktop.isDesktop(),
    retry: false,
  })
  const reportPath = configQuery.data?.report_path ?? ''

  /* ---------------- 跑勘误 ---------------- */
  const [result, setResult] = useState<ErrataRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const run = useCallback(async () => {
    if (!reportPath) return
    setRunning(true)
    setError(null)
    try {
      const data = await errataLabApi.run({
        report_path: reportPath,
        types,
        page_range: pageRange,
        use_llm: useLlm,
      })
      setResult(data)
      setDecisions({}) // 换一次结果就清空上一轮裁决，避免把旧判断挂到新条目上
      // 默认落在第一条「要看的」上；万一全都复算一致，就退回第一条（此时列表默认是空的）
      const firstToShow = data.annotations.find((item) => item.status !== 'pass') ?? data.annotations[0]
      setSelectedId(firstToShow?.id ?? null)
    } catch (err) {
      const apiError = err as ApiError
      setError(apiError?.userMessage || apiError?.message || '勘误失败')
    } finally {
      setRunning(false)
    }
  }, [reportPath, types, pageRange, useLlm])

  /** 进来就自动跑一次（用户刚在上一页点了"发送"） */
  useEffect(() => {
    if (reportPath && !startedRef.current) {
      startedRef.current = true
      void run()
    }
  }, [reportPath, run])

  /* ---------------- 联动状态 ---------------- */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 「复算一致」= 这份文件在这个数上没问题。默认不展示（用户要的是一张问题清单），可一键展开。 */
  const [showAll, setShowAll] = useState(false)
  /** 人的裁决：批注 id -> {判断, 备注}。这是本页真正的产出 —— 保存时落盘，人工复核界面据此呈现。 */
  const [decisions, setDecisions] = useState<Record<string, { verdict: HumanVerdict | null; note: string }>>({})
  const [saving, setSaving] = useState(false)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  const annotations = result?.annotations ?? []
  /** 真正渲染的那一份：默认滤掉「复算一致」，只留 有问题 / 待人工确认 */
  const visible = useMemo(
    () => (showAll ? annotations : annotations.filter((item) => item.status !== 'pass')),
    [annotations, showAll]
  )
  const hiddenCount = annotations.length - visible.length
  /** 人工裁决进度（底部那一栏显示"已判 X/Y"） */
  const decided = useMemo(() => {
    const values = visible.map((item) => decisions[item.id]?.verdict ?? null)
    return {
      keep: values.filter((value) => value === 'keep').length,
      discard: values.filter((value) => value === 'discard').length,
      undecided: values.filter((value) => value === null).length,
    }
  }, [visible, decisions])
  const marks = useMemo(() => {
    const map: Record<number, PageMark> = {}
    visible.forEach((item, index) => {
      const current = map[item.page] ?? { total: 0, risk: 0, boxes: [] }
      current.total += 1
      if (item.status === 'risk') current.risk += 1
      // 版面标注框：把"这条批注在第几行的哪个位置"直接画在 PDF 原文旁边 ——
      // 用户不必再自己满篇找。换算成占页面宽高的百分比，于是缩放/高分屏/DPR 都不用管；
      // 后端没定位到的条目没有 rects，这里自然就不画框（画错位置比不画更糟）。
      if (item.page_width > 0 && item.page_height > 0) {
        const count = item.rects.length
        item.rects.forEach((rect, seq) => {
          current.boxes.push({
            id: item.id,
            seq,
            label: count > 1 ? `#${index + 1} · ${seq + 1}/${count}` : `#${index + 1}`,
            title: `第 ${index + 1} 条批注（第 ${item.page} 页）：${item.conclusion}`,
            tone: item.status === 'risk' ? 'risk' : 'uncovered',
            left: (rect.x0 / item.page_width) * 100,
            top: (rect.y0 / item.page_height) * 100,
            width: ((rect.x1 - rect.x0) / item.page_width) * 100,
            height: ((rect.y1 - rect.y0) / item.page_height) * 100,
          })
        })
      }
      map[item.page] = current
    })
    return map
  }, [visible])

  const selected = visible.find((item) => item.id === selectedId) ?? null
  const focusPage = selected?.page ?? null

  const locate = useCallback((id: string) => {
    setSelectedId(id)
    window.setTimeout(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }, [])

  /** 同一个按钮再点一次 = 取消裁决（允许改主意，不能一按下去就再也改不了） */
  const decide = useCallback((id: string, verdict: HumanVerdict) => {
    setDecisions((prev) => ({
      ...prev,
      [id]: { verdict: prev[id]?.verdict === verdict ? null : verdict, note: prev[id]?.note ?? '' },
    }))
  }, [])

  const setNote = useCallback((id: string, note: string) => {
    setDecisions((prev) => ({ ...prev, [id]: { verdict: prev[id]?.verdict ?? null, note } }))
  }, [])

  /**
   * 保存裁决结果 → 自动进入下一步。
   *
   * 【保存的是三样东西】机器的判断（status/等级/结论）+ AI 的判断（复核四档 + 备注 + 建议）
   * + 人的判断与备注。缺任何一样，"这条为什么最终被留下 / 被剔除"就说不清 ——
   * 下一站「人工复核」界面靠这三样复现整条推理链。
   */
  const save = useCallback(async () => {
    if (!result) return
    setSaving(true)
    try {
      const payload: ErratalReviewPayload = {
        schema_version: 1,
        report_path: result.report_path,
        report_name: result.report_name,
        page_range: result.page_range,
        saved_at: new Date().toISOString(),
        stats: { total: visible.length, keep: decided.keep, discard: decided.discard, undecided: decided.undecided },
        items: visible.map((item) => ({
          id: item.id,
          page: item.page,
          statement: item.statement,
          expression: item.expression,
          computed: item.computed,
          claimed: item.claimed,
          unit: item.unit,
          machine: { status: item.status, risk_level: item.risk_level, conclusion: item.conclusion },
          ai: { review_verdict: item.review_verdict, review_note: item.review_note, suggestion: item.suggestion },
          human: { verdict: decisions[item.id]?.verdict ?? null, note: decisions[item.id]?.note ?? '' },
        })),
      }
      const file = await desktop.saveErrataReview({ projectId, review: payload })
      message.success('已保存裁决结果（机器 + AI + 人），正在进入下一步…')
      // 自动跳到"下一个导航页面"：项目界面 —— 「人工复核」那条主线就从这里进
      navigate('/projects/' + projectId)
      console.info('[errata] 裁决记录已写入：' + file)
    } catch (error) {
      message.error((error as Error)?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [result, visible, decisions, decided, projectId, navigate, message])

  /** 点 PDF 某一页 -> 选中那页的第一条批注 */
  const pickPage = useCallback(
    (page: number) => {
      // 一定要在**过滤后**的列表里找：否则点到某一页，选中的可能是被隐藏的「复算一致」，
      // 右栏没有对应卡片可滚 → 点了像没反应。
      const first = visible.find((item) => item.page === page)
      if (first) locate(first.id)
    },
    [visible, locate]
  )

  /* ---------------- 各种状态 ---------------- */
  if (configQuery.isLoading) return <LoadingBlock rows={6} />
  if (!desktop.isDesktop()) {
    return (
      <div className="page">
        <PageHeader title="勘误批注" />
        <Alert
          type="info"
          showIcon
          message="请用桌面端打开"
          description="这一页要读取本地研报文件并渲染 PDF 原件，请在桌面端（npm run desktop）里使用。"
        />
      </div>
    )
  }
  if (configQuery.isError || !reportPath) {
    return (
      <div className="page">
        <PageHeader title="勘误批注" />
        <ErrorState error={configQuery.error} onRetry={() => configQuery.refetch()} />
      </div>
    )
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 8 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects/' + projectId)}>
          返回项目
        </Button>
      </div>

      <PageHeader
        title="勘误批注 · 数字复算"
        description={configQuery.data?.name}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={running} onClick={() => void run()}>
              重新勘误
            </Button>
          </Space>
        }
      />

      {/* 本次勘误的来龙去脉：模型状态 / 统计 / 降级说明 */}
      {result ? (
        <Card size="small" style={{ marginBottom: 10 }} styles={{ body: { padding: '10px 14px' } }}>
          <Space size={16} wrap style={{ fontSize: 13 }}>
            <span>
              核查 <span className="num">{result.stats.pages_scanned}</span> 页
              （含数字句子 <span className="num">{result.stats.sentences_scanned}</span> 句）
            </span>
            <span>
              批注 <span className="num">{result.stats.annotations_total}</span> 条
            </span>
            <span style={{ color: '#cf1322' }}>
              有问题 <span className="num">{result.stats.risk}</span>
            </span>
            <span style={{ color: '#389e0d' }}>
              复算一致 <span className="num">{result.stats.pass}</span>
            </span>
            <span style={{ color: '#d4a017' }}>
              待人工确认 <span className="num">{result.stats.uncovered}</span>
            </span>
            <span className="meta-text">
              算式来源：AI {result.stats.extracted_by_llm} / 规则 {result.stats.extracted_by_rule}
              {result.stats.self_contained ? ` / 本句自证 ${result.stats.self_contained}` : ''}
            </span>
            {result.stats.review_candidates ? (
              <Tooltip
                title={
                  `把「算不平」的条目连同原文一次性交给模型复核：确认原文有误 ${result.stats.review_confirmed} 条、` +
                  `确认只是四舍五入 ${result.stats.review_consistent} 条、判定为机器配错并已排除 ${result.stats.review_dropped} 条、` +
                  `无法判定保留待确认 ${result.stats.review_unclear} 条`
                }
              >
                <span className="meta-text">
                  复核 {result.stats.review_candidates} 条算不平 → 原文有误 {result.stats.review_confirmed} ｜ 只是四舍五入{' '}
                  {result.stats.review_consistent} ｜ 我方配错已排除 {result.stats.review_dropped}
                </span>
              </Tooltip>
            ) : null}
            <span className="meta-text">耗时 {(result.elapsed_ms / 1000).toFixed(1)} 秒</span>
            {result.llm.available ? (
              <Tooltip
                title={`模型 ${result.llm.model}；共 ${result.llm.calls} 次调用，约 ${result.llm.tokens_est} tokens，模型耗时 ${(result.llm.elapsed_ms / 1000).toFixed(1)} 秒`}
              >
                <Tag icon={<RobotOutlined />} color="purple">
                  AI 已参与（{result.llm.calls} 次调用）
                </Tag>
              </Tooltip>
            ) : (
              <Tag icon={<ThunderboltOutlined />} color="orange">
                未接入大模型 · 规则兜底
              </Tag>
            )}
          </Space>

          {result.notes.length ? (
            <div style={{ marginTop: 8 }}>
              {result.notes.map((note, index) => (
                <div key={index} className="meta-text" style={{ lineHeight: 1.9 }}>
                  · {note}
                </div>
              ))}
            </div>
          ) : null}

          {result.unsupported_types.length ? (
            <div className="meta-text" style={{ marginTop: 6 }}>
              你勾选的其他 {result.unsupported_types.length} 项（{result.unsupported_types.join('、')}）本次未实现，只跑了「数字复算」。
            </div>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          message="勘误失败"
          description={error}
          style={{ marginBottom: 10 }}
          action={
            <Button size="small" onClick={() => void run()}>
              重试
            </Button>
          }
        />
      ) : null}

      {/* 主体：左 PDF 原件 / 右 批注。两栏各自内部滚动，整块高度锁定在一屏内 */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          // 减去的值比原来多 70px：底部多了一条"裁决进度 + 保存"栏，不减会把两栏顶出屏幕
          height: 'calc(100vh - 400px)',
          minHeight: 420,
        }}
      >
        <div style={{ flex: 1, minWidth: 320, height: '100%' }}>
          {running && !result ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
              <Spin tip="正在勘误：解析 PDF → 抽取算式 → 本地复算 → 写批注…">
                <div style={{ width: 300, height: 100 }} />
              </Spin>
            </div>
          ) : (
            <PdfDocumentViewer
              url={errataLabApi.pdfUrl(reportPath)}
              marks={marks}
              focusPage={focusPage}
              onPickPage={pickPage}
              activeAnnotationId={selectedId}
              onPickAnnotation={locate}
            />
          )}
        </div>

        <div style={{ width: 470, flexShrink: 0, height: '100%', overflowY: 'auto', paddingRight: 6 }}>
          {visible.length ? (
            <>
              <div
                className="meta-text"
                style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <span>
                  {showAll ? `全部 ${annotations.length} 条` : `待处理 ${visible.length} 条`}
                  （按页码排序）｜点卡片可让左侧 PDF 跳到对应页
                </span>
                {hiddenCount ? (
                  <a style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setShowAll((value) => !value)}>
                    {showAll ? '只看问题' : `显示全部 ${annotations.length} 条`}
                  </a>
                ) : null}
              </div>
              {visible.map((item, index) => (
                <AnnotationCard
                  key={item.id}
                  annotation={item}
                  index={index}
                  active={selectedId === item.id}
                  human={decisions[item.id] ?? EMPTY_DECISION}
                  onLocate={() => locate(item.id)}
                  onDecide={(verdict) => decide(item.id, verdict)}
                  onNote={(note) => setNote(item.id, note)}
                  cardRef={(node) => {
                    if (node) cardRefs.current.set(item.id, node)
                    else cardRefs.current.delete(item.id)
                  }}
                />
              ))}
            </>
          ) : running ? null : annotations.length ? (
            <Empty
              description={`本次没有发现问题（另有 ${annotations.length} 条「复算一致」已隐藏）`}
              style={{ marginTop: 60 }}
            >
              <Typography.Text type="secondary">
                复核无误的数字也查过了，只是不再占版面；需要逐条看时点上方「显示全部」。
              </Typography.Text>
            </Empty>
          ) : (
            <Empty description="本次没有产出批注" style={{ marginTop: 60 }}>
              <Typography.Text type="secondary">
                如果提示"规则兜底"，说明没有接入大模型，覆盖率会很低。
              </Typography.Text>
            </Empty>
          )}

          {/* 被复核排除的条目（判定为"机器自己配错"）：默认收起、不占版面，
              但要能抽查 —— 只给一个"已排除 N 条"的数字，用户没法判断里面有没有被误杀的真问题。 */}
          {result?.review_excluded.length ? (
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 4 }}
              items={[
                {
                  key: 'excluded',
                  label: (
                    <span className="meta-text" style={{ fontSize: 12 }}>
                      另有 {result.review_excluded.length} 条被复核排除（判定为机器自己配错，未列为问题）· 点开可抽查
                    </span>
                  ),
                  children: (
                    <div style={{ fontSize: 12.5, lineHeight: 1.85 }}>
                      {result.review_excluded.map((item, index) => (
                        <div
                          key={index}
                          style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #f0f0f0' }}
                        >
                          <div className="meta-text">
                            第 {item.page} 页｜算式 <span className="num">{item.expression}</span>｜机器算出{' '}
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
                          <div style={{ color: 'var(--ink-2)' }}>{item.statement}</div>
                          <div style={{ color: '#2f54eb' }}>排除理由：{item.note}</div>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          ) : null}
        </div>
      </div>

      {/* 底部：裁决进度 + 保存（保存后自动进入下一步）。 */}
      {result && annotations.length ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 10,
            padding: '10px 14px',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            flexWrap: 'wrap',
          }}
        >
          <span className="meta-text">
            人工裁决进度：已判 {visible.length - decided.undecided}/{visible.length}（保留{' '}
            <span className="num">{decided.keep}</span> · 舍弃 <span className="num">{decided.discard}</span>
            {decided.undecided ? ` · 未判 ${decided.undecided}` : ''}）
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
            保存结果
          </Button>
        </div>
      ) : null}
    </div>
  )
}
