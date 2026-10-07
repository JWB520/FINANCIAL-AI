/**
 * api/client.ts —— 前端与后端通信的唯一出口（★ 后端工程师请先读这个文件）
 *
 * 【这个文件的职责（就这四件事）】
 *   1. 拼 URL、加鉴权头 Authorization: Bearer xxx、加追踪号 X-Trace-Id
 *   2. 超时与取消（AbortController）
 *   3. 把各种失败（网络断、超时、401、4xx、5xx）统一打包成一个 ApiError 对象，
 *      页面只需要 catch 到 ApiError 并弹它的 message，不用再判断 res.status
 *   4. 401 时自动用 refresh_token 换新令牌并重试**一次**，仍失败才认定登录失效
 *
 * 【本文件定义的内容清单】
 *   常量：API_BASE_URL / USE_MOCK / REQUEST_TIMEOUT
 *   常量表：ERROR_CODE（错误码词典，与 05 §7 一一对应）、ERROR_CODE_HINT（每种错误给用户的补充说明）
 *   类：ApiError（统一错误对象）、AuthTokenStore（令牌本地存取）
 *   函数：buildUrl() / createTraceId() / rawFetch() / request() / uploadForm()
 *   对象：client（对外使用的接口集合：get / post / patch / put / del / upload）
 *   函数：setUnauthorizedHandler()（登录失效时由上层注册跳转逻辑，避免 api 层依赖路由）
 *
 * 【后端工程师对接时需要知道的三件事】
 *   1. 所有接口前缀 /api/v1（见 05 §5 开头），开发环境由 vite 代理转发到 localhost:8000，
 *      配置在 vite.config.ts，前端代码里不出现硬编码的后端地址。
 *   2. 请求会带 X-Trace-Id 头（前端生成）。后端应在日志里记录它，这样用户报障时给个编号就能查。
 *      若后端返回体里带 trace_id，前端会优先用后端的，保证两边是同一个编号。
 *   3. 列表接口统一返回 { items, total, page, page_size }；错误统一返回
 *      { code, message, details, trace_id }。前端不自己编业务文案，直接显示 message。
 *
 * 【调试开关】
 *   .env.development 里 VITE_USE_MOCK=true 时，所有请求走 src/api/mock/ 的假数据，
 *   不需要后端也能把全部页面点一遍（比赛演示 / 前端单独开发时用）。
 *   把 VITE_USE_MOCK 改成 false 就切换为真实后端，业务代码一行都不用改。
 */
import type { ApiErrorBody } from './types'
import { handleMockRequest } from './mock/mockHandlers'

/* ============================================================================
 * 一、环境相关常量
 * ==========================================================================*/

/** 是否使用假数据。字符串 'true' 才为真，避免 VITE_USE_MOCK=false 被当成真值 */
export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'

/**
 * 接口前缀。优先用 VITE_API_DIRECT_URL（直连后端，用于联调后端同事的机器），
 * 否则用 VITE_API_BASE_URL（默认 /api/v1，走 vite 代理）。两者都没配就用 /api/v1 兜底。
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_DIRECT_URL as string) ||
  (import.meta.env.VITE_API_BASE_URL as string) ||
  '/api/v1'

/** 单个请求的超时时间（毫秒）。列表类接口够用，长任务进度走 SSE 不受它约束 */
export const REQUEST_TIMEOUT = Number(import.meta.env.VITE_REQUEST_TIMEOUT || 15000)
/* ---------------------------------------------------------------------------
 * 运行时覆盖层（设置页改完立刻生效，不用重启应用）
 *
 * 上面两个常量来自构建期环境变量，改不动；但设置页允许用户改「数据模式」与「接口地址」，
 * 所以这里留一层运行时可写的覆盖值：应用启动时读一次配置写进来，设置页保存后再写一次。
 * 没被覆盖过就退回环境变量的值 —— 命令行 / CI 那套用法完全不受影响。
 * -------------------------------------------------------------------------*/
