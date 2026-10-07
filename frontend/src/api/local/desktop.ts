/**
 * api/local/desktop.ts —— 桌面端能力（只有"本地文件 / 本地文件夹"这类操作才用得到）
 *
 * 【为什么要单独一层，不和 client.ts 混在一起】
 *   系统里有两类完全不同的外部依赖：
 *     ① 业务数据（报告、结论、复核记录）→ 走 HTTP 后端（src/api/client.ts）
 *     ② 本地文件系统（选研报文件、选知识库文件夹、建项目文件夹）→ 走桌面端主进程（本文件）
 *   混在一起会导致一个常见误解："浏览器里也能选本地路径" —— 不能。
 *   浏览器出于安全，从一开始就不给网页真实路径，所以这一层必须由桌面端主进程提供。
 *
 * 【在浏览器里打开时会怎样】
 *   window.rqc 不存在 → isDesktop() 返回 false → 调用这些方法会抛出带明确提示的错误，
 *   调用方（工作台）据此显示提示，而不是静默失败。
 *
 * 【本文件定义】
 *   LocalProjectConfig   项目配置文件（project.json）的结构
 *   DesktopCapability    桌面端暴露的能力清单（与 electron/preload.cjs 一一对应）
 *   desktop              调用入口：isDesktop()、pickReportFile()、pickKnowledgeDir()、
 *                        createProject()、listProjects()、openProject()、openInExplorer()、workspaceDir()
 */
import type { Id } from '../types'

/** 项目配置文件（每个项目文件夹下有一个 project.json） */
export interface LocalProjectConfig {
  /** 配置格式版本：以后加字段时用它判断要不要迁移 */
  schema_version: number
  /** 项目 id（由桌面端生成；文件夹改名不影响 id） */
  id: Id
  /** 项目名（默认取研报文件名，用户可以改） */
  name: string
  /** 研报文件的**绝对路径**（这就是浏览器做不到的地方） */
  report_path: string
  /** 知识库文件夹的绝对路径；没选就是 null */
  knowledge_dir: string | null
  /** 项目文件夹的绝对路径（列表展示与"在资源管理器中打开"用） */
  dir: string
  created_at: string
  updated_at: string
}

/** 桌面端通过 preload 暴露给页面的能力（与 electron/preload.cjs 严格一致） */
export interface DesktopCapability {
  /** 拉起系统"选择文件"窗口，返回选中的绝对路径；用户取消返回 null */
  pickReportFile: () => Promise<string | null>
  /** 拉起系统"选择文件夹"窗口，返回选中的绝对路径；用户取消返回 null */
  pickKnowledgeDir: () => Promise<string | null>
  /** 新建项目：在工作区里建一个项目文件夹并写入 project.json */
  createProject: (payload: { name: string; report_path: string; knowledge_dir: string | null }) => Promise<LocalProjectConfig>
  /** 列出工作区里的全部项目（按创建时间倒序） */
  listProjects: () => Promise<LocalProjectConfig[]>
  /** 打开某个项目（读它的 project.json） */
  openProject: (projectId: string) => Promise<LocalProjectConfig | null>
  /** 在资源管理器里打开项目文件夹 */
  openInExplorer: (path: string) => Promise<void>
  /** 工作区根目录（界面显示用） */
  workspaceDir: () => Promise<string>
  /** 读研报元信息（文件名、大小、PDF 页数）—— 勘误范围选择要用页数 */
  reportMeta: (reportPath: string) => Promise<ReportMeta>
  /** 把任务请求留档到项目的 data/tasks/ 下，返回写入的文件路径 */
  saveTaskRequest: (payload: { projectId: string; kind: TaskKind; request: unknown }) => Promise<string>
  /** 保存一次人工裁决（保留/舍弃 + 备注），返回写入的文件路径 */
  saveErrataReview: (payload: { projectId: string; review: ErratalReviewPayload }) => Promise<string>
  /** 列出本机保存过的全部裁决记录（人工复核界面呈现用） */
  listErrataReviews: () => Promise<ErratalReviewRecord[]>
  /** 读全部配置 */
  getSettings: () => Promise<AppSettings>
  /** 存配置（只传要改的段） */
  saveSettings: (patch: DeepPartial<AppSettings>) => Promise<AppSettings>
  /** 选工作区目录（系统原生文件夹窗口） */
  pickWorkspaceDir: () => Promise<string | null>
  /** 打开配置文件所在位置，返回文件路径 */
  revealSettingsFile: () => Promise<string>
  /** 恢复默认设置 */
  resetSettings: () => Promise<AppSettings>
}

/** 研报元信息（读不到页数时为 null，界面会让用户手填） */
export interface ReportMeta {
  name: string
  ext: string
  /** 字节数 */
  size: number
  /** PDF 页数；非 PDF 或读不到就是 null */
  pages: number | null
  /** 文件是否还在原位置（用户可能把它挪走了） */
  exists: boolean
}

/** 两类任务的代号：勘误 / 评估 */
export type TaskKind = 'errata' | 'assessment'

/** 人对一条批注的判断：keep=保留（这条问题成立）；discard=舍弃（不成立）；null=还没判 */
export type HumanVerdict = 'keep' | 'discard'

