/**
 * shared/hooks/useUrlState.ts —— 把"筛选条件"存进网址的工具（本项目的核心约定之一）
 *
 * 【为什么一定要这样做】
 *   用户复制一个链接发给同事，同事打开必须看到一样的筛选结果；
 *   刷新页面不能丢掉筛选；浏览器后退要符合直觉。这三件事只有把状态放 URL 才能同时满足。
 *   所以本项目的规矩是：凡是会改变列表内容的筛选条件，一律进 URL，
 *   纯界面状态（抽屉开合等）才放组件内部或 Zustand。
 *
 * 【本文件导出】
 *   useUrlState(defaults)   统一读写筛选状态
 *   useUrlParam(key, def)   只读写一个参数（简单场景）
 *   parseMulti / stringifyMulti  多选筛选值与 URL 字符串互转（risk=high,medium）
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export type UrlState = Record<string, string>

/**
 * 读写一组 URL 参数。
 *
 * 用法（列表页的典型写法）：
 *   const [filters, setFilters] = useUrlState({ status: '', risk: '', page: '1' })
 *   setFilters({ risk: 'high', page: '1' })   // 改筛选时同时把页码重置为 1
 *
 * 传 undefined 或空字符串表示删掉该参数，URL 会更干净。
 */
export function useUrlState(defaults: UrlState): [UrlState, (patch: Record<string, string | number | undefined>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  // 现值：URL 里有就用 URL 的，没有就用默认值
  const state = useMemo(() => {
    const result: UrlState = { ...defaults }
    Object.keys(defaults).forEach((key) => {
      const value = searchParams.get(key)
      if (value !== null) result[key] = value
    })
    return result
  }, [searchParams, defaults])

  const update = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(patch).forEach(([key, value]) => {
            if (value === undefined || value === '') next.delete(key)
            else next.set(key, String(value))
          })
          return next
        },
        // replace: true —— 筛选变化不产生新的浏览器历史记录，
        // 否则用户点几次筛选后要按很多次后退才能离开页面
        { replace: true }
      )
    },
    [setSearchParams]
  )

  return [state, update]
}

/** 单个参数的便捷写法：const [page, setPage] = useUrlParam('page', '1') */
export function useUrlParam(key: string, defaultValue = ''): [string, (value: string | undefined) => void] {
  const [state, update] = useUrlState({ [key]: defaultValue })
  return [state[key], (value) => update({ [key]: value })]
}

/** 把逗号分隔的多选筛选值转成数组（URL 里形如 risk=high,medium） */
export function parseMulti(value?: string): string[] {
  if (!value) return []
  return value.split(',').filter(Boolean)
}

/** 把数组转回 URL 参数值 */
export function stringifyMulti(values: string[]): string {
  return values.join(',')
}