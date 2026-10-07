/**
 * electron/main.cjs —— 桌面端主进程（窗口 + 系统原生对话框 + 文件系统操作）
 *
 * 【它负责的三件浏览器做不到的事】
 *   1. 拉起**系统原生**的"选择文件 / 选择文件夹"窗口，并把**绝对路径**交给页面
 *      （浏览器出于安全永远拿不到真实路径，所以这一步只能在主进程做）；
 *   2. 建项目文件夹、写 project.json（见 projectStore.cjs）；
 *   3. 在资源管理器里打开项目文件夹。
 *
 * 【渲染进程怎么调】
 *   页面不直接碰 ipcRenderer，而是通过 preload.cjs 暴露的 window.rqc（见 src/api/local/desktop.ts）。
 *   每个 handler 的返回值都保持"能用就用、不能用给 null"的风格：用户取消对话框不是错误。
 *
 * 【开发与打包两种加载方式】
 *   开发：加载 VITE_DEV_SERVER_URL（由 scripts/start-desktop.cjs 传入）
 *   打包：加载 ../dist/index.html
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const store = require('./projectStore.cjs')

/** 应用配置文件（放在系统给应用的数据目录里，与工作区数据分开） */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

/** 读当前配置（文件缺失或损坏时自动退回默认值，见 projectStore.readSettings） */
function settings() {
  return store.readSettings(settingsPath())
}

/** 工作区根目录：设置里填了就用它，没填过就用 <文档>/RQC 项目库 */
function workspace() {
  return settings().general.workspace_dir || store.defaultWorkspace(app.getPath('documents'))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: '研报核查与质量评估平台',
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      // 安全默认值：渲染进程拿不到 Node，只能通过 preload 暴露的白名单能力访问系统
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  return win
}

/* ---------------------------------------------------------------------------
 * IPC：每一项都对应 src/api/local/desktop.ts 里的一个方法
 * -------------------------------------------------------------------------*/

/** 选研报文件（系统原生"打开文件"窗口） */
ipcMain.handle('project:pickReportFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: '选择要核查的研报',
    buttonLabel: '选择这份研报',
    properties: ['openFile'],
    filters: [
      { name: '研报文档', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

/** 选知识库文件夹（系统原生"选择文件夹"窗口） */
ipcMain.handle('project:pickKnowledgeDir', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: '选择知识库文件夹（规范、规则、案例等资料所在目录）',
    buttonLabel: '使用这个文件夹',
    properties: ['openDirectory'],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

/** 新建项目：建文件夹 + 写配置文件 */
ipcMain.handle('project:create', async (_event, payload) => {
  return store.createProject({
    workspace: workspace(),
    name: payload?.name,
    report_path: payload?.report_path,
    knowledge_dir: payload?.knowledge_dir ?? null,
  })
})

/** 导入已有项目：列工作区里全部项目（按时间倒序） */
ipcMain.handle('project:list', async () => store.listProjects(workspace()))

/** 打开项目：读配置 */
ipcMain.handle('project:open', async (_event, projectId) => store.openProject(workspace(), projectId))

/** 在资源管理器里打开项目文件夹 */
ipcMain.handle('project:openInExplorer', async (_event, target) => {
  if (!target) return
  await shell.openPath(target)
})

/** 工作区根目录（界面显示"文件都存在哪"） */
ipcMain.handle('project:workspaceDir', async () => workspace())

/* ---------------- 设置（设置页读写的就是这一份配置） ---------------- */

/** 读全部配置 */
ipcMain.handle('settings:read', async () => settings())

/**
 * 保存配置（只传要改的段，其余保留）。
 * 如果这次改了工作区目录，顺手把新目录建出来 —— 用户不必自己去建文件夹。
 */
ipcMain.handle('settings:save', async (_event, patch) => {
  const before = settings().general.workspace_dir
  const saved = store.writeSettings(settingsPath(), patch)
  if (saved.general.workspace_dir && saved.general.workspace_dir !== before) {
    store.ensureWorkspace(saved.general.workspace_dir)
  }
  return saved
})

/** 恢复默认设置（用默认值整份覆盖；只动配置，不动项目与研报） */
ipcMain.handle('settings:reset', async () => {
  return store.writeSettings(settingsPath(), JSON.parse(JSON.stringify(store.DEFAULT_SETTINGS)))
})

/** 选工作区目录（系统原生"选择文件夹"窗口） */
ipcMain.handle('settings:pickWorkspaceDir', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: '选择工作区目录（项目文件夹都会建在这里）',
    buttonLabel: '使用这个目录',
    properties: ["openDirectory", "createDirectory"],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

/** 打开配置文件所在位置（排查问题时看得到） */
ipcMain.handle('settings:reveal', async () => {
  const file = settingsPath()
  if (!fs.existsSync(file)) store.writeSettings(file, {})
  shell.showItemInFolder(file)
  return file
})


/** 读研报元信息（页码范围要用页数） */
ipcMain.handle('report:meta', async (_event, reportPath) => store.readReportMeta(reportPath))

/** 任务请求留档（写到项目的 data/tasks/ 下） */
ipcMain.handle('task:saveRequest', async (_event, payload) => {
  const { projectId, kind, request } = payload ?? {}
  const project = store.openProject(workspace(), projectId)
  if (!project) throw new Error('项目不存在，无法留档任务请求')
  return store.saveTaskRequest(project.dir, kind, request)
})

/** 人工裁决留档（勘误批注页的"保留/舍弃 + 备注"，写到项目的 data/errata-reviews/ 下） */
ipcMain.handle('errata:saveReview', async (_event, payload) => {
  const { projectId, review } = payload ?? {}
  const project = store.openProject(workspace(), projectId)
  if (!project) throw new Error('项目不存在，无法保存裁决结果')
  return store.saveErrataReview(project.dir, review)
})

/** 列出本机保存过的全部裁决记录（人工复核界面要呈现这些结果） */
ipcMain.handle('errata:listReviews', async () => store.listErrataReviews(workspace()))

app.whenReady().then(() => {
  store.ensureWorkspace(workspace())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
