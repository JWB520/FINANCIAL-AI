/**
 * api/endpoints/knowledge.ts —— 知识库管理
 *
 * 对应 05 §5.6：知识库文档 CRUD、启停、分片查看
 *
 * 【后端实现要点】
 *   - 文档有 type（规范/估值规则/禁用表达/指标定义/案例/外部研报），
 *     type 决定了它能支撑哪些维度：例如只有上传了 external_report，观点交叉验证才会跑，
 *     否则该维度标记为"未覆盖"。
 *   - 启停只影响**后续新任务**，历史结论不动（否则昨天的报告结论会莫名其妙变化）。
 *   - 上传后要切片（chunk）并建索引，界面要显示切片数，让用户确认"资料真的入库了"。
 */
import { client } from '../client'
import type { KnowledgeChunk, KnowledgeDoc, KnowledgeType, Page } from '../types'

export interface KnowledgeListParams {
  type?: KnowledgeType
  enabled?: boolean
  q?: string
  page?: number
  page_size?: number
}

export interface UploadKnowledgePayload {
  file: File
  type: KnowledgeType
  title: string
  /** 生效起始日 */
  effective_from?: string
  /** 适用维度；空数组=全部适用 */
  scope?: string[]
}

export const knowledgeApi = {
  list: (params: KnowledgeListParams) => client.get<Page<KnowledgeDoc>>('/knowledge/docs', { params }),

  upload: (payload: UploadKnowledgePayload) => {
    const form = new FormData()
    form.append('file', payload.file)
    form.append('type', payload.type)
    form.append('title', payload.title)
    if (payload.effective_from) form.append('effective_from', payload.effective_from)
    if (payload.scope?.length) form.append('scope', payload.scope.join(','))
    return client.upload<KnowledgeDoc>('/knowledge/docs', form)
  },

  /** 启用 / 停用。停用后新任务不再使用该资料，历史结论保持不变 */
  setEnabled: (docId: string, enabled: boolean) =>
    client.patch<KnowledgeDoc>(`/knowledge/docs/${docId}/enable`, { body: { enabled } }),

  /** 删除（软删）：后端保留记录用于审计 */
  remove: (docId: string) => client.del<void>(`/knowledge/docs/${docId}`),

  /** 查看某份文档切出来的分片，用于排查"为什么没检索到" */
  chunks: (docId: string, page = 1) =>
    client.get<Page<KnowledgeChunk>>('/knowledge/chunks', { params: { doc_id: docId, page } }),

  /** 全文检索分片（帮助页与证据查看器都会用） */
  searchChunks: (q: string, page = 1) =>
    client.get<Page<KnowledgeChunk>>('/knowledge/chunks', { params: { q, page } }),
}