/**
 * app/providers.tsx —— 全局"环境"：主题、数据缓存、错误边界、登录失效处理
 *
 * 【为什么要有这个文件】
 *   这些都是"每个页面都需要、但不属于任何页面"的东西。集中放一处，
 *   页面里就不用反复写 ConfigProvider / QueryClientProvider 了。
 *
 * 【本文件定义】
 *   AppProviders  一个组件，把上面说的一堆 Provider 按正确顺序套起来
 *   QueryClient   （内部）请求缓存实例：失败重试次数、缓存时间在这里统一配置
 *
 * 【包了什么】
 *   1. ConfigProvider   —— antd 中文语言包 + 主题（品牌色、圆角、紧凑度）
 *   2. QueryClientProvider —— TanStack Query：服务端数据的缓存与刷新（页面不再手写 useEffect 拉数据）
 *   3. App（antd）      —— 提供 message/notification/modal 的上下文，页面里用 App.useApp() 取
 *   4. ErrorBoundary    —— 某个页面崩了不至于整站白屏，给一个"重新加载"的出口
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Component, useEffect, type ReactNode } from 'react'
import { Button, Result } from 'antd'
import { setUnauthorizedHandler } from '@/api'

/**
 * 请求缓存策略（与 04_前端架构.md §4 一致）
 *   - 失败不自动重试 3 次以上：业务错误重试没意义，网络抖动重试 1 次就够
 *   - staleTime 30s：列表页来回切换不会每次都重新请求，但也不会看到过期太久的数字
 *   - refetchOnWindowFocus=false：切回来就刷会让用户正在看的表格跳动，体验很差
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

/** 页面级错误边界：一个页面出错不影响其他页面 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="500"
          title="页面出错了"
          subTitle={this.state.error.message}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}

/**
 * 登录失效时的处理：清掉本地令牌并跳到登录页。
 * 注意这里用 window.location 而不是路由跳转 —— api 层不应该依赖路由库，
 * 所以由 providers 在启动时把"该怎么做"注册进去（见 setUnauthorizedHandler）。
 */
function useAuthFailureRedirect() {
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    })
  }, [])
}

export function AppProviders({ children }: { children: ReactNode }) {
  useAuthFailureRedirect()

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        // 用默认算法，但把关键 token 调成"专业工具"的样子：紧凑、克制的圆角
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
          fontSize: 14,
          colorBgLayout: '#f5f7fa',
          // 表格行高紧凑一点，一屏能看更多条目（这是个干活用的工具）
          controlHeight: 34,
        },
        components: {
          Table: { headerBg: '#fafafa', cellPaddingBlock: 10 },
          Card: { paddingLG: 20 },
          Layout: { headerBg: '#ffffff', siderBg: '#ffffff' },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AntdApp>
          <ErrorBoundary>{children}</ErrorBoundary>
        </AntdApp>
      </QueryClientProvider>
    </ConfigProvider>
  )
}