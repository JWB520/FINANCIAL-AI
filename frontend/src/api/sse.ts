/**
 * api/sse.ts —— 长连接（Server-Sent Events）客户端
 *
 * 系统里有两条流式通道（04_前端架构.md §8）：
 *   1. 任务进度：GET /tasks/{id}/events —— 阶段进度、计数、失败原因
 *   2. 单条追问：POST /claims/{id}/ask —— 回答一个字一个字地流出来
 *
 * 【为什么不用浏览器自带的 EventSource】
 *   EventSource 不能自定义请求头，也就带不了 Authorization，所以这里用
 *   fetch + ReadableStream 手动解析 SSE 文本。代价是要自己写重连逻辑，收益是能鉴权。
 *
 * 【两条硬规则（踩过坑）】
 *   1. SSE 只用来"催更"，不作为数据来源：任何时刻刷新页面，页面都能只靠普通 GET 恢复完整状态。
 *      所以每次重连成功后，都会回调 onConnected，让页面先拉一次快照，再继续接收增量事件。
 *   2. 断线要指数退避重连（1s→2s→4s→8s→…→30s 封顶）；连续多次失败就降级为轮询，
 *      并在界面上明确告诉用户"实时连接已中断，已切换为轮询"，不能让进度条静止在那里让用户干等。
 *
 * 【本文件导出】
 *   subscribeTaskProgress(taskId, handlers)  ->  取消订阅函数
 *   askClaimStream(claimId, question, handlers) -> Promise<void>
 *   type TaskStreamHandlers / AskStreamHandlers
 */
import { API_BASE_URL, USE_MOCK, authToken, ApiError, createTraceId } from './client'
import type { AskSseEvent, TaskSseEvent } from './types'
import { mockAskStream, mockTaskProgressStream } from './mock/mockStream'

/** 进度流的回调集合 */
export interface TaskStreamHandlers {
  /** 收到一个进度事件 */
  onEvent: (event: TaskSseEvent) => void
  /** 每次连接成功（含重连成功）后调用：页面应在这里拉一次任务快照，防止丢事件 */
  onConnected?: () => void
  /** 连续失败后降级：页面应改为轮询并提示用户 */
  onDegraded?: (reason: string) => void
}

/** 追问流的回调集合 */
export interface AskStreamHandlers {
  /** 收到一段文字（流式回答就是这样一段段拼出来的） */
  onChunk: (text: string) => void
  /** 回答结束 */
  onDone: (payload: { message_id: string; citations: Array<{ claim_id: string | null; label: string }> }) => void
  /** 出错 */
  onError: (error: ApiError) => void
}

/** 退避间隔（毫秒）：1s / 2s / 4s / 8s / 16s / 30s 封顶 */
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
/** 连续失败到第几次就降级为轮询 */
const MAX_RETRY_BEFORE_DEGRADE = 3

/**
 * parseSseChunk —— 把 SSE 原始文本块解析成一条条事件。
 *
 * SSE 的格式很简单（05 §6）：
 *   event: stage
 *   data: {"stage_code":"check","progress":78}
 *   （空行表示一条事件结束）
 *
 * 注意要处理"半个事件"的情况：网络分包可能把一个事件切成两半，
 * 所以调用方要用缓冲区保存未完成的尾巴，等下一块数据到了再补上。
 */
function parseSseChunk(raw: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = []
  // 事件之间用空行分隔
  for (const block of raw.split(/\n\n/)) {
    const lines = block.split('\n').filter(Boolean)
    if (!lines.length) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) events.push({ event, data: dataLines.join('\n') })
  }
  return events
}

/**
 * subscribeTaskProgress —— 订阅任务进度流。
 *
 * 返回一个"取消订阅"函数，组件卸载时必须调用它（否则连接会一直挂着，越开越多）。
 *
 * 用法（见 src/features/task-progress/useTaskProgress.ts）：
 *   useEffect(() => subscribeTaskProgress(taskId, { onEvent, onConnected, onDegraded }), [taskId])
 */
