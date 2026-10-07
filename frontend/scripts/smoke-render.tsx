/**
 * scripts/smoke-render.tsx —— 渲染冒烟测试（不需要浏览器）
 *
 * 【它验证什么】
 *   "页面组件真的能渲染出 HTML" —— 不是白屏、不是启动即抛异常。
 *   做法是把组件放在服务端渲染器里跑一遍（renderToString），
 *   因为服务端渲染会真实执行组件的渲染函数、Provider 与所有子组件。
 *
 * 【为什么需要它】
 *   类型检查与打包只能证明"代码是合法的"，不能证明"运行时不会崩"。
 *   这个脚本补上"运行时能渲染"这一环（不含交互，交互仍需人工过一遍）。
 *
 * 【怎么跑】见 README 第 6 节（esbuild 打包成 mjs 后 node 运行）
 */
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

import LoginPage from '@/pages/login/LoginPage'
import TaskRequestPage from '@/pages/projects/TaskRequestPage'
import HelpPage from '@/pages/help/HelpPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import LearningPage from '@/pages/learning/LearningPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import ClaimQueuePage from '@/pages/reviews/ClaimQueuePage'
import TaskRunPage from '@/pages/task-run/TaskRunPage'
import ClaimReviewPage from '@/pages/reviews/ClaimReviewPage'
import ErrataOverviewPage from '@/pages/errata/ErrataOverviewPage'
import ErrataAnnotatePage from '@/pages/errata/ErrataAnnotatePage'
import AssessmentDetailPage from '@/pages/assessment/AssessmentDetailPage'
import TaskAuditPage from '@/pages/task-run/TaskAuditPage'

let passed = 0
let failed = 0

/** 渲染一个页面组件，返回 HTML 长度；抛异常就算失败 */
function renderPage(name: string, element: React.ReactElement, route = '/'): void {
  try {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConfigProvider locale={zhCN}>
          <AntdApp>
            <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
          </AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    )
    const ok = html.length > 200
    if (ok) {
      passed += 1
      console.log('  ✓ ' + name + ' 渲染出 ' + html.length + ' 字符的 HTML')
    } else {
      failed += 1
      console.log('  ✗ ' + name + ' 渲染结果过短（' + html.length + ' 字符），疑似白屏')
    }
  } catch (error) {
    failed += 1
    console.log('  ✗ ' + name + ' 渲染抛异常：' + (error as Error).message)
  }
}

console.log('== 页面渲染冒烟（服务端渲染，验证不白屏）==')
renderPage('登录页', <LoginPage />, '/login')
// 工作台会发起数据请求：服务端渲染时处于加载态（渲染骨架屏），同样证明组件树可渲染
renderPage('发起勘误任务页', <TaskRequestPage />, '/projects/prj-demo/task/new?kind=errata')
renderPage('帮助页', <HelpPage />, '/help')
renderPage('工作台（加载态）', <DashboardPage />, '/')
// 下面四页是"文案瘦身"动过的地方：以前不在冒烟范围里，改动等于没有回归保护
renderPage('经验学习（加载态）', <LearningPage />, '/learning')
renderPage('设置页', <SettingsPage />, '/settings')
renderPage('复核队列（加载态）', <ClaimQueuePage />, '/reviews/rpt-001/queue')
renderPage('进度页（加载态）', <TaskRunPage />, '/tasks/task-001/run')
renderPage('复核裁决（加载态）', <ClaimReviewPage />, '/reviews/rpt-001/review')
renderPage('勘误结果（加载态）', <ErrataOverviewPage />, '/errata/rpt-001/overview')
// 勘误批注页：服务端渲染时没有 window.rqc（不是桌面端），所以渲染的是"请用桌面端打开"的提示页。
// 这一条恰好把"非桌面端不能崩"这条边界也钉住了。
renderPage('勘误批注（非桌面端提示）', <ErrataAnnotatePage />, '/errata/prj-001/annotate')
renderPage('研报评估（加载态）', <AssessmentDetailPage />, '/assessment/rpt-001')
renderPage('任务审计（加载态）', <TaskAuditPage />, '/tasks/task-001/audit')

console.log('')
console.log('渲染冒烟：通过 ' + passed + ' 项，失败 ' + failed + ' 项')
if (failed) process.exitCode = 1
