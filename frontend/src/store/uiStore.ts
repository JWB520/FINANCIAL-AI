/**
 * store/uiStore.ts —— 纯界面状态（Zustand）
 *
 * 【为什么前端的状态要分三处放（04_前端架构.md §4）】
 *   · 会改变列表内容、需要分享/后退的筛选 → 放 URL（见 shared/hooks/useUrlState.ts）
 *   · 服务端数据                          → 放 TanStack Query（自动缓存/失效/去重）
 *   · 纯界面偏好（既不该进 URL，也不该请求后端）→ 放这里
 *
 * 【一条禁令】绝不能把接口返回的数据抄进 store 再自己同步 —— 那样两份状态必然会不一致。
 *   所以这个文件里**只有界面偏好**，没有任何业务数据。
 *
 * 【本文件定义】
 *   useUiStore            Zustand store
 *   UiState               它的状态与方法类型
 *   sidebarCollapsed      左侧导航是否折叠（用 persist 持久化到 localStorage，键名 rqc.ui）
 *   setSidebarCollapsed   直接设置
 *   toggleSidebar         切换（AppShell 的"收起/展开导航"按钮用这个）
 *
 * 【以后要加什么】同样是"界面偏好"级别的东西才放这里，例如列表密度、默认筛选开关；
 *   一旦某个偏好会影响"别人打开链接看到的内容"，就必须改成放 URL。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface UiState {
  /** 左侧导航是否折叠。持久化的理由：用户不想每次进系统都再收一次 */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    { name: 'rqc.ui' }
  )
)