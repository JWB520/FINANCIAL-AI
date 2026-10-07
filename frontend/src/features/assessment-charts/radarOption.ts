/**
 * features/assessment-charts/radarOption.ts —— 质量雷达图的 ECharts 配置（纯函数，无依赖）
 *
 * 【为什么单独抽出来】
 *   配置本身是"纯数据"，和 React、antd 都没关系。抽成纯函数以后：
 *   ① 页面只负责把维度数据传进来；
 *   ② scripts/verify-charts.ts 能直接在 Node 里拿它渲染一张图，
 *      断言"按需注册的 echarts 真的画得出来"（少注册一个组件时 echarts 是安静失败的）。
 *
 * 【本文件导出】
 *   buildQualityRadarOption(dims)  质量维度 → 雷达图配置
 */

/** 只有绘制需要的三个字段，不依赖 api/types，避免把接口层拖进验证脚本 */
export interface RadarDimension {
  name: string
  /** 覆盖率（0~1），图上显示成 0~100 */
  coverage: number
}

/**
 * 4 个质量维度各画一条边，数值是覆盖率 —— 只是"一眼看出弱在哪"的直观指标，
 * 结论仍以明细为准（页面上那句话必须保留，别让用户把它当成结论）。
 */
export function buildQualityRadarOption(dims: RadarDimension[]) {
  return {
    tooltip: {},
    radar: {
      indicator: dims.map((dim) => ({ name: dim.name, max: 100 })),
      radius: '65%',
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: [
      {
        type: 'radar' as const,
        areaStyle: { opacity: 0.18 },
        lineStyle: { color: '#1677ff' },
        itemStyle: { color: '#1677ff' },
        data: [
          {
            value: dims.map((dim) => Math.round(dim.coverage * 100)),
            name: '覆盖率',
          },
        ],
      },
    ],
  }
}
