/**
 * api/endpoints/help.ts —— 帮助与说明文档
 *
 * 对应 05 §5.6：GET /help/articles
 *
 * 【为什么帮助文档要走接口而不是写死在前端】
 *   风险等级定义、核查类型说明这些内容会随规则版本变化（比如"什么算高风险"改了），
 *   写在数据库里由业务方维护，前端只负责渲染，改文案不用发版。
 *   另外：每个核查卡片上的"?"图标要能直接跳到对应词条，所以文章要带 slug。
 */
import { client } from '../client'

/** 帮助文章的目录结构：一级分组 + 文章 */
export interface HelpArticle {
  id: string
  /** 分组名，如"开始使用""核查类型说明""风险等级定义" */
  group: string
  /** 文章标题 */
  title: string
  /** 锚点标识，卡片上的"?"按钮用它跳转 */
  slug: string
  /** 正文（Markdown 文本，前端按段落渲染） */
  content: string
  updated_at: string
}

export const helpApi = {
  /** 全部帮助文章（内容不大，一次拉回，前端本地做搜索） */
  articles: () => client.get<HelpArticle[]>('/help/articles'),

  /** 按 slug 取单篇（从卡片"?"跳转时用） */
  article: (slug: string) => client.get<HelpArticle>(`/help/articles/${slug}`),
}