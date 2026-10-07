/**
 * features/report-nav/ReportLineNav.tsx —— 同一份研报的"三条主线"切换器
 *
 * 【它解决什么】
 *   三条主线（勘误 / 评估 / 人工复核）的页面都靠 reportId 指向同一份研报，
 *   但彼此之间原来没有直达路口：从复核队列想去勘误结果，得先"返回上一步"回项目界面、
 *   再点勘误那张卡 —— 三步，而且会把用户带离他正在看的那份报告。
 *   把这个切换器放进主线页面的页头，任意一条主线都能一步切到同一份研报的另外两条主线。
 *
 * 【为什么不做进左侧全局导航】
 *   这三条主线的结论脱离具体研报没有意义（必须先有 reportId 才能打开），
 *   放进全局导航只能做成"先选报告、再选主线"两步，反而更绕。
 *   分工是：全局导航放"不属于任何研报的页面"，主线切换放在研报相关页面的页头里。
 *
 * 【本文件定义】
 *   ReportLine       主线代号类型（errata / assessment / review）
 *   lineOfPath()     由当前路径判断在哪条主线上（用来高亮；/errata/:id/review 算人工复核）
 *   lineEntryPath()  每条主线的入口页（切换过去的落点）
 *   ReportLineNav    切换器组件（命名导出 + 默认导出）
 */
import { Segmented } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'

/** 三条主线的代号，与路由前缀 /errata、/assessment、/reviews 一一对应 */
export type ReportLine = 'errata' | 'assessment' | 'review'

/**
 * 前缀匹配必须带上"/"：
 * 否则 /reviewsomething 这种路径也会被当成复核主线（虽然现在没有这种路由，
 * 但路径判断属于"错了会安静地跳错地方"的那类逻辑，宁可写严一点）。
 */
function matchPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** 由路径判断当前属于哪条主线；不属于任何主线时返回 undefined（此时不高亮任何一档） */
export function lineOfPath(pathname: string): ReportLine | undefined {
  if (matchPrefix(pathname, '/errata')) return 'errata'
  if (matchPrefix(pathname, '/assessment')) return 'assessment'
  if (matchPrefix(pathname, '/reviews')) return 'review'
  return undefined
}

/** 每条主线的入口页：勘误落到结果总览（复核裁决页在 /reviews/:reportId/review） */
export function lineEntryPath(line: ReportLine, reportId: string): string {
  if (line === 'errata') return '/errata/' + reportId + '/overview'
  if (line === 'assessment') return '/assessment/' + reportId
  return '/reviews/' + reportId + '/queue'
}

/** 三档的名字与项目界面那三张卡完全一致，用户不用重新认词 */
const OPTIONS = [
  { value: 'errata', label: '勘误' },
  { value: 'assessment', label: '评估' },
  { value: 'review', label: '人工复核' },
]

export function ReportLineNav(props: { reportId: string }) {
  const { reportId } = props
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = lineOfPath(pathname)

  // 拿不到 reportId 就不渲染（例如路由参数异常），免得出现一个点了没反应的空控件
  if (!reportId) return null

  return (
    <div style={{ marginTop: 12 }}>
      <Segmented
        size="small"
        value={active ?? ''}
        options={OPTIONS}
        onChange={(value) => {
          const line = String(value) as ReportLine
          // 点当前这一档不做事，避免多产生一条重复的历史记录（返回时会连着退两次）
          if (line !== active) navigate(lineEntryPath(line, reportId))
        }}
      />
    </div>
  )
}

export default ReportLineNav
