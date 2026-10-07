/**
 * api/endpoints/learning.ts —— 经验学习闭环（案例 → 候选 → 审核发布 → 回滚）
 *
 * 对应 05 §5.6：/learning/cases、/learning/candidates、/learning/versions
 *
 * 【这个模块的意义（也是比赛答辩的加分点）】
 *   人工每一次"驳回 AI + 填理由"，都会沉淀成一条案例；案例攒够后，系统归纳出
 *   "规则/提示词该怎么改"的候选；候选**必须由人点击发布**才生效，并且版本化、可回滚。
 *   一句话：系统会越用越准，但判据永远由人掌握（架构约束 5）。
 *
 * 【后端实现要点】
 *   - 候选必须能追溯到"来自哪几条人工裁决"，前端要把它展示出来，否则用户不敢批。
 *   - 同一 key 同时只能有一个 active 版本；灰度时允许多个 canary。
 *   - 发布/回滚都要写审计事件（event_type=rule_publish）。
 */
import { client } from '../client'
import type { ExperienceCase, LearningCandidate, Page, RuleVersion } from '../types'

export const learningApi = {
  /**
   * 删除学习候选（**任何状态都能删**）。
   *
   * 【已审核过的候选要多一道手续】
   *   它承载着"这条规则当初为什么通过 / 被驳回"的决策信息，所以删除**必须填理由**；
   *   没填理由后端返回 400，前端弹窗也强制填。
   * @param reason 删除原因（已审核过的必填，pending 可空）
   */
  removeCandidate(id: string, reason?: string): Promise<{ deleted: boolean }> {
    return client.del<{ deleted: boolean }>('/learning/candidates/' + id, { body: { reason } })
  },

  /** 删除经验案例（案例是学习素材，允许清理；删除会写审计事件） */
  removeCase(id: string): Promise<{ deleted: boolean }> {
    return client.del<{ deleted: boolean }>('/learning/cases/' + id)
  },

  /**
   * 删除规则版本（**不限制状态**：生效中的也能删）。
   *
   * 【删掉"生效中"的版本时后端会自动兜底】
   *   把同一条规则下最近的归档版本切回生效，并在返回值 promoted 里告诉前端切到了哪一版；
   *   如果该规则已无任何历史版本，promoted 为 null（系统退回默认判据）。
   *   这样"允许删"与"系统不能没有判据"两件事就不冲突了。
   * @param reason 删除原因（可选，写进审计事件）
   */
  removeVersion(
    id: string,
    reason?: string
  ): Promise<{ deleted: boolean; promoted: { id: string; key: string; version: number } | null }> {
    return client.del<{ deleted: boolean; promoted: { id: string; key: string; version: number } | null }>(
      '/learning/versions/' + id,
      { body: { reason } }
    )
  },
  /** 经验案例列表（由人工裁决沉淀而来） */
  cases: (params?: { case_type?: string; dimension?: string; page?: number }) =>
    client.get<Page<ExperienceCase>>('/learning/cases', { params }),

  /** 学习候选列表（待审核的规则/提示词修改建议） */
  candidates: (params?: { state?: string; type?: string; page?: number }) =>
    client.get<Page<LearningCandidate>>('/learning/candidates', { params }),

  /**
   * 审核候选：approve 会生成新版本并置为 active，reject 需要给理由。
   * 注意 reviewer_note 在 reject 时必填——将来回头看"为什么没采纳"才有据可查。
   */
  reviewCandidate: (candidateId: string, decision: 'approve' | 'reject', note?: string) =>
    client.post<LearningCandidate>(`/learning/candidates/${candidateId}/review`, {
      body: { decision, note },
    }),

  /** 已发布的规则/提示词版本（按 key 分组展示） */
  versions: (params?: { kind?: string; key?: string; page?: number }) =>
    client.get<Page<RuleVersion>>('/learning/versions', { params }),

  /** 回滚到指定版本：会生成一个新版本（而不是删掉历史），保证审计链完整 */
  rollback: (versionId: string, reason: string) =>
    client.post<RuleVersion>(`/learning/versions/${versionId}/rollback`, { body: { reason } }),

  /** 手动触发一次候选生成（平时由后端定时任务生成） */
  generateCandidates: () => client.post<{ created: number }>('/learning/candidates'),
}