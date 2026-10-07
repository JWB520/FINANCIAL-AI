/**
 * vite-env.d.ts —— 让 TypeScript 认识 Vite 的环境变量
 *
 * 【为什么需要这个文件】
 *   代码里写 import.meta.env.VITE_USE_MOCK 时，TypeScript 并不知道 env 上有哪些字段，
 *   会直接报 "Property 'env' does not exist on type 'ImportMeta'"。
 *   所以这里把用到的环境变量声明出来（同时也就成了"前端支持哪些环境变量"的清单）。
 *
 * 【加新变量的规矩】先在 .env.example 里加一行，再在这里加一行，最后才在代码里用。
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 是否使用假数据（'true' 时全部请求走 src/api/mock） */
  readonly VITE_USE_MOCK?: string
  /** 接口前缀，默认 /api/v1 */
  readonly VITE_API_BASE_URL?: string
  /** 直连后端的完整地址（不走 vite 代理时用，联调他人机器时方便） */
  readonly VITE_API_DIRECT_URL?: string
  /** 单请求超时（毫秒） */
  readonly VITE_REQUEST_TIMEOUT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * ECharts 的"按需注册"模块（只 import、不取用，本身没有类型声明）。
 *
 * 【为什么需要这几行】src/features/assessment-charts/EChart.tsx 里用
 *   import('echarts/lib/chart/radar') 这种**副作用导入**来注册图表 ——
 *   echarts 只为包根（echarts、echarts/core）提供了 .d.ts，这些子路径没有，
 *   于是 tsc 会报 TS7016「找不到声明文件」。
 *   它们本来就只是"引一下让它自己注册"，声明成任意类型完全够用。
 * 【为什么用通配符】以后加图表（柱状图、折线图）不用再来改这个文件。
 */
declare module 'echarts/lib/chart/*'
declare module 'echarts/lib/component/*'