/** 一条批注的完整三方记录：机器判断 + AI 复核 + 人的判断与备注（一次裁决里的最小单元） */
export interface ErrataReviewItem {
  id: string
  page: number
  /** 承载这条批注的原文句子（人工复核界面直接展示，不必再翻 PDF） */
  statement: string
  expression: string
  computed: number | null
  claimed: number | null
  unit: string
  /** 机器的判断 */
  machine: { status: string; risk_level: string | null; conclusion: string }
  /** AI 的判断（复核结论 + 备注 + 建议） */
  ai: { review_verdict: string | null; review_note: string | null; suggestion: string | null }
  /** 人的判断与备注 */
  human: { verdict: HumanVerdict | null; note: string }
}

/** 一次裁决的落盘内容（保存按钮写的就是它） */
export interface ErratalReviewPayload {
  schema_version: number
  report_path: string
  report_name: string
  page_range: { from: number; to: number } | null
  saved_at: string
  /** total = 本次列出的批注数；keep/discard/undecided 三种人去向的条数 */
  stats: { total: number; keep: number; discard: number; undecided: number }
  items: ErrataReviewItem[]
}

/** 记录（落盘内容 + 列表接口补上的出处信息） */
export type ErratalReviewRecord = ErratalReviewPayload & {
  /** 记录文件的绝对路径（打开所在文件夹用） */
  file?: string
  project_id?: string
  project_name?: string
}

/** 递归可选（保存设置时只传要改的那几段） */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** 应用配置（与 electron/projectStore.cjs 的 DEFAULT_SETTINGS 一一对应） */
export interface AppSettings {
  schema_version: number
  general: {
    /** 工作区目录；null = 用默认的 <文档>/RQC 项目库 */
    workspace_dir: string | null
    page_size: number
  }
  model: {
    provider: 'deepseek' | 'openai' | 'anthropic' | 'ollama' | 'custom'
    model: string
    temperature: number
    max_tokens: number
    top_p: number
    concurrency: number
    timeout_seconds: number
  }
  check: {
    strictness: 'loose' | 'standard' | 'strict'
    high_risk_threshold: number
    max_retry: number
    auto_recheck: boolean
    cross_check_with_knowledge: boolean
  }
  knowledge: {
    enabled: boolean
    top_k: number
    similarity_threshold: number
    chunk_size: number
    chunk_overlap: number
  }
  backend: {
    api_base_url: string
    use_mock: boolean
  }
  notify: {
    on_task_done: 'none' | 'in_app' | 'system'
  }
  updated_at?: string | null
}

/** 桌面端是否可用（浏览器里打开会是 false） */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { rqc?: unknown }).rqc)
}

/** 拿到底层能力；浏览器里调用会抛出带解决办法的错误 */
function capability(): DesktopCapability {
  const rqc = (window as unknown as { rqc?: DesktopCapability }).rqc
  if (!rqc) {
    throw new Error('当前是浏览器环境，无法选择本地文件路径，请改用桌面端方式启动（见 README 第 1 节）')
  }
  return rqc
}

export const desktop = {
  isDesktop,

  /** 选研报文件（系统原生"打开文件"窗口） */
  pickReportFile: (): Promise<string | null> => capability().pickReportFile(),

  /** 选知识库文件夹（系统原生"选择文件夹"窗口） */
  pickKnowledgeDir: (): Promise<string | null> => capability().pickKnowledgeDir(),

  /** 建项目：创建文件夹 + 写配置文件（研报路径与知识库路径都记在里面） */
  createProject: (payload: { name: string; report_path: string; knowledge_dir: string | null }) =>
    capability().createProject(payload),

  /** 导入已有项目：列工作区里已有的（按时间排序） */
  listProjects: (): Promise<LocalProjectConfig[]> => capability().listProjects(),

  /** 打开项目：读配置文件 */
  openProject: (projectId: string): Promise<LocalProjectConfig | null> => capability().openProject(projectId),

  /** 在资源管理器中定位项目文件夹 */
  openInExplorer: (path: string): Promise<void> => capability().openInExplorer(path),

  /** 工作区根目录（显示在界面上，用户知道文件都放在哪） */
  workspaceDir: (): Promise<string> => capability().workspaceDir(),

  /** 读研报元信息（文件名 / 大小 / PDF 页数） */
  reportMeta: (reportPath: string): Promise<ReportMeta> => capability().reportMeta(reportPath),

  /** 任务请求留档（写到 <项目>/data/tasks/ 下） */
  saveTaskRequest: (payload: { projectId: string; kind: TaskKind; request: unknown }): Promise<string> =>
    capability().saveTaskRequest(payload),

  /** 人工裁决留档（写到 <项目>/data/errata-reviews/ 下；刷新不丢，供人工复核界面读取） */
  saveErrataReview: (payload: { projectId: string; review: ErratalReviewPayload }): Promise<string> =>
    capability().saveErrataReview(payload),

  /** 列出本机保存过的全部裁决记录（人工复核界面呈现用） */
  listErrataReviews: (): Promise<ErratalReviewRecord[]> => capability().listErrataReviews(),

  /** 读全部配置（设置页打开时调用） */
  getSettings: (): Promise<AppSettings> => capability().getSettings(),

  /** 存配置（只传要改的段，其余由主进程负责保留） */
  saveSettings: (patch: DeepPartial<AppSettings>): Promise<AppSettings> => capability().saveSettings(patch),

  /** 选工作区目录（系统原生文件夹窗口；取消返回 null） */
  pickWorkspaceDir: (): Promise<string | null> => capability().pickWorkspaceDir(),

  /** 打开配置文件所在位置（排查问题时看得到配置到底存了什么） */
  revealSettingsFile: (): Promise<string> => capability().revealSettingsFile(),

  /** 恢复默认设置（整份覆盖，只动配置） */
  resetSettings: (): Promise<AppSettings> => capability().resetSettings(),
}
