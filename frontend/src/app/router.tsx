/**
 * app/router.tsx —— 路由表
 *
 * 【路径只有这些，因为软件本体只有三块】
 *   /                     工作台：新建项目 / 导入已有项目
 *   /projects/:projectId  项目界面：勘误 / 评估 / 人工复核 三个入口
 *   /errata/...           勘误（结果总览）
 *   /assessment/...       评估明细
 *   /reviews/...          人工复核（队列、复核裁决）
 *   /tasks/:id/run        核查执行进度（从项目或复核里进来）
 *   /login                登录（桌面端单人使用，保留入口不影响）
 *
 * 【本文件定义】ROUTES（路径清单）、AppRouter（路由组件）
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { AppShell } from './layout/AppShell'

const LoginPage = lazy(() => import('@/pages/login/LoginPage'))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'))
const TaskRequestPage = lazy(() => import('@/pages/projects/TaskRequestPage'))
const ErrataOverviewPage = lazy(() => import('@/pages/errata/ErrataOverviewPage'))
const ErrataAnnotatePage = lazy(() => import('@/pages/errata/ErrataAnnotatePage'))
const ClaimReviewPage = lazy(() => import('@/pages/reviews/ClaimReviewPage'))
const AssessmentDetailPage = lazy(() => import('@/pages/assessment/AssessmentDetailPage'))
const ClaimQueuePage = lazy(() => import('@/pages/reviews/ClaimQueuePage'))
const TaskRunPage = lazy(() => import('@/pages/task-run/TaskRunPage'))
const TaskAuditPage = lazy(() => import('@/pages/task-run/TaskAuditPage'))
const LearningPage = lazy(() => import('@/pages/learning/LearningPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const HelpPage = lazy(() => import('@/pages/help/HelpPage'))

/** 路由首次加载时的占位 */
function RouteFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Spin tip="页面加载中…" size="large">
        <div style={{ width: 120, height: 80 }} />
      </Spin>
    </div>
  )
}

/** 路径清单（一眼看清哪个路径对应哪一页） */
export const ROUTES: Array<{ path: string; description: string }> = [
  { path: '/login', description: '登录' },
  { path: '/', description: '工作台（新建项目 / 导入已有项目）' },
  { path: '/projects/:projectId', description: '项目界面（勘误 / 评估 / 人工复核）' },
  { path: '/projects/:projectId/task/new?kind=errata|assessment', description: '发起任务：选类型/范围/深度/备注' },
  { path: '/errata/:reportId/overview', description: '勘误结果（风险分布、未覆盖、复核优先级）' },
  { path: '/errata/:projectId/annotate?types=&from=&to=', description: '勘误批注（左 PDF 原件 / 右批注卡，数字复算实验）' },
  { path: '/reviews/:reportId/review', description: '复核裁决（左原文 / 右结论，逐条裁决）' },
  { path: '/assessment/:reportId', description: '研报评估明细（四个质量维度 + 参考分）' },
  { path: '/reviews/:reportId/queue', description: '人工复核队列（主张级）' },
  { path: '/tasks/:taskId/run', description: '核查执行进度' },
  { path: '/tasks/:taskId/audit', description: '任务审计日志（模型/工具调用、耗时、token、追踪号）' },
  { path: '/learning', description: '经验学习（案例 → 候选 → 审核发布 → 回滚）' },
  { path: '/settings', description: '设置（工作区位置、数据模式、关于）' },
  { path: '/help', description: '帮助（怎么用、概念解释）' },
]

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/projects/:projectId/task/new" element={<TaskRequestPage />} />
            <Route path="/errata/:reportId/overview" element={<ErrataOverviewPage />} />
            {/* 勘误批注（数字复算实验）：参数从 URL 带进来，刷新/分享链接都能复现同一次勘误 */}
            <Route path="/errata/:projectId/annotate" element={<ErrataAnnotatePage />} />
            <Route path="/reviews/:reportId/review" element={<ClaimReviewPage />} />
            <Route path="/assessment/:reportId" element={<AssessmentDetailPage />} />
            <Route path="/reviews/:reportId/queue" element={<ClaimQueuePage />} />
            <Route path="/tasks/:taskId/run" element={<TaskRunPage />} />
            {/* 缺少这一条时，进度页的「审计日志」按钮会被通配路由接住、跳回工作台 */}
            <Route path="/tasks/:taskId/audit" element={<TaskAuditPage />} />
            <Route path="/learning" element={<LearningPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/help/:slug" element={<HelpPage />} />
            {/* 找不到的地址回工作台 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
