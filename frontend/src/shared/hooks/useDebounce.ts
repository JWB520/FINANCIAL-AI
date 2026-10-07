/**
 * shared/hooks/useDebounce.ts —— 输入防抖
 *
 * 用途：搜索框每敲一个字都发请求很浪费，也会让列表闪烁。
 * 这里延迟 300ms：用户停止输入后才把值交出去（与 04_前端架构.md §10 一致）。
 *
 * 【本文件导出】useDebouncedValue(value, delay) / useDebouncedFn(fn, delay)
 */
import { useEffect, useMemo, useRef, useState } from 'react'

/** 返回"延迟后的值"：原值变化 300ms 后才跟着变 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}

/** 返回一个防抖过的函数（适合搜索、自动保存等场景） */
export function useDebouncedFn<Args extends unknown[]>(fn: (...args: Args) => void, delay = 300) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useMemo(() => {
    let timer: number | undefined
    return (...args: Args) => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => fnRef.current(...args), delay)
    }
  }, [delay])
}