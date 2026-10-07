/**
 * scripts/verify-charts.ts —— 图表"画得出来"自检（无头渲染，不需要浏览器）
 *
 * 【为什么必须单独验这一条】
 *   ECharts 改成**按需注册**（echarts/core + 只 use 用到的图表与组件）之后，体积从 1MB 降到几百 KB，
 *   但代价是：**少注册一个组件，echarts 不会报错崩掉，只会安静地画不出来**（图表区一片空白）。
 *   类型检查、构建、页面渲染冒烟**一个都发现不了**这类缺陷 —— 它们只看代码有没有崩。
 *   所以这里在 Node 里真的渲染一张雷达图，断言：画出了图形、维度名出现在图上、并且没有任何
 *   "组件没注册"的告警。改了注册清单（加/减图表）就跑一次 `npm run verify:charts`。
 *
 * 【怎么跑】npm run verify:charts
 */
import * as echarts from 'echarts/core'
import { buildQualityRadarOption } from '@/features/assessment-charts/radarOption'
import { loadECharts } from '@/features/assessment-charts/EChart'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    failures.push(name + (detail ? ' —— ' + detail : ''))
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

/** 把 echarts 自己的告警抓下来（"没注册"是告警，不是异常） */
const warnings: string[] = []
const originalWarn = console.warn
const originalError = console.error
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '))
}
console.error = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '))
}

console.log('== 1. 按需注册：雷达图配置能真的渲染出来 ==')
const dims = [
  { name: '论证质量', coverage: 0.8 },
  { name: '数据与证据', coverage: 0.6 },
  { name: '风险与合规', coverage: 0.5 },
  { name: '写作呈现', coverage: 1 },
]

// 与页面同一条路径：先走 loadECharts() 完成注册（缺注册这里就会暴露）
// renderer 传 'svg'：Node 里没有 canvas，echarts 的 SSR 渲染只支持 svg；
// 图表/组件的注册清单与页面用的是同一份（见 EChart.tsx 的 loadECharts）
const { init, registered } = await loadECharts('svg')
check('注册清单没被删空（雷达图 + 雷达组件 + 提示框 + 渲染器 = 4 项）', registered === 4, '实际 ' + registered + ' 项')
const chart = init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 }) as unknown as {
  setOption: (option: unknown) => void
  renderToSVGString: () => string
  dispose: () => void
}
chart.setOption(buildQualityRadarOption(dims))
const svg = chart.renderToSVGString()
chart.dispose()

console.warn = originalWarn
console.error = originalError

check('渲染出 SVG', svg.length > 500, '字符数 ' + svg.length)
const notRegistered = warnings.filter((text) => /not exists|not imported|Unknown series|Unknown component/i.test(text))
check('没有"组件/系列未注册"的告警（按需注册清单是够用的）', notRegistered.length === 0, notRegistered.join(' | '))
check('图上出现了全部维度名（雷达的四条边画出来了）', dims.every((dim) => svg.includes(dim.name)), svg.includes('论证质量') ? '' : '维度名没出现在 SVG 里')
check('系列颜色出现在图里（证明不是空图）', /1677ff|rgb\(22,\s*119,\s*255\)/i.test(svg), '找不到系列主色')

console.log('== 2. 配置是纯函数：数据变了图跟着变 ==')
const oneDim = buildQualityRadarOption([{ name: '只有一维', coverage: 0.25 }])
check('只传一维时不报错、指标数正确', oneDim.radar.indicator.length === 1)
check('覆盖率换算成 0~100 的整数（25% → 25）', oneDim.series[0].data[0].value[0] === 25, String(oneDim.series[0].data[0].value[0]))
check('空维度列表不抛错', buildQualityRadarOption([]).radar.indicator.length === 0)
check('每根轴的满值都是 100（覆盖率口径一致）', buildQualityRadarOption(dims).radar.indicator.every((item) => item.max === 100))

console.log('')
console.log('==============================================')
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项')
if (failed) {
  failures.forEach((item) => console.log('  - ' + item))
  process.exitCode = 1
} else {
  console.log('图表正常：按需注册的 echarts 画得出雷达图，且没有"安静失败"。')
}
