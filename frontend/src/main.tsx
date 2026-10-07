/**
 * main.tsx —— 前端入口（整个应用从这一行开始跑）
 *
 * 【为什么不是"直接渲染"】
 *   桌面端启动时要先读一次应用配置（settings.json），把"数据模式（演示 / 真实）"与"接口地址"
 *   注入到 api 层 —— 否则第一个请求会先按环境变量的默认值发出去，用户改过的设置要刷新才生效。
 *   所以这里是"先取配置、再渲染"。配置读失败也照常渲染（用默认值），绝不因为配置问题白屏。
 *
 * 【本文件定义】injectRuntimeSettings()（配置注入）、renderApp()（挂载渲染）
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from './app/providers'
import { AppRouter } from './app/router'
import { setRuntimeApiOptions } from '@/api'
import { desktop } from '@/api/local/desktop'
import './app/styles/global.css'

/** 把配置里的数据模式与接口地址接进 api 层（失败就算了，按环境变量跑） */
async function injectRuntimeSettings() {
  if (!desktop.isDesktop()) return
  try {
    const settings = await desktop.getSettings()
    setRuntimeApiOptions({ useMock: settings.backend.use_mock, apiBaseUrl: settings.backend.api_base_url })
  } catch {
    // 配置读不到不是致命问题：继续用环境变量的默认值
  }
}

function renderApp() {
  const container = document.getElementById('root')
  if (!container) {
    // 正常情况下不可能发生；写出来是为了让类型检查知道 container 一定存在
    throw new Error('找不到 #root 节点，请检查 index.html')
  }
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </React.StrictMode>
  )
}

void injectRuntimeSettings().finally(renderApp)