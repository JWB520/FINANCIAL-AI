/**
 * api/mock/mockStream.ts —— 假数据模式下的两条"流式通道"
 *
 * 系统有两处长连接（04_前端架构.md §8）：
 *   1. 任务进度：真后端是 SSE（GET /tasks/{id}/events），这里用定时器模拟，每 1.2 秒推一个事件；
 *   2. 单条追问：真后端是流式回答（POST /claims/{id}/ask），这里用打字机效果一段段吐字。
 *
 * 【为什么要模拟得这么细】
 *   进度条、阶段列表、计数变化、失败重试、追问流式这些都是"交互体验"的核心，
 *   如果假数据只返回一个最终结果，前端根本没法验证自己的进度逻辑对不对。
 *
 * 【本文件导出】
 *   mockTaskProgressStream(taskId, handlers)  返回取消订阅函数
 *   mockAskStream(claimId, question, handlers)  返回 Promise
 */
import type { StageCode, StageStatus, TaskSseEvent } from '../types'
import type { AskStreamHandlers, TaskStreamHandlers } from '../sse'
import { MOCK_CLAIMS, MOCK_FINDINGS } from './mockData'
import { RISK_LEVEL_LABEL, STAGE_CODE_LABEL } from '../enums'
import { mockTaskById } from './mockHandlers'

/** 每个阶段的"刻度数"：数值越大跑得越久（check 最久，因为要逐条核对） */
const STAGE_TICKS: Record<StageCode, number> = { parse: 2, claim_split: 3, claim_classify: 4, check: 6, aggregate: 2 }

/** 加权总进度（与后端权重一致）：parse 5 / claim_split 20 / claim_classify 25 / check 45 / aggregate 5 */
const STAGE_WEIGHTS: Record<StageCode, number> = { parse: 5, claim_split: 20, claim_classify: 25, check: 45, aggregate: 5 }

/** 每个阶段跑起来时写在阶段行上的统计（对应 TaskProgressList 的 statText） */
function stageStat(code: StageCode, tick: number): Record<string, number> {
  if (code === 'parse') return { blocks: 20 }
  if (code === 'claim_split') return { claims_total: 16 }
  if (code === 'claim_classify') return { done: Math.round((tick / STAGE_TICKS.claim_classify) * 16), claims_total: 16 }
  if (code === 'check') return { done: Math.round((tick / STAGE_TICKS.check) * 16), findings: 16 }
  return { dimensions: 9 }
}

/**
 * 模拟任务进度流。
 *
 * 【为什么必须真的改任务数据（这一版的核心修正）】
 *   上一版只在内存里算总进度、最后 `void totalProgress` 把它丢掉，也从不写回 db.tasks：
 *   终态事件只发给了"当时正打开着的那个页面"，刷新/换页/重开窗口后任务仍显示 running。
 *   现在进度流**直接推进 mock 数据库里的那条任务**：阶段状态、总进度、计数器、终态
 *   （completed + finished_at）全部写回去 —— 看到的状态和真实后端一样是持久的。
 *
 * 【驱动的是"这条任务自己的阶段表"】不再写死 5 个阶段代号，
 *   而是按任务里 stages 的顺序逐个推进：任务有几个阶段、叫什么，由数据决定。
 *
 * 注意：返回的函数必须被调用（组件卸载时），否则定时器会一直跑。
 */