let runtimeUseMock: boolean | null = null
let runtimeApiBaseUrl = ''

/** 应用启动时、以及设置页保存后调用，把配置里的这两项接进来 */
export function setRuntimeApiOptions(options: { useMock?: boolean; apiBaseUrl?: string }): void {
  if (typeof options.useMock === 'boolean') runtimeUseMock = options.useMock
  if (typeof options.apiBaseUrl === 'string' && options.apiBaseUrl.trim()) runtimeApiBaseUrl = options.apiBaseUrl.trim()
}

/** 当前是否在用假数据（设置页与顶栏标记都用它判断） */
export function isUsingMock(): boolean {
  return runtimeUseMock === null ? USE_MOCK : runtimeUseMock
}

/** 当前实际使用的接口前缀（设置页显示给用户看） */
export function currentApiBaseUrl(): string {
  return runtimeApiBaseUrl || API_BASE_URL
}

/* ============================================================================
 * 二、错误码词典（与 05_数据模型与接口契约.md §7 一一对应）
 *
 * 为什么要建这张表：错误码是前后端之间的"约定"，一旦改动必须两边同时改。
 * 写在这里注释里，后端工程师改错误码时可以一眼看到前端怎么用它。
 * ==========================================================================*/

export const ERROR_CODE = {
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED', // 401 令牌过期 -> 自动刷新一次，失败跳登录
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN', // 403 无权限 -> 显示无权限态
  VALIDATION_ERROR: 'VALIDATION_ERROR', // 400 参数错误 -> 字段级提示
  REPORT_PARSE_FAILED: 'REPORT_PARSE_FAILED', // 422 文档解析失败 -> 提示换可复制文本的版本
  TASK_MISSING_INPUTS: 'TASK_MISSING_INPUTS', // 409 所选维度缺资料 -> 引导上传
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING', // 409 该报告已有运行中任务 -> 跳过去
  STAGE_NOT_RETRYABLE: 'STAGE_NOT_RETRYABLE', // 409 该阶段不可重试
  CLAIM_REVISION_CONFLICT: 'CLAIM_REVISION_CONFLICT', // 409 复核冲突（别人先改了）-> 刷新
  REVIEW_REASON_REQUIRED: 'REVIEW_REASON_REQUIRED', // 400 驳回没填理由 -> 定位输入框
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED', // 500 出现无证据的高风险结论（内部缺陷）
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE', // 503 模型/数据源不可用
  RATE_LIMITED: 'RATE_LIMITED', // 429 触发限流
  INTERNAL_ERROR: 'INTERNAL_ERROR', // 500 未预期错误
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

/** 每种错误码配一句"用户该怎么做"，会拼在 message 后面。后端有 message 时以后端的为准 */
export const ERROR_CODE_HINT: Record<string, string> = {
  [ERROR_CODE.AUTH_TOKEN_EXPIRED]: '请重新登录',
  [ERROR_CODE.AUTH_FORBIDDEN]: '当前账号没有该操作的权限，请联系管理员开通',
  [ERROR_CODE.VALIDATION_ERROR]: '请检查填写内容后重试',
  [ERROR_CODE.REPORT_PARSE_FAILED]: '建议改用可复制文本的 PDF 或 Word 文件重新上传',
  [ERROR_CODE.TASK_MISSING_INPUTS]: '请先补齐缺失的资料，或取消勾选需要它的维度',
  [ERROR_CODE.TASK_ALREADY_RUNNING]: '正在跳转到进行中的任务',
  [ERROR_CODE.STAGE_NOT_RETRYABLE]: '该阶段当前不可重试',
  [ERROR_CODE.CLAIM_REVISION_CONFLICT]: '该条已被他人复核，已为你刷新为最新状态',
  [ERROR_CODE.REVIEW_REASON_REQUIRED]: '驳回 AI 必须填写理由',
  [ERROR_CODE.EVIDENCE_REQUIRED]: '这是内部缺陷（结论缺少证据），已记录，请联系工程师',
  [ERROR_CODE.UPSTREAM_UNAVAILABLE]: '模型或数据源暂时不可用，稍后重试即可',
  [ERROR_CODE.RATE_LIMITED]: '请求过于频繁，正在排队，请稍候',
  [ERROR_CODE.INTERNAL_ERROR]: '服务异常，请稍后重试',
}

/* ============================================================================
 * 三、统一错误对象
 * ==========================================================================*/

/**
 * ApiError —— 所有接口失败的统一形态。
 *
 * 页面里的用法永远只有两种：
 *   try { await api.xxx() } catch (e) { message.error((e as ApiError).userMessage) }
 *   或者用 useApiMutation，它已经帮你弹好了。
 *
 * 为什么要有它：fetch 失败的原因五花八门（断网、超时、500、401、被取消），
 * 如果不统一，每个页面都要写一堆 if，最后一定有人漏掉处理（比如把"未覆盖"当"通过"）。
 */
export class ApiError extends Error {
  /** 后端错误码（见 ERROR_CODE）；网络类错误用前端自造的 NETWORK_ERROR / TIMEOUT / ABORTED */
  readonly code: string
  /** HTTP 状态码；网络错误时为 0 */
  readonly httpStatus: number
  /** 后端返回的结构化补充信息，例如 { missing_inputs: ['external_reports'] } */
  readonly details: Record<string, unknown>
  /** 追踪号，报障时给后端工程师 */
  readonly traceId: string

  constructor(params: {
    code: string
    message: string
    httpStatus?: number
    details?: Record<string, unknown>
    traceId?: string
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.code = params.code
    this.httpStatus = params.httpStatus ?? 0
    this.details = params.details ?? {}
    this.traceId = params.traceId ?? ''
  }

  /** 给用户看的完整文案：错误说明 + 怎么办 + 追踪号 */
  get userMessage(): string {
    const hint = ERROR_CODE_HINT[this.code]
    const base = this.message || '请求失败'
    const withHint = hint && !base.includes(hint) ? `${base}（${hint}）` : base
    // 只有 5xx 与未知错误才把 traceId 抛给用户，4xx 是用户自己的问题，没必要吓唬他
    if (this.traceId && (this.httpStatus >= 500 || this.httpStatus === 0)) {
      return `${withHint}｜如问题持续，请把编号 ${this.traceId} 提供给技术人员`
    }
    return withHint
  }

  /** 是否需要跳登录（令牌彻底失效） */
  get isAuthError(): boolean {
    return this.httpStatus === 401
  }

  /** 是否是"别人先改了这条"的并发冲突，复核裁决页要特殊处理 */
  get isRevisionConflict(): boolean {
    return this.code === ERROR_CODE.CLAIM_REVISION_CONFLICT
  }

  /** 是否是"缺资料"，新建核查页要弹上传引导 */
  get isMissingInputs(): boolean {
    return this.code === ERROR_CODE.TASK_MISSING_INPUTS
  }

  /** 取出缺失资料清单（TASK_MISSING_INPUTS 专用） */
  get missingInputs(): string[] {
    const v = this.details?.missing_inputs
    return Array.isArray(v) ? (v as string[]) : []
  }
}

/* ============================================================================
 * 四、令牌存取
 * ==========================================================================*/

const ACCESS_KEY = 'rqc.access_token'
const REFRESH_KEY = 'rqc.refresh_token'

/**
 * 令牌怎么存、怎么取，只在这里实现。
 * 说明：用 localStorage 是为了刷新页面不丢登录态；比赛演示够用。
 * 若要上生产，建议改成 HttpOnly Cookie（防 XSS 窃取），改动只涉及这个对象。
 */
export const authToken = {
  getAccess(): string | null {
    return localStorage.getItem(ACCESS_KEY)
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_KEY)
  },
  save(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

/* ============================================================================
 * 五、工具函数
 * ==========================================================================*/

/** 生成本次请求的追踪号。优先用浏览器的 crypto.randomUUID，不支持时降级用时间戳+随机数 */
export function createTraceId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 把对象拼成 querystring。undefined / null / 空字符串会被丢掉，避免后端收到 ?status= 这种空筛选 */
export function buildUrl(path: string, params?: object): string {
  const url = `${currentApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  if (!params) return url
  const search = new URLSearchParams()
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      // 数组用逗号分隔，与 05 §8 的约定一致（risk=high,medium）
      if (value.length) search.append(key, value.join(','))
      return
    }
    search.append(key, String(value))
  })
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ============================================================================
 * 六、请求参数与核心请求函数
 * ==========================================================================*/

export interface RequestOptions {
  /**
   * URL 查询参数。
   * 类型写成 object 是刻意的：各资源自己的筛选参数接口（如 TaskListParams）不需要为了
   * 兼容这里而加索引签名，写起来更自然；真正拼 URL 的地方（buildUrl）再做一次收窄。
   */
  params?: object
  /** 请求体（对象会被 JSON.stringify；FormData 原样发送） */
  body?: unknown
  /** 额外请求头，例如复核动作要带的 If-Match: <revision> */
  headers?: Record<string, string>
  /** 本次请求的超时（毫秒），不传用 REQUEST_TIMEOUT */
  timeout?: number
  /** 外部取消信号（组件卸载时取消请求，避免"已卸载组件 setState"告警） */
  signal?: AbortSignal
  /** 跳过 mock 分流，强制打真实后端（联调时用） */
  noMock?: boolean
}

/** 登录失效时的回调。由 app/providers.tsx 注册，避免 api 层直接依赖路由库 */
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

/**
 * rawFetch —— 真正发请求的地方，只做四件事：加头、发请求、判状态、归一错误。
 * 不做 mock 分流、不做 401 重试，那两件事在下面的 request() 里做，职责分开更好读。
 */
async function rawFetch<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const traceId = createTraceId()

  // 超时控制：自己拿一个 AbortController，把外部 signal 也接进来（任一触发就中止）
  const controller = new AbortController()
  const timeout = options.timeout ?? REQUEST_TIMEOUT
  const timer = window.setTimeout(() => controller.abort(), timeout)
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const headers: Record<string, string> = {
    // 追踪号：后端请把它写进日志，前端会把它原样显示给用户用于报障
    'X-Trace-Id': traceId,
    ...(options.headers || {}),
  }
  // FormData 不能手动设 Content-Type，浏览器要自己带 boundary
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const access = authToken.getAccess()
  if (access) headers.Authorization = `Bearer ${access}`

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.params), {
      method,
      headers,
      signal: controller.signal,
      body: isFormData ? (options.body as FormData) : options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (err) {
    window.clearTimeout(timer)
    // 三种失败要区分开：用户主动取消、超时、真断网
    const isAbort = (err as Error)?.name === 'AbortError'
    if (isAbort && options.signal?.aborted) {
      throw new ApiError({ code: 'ABORTED', message: '请求已取消', httpStatus: 0, traceId })
    }
    if (isAbort) {
      throw new ApiError({ code: 'TIMEOUT', message: `请求超时（超过 ${Math.round(timeout / 1000)} 秒）`, httpStatus: 0, traceId })
    }
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请检查网络或后端服务是否已启动',
      httpStatus: 0,
      traceId,
    })
  } finally {
    window.clearTimeout(timer)
  }

  // 204 与其他空响应体：直接返回 undefined，避免 JSON.parse('') 抛异常
  const text = await response.text()
  let payload: unknown = undefined
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      // 后端返回了非 JSON（例如 nginx 的 502 页面），按错误处理
      if (!response.ok) {
        throw new ApiError({
          code: ERROR_CODE.INTERNAL_ERROR,
          message: `服务返回了无法解析的内容（HTTP ${response.status}）`,
          httpStatus: response.status,
          traceId,
        })
      }
      return undefined as T
    }
  }

  if (!response.ok) {
    // 统一错误体：{ code, message, details, trace_id }（05 §7）。字段缺失时用状态码兜底
    const body = (payload || {}) as Partial<ApiErrorBody>
    throw new ApiError({
      code: body.code || mapStatusToCode(response.status),
      message: body.message || `请求失败（HTTP ${response.status}）`,
      httpStatus: response.status,
      details: body.details,
      // 后端给了 trace_id 就用后端的，保证前后端日志是同一个编号
      traceId: body.trace_id || traceId,
    })
  }

  return payload as T
}

/** 后端没给错误码时，按 HTTP 状态码猜一个（保证前端一定有 code 可用） */
function mapStatusToCode(status: number): string {
  if (status === 401) return ERROR_CODE.AUTH_TOKEN_EXPIRED
  if (status === 403) return ERROR_CODE.AUTH_FORBIDDEN
  if (status === 400) return ERROR_CODE.VALIDATION_ERROR
  if (status === 429) return ERROR_CODE.RATE_LIMITED
  if (status === 503) return ERROR_CODE.UPSTREAM_UNAVAILABLE
  return ERROR_CODE.INTERNAL_ERROR
}

/** 刷新令牌用的"并发锁"：多个请求同时 401 时只发一次刷新请求，其余等它 */
let refreshing: Promise<boolean> | null = null

/**
 * 用 refresh_token 换新的 access_token。
 * 返回是否刷新成功；成功后原请求会被重试一次。
 */
async function refreshAccessToken(): Promise<boolean> {
  const refresh = authToken.getRefresh()
  if (!refresh) return false
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const result = await rawFetch<{ access_token: string; refresh_token?: string }>('POST', '/auth/refresh', {
          body: { refresh_token: refresh },
          timeout: 8000,
        })
        authToken.save(result.access_token, result.refresh_token || refresh)
        return true
      } catch {
        return false
      } finally {
        // 无论成功失败都释放锁，下一个 401 可以再试
        refreshing = null
      }
    })()
  }
  return refreshing
}

/**
 * request —— 对外的统一请求入口。所有 endpoint 都调它。
 *
 * 处理顺序（顺序很重要）：
 *   1. 假数据开关打开 -> 直接交给 mock 适配器，不发网络请求
 *   2. 正常请求
 *   3. 如果是 401 且手上有 refresh_token -> 刷新 -> 重试一次
 *   4. 还是失败 -> 通知上层跳登录（由 setUnauthorizedHandler 注册）
 */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  // 1) 假数据分流：后端没起来也能把页面点一遍
  if (isUsingMock() && !options.noMock && !path.startsWith('/auth/refresh')) {
    return handleMockRequest<T>(method, path, options)
  }

  try {
    return await rawFetch<T>(method, path, options)
  } catch (err) {
    const apiError = err as ApiError
    // 3) 令牌过期：自动续期后重试一次（只重试一次，避免死循环）
    if (apiError.isAuthError && !path.startsWith('/auth/')) {
      const ok = await refreshAccessToken()
      if (ok) {
        try {
          return await rawFetch<T>(method, path, options)
        } catch (retryErr) {
          const second = retryErr as ApiError
          if (second.isAuthError) {
            authToken.clear()
            unauthorizedHandler?.()
          }
          throw second
        }
      }
      // 刷新也失败：清掉本地令牌并通知上层跳登录
      authToken.clear()
      unauthorizedHandler?.()
    }
    throw apiError
  }
}

/* ============================================================================
 * 七、对外接口集合
 * ==========================================================================*/

/**
 * client —— 页面与 feature 只用这个对象发请求。
 *
 * 用法示例（详见 src/api/endpoints/ 下每个资源文件）：
 *   client.get<Page<Task>>('/tasks', { params: { status: 'running' } })
 *   client.post<ReviewAction>('/claims/c1/reviews', { body: { action: 'verify' } })
 */
export const client = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions) => request<T>('PATCH', path, options),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
  /** 文件上传（multipart/form-data），用于上传研报与知识库文档 */
  upload: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body: formData, timeout: 120000 }),
}
