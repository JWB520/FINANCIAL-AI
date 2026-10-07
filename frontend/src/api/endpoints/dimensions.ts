/**
 * api/endpoints/dimensions.ts —— 维度注册表
 *
 * 对应 05 §5.1：GET /dimensions
 *
 * 【为什么维度不让前端写死】
 *   维度是后端注册表里的配置（03 §4）。前端读它的 required_inputs 自动算出"还缺什么资料"，
 *   后端新增一个维度，前端一行代码都不用改就能勾选（这就是"声明式依赖"的价值）。
 */
import { client } from '../client'
import type { Dimension } from '../types'

export const dimensionApi = {
  /** 拉全部维度。核查设置页据此渲染勾选项并做依赖提示 */
  list: () => client.get<Dimension[]>('/dimensions'),
}