export function mockTaskProgressStream(taskId: string, handlers: TaskStreamHandlers): () => void {
  handlers.onConnected?.()

  let stopped = false
  const push = (event: TaskSseEvent) => {
    if (!stopped) handlers.onEvent(event)
  }

  const task = mockTaskById(taskId)
  if (!task) {
    // 任务不存在就明确报错 —— 否则页面会一直停在加载态（这和真实后端返回 404 的行为一致）
    // 错误事件需要带阶段代号与"能否重试"：任务不存在属于不可重试，靠返回上一步/刷新解决
    push({ event: 'error', data: { stage_code: 'parse', message: '任务不存在：' + taskId, retryable: false } })
    return () => {
      stopped = true
    }
  }

  const stages = task.stages ?? []
  const firstUnfinished = stages.findIndex((stage) => stage.status !== 'done')
  if (!stages.length || firstUnfinished < 0 || (task.status !== 'running' && task.status !== 'pending')) {
    // 没有阶段 / 已经跑完 / 已终止：不做动画，只把当前真实状态推一次
    push({ event: 'task', data: { status: task.status, message: task.message ?? '', progress: task.progress } })
    return () => {
      stopped = true
    }
  }

  // 计数器直接引用任务对象上的那一份，改动即持久化
  const counters = task.counters ?? { claims_total: 0, findings_high: 0, findings_medium: 0, findings_low: 0, uncovered: 0 }
  task.counters = counters

  let index = firstUnfinished
  let tick = 0
  let totalProgress = task.progress

  /** 收尾：写回终态并推一次 task 事件（页面据此去拉最终快照） */
  const finish = () => {
    task.status = 'completed'
    task.progress = 100
    task.current_stage = null
    task.message = '核查完成，发现 3 条高风险'
    task.updated_at = new Date().toISOString()
    task.finished_at = new Date().toISOString()
    push({ event: 'task', data: { status: 'completed', message: task.message ?? '', progress: 100 } })
    stopped = true
    window.clearInterval(timer)
    window.clearInterval(heartbeat)
  }

  const timer = window.setInterval(() => {
    if (stopped) return
    const stage = stages[index]
    if (!stage) {
      finish()
      return
    }

    tick += 1
    const ticks = STAGE_TICKS[stage.stage_code] ?? 3
    const stageProgress = Math.min(100, Math.round((tick / ticks) * 100))
    const finished = stageProgress >= 100
    const before = stages.slice(0, index).reduce((sum, item) => sum + (STAGE_WEIGHTS[item.stage_code] ?? 0), 0)
    totalProgress = Math.min(99, Math.round(before + ((STAGE_WEIGHTS[stage.stage_code] ?? 0) * stageProgress) / 100))
    if (finished && index === stages.length - 1) totalProgress = 99 // 100 留给终态，避免"100 了还在跑"

    const now = new Date().toISOString()

    // ① 写回任务数据：刷新页面、换页签都能看到同一份进度
    stage.status = (finished ? 'done' : 'running') as StageStatus
    stage.progress = stageProgress
    stage.stat = stageStat(stage.stage_code, tick)
    if (!stage.started_at) stage.started_at = now
    stage.duration_ms = new Date(now).getTime() - new Date(stage.started_at).getTime()
    if (finished) stage.finished_at = now
    task.progress = totalProgress
    task.current_stage = stage.stage_code
    task.updated_at = now
    task.message = '正在' + STAGE_CODE_LABEL[stage.stage_code]

    // ② 核查阶段顺手推计数变化（演示"工作台/总览页的数字会跟着动"）
    if (stage.stage_code === 'check' && tick % 2 === 0) {
      const done = Math.round((tick / ticks) * 16)
      counters.claims_total = 16
      counters.findings_high = Math.min(3, Math.round(done / 6))
      counters.findings_medium = Math.min(2, Math.round(done / 8))
      counters.findings_low = Math.min(1, Math.round(done / 16))
      counters.uncovered = Math.min(3, Math.round(done / 6))
      push({ event: 'counters', data: { ...counters } })
    }

    // ③ 推事件：页面实时更新（事件里的阶段状态与写回的数据是同一份，不会两边不一致）
    push({
      event: 'stage',
      data: {
        stage_code: stage.stage_code,
        status: stage.status,
        progress: stageProgress,
        message: stage.stage_code === 'claim_classify' || stage.stage_code === 'check' ? `${Math.round((tick / ticks) * 16)}/16` : '',
      },
    })

    if (finished) {
      index += 1
      tick = 0
      if (index >= stages.length) finish()
    }
  }, 1200)

  // 心跳：每 5 秒一次，页面可用它检测"连接还活着"
  const heartbeat = window.setInterval(() => {
    push({ event: 'heartbeat', data: { ts: new Date().toISOString() } })
  }, 5000)

  // 取消订阅：清掉两个定时器
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.clearInterval(heartbeat)
  }
}

/**
 * 模拟单条追问的流式回答。
 *
 * 回答内容根据这条主张的结论"编"出来（引用了命中的规则编号与复算过程），
 * 让演示时看起来像是真的在解释判定理由。**注意：追问不落库为结论**（刻意的边界）。
 */
export async function mockAskStream(
  claimId: string,
  question: string,
  handlers: AskStreamHandlers
): Promise<void> {
  const claim = MOCK_CLAIMS.find((c) => c.id === claimId)
  const finding = MOCK_FINDINGS.find((f) => f.claim_id === claimId)

  // 根据这条结论"拼"一段像样的回答
  let answer = '这条主张目前没有核查结论，可能是该维度未运行或尚未跑完。建议先确认维度是否勾选。'
  if (finding) {
    if (finding.status === 'risk' && finding.risk_level) {
      const rule = finding.rule_hits[0]
      answer =
        `判定为${RISK_LEVEL_LABEL[finding.risk_level]}的依据是规则 ${rule?.code ?? ''}（${rule?.desc ?? ''}）。\n\n` +
        `具体过程：${finding.reason}\n\n` +
        (finding.calc_trace
          ? `复算式：${finding.calc_trace.expression} = ${finding.calc_trace.computed}，原文写的是 ${finding.calc_trace.claimed}，` +
            `偏差 ${finding.calc_trace.deviation}，超出容差 ${finding.calc_trace.tolerance}。\n\n`
          : '') +
        `证据 ${finding.evidences.length} 条（${finding.evidences.map((e) => e.type).join('、')}）。\n\n` +
        `说明：风险等级由规则表算出，模型只负责判断规则是否命中；如果你认为规则本身不合适，` +
        `可以在"经验学习"里看到基于这类驳回生成的规则修改候选。`
    } else if (finding.status === 'pass') {
      answer = `这条已核查通过：${finding.reason}\n\n该结论有 ${finding.evidences.length} 条证据支撑，可点开查看来源。`
    } else if (finding.status === 'uncovered') {
      answer =
        `这条是"未覆盖"，不是"通过"：${finding.uncovered_reason ?? '缺少必要资料'}。\n\n` +
        `未覆盖表示系统这次没有能力核对它，它会单独统计，不会算进通过率。补齐资料后重新核查即可。`
    } else {
      answer = `这条核查失败：${finding.uncovered_reason ?? '核查过程出错'}。\n\n可以在进度页对该阶段点"重试"，已完成阶段的产物会保留。`
    }
  }

  const text = `你问的是："${question}"\n\n${answer}`

  // 按 4 个字符一段吐字，模拟流式输出（比逐字快一点，演示节奏更舒服）
  const chunkSize = 4
  for (let i = 0; i < text.length; i += chunkSize) {
    const piece = text.slice(i, i + chunkSize)
    handlers.onChunk(piece)
    // 每段之间停 18ms，整段回答大约 1.5 秒左右
    await new Promise((resolve) => setTimeout(resolve, 18))
  }

  handlers.onDone({ message_id: 'msg-' + Date.now(), citations: [{ claim_id: claimId, label: '原文定位' }] })
  void claim
}