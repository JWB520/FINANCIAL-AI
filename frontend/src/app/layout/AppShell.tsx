/**
 * app/layout/AppShell.tsx —— 全站外壳：左侧导航 + 顶栏 + 内容区
 *
 * 【本文件定义】
 *   AppShell  组件（导出）：布局容器，具体页面通过 <Outlet /> 渲染在内容区
 *   内部小组件：
 *     SideNav      左侧导航（读 nav.config.ts 渲染）
 *     TopBar       顶栏（面包屑 + 当前用户 + 退出登录）
 *
 * 【它负责的三件事（页面不用再管）】
 *   1. 未登录时跳转到 /login（前端这一层只是体验兜底，真正的鉴权在后端）；
 *   2. 导航高亮：当前路径落在哪一项上，就高亮哪一项；
 *   3. 顶栏面包屑：路径 → 导航名（用 findNavItemByPath 反查）。
 */
import { useEffect, useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { App as AntdApp, Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Tag, Tooltip } from 'antd'
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import { authApi, authToken, USE_MOCK } from '@/api'
import { USER_ROLE_LABEL } from '@/api'
import { initials } from '@/shared/utils/format'
import { useUiStore } from '@/store/uiStore'
import { NAV_GROUPS, findNavItemByPath } from './nav.config'

const { Sider, Header, Content } = Layout

/** 左侧导航 */
function SideNav({ collapsed }: { collapsed: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()

  // 把 nav.config 的分组转成 antd Menu 需要的 items 结构
  const items = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        key: group.title,
        type: 'group' as const,
        label: collapsed ? undefined : group.title,
        children: group.items.map((item) => ({
          key: item.path,
          icon: item.icon,
          label: item.label,
        })),
      })),
    [collapsed]
  )

  // 当前选中项：用最长前缀匹配，保证进到 /reports/xxx/review 时"报告列表"仍然高亮
  const selectedKey = findNavItemByPath(location.pathname)?.path ?? '/'

  return (
    <Sider
      theme="light"
      collapsed={collapsed}
      collapsedWidth={64}
      width={228}
      className="app-sider"
      style={{ borderRight: '1px solid #f0f0f0', height: '100vh', position: 'sticky', top: 0, overflow: 'auto' }}
    >
      {/* 品牌区：一句产品名 + 一句话定位（评审一眼就能知道这是什么系统） */}
      <div className="app-brand">
        <div className="app-brand__logo">RQC</div>
        {!collapsed && (
          <div className="app-brand__text">
            <div className="app-brand__title">研报核查与质量评估</div>
            <div className="app-brand__sub">Research Quality Check</div>
          </div>
        )}
      </div>

      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={items}
        style={{ borderInlineEnd: 'none' }}
        onClick={({ key }) => {
          if (key === '/admin') {
            // 规划中的功能照样能点，进去会看到"规划中"说明页
          }
          navigate(key)
        }}
      />
    </Sider>
  )
}

/** 顶栏：面包屑 + 新建按钮 + 用户信息 */
function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  // 折叠按钮归顶栏：它是布局控制，不该独占一整行
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const { message } = AntdApp.useApp()
  // 拉当前用户（刷新页面后恢复显示；未登录时后端会返回 401，由 client.ts 统一处理）
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  const current = findNavItemByPath(location.pathname)

  const handleLogout = () => {
    authToken.clear()
    message.success('已退出登录')
    navigate('/login')
  }

  return (
    <Header
      style={{
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Button
          type="text"
          size="small"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          title={collapsed ? '展开导航' : '收起导航'}
        />
        <Breadcrumb
          items={[
            { title: <Link to="/">工作台</Link> },
            ...(current && current.path !== '/' ? [{ title: current.label }] : []),
          ]}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>



        <Dropdown
          menu={{
            items: [
              { key: 'role', label: `角色：${user ? USER_ROLE_LABEL[user.role] : '—'}`, disabled: true },
              { key: 'company', label: `机构：${user?.company ?? '—'}`, disabled: true },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
            ],
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Avatar size={30} style={{ background: '#1677ff' }}>
              {initials(user?.name)}
            </Avatar>
            <span style={{ fontSize: 13 }}>{user?.name ?? '未登录'}</span>
          </div>
        </Dropdown>
      </div>
    </Header>
  )
}

export function AppShell() {
  // 折叠状态是纯界面偏好：放 uiStore（会持久化），不进 URL、也不请求后端
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const navigate = useNavigate()
  const location = useLocation()

  // 未登录就跳登录页。注意：真正的权限校验在后端，这里只是别让用户对着空页面发呆
  useEffect(() => {
    if (!authToken.getAccess() && !location.pathname.startsWith('/login')) {
      navigate('/login', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <SideNav collapsed={collapsed} />
      <Layout>
        <TopBar />
        <Content style={{ padding: '16px 20px 24px' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}