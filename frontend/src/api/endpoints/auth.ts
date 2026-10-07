/**
 * api/endpoints/auth.ts —— 认证与当前用户相关接口
 *
 * 对应 05 §5.1：POST /auth/register、POST /auth/login、POST /auth/refresh、GET /me
 *
 * 【后端实现要点】
 *   - /auth/login 返回 { access_token, refresh_token, expires_in, user }
 *   - /auth/refresh 用 refresh_token 换新 access_token，前端在 401 时自动调用（见 client.ts）
 *   - 令牌由 client.ts 自动放进 Authorization 头，这里不用管
 */
import { client } from '../client'
import type { LoginResult, User } from '../types'

export interface RegisterPayload {
  /** 登录名 */
  username: string
  /** 密码（后端只存哈希） */
  password: string
  /** 姓名，界面上显示 */
  name: string
  /** 所属机构 */
  company: string
  /** 注册时选的角色；比赛演示里默认给研究员 */
  role: 'researcher' | 'reviewer'
}

export const authApi = {
  /** 登录：成功后由调用方把令牌存进 authToken（见 store/authStore.ts） */
  login: (username: string, password: string) =>
    client.post<LoginResult>('/auth/login', { body: { username, password } }),

  /** 注册（公司 + 角色） */
  register: (payload: RegisterPayload) => client.post<LoginResult>('/auth/register', { body: payload }),

  /** 拉当前用户与权限，用于刷新页面后恢复登录态 */
  me: () => client.get<User>('/me'),

  /** 主动退出：调一次让后端把 refresh_token 作废（后端没做也没关系，前端本地清干净即可） */
  logout: () => client.post<void>('/auth/logout'),
}