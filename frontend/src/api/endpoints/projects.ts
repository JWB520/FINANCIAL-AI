/**
 * api/endpoints/projects.ts —— 项目相关接口（★ 后端工程师注意：这是本次新增的一层）
 *
 * 【当前状态】项目目前由桌面端以本地文件夹管理（<文档>/RQC 项目库/<项目名>/project.json），
 *   前端不调用本文件的接口；它们保留给后端将来做「项目云归档 / 团队共享」时启用。
 *   打开本地项目时真正需要后端配合的是 reportApi.ensureProject（POST /reports/ensure，幂等）。
 * * 【项目在系统里的位置】
 *   项目 = 管理核查任务的基本单元。一份研报必须先属于某个项目，然后才谈得上
 *   "勘误 / 评估 / 复核"这三件事。所以项目接口只有"增删改查"四个动作，很简单，
 *   但它决定了另外三个模块的入口（列表页都支持按 project_id 过滤）。
 *
 * 对应文档：05_数据模型与接口契约.md（项目为新增实体，字段见 api/types.ts 的 Project）
 *
 * 【本文件导出的函数】
 *   projectApi.list(params?)        项目列表（支持 status 筛选、名称搜索、分页）
 *   projectApi.detail(projectId)    项目详情（含项目下的研报清单与三件事状态）
 *   projectApi.create(body)         新建项目
 *   projectApi.update(id, body)     改项目名 / 说明
 *   projectApi.archive(id)          归档（不删数据，历史结论与审计都保留）
 *
 * 【后端实现要点】
 *   1. 列表里的 6 个统计字段请由后端算好返回（report_count / errata_done / assessment_done /
 *      pending_review_count / high_risk_count / running_task_count），前端不做聚合，
 *      避免"列表数字"和"详情明细"两处口径不一致；
 *   2. 归档不级联删除任何东西，只把 status 置为 archived；
 *   3. detail 里的 reports 一行一份研报，把三件事的状态都带上，前端一屏展示不再发额外请求。
 */
import { client } from '../client'
import type { CreateProjectBody, Page, Project, ProjectDetail, ProjectListParams } from '../types'

export const projectApi = {
  /** 项目列表 */
  list(params?: ProjectListParams): Promise<Page<Project>> {
    return client.get<Page<Project>>('/projects', { params })
  },

  /** 项目详情：项目 + 它下面的研报（每行含勘误/评估/复核状态） */
  detail(projectId: string): Promise<ProjectDetail> {
    return client.get<ProjectDetail>('/projects/' + projectId)
  },

  /** 新建项目 */
  create(body: CreateProjectBody): Promise<Project> {
    return client.post<Project>('/projects', { body })
  },

  /** 改项目名或说明 */
  update(projectId: string, body: Partial<CreateProjectBody>): Promise<Project> {
    return client.patch<Project>('/projects/' + projectId, { body })
  },

  /** 归档项目（只改状态，不删数据） */
  archive(projectId: string): Promise<Project> {
    return client.post<Project>('/projects/' + projectId + '/archive', {})
  },
}