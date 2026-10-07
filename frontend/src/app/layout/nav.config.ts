/**
 * app/layout/nav.config.ts —— 左侧导航（全站导航只有这一份数据）
 *
 * 【导航的规矩】
 *   1. 只放"入口"，不放详情页：勘误审阅、评估明细、复核队列一律从**项目界面**进入
 *      （结论脱离项目就没有意义，所以它们不是导航项）；
 *   2. 名字用用户嘴里的词，不出现技术词；
 *   3. 全站不超过 5 项 —— 超过就说明该合并了。
 *
 * 【本文件定义】
 *   NavItem / NavGroup   导航项与分组类型
 *   NAV_GROUPS           导航数据（AppShell 渲染它）
 *   ALL_NAV_ITEMS        拍平后的全部导航项
 *   findNavItemByPath()  按路径反查导航项（顶栏面包屑用）
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { AppstoreOutlined, BulbOutlined, QuestionCircleOutlined, SettingOutlined } from '@ant-design/icons'

export interface NavItem {
  /** 路由路径，与 router.tsx 严格一致 */
  path: string
  /** 导航上显示的名字 */
  label: string
  icon: ReactNode
  /** 是否精确匹配才高亮 */
  exact?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** 图标统一创建，避免写一坨 JSX */
const icon = (component: unknown) => createElement(component as never)

export const NAV_GROUPS: NavGroup[] = [
  {
    title: '导航',
    items: [{ path: '/', label: '工作台', icon: icon(AppstoreOutlined), exact: true }],
  },
  {
    title: '支撑',
    items: [
      { path: '/learning', label: '经验学习', icon: icon(BulbOutlined) },
      { path: '/settings', label: '设置', icon: icon(SettingOutlined) },
      { path: '/help', label: '帮助', icon: icon(QuestionCircleOutlined) },
    ],
  },
]

/** 全部导航项拍平，便于查表 */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

/** 按路径反查导航项（项目界面这类不在导航里的路径会返回 undefined，面包屑就只显示"工作台"） */
export function findNavItemByPath(path: string): NavItem | undefined {
  const candidates = ALL_NAV_ITEMS.filter((item) => (item.exact ? item.path === path : path.startsWith(item.path)))
  return candidates.sort((a, b) => b.path.length - a.path.length)[0]
}