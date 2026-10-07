/**
 * scripts/verify-report-nav.tsx —— 主线切换器（features/report-nav）自检
 *
 * 【为什么它要单独验】
 *   切换器决定"你在哪条主线上、点一下去哪"，它出错的表现是**安静的**：
 *   类型检查和打包都不报，用户只会觉得"点了没反应"或"跳到了别的地方"。
 *   所以这里断言三件事：
 *     1) 路径 → 主线代号（决定哪一档高亮）；/errata/:id/review 也算勘误；
 *     2) 每条主线的入口页，且这些路径在 router.tsx 里真实存在（不允许指向死路由）；
 *     3) 渲染产物里三档都在、当前那一档被标成选中，没有 reportId 时什么都不渲染。
 *
 * 【怎么跑】esbuild 打包成 cjs 后 node 运行（必须 cjs：react-dom/server 在 ESM 下会报
 *   "Dynamic require of stream is not supported"）。命令见 package.json 的 verify:nav。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

import { lineEntryPath, lineOfPath, ReportLineNav } from '@/features/report-nav/ReportLineNav'
import ClaimQueuePage from '@/pages/reviews/ClaimQueuePage'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    console.log('  ✗ ' + name + (detail ? '  —— ' + detail : ''))
  }
}

/** 把切换器单独渲染出来（不依赖页面数据，因此三条主线都能验） */
function renderNav(pathname: string, reportId = 'rpt-001'): string {
  return renderToString(
    <MemoryRouter initialEntries={[pathname]}>
      <ReportLineNav reportId={reportId} />
    </MemoryRouter>
  )
}

/** 从渲染产物里取出"被标成选中"的那一档名字；取不到或有歧义就返回空串 */
function selectedLine(html: string): string {
  const matched = html.match(/<label[^>]*ant-segmented-item-selected[^>]*>[\s\S]*?<\/label>/)
  if (!matched) return ''
  const hit = ['勘误', '评估', '人工复核'].filter((text) => matched[0].includes(text))
  return hit.length === 1 ? hit[0] : ''
}

console.log('== 1. 路径 → 主线（决定哪一档高亮）==')
check('/errata/rpt-1/overview 属于勘误', lineOfPath('/errata/rpt-1/overview') === 'errata')
check('/reviews/rpt-1/review（复核裁决页）属于人工复核', lineOfPath('/reviews/rpt-1/review') === 'review')
check('/assessment/rpt-1 属于评估', lineOfPath('/assessment/rpt-1') === 'assessment')
check('/reviews/rpt-1/queue 属于人工复核', lineOfPath('/reviews/rpt-1/queue') === 'review')
check(
  '项目界面与工作台不属于任何主线（三档都不高亮）',
  lineOfPath('/projects/prj-1') === undefined && lineOfPath('/') === undefined
)
check('前缀必须带 /：/reviewsomething 不算复核主线', lineOfPath('/reviewsomething') === undefined)

console.log('')
console.log('== 2. 每条主线的入口页，且路由真实存在 ==')
const routerSource = readFileSync('src/app/router.tsx', 'utf8')
const entries: Array<{ line: 'errata' | 'assessment' | 'review'; path: string; label: string }> = [
  { line: 'errata', path: '/errata/:reportId/overview', label: '勘误 → 结果总览' },
  { line: 'assessment', path: '/assessment/:reportId', label: '评估 → 评估明细' },
  { line: 'review', path: '/reviews/:reportId/queue', label: '人工复核 → 复核队列' },
]
entries.forEach((item) => {
  const actual = lineEntryPath(item.line, ':reportId')
  check(item.label + ' 的落点是 ' + item.path, actual === item.path, '实际得到 ' + actual)
  check(item.path + ' 在 router.tsx 里注册过（不会跳到死路由）', routerSource.indexOf(item.path) >= 0)
})

// 改名护栏 1：裁决页必须挂在 /reviews 下，/errata 下不许再有它
check('/reviews/:reportId/review 在 router.tsx 里注册过', routerSource.indexOf('/reviews/:reportId/review') >= 0)
check('裁决页不再挂在 /errata 下（改名后不许留旧路径）', routerSource.indexOf('/errata/:reportId/review') < 0)

// 改名护栏 2：任何一脚跳转都不许把裁决页写回 /errata 下（只看代码行，注释不算）
const srcFiles = (readdirSync('src', { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
const badJumps: string[] = []
let reviewJumpLines = 0
srcFiles.forEach((f) => {
  readFileSync('src/' + f, 'utf8').split('\n').forEach((line) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    if (line.indexOf('/review') >= 0) reviewJumpLines += 1
    if (line.indexOf('/errata/') >= 0 && line.indexOf('/review') >= 0) badJumps.push(f + ' :: ' + t)
  })
})
check('扫得到指向复核页面的代码行（证明这条护栏确实在扫东西）', reviewJumpLines > 0, '扫到 ' + reviewJumpLines + ' 行')
check('没有把裁决页写回 /errata 下的跳转', badJumps.length === 0, badJumps.join(' | '))
console.log('== 3. 渲染产物：三档都在、当前那档选中 ==')
const atErrara = renderNav('/errata/rpt-001/overview')
const atAssessment = renderNav('/assessment/rpt-001')
const atReview = renderNav('/reviews/rpt-001/queue')

check('三档名字都在（勘误 / 评估 / 人工复核）',
  ['勘误', '评估', '人工复核'].every((text) => atErrara.includes(text)))
check('勘误页高亮「勘误」', selectedLine(atErrara) === '勘误', '实际选中 ' + selectedLine(atErrara))
check('评估页高亮「评估」', selectedLine(atAssessment) === '评估', '实际选中 ' + selectedLine(atAssessment))
check('复核队列高亮「人工复核」', selectedLine(atReview) === '人工复核', '实际选中 ' + selectedLine(atReview))
check('没有 reportId 时不渲染（不会出现点了没反应的空控件）', renderNav('/reviews/rpt-001/queue', '') === '')

// 页面级冒烟：证明这个切换器真的被挂到了主线页面上（没挂上就只是一段没人用的组件）
const pageHtml = renderToString(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <MemoryRouter initialEntries={['/reviews/rpt-001/queue']}>
          {/* 必须套一层 Routes/Route：不套的话 useParams() 取不到 reportId，
              切换器按"拿不到 id 就不渲染"的规矩什么都不画，这条断言会假红 */}
          <Routes>
            <Route path="/reviews/:reportId/queue" element={<ClaimQueuePage />} />
          </Routes>
        </MemoryRouter>
      </AntdApp>
    </ConfigProvider>
  </QueryClientProvider>
)
check('复核队列页里确实挂上了切换器，且停在「人工复核」',
  selectedLine(pageHtml) === '人工复核', '实际选中 ' + selectedLine(pageHtml))

console.log('')
console.log('主线切换器自检：通过 ' + passed + ' 项，失败 ' + failed + ' 项')
if (failed) process.exitCode = 1
