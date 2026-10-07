/**
 * api/endpoints/audit.ts —— 审计与运行日志
 *
 * 对应 05 §5.6：GET /audit/events、GET /audit/trace/{traceId}
 *
 * 【这个页面存在的意义】
 *   用户看到一条"高风险"结论时，一定想追问："你凭什么这么说？花了我多少钱？"
 *   审计日志就是回答这两个问题的：用了哪个模型、哪个提示词版本、调了什么工具、
 *   耗时多少、token 多少、输入输出摘要是什么、trace_id 是多少。
 *
 * 【后端实现要点】
 *   - 审计日志必须分页，禁止无分页拉全量（05 §8）。
 *   - 只存摘要与哈希，不存完整原文与完整模型输入输出（06 §1.3：日志里不许出现全文与密钥）。
 *   - 索引 (task_id, created_at)、(trace_id)、(claim_id)，前端会按这三种维度过滤。
 */
import { client } from '../client'
import type { AuditEvent, Page } from '../types'

export interface AuditEventParams {
  task_id?: string
  stage_code?: string
  event_type?: string
  model?: string
  tool?: string
  status?: string
  /** 从某条 Finding 反查："这条结论凭什么" */
  claim_id?: string
  trace_id?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

export const auditApi = {
  /** 审计事件列表（支持按任务、阶段、事件类型、模型、工具、trace_id 过滤） */
  events: (params: AuditEventParams) => client.get<Page<AuditEvent>>('/audit/events', { params }),

  /**
   * 按 trace_id 拉全链路：一次任务里所有相关事件按时间排好，
   * 用于回答"这条结论从解析到产出经过了哪些步骤"。
   */
  trace: (traceId: string) => client.get<{ trace_id: string; events: AuditEvent[] }>(`/audit/trace/${traceId}`),
}