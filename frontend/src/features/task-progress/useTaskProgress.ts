/**
 * features/task-progress/useTaskProgress.ts —— 订阅任务进度（SSE）并维护页面上的进度状态
 *
 * 【这个 hook 负责什么】
 *   把"事件流"变成"页面能直接渲染的状态"，并且处理三件容易出错的事：
 *     1. 断线重连后先拉一次快照（防止丢事件导致进度停在旧值）；
 *     2. 连续失败降级为轮询，并把降级状态交给页面去提示用户；
 *     3. 组件卸载时取消订阅（否则连接会越开越多）。
 *
 * 【为什么不用 useEffect 里直接 fetch】
 *   因为流式连接有自己的生命周期（连上 / 掉线 / 重连 / 关闭），
 *   写成 hook 之后页面只需要读 state，逻辑集中在这一处，改起来也不会漏。
 *
 * 【本文件导出】useTaskProgress(taskId) => { task, stages, counters, connection, snapshot }
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeTaskProgress, taskApi, type TaskSseEvent } from '@/api'
import type { StageCode, StageStatus, Task, TaskStage } from '@/api'

/** 连接状态：让页面能把"实时连接断了"这件事明确告诉用户，而不是让进度条干等着 */
export type ConnectionState = 'connecting' | 'live' | 'polling'

export interface TaskProgressState {
  /** 任务快照（来自 GET /tasks/{id}，SSE 事件只用于催更） */
  task: Task | undefined
  /** 阶段列表（按流水线顺序排好） */
  stages: TaskStage[]
  /** 实时计数 */
  counters: Task['counters']
  /** 连接状态 */
  connection: ConnectionState
  /** 降级原因（connection === 'polling' 时有值） */
  degradedReason: string | null
  /** 快照还在加载（页面据此显示骨架屏，而不是把 undefined 当成"没有任务"） */
  isLoading: boolean
  /** 快照查询失败的原因（任务不存在 / 网络失败）—— 页面要能区分"加载中"和"加载失败" */
  error: unknown
  /** 手动刷新一次快照 */
  refresh: () => void
}

export function useTaskProgress(taskId: string): TaskProgressState {
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [degradedReason, setDegradedReason] = useState<string | null>(null)

  // 基础快照：页面任何时刻都能只靠这个查询恢复完整状态（不依赖 SSE 是否在线）
  const { data: task, isLoading, error } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.detail(taskId),
    enabled: Boolean(taskId),
    // 任务在跑的时候要勤刷一点，跑完就不用刷了
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'running' || status === 'pending') return 5000
      return false
    },
  })

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['task', taskId] })
  }, [queryClient, taskId])

  // 事件里的阶段状态：与快照合并后展示，避免"事件到了但快照还没刷"的闪烁
  const stageEvents = useRef<Map<StageCode, { status: StageStatus; progress: number; message?: string }>>(new Map())
  const [, forceRender] = useState(0)

  useEffect(() => {
    if (!taskId) return undefined

    // 订阅进度流：onConnected 里做的事很关键 —— 每（重）连一次都先拉快照
    const unsubscribe = subscribeTaskProgress(taskId, {
      onEvent: (event: TaskSseEvent) => {
        if (event.event === 'stage') {
          stageEvents.current.set(event.data.stage_code, {
            status: event.data.status,
            progress: event.data.progress,
            message: event.data.message,
          })
          forceRender((n) => n + 1)
        } else if (event.event === 'counters') {
          // 计数变化：直接写进快照缓存，工作台与总览页的数字会跟着动
          queryClient.setQueryData<Task>(['task', taskId], (prev) =>
            prev ? { ...prev, counters: { ...event.data } } : prev
          )
        } else if (event.event === 'task') {
          // 任务终态：拉一次最终快照，并让相关列表失效
          refresh()
          queryClient.invalidateQueries({ queryKey: ['tasks'] })
          queryClient.invalidateQueries({ queryKey: ['reviews'] })
        } else if (event.event === 'error') {
          refresh()
        }
      },
      onConnected: () => {
        setConnection('live')
        setDegradedReason(null)
        // 关键：重连后先拉快照，防止丢事件导致状态停在旧值
        refresh()
      },
      onDegraded: (reason) => {
        setConnection('polling')
        setDegradedReason(reason)
      },
    })

    return unsubscribe
  }, [taskId, queryClient, refresh])

  // 把快照与事件合并成最终的阶段列表
  const stages: TaskStage[] = (task?.stages ?? []).map((stage) => {
    const fromEvent = stageEvents.current.get(stage.stage_code)
    if (!fromEvent) return stage
    return { ...stage, status: fromEvent.status, progress: fromEvent.progress }
  })

  return {
    task,
    stages,
    counters: task?.counters,
    connection,
    degradedReason,
    isLoading,
    error,
    refresh,
  }
}