export function subscribeTaskProgress(taskId: string, handlers: TaskStreamHandlers): () => void {
  // 假数据模式：用定时器模拟后端推送，方便没有后端时演示进度条
  if (USE_MOCK) {
    return mockTaskProgressStream(taskId, handlers)
  }

  const controller = new AbortController()
  let retryCount = 0
  let closed = false
  let retryTimer: number | undefined

  /** 发一次连接请求并消费流；断开后由 scheduleRetry 负责重连 */
  const connect = async () => {
    if (closed) return
    try {
      const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/events`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: authToken.getAccess() ? `Bearer ${authToken.getAccess()}` : '',
          'X-Trace-Id': createTraceId(),
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new ApiError({
          code: 'SSE_CONNECT_FAILED',
          message: `进度连接失败（HTTP ${response.status}）`,
          httpStatus: response.status,
        })
      }

      // 连上了：重置退避计数，并通知页面先拉一次快照
      retryCount = 0
      handlers.onConnected?.()

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      // 一直读到流结束或被 abort
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // 只有遇到空行才说明一条事件完整了，最后一段留着下次拼接
        const lastBreak = buffer.lastIndexOf('\n\n')
        if (lastBreak === -1) continue
        const complete = buffer.slice(0, lastBreak)
        buffer = buffer.slice(lastBreak + 2)

        for (const { event, data } of parseSseChunk(complete)) {
          try {
            const parsed = JSON.parse(data)
            handlers.onEvent({ event: event as TaskSseEvent['event'], data: parsed } as TaskSseEvent)
          } catch {
            // 单条事件解析失败不影响整个流，跳过即可（后端格式偶尔不规范时别把页面搞崩）
          }
        }
      }
      // 流正常结束（后端关闭连接）：如果还没到终态，安排一次重连
      scheduleRetry()
    } catch (err) {
      if (closed || (err as Error)?.name === 'AbortError') return
      scheduleRetry()
    }
  }

  /** 退避重连；连续失败达到阈值就告诉页面降级为轮询 */
  const scheduleRetry = () => {
    if (closed) return
    retryCount += 1
    if (retryCount > MAX_RETRY_BEFORE_DEGRADE) {
      handlers.onDegraded?.('实时连接连续中断，已切换为定时轮询（每 5 秒刷新一次）')
      // 降级后不再自动重连，由页面用轮询兜底；页面重新进入时再订阅一次
      return
    }
    const delay = BACKOFF_STEPS[Math.min(retryCount - 1, BACKOFF_STEPS.length - 1)]
    retryTimer = window.setTimeout(connect, delay)
  }

  void connect()

  // 取消订阅：关闭连接并清掉待执行的重连
  return () => {
    closed = true
    controller.abort()
    if (retryTimer) window.clearTimeout(retryTimer)
  }
}

/**
 * askClaimStream —— 单条追问（对某条结论问"为什么这么判"）。
 *
 * 与进度流的区别：这是 POST 且要发请求体，流结束后需要拿最终的引用列表。
 * 追问内容不会被当成核查结论落库（刻意的边界，见 04 §5.5 追问抽屉）。
 */
export async function askClaimStream(
  claimId: string,
  question: string,
  handlers: AskStreamHandlers
): Promise<void> {
  if (USE_MOCK) {
    return mockAskStream(claimId, question, handlers)
  }

  try {
    const response = await fetch(`${API_BASE_URL}/claims/${claimId}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: authToken.getAccess() ? `Bearer ${authToken.getAccess()}` : '',
        'X-Trace-Id': createTraceId(),
      },
      body: JSON.stringify({ question }),
    })

    if (!response.ok || !response.body) {
      throw new ApiError({
        code: 'SSE_CONNECT_FAILED',
        message: `追问失败（HTTP ${response.status}）`,
        httpStatus: response.status,
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lastBreak = buffer.lastIndexOf('\n\n')
      if (lastBreak === -1) continue
      const complete = buffer.slice(0, lastBreak)
      buffer = buffer.slice(lastBreak + 2)

      for (const { event, data } of parseSseChunk(complete)) {
        try {
          const parsed = JSON.parse(data) as AskSseEvent['data']
          if (event === 'chunk') handlers.onChunk((parsed as { text: string }).text)
          else if (event === 'done') handlers.onDone(parsed as never)
        } catch {
          // 忽略解析不了的碎片
        }
      }
    }
  } catch (err) {
    handlers.onError(
      err instanceof ApiError
        ? err
        : new ApiError({ code: 'SSE_FAILED', message: '追问失败，请稍后重试', httpStatus: 0 })
    )
  }
}