/**
 * shared/utils/format.ts —— 展示层格式化函数（纯函数，随手可测）
 *
 * 【本文件导出的函数】
 *   formatDateTime(iso)      2026-09-24T02:11:03Z -> 2026-09-24 10:11（本地时区）
 *   formatDate(iso)          只保留日期
 *   formatRelative(iso)      刚刚 / 12 分钟前 / 3 天前 / 2026-09-01
 *   formatDuration(ms)       1 分 22 秒
 *   formatPercent(v, digits) 0.9223 -> 92.2%
 *   formatNumber(v, digits)  69.8749131341209 -> 69.8749（去掉浮点噪声：复算值/偏差用）
 *   formatRatio(v)           0.9223 -> 92.2%（覆盖率专用，小数位固定 1 位）
 *   truncate(text, max)      超长文本截断加省略号
 *   initials(name)           姓名取首字，用于头像
 *   formatTokens(n)          12345 -> 12.3k
 *
 * 【为什么集中放这里】
 *   同一个数字在不同页面必须长得一样（"92.2%"和"92.23%"同时出现会让人以为算错了），
 *   所以格式化只有这一处实现，页面里禁止再手写 toFixed 与字符串拼接。
 */
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/** 后端返回的是 UTC 时间，dayjs 会自动转成本机时区展示 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  return dayjs(iso).format('YYYY-MM-DD HH:mm')
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return dayjs(iso).format('YYYY-MM-DD')
}

/** 列表里显示"多久以前"，比精确时间更好读；超过 7 天就回到具体日期 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return '—'
  const t = dayjs(iso)
  if (dayjs().diff(t, 'day') >= 7) return t.format('YYYY-MM-DD')
  return t.fromNow()
}

/** 耗时格式化：不足 1 秒显示毫秒，超过 1 分钟显示"x 分 y 秒" */
export function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} 毫秒`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`
}

/** 比率 -> 百分比文本。v 传 0.9223 得到 "92.2%"；传 null 得到 "—" */
export function formatPercent(v?: number | null, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

/**
 * 浮点数 -> 给人看的数字文本。复算值是 ast 求出来的，原始长这样：69.8749131341209，
 * 直接渲染会挤爆卡片（四个对照格并排时文字会互相压住）。
 * 规则：最多保留 digits 位小数并去掉尾随 0；比 1e-4 还小但不为 0 的改用有效数字，别显示成 0。
 */
export function formatNumber(v?: number | null, digits = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return String(v)
  const rounded = Number(v.toFixed(digits))
  if (rounded === 0 && v !== 0) return v.toPrecision(2)
  return String(rounded)
}

export function truncate(text?: string | null, max = 60): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 取姓名首字做头像文字（"王小明" -> "王"） */
export function initials(name?: string | null): string {
  if (!name) return '?'
  return name.trim().charAt(0)
}

/** token 数缩写，审计页展示成本用 */
export function formatTokens(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}