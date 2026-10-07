/**
 * api/endpoints/tasks.ts —— 核查任务的创建、查询、控制
 *
 * 对应 05 §5.3：
 *   POST /tasks                                    创建核查任务
 *   GET  /tasks                                    任务列表（工作台/任务中心共用）
 *   GET  /tasks/{id}                               任务详情 + 阶段列表 + 计数
 *   GET  /tasks/{id}/events                        SSE 进度流（在 sse.ts 里实现）
 *   POST /tasks/{id}/cancel                        终止任务（保留已完成产物）
 *   POST /tasks/{id}/stages/{code}/retry           重试单个阶段
 *   POST /reports/{id}/recheck                     按新批次重新核查
 *
 * 【后端实现要点】
 *   - 创建任务时若所选维度缺资料，返回 409 + code=TASK_MISSING_INPUTS + details.missing_inputs[]
 *     前端据此弹"上传引导"，注意这是"提示"不是"报错"，不要弹红色错误
 *   - 该报告已有运行中任务时返回 409 + TASK_ALREADY_RUNNING，前端会跳到那个任务
 *   - 进度用加权计算（parse 5% + split 20% + classify 25% + check 45% + aggregate 5%），
 *     前端只显示 progress 字段，不自己算权重
 */
import { client } from '../client'
import type {
  TaskSubmitPayload, CheckMode, Page, Task } from '../types'

/** 任务列表筛选条件 */
export interface TaskListParams {
  status?: string
  owner?: string
  company?: string
  mode?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

/** 创建任务的请求体（05 §5.3） */
export interface CreateTaskPayload {
  report_id: string
  mode: CheckMode
  /** 勾选的维度代号 */
  dimensions: string[]
  options?: {
    /** 并发数，不传走后端默认值（.env 的 CHECK_CONCURRENCY） */
    concurrency?: number
    /** 是否重跑已完成维度 */
    rerun_completed?: boolean
    /** 是否复用缓存结果（演示时打开它，30 秒出结果） */
    use_cache?: boolean
  }
}

export const taskApi = {
  /**
   * 提交任务请求（勘误 / 评估）。
   *
   * 【和 taskApi.create 的区别】
   *   create 是"报告已经解析好了，直接排一条核查任务"；
   *   submit 是"用户在表单里选好了类型、范围、深度、备注，把它交给后端去执行"，
   *   请求体里带着完整的意图（见 types.ts 的 TaskSubmitPayload）。
   *   桌面端调用前会先把这份请求留档到项目的 data/tasks/ 下。
   */
  submit(payload: TaskSubmitPayload): Promise<Task> {
    return client.post<Task>('/tasks/submit', { body: payload })
  },
  /** 创建核查任务，返回创建好的任务（一般是 pending/running 状态） */
  create: (payload: CreateTaskPayload) => client.post<Task>('/tasks', { body: payload }),

  /** 任务列表 */
  list: (params: TaskListParams) => client.get<Page<Task>>('/tasks', { params }),

  /**
   * 任务详情：含 stages（阶段列表）与 counters（实时计数）。
   * 进度页每次收到 SSE 事件后都会调它做"快照校正"，保证界面不会因为丢事件而停在旧状态。
   */
  detail: (taskId: string) => client.get<Task>(`/tasks/${taskId}`),

  /** 终止任务：已完成阶段的产物保留，之后可以只补跑没跑完的阶段 */
  cancel: (taskId: string, reason?: string) =>
    client.post<Task>(`/tasks/${taskId}/cancel`, { body: { reason } }),

  /** 重试某个失败阶段（进度页红色阶段上的"重试"按钮） */
  retryStage: (taskId: string, stageCode: string) =>
    client.post<Task>(`/tasks/${taskId}/stages/${stageCode}/retry`),

  /**
   * 重新核查：产生新批次。
   * 旧批次的结论完整保留，用于"改完再核一遍"的对比（这是复核闭环的关键一环）。
   */
  recheck: (reportId: string, payload: Omit<CreateTaskPayload, 'report_id'>) =>
    client.post<Task>(`/reports/${reportId}/recheck`, { body: payload }),
}