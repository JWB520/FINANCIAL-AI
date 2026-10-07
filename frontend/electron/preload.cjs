/**
 * electron/preload.cjs —— 渲染进程与主进程之间的唯一通道（安全白名单）
 *
 * 【为什么必须有这一层】
 *   主进程有完整的文件系统权限。如果让页面直接 require('fs')，任何一个第三方脚本
 *   都能删用户的文件。所以这里只**挑出几个明确的能力**暴露给页面，
 *   页面拿到的是一组普通函数，碰不到 Node。
 *
 * 暴露的东西与 src/api/local/desktop.ts 里的 DesktopCapability 一一对应：
 *   window.rqc.pickReportFile / pickKnowledgeDir / createProject / listProjects /
 *              openProject / openInExplorer / workspaceDir
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rqc', {
  pickReportFile: () => ipcRenderer.invoke('project:pickReportFile'),
  pickKnowledgeDir: () => ipcRenderer.invoke('project:pickKnowledgeDir'),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  listProjects: () => ipcRenderer.invoke('project:list'),
  openProject: (projectId) => ipcRenderer.invoke('project:open', projectId),
  openInExplorer: (target) => ipcRenderer.invoke('project:openInExplorer', target),
  workspaceDir: () => ipcRenderer.invoke('project:workspaceDir'),
  reportMeta: (reportPath) => ipcRenderer.invoke('report:meta', reportPath),
  saveTaskRequest: (payload) => ipcRenderer.invoke('task:saveRequest', payload),
  /** 人工裁决：保存一次裁决结果 / 列出本机保存过的裁决记录 */
  saveErrataReview: (payload) => ipcRenderer.invoke('errata:saveReview', payload),
  listErrataReviews: () => ipcRenderer.invoke('errata:listReviews'),
  /** 设置：读 / 存 / 换工作区目录 / 打开配置文件位置 */
  getSettings: () => ipcRenderer.invoke('settings:read'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickWorkspaceDir: () => ipcRenderer.invoke('settings:pickWorkspaceDir'),
  revealSettingsFile: () => ipcRenderer.invoke('settings:reveal'),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
})