/**
 * shared/ui/PageHeader.tsx —— 页面标题区（每个页面顶部都用它，保证全站节奏一致）
 *
 * 【为什么改版】
 *   上一版允许在标题下面写一整段说明，结果每个页面顶部都像一篇小文档，
 *   用户第一眼看到的是"解释",而不是"要做什么"。
 *   现在收紧成：**标题一行 + 说明最多一行（12.5px 浅灰）+ 右侧主操作**，
 *   详细解释统一去帮助页（/help）或者放进 Tooltip。
 *
 * 【本文件定义】PageHeader 组件
 *   props: title / description（一句话，别写长） / extra（右侧操作） / notice（一行轻提示，可选）
 */
import type { ReactNode } from 'react'
import { InfoCircleOutlined } from '@ant-design/icons'

export function PageHeader(props: {
  title: string
  /** 一句话说明，务必短（超过 40 字就说明该挪进帮助页） */
  description?: ReactNode
  /** 右侧操作区（只放本页最主的 1~2 个动作） */
  extra?: ReactNode
  /** 一行轻提示；只用于"必须让人知道"的事（例如未覆盖含义） */
  notice?: ReactNode
  warning?: boolean
  children?: ReactNode
}) {
  const { title, description, extra, notice, warning, children } = props

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-head__title">{title}</h1>
          {description ? <div className="page-head__desc">{description}</div> : null}
        </div>
        {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
      </div>

      {notice ? (
        <div className={'notice-inline' + (warning ? ' notice-inline--warn' : '')}>
          <InfoCircleOutlined />
          <span>{notice}</span>
        </div>
      ) : null}

      {children}
    </div>
  )
}