/**
 * shared/hooks/useGoBack.ts —— 全站统一的"返回上一步"
 *
 * 【为什么不能写死一个目标页】
 *   勘误结果、研报评估、复核队列这些详情页都有多个来源入口
 *   （项目界面、复核裁决、进度页……）。如果把按钮写死成"返回项目"，
 *   从复核裁决页进来的用户会被送到他没去过的页面 —— 那比没有按钮更让人迷惑。
 *
 * 【为什么不能裸用 navigate(-1)】
 *   刷新或直接打开时，浏览器历史里前一条可能根本不属于本应用，
 *   navigate(-1) 会把人送出应用（甚至退到空白页）。
 *   react-router v6 会给自己的每条历史记录打上 `history.state.idx`，
 *   所以只有 idx > 0（前面确实还有一条本应用的路由）才回退；
 *   否则退到调用方给的目标页（通常是它所属的项目界面），最后兜底回工作台。
 *
 * 【为什么判 typeof window】
 *   本 hook 会被渲染冒烟（scripts/smoke-render.tsx）在 Node 里跑一遍，
 *   那里没有 window —— 少了这个判断，冒烟会直接抛 "window is not defined"。
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export function useGoBack(fallbackPath = '/'): () => void {
  const navigate = useNavigate()

  return useCallback(() => {
    const idx =
      typeof window !== 'undefined' ? (window.history.state as { idx?: number } | null)?.idx : undefined
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
    navigate(fallbackPath)
  }, [navigate, fallbackPath])
}
