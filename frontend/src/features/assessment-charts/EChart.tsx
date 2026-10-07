/**
 * features/assessment-charts/EChart.tsx —— ECharts 的最小封装（按需加载 + 按需注册）
 *
 * 【为什么要封装成两层"按需"】
 *   第一层：不在文件顶部 import，而是在 useEffect 里动态 import ——
 *     这样 ECharts 不进首屏包，只有真正渲染图表（打开评估明细页）时才下载。
 *   第二层：只用 **echarts/core + 按需注册**，不用 `import 'echarts'` 全量包。
 *     全量包 1MB（gzip 346KB），而本项目实际只画一张雷达图：全量引进来，
 *     99% 的代码（地图、桑基图、树图、GL 渲染器……）都是死重。
 *     按需注册后这个懒加载包降到几百 KB —— 打开评估页明显更快。
 *
 * 【本文件导出】EChart 组件
 *   props: option（ECharts 配置）、height（容器高度）、onEvents（可选的事件绑定）
 * 【本文件导出】loadECharts(renderer) —— 按需注册后的 echarts 实例加载器
 *   scripts/verify-charts.ts 直接用它做无头渲染自检（证明"注册的东西够画雷达图"）。
 */
import { useEffect, useRef } from 'react'
import type { EChartsCoreOption } from 'echarts/core'

/** 渲染实例要用的最小接口（只声明本项目用到的四个方法，避免把 echarts 的类型拖进首屏类型图） */
export interface ChartInstance {
  setOption: (option: EChartsCoreOption) => void
  resize: () => void
  dispose: () => void
  on: (eventName: string, handler: (params: unknown) => void) => void
}

/**
 * 按需注册 ECharts。
 *
 * 【为什么用 lib/ 深层路径，而不是官方文档里的 `import { RadarChart } from 'echarts/charts'`】
 *   echarts 的 package.json 把 `lib/chart/*.js`、`lib/component/*.js` 声明成了"有副作用"，
 *   于是打包器**不敢摇掉**桶文件里没被用到的图表 —— 实测走桶导入，产物还是 1MB
 *   （桑基图、地图、K 线、关系图全都还在包里，尽管本项目只画一张雷达图）。
 *   而 `lib/chart/radar.js` 这类文件是"一被 import 就自己调用 use() 注册"，
 *   所以只引这一个文件，其余图表就真的不进包了。
 *   这两个路径都在 echarts 的 package.json exports 里正式导出，不是野路子。
 *
 * 【加图表的规矩】以后要画新图（例如柱状图），在这里补一行
 *   import('echarts/lib/chart/bar')、需要坐标轴再补 import('echarts/lib/component/grid')。
 *   少引一个，echarts 不会报错崩掉，只会**安静地画不出来**（最容易漏的坑）——
 *   scripts/verify-charts.ts 会把"画得出来"这件事断言住，改完记得跑 npm run verify:charts。
 *
 * 【renderer 参数】页面里用 canvas（默认）；自检脚本在 Node 里没法建 canvas，
 *   所以传 'svg' 走无头渲染 —— 注册清单与页面是同一套，只是渲染器不同。
 */
export async function loadECharts(renderer: 'canvas' | 'svg' = 'canvas'): Promise<{
  init: (dom: HTMLElement | null, theme?: unknown, opts?: Record<string, unknown>) => ChartInstance
  /** 实际注册的条目数（图表 + 组件 + 渲染器），自检脚本用它守住"清单没被删空" */
  registered: number
}> {
  const [core, renderers, ...chartModules] = await Promise.all([
    import('echarts/core'),
    import('echarts/renderers'),
    // 下面三条都是"副作用导入"：被 import 时自己完成注册，不需要（也没有）返回值
    import('echarts/lib/chart/radar'),
    import('echarts/lib/component/radar'),
    import('echarts/lib/component/tooltip'),
  ])
  core.use([renderer === 'svg' ? renderers.SVGRenderer : renderers.CanvasRenderer])
  // 注册条目 = 上面那几个图表/组件模块 + 1 个渲染器（这里不写死数字，加了模块它会自己涨）
  return { init: core.init as never, registered: chartModules.length + 1 }
}

export function EChart({
  option,
  height = 280,
  onEvents,
}: {
  option: EChartsCoreOption
  height?: number
  /** 事件绑定，例如点击柱子时筛选列表 */
  onEvents?: Record<string, (params: unknown) => void>
}) {
  const domRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ChartInstance | null>(null)

  // 初始化：第一次渲染时动态加载 echarts
  useEffect(() => {
    let disposed = false

    void (async () => {
      const echarts = await loadECharts()
      if (disposed || !domRef.current) return
      const instance = echarts.init(domRef.current)
      instance.setOption(option)
      chartRef.current = instance

      // 绑定事件（例如点击某个风险等级的柱子 → 跳到筛选后的列表）
      if (onEvents) {
        Object.entries(onEvents).forEach(([eventName, handler]) => {
          instance.on(eventName, handler)
        })
      }

      // 容器尺寸变化时重绘（拖动三栏布局时必须做，否则图表会错位）
      const observer = new ResizeObserver(() => instance.resize())
      observer.observe(domRef.current)
    })()

    return () => {
      disposed = true
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // option 变化通过下面的 effect 单独更新，这里只在挂载时初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 配置变化时更新图表（不重新 init，避免闪烁）
  useEffect(() => {
    chartRef.current?.setOption(option)
  }, [option])

  return <div ref={domRef} style={{ width: '100%', height }} />
}
