/**
 * electron/projectStore.cjs —— 项目文件夹与配置文件的读写（纯 Node，不依赖 Electron）
 *
 * 【为什么单独抽出来】
 *   这里的逻辑是"软件数据到底存在哪、长什么样"，属于最容易出问题的部分（路径非法、重名、
 *   配置损坏、磁盘权限……）。它不依赖 Electron，所以可以**直接用 node 脚本跑测试**，
 *   不必打开窗口点一遍才知道对不对（见 scripts/verify-project-store.cjs）。
 *
 * 【一个项目 = 一个文件夹】
 *   <工作区>/<项目名>/
 *   ├── project.json     配置文件：研报路径、知识库路径、创建时间、id
 *   └── data/            将来放核查结果与导出文件（现在先建好，免得以后迁移）
 *
 * 【命名与去重规则】
 *   文件夹名取项目名，但会清掉 Windows 不允许的字符（\ / : * ? " < > |），
 *   重名时自动加后缀（项目名-2、项目名-3……），**绝不覆盖已有项目**。
 *
 * 【本文件导出】
 *   SCHEMA_VERSION                  配置格式版本
 *   defaultWorkspace(documentsDir)  默认工作区路径（文档/RQC 项目库）
 *   ensureWorkspace(workspace)      确保工作区存在
 *   sanitizeFolderName(name)        把项目名转成安全的文件夹名
 *   createProject(opts)             新建项目（建文件夹 + 写配置 + 建 data/）
 *   listProjects(workspace)         列出全部项目（按创建时间倒序；坏配置跳过不报错）
 *   openProject(workspace, id)      按 id 打开项目（找不到返回 null）
 *   readReportMeta(reportPath)      读研报元信息（文件名/大小/PDF 页数）—— 页码范围选择要用
 *   saveTaskRequest(projectDir, kind, payload)  把任务请求留档到 <项目>/data/tasks/
 *   readSettings(file) / writeSettings(file, patch)  应用配置的读写（带默认值合并，见文件末尾）
 *   readConfig(file)/writeConfig()  配置读写（供测试与以后迁移用）
 */
const fs = require('node:fs')
const path = require('node:path')
// zlib 是 Node 自带的，用它能解压 PDF 里的 Flate 流（见 unpackFlateStreams）——不算新增依赖
const zlib = require('node:zlib')

/** 配置格式版本：以后加字段时靠它判断要不要迁移 */
const SCHEMA_VERSION = 1

/** 默认工作区：<文档>/RQC 项目库 —— 放在用户看得见的地方，别藏在 AppData 里 */
function defaultWorkspace(documentsDir) {
  return path.join(documentsDir, 'RQC 项目库')
}

/** 确保工作区目录存在（首次启动时自动创建） */
function ensureWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true })
  return workspace
}

/** 把项目名转成安全的文件夹名：去掉 Windows 非法字符与首尾空格/点 */
function sanitizeFolderName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return cleaned.slice(0, 80) || '未命名项目'
}

/** 重名时加后缀：项目名 -> 项目名-2 -> 项目名-3 …… */
function uniqueFolder(workspace, folderName) {
  let candidate = folderName
  let index = 2
  while (fs.existsSync(path.join(workspace, candidate))) {
    candidate = folderName + '-' + index
    index += 1
  }
  return candidate
}

/** 生成项目 id（与文件夹名解耦：文件夹改名不影响 id） */
function makeId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.random().toString(36).slice(2, 6)
  return 'prj-' + stamp + '-' + random
}

/** 读配置：解析失败返回 null（调用方当"坏项目"处理，不炸整个列表） */
function readConfig(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null
    return parsed
  } catch {
    return null
  }
}

/** 写配置：UTF-8 无 BOM，缩进 2（人工打开也能读） */
function writeConfig(file, config) {
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * 新建项目。
 * @param {{ workspace: string, name: string, report_path: string, knowledge_dir?: string|null }} opts
 * @returns 项目配置对象（含 dir 字段，界面上要显示"东西存在哪"）
 */
function createProject(opts) {
  const { workspace, name, report_path, knowledge_dir = null } = opts
  if (!workspace) throw new Error('缺少工作区路径')
  if (!report_path) throw new Error('缺少研报文件路径')

  ensureWorkspace(workspace)
  const folder = uniqueFolder(workspace, sanitizeFolderName(name))
  const dir = path.join(workspace, folder)

  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })

  const now = new Date().toISOString()
  const config = {
    schema_version: SCHEMA_VERSION,
    id: makeId(),
    name: String(name || folder).trim(),
    report_path: path.resolve(report_path),
    knowledge_dir: knowledge_dir ? path.resolve(knowledge_dir) : null,
    dir,
    created_at: now,
    updated_at: now,
  }
  writeConfig(path.join(dir, 'project.json'), config)
  return config
}

/** 列出工作区里的全部项目：按创建时间倒序（最近的排最前，导入弹窗就是这么排的） */
function listProjects(workspace) {
  if (!fs.existsSync(workspace)) return []
  const entries = fs.readdirSync(workspace, { withFileTypes: true })
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const config = readConfig(path.join(workspace, entry.name, 'project.json'))
    if (config) projects.push(config)
  }
  return projects.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

/** 按 id 打开项目（遍历工作区找 id 匹配的配置） */
function openProject(workspace, projectId) {
  if (!projectId) return null
  const hit = listProjects(workspace).find((project) => project.id === projectId)
  return hit || null
}

/**
 * 把 PDF 里所有能解压的 Flate 流解出来，拼成一段可搜索的文本。
 *
 * 【为什么非解压不可】现代 PDF（Word / Acrobat / LaTeX 导出的）普遍把页对象放进
 *   **压缩对象流**（/Type /ObjStm + FlateDecode）：页对象在磁盘上是二进制，
 *   直接拿字节搜 "/Type /Page" 一个都搜不到 —— 这就是"明明 60 页却读不出页数"的真正原因。
 *
 * 【做法】扫 "stream" 关键字（要排除 "endstream"）→ 取到下一个 "endstream" 之间的字节 →
 *   交给 zlib 解压。解不开的（图片流 DCTDecode、LZW、加密流）直接跳过，不影响后面的流。
 * 【为什么带 finishFlush: Z_SYNC_FLUSH】PDF 流在 endstream 前常夹带多余字节，
 *   默认解压参数会因此抛错；这个参数就是 zlib 为此提供的"尾部可有垃圾"模式。
 */
function unpackFlateStreams(buf, plain) {
  const pieces = []
  // (^|[^d]) 是为了跳过 "endstream" 里的那个 stream
  const marker = /(^|[^d])stream\r?\n/g
  let match
  while ((match = marker.exec(plain)) !== null) {
    const start = match.index + match[0].length
    const end = plain.indexOf('endstream', start)
    if (end < 0) break
    try {
      pieces.push(zlib.inflateSync(buf.subarray(start, end), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1'))
    } catch {
      // 不是 Flate 流（或已加密）—— 跳过这一条，继续看下一段
    }
    // 从 endstream 之后继续找，避免在同一段流里反复匹配
    marker.lastIndex = end
  }
  return pieces.join('\n')
}

/** 在一段文本里数页对象个数与页树声明的 /Count（/Type /Pages 是页树节点，不算一页） */
function countPageRefs(text) {
  const objects = text.match(/\/Type\s*\/Page(?![s])/g)
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]))
  return {
    objects: objects ? objects.length : 0,
    declared: counts.length ? Math.max(...counts) : 0,
  }
}

/**
 * 统计 PDF 页数 —— **启发式的"尽力读"，不是完整 PDF 解析器**（这一点必须说清，别过度承诺）。
 *
 * 能读到的：
 *   - 明文结构的 PDF（页对象直接写在文件里）；
 *   - 现代 PDF 的压缩对象流（页对象被 Flate 压过，见 unpackFlateStreams）。
 * 读不到的一律返回 null：
 *   - 加密 PDF（流解不开）、只有图片的扫描件、结构非常规的文件。
 *   返回 null 时**界面会让用户手填页数**（见 TaskRequestPage 的页码卡），绝不能瞎猜一个数字。
 *
 * 【为什么取"页对象个数"与"/Count 声明"里的较大值】
 *   增量更新过的 PDF 可能残留旧页对象（个数偏多），页树 /Count 也可能只覆盖一棵子树（偏少）。
 *   页数只用于输入上限与耗时估算，宁大勿小 —— 猜小了用户就填不进去真实页码。
 * 【为什么用这种土办法而不是引入 pdf 库】只要一个页数，不值得为它装几 MB 的依赖。
 */
function countPdfPages(filePath) {
  try {
    const stat = fs.statSync(filePath)
    // 超大文件不读（避免把内存吃满）；只提示用户手填页数
    if (stat.size > 64 * 1024 * 1024) return null
    const buf = fs.readFileSync(filePath)
    // latin1 = 一字节一字符，能安全地在二进制里搜 ASCII 标记（PDF 的关键字与标记全是 ASCII）
    const plain = buf.toString('latin1')
    const inPlain = countPageRefs(plain)
    const inStreams = countPageRefs(unpackFlateStreams(buf, plain))
    const fromObjects = inPlain.objects + inStreams.objects
    const fromCount = Math.max(inPlain.declared, inStreams.declared)
    const pages = Math.max(fromObjects, fromCount)
    return pages > 0 ? pages : null
  } catch {
    return null
  }
}

/**
 * 读研报元信息：文件名、扩展名、大小、PDF 页数（读不到为 null）。
 * 页码范围选择器用它做上下限校验与"共 N 页"的显示；
 * **pages 为 null 时界面显示"请按实际页数填写"，绝不显示一个猜出来的数字**。
 */
function readReportMeta(reportPath) {
  const result = { name: '', ext: '', size: 0, pages: null, exists: false }
  if (!reportPath) return result
  const base = String(reportPath).split(/[\\/]/).pop() || ''
  result.name = base
  result.ext = (base.match(/\.[^.]+$/) ?? [''])[0].toLowerCase()
  try {
    const stat = fs.statSync(reportPath)
    result.exists = true
    result.size = stat.size
  } catch {
    return result
  }
  if (result.ext === '.pdf') result.pages = countPdfPages(reportPath)
  return result
}

/**
 * 把一次任务请求留档到项目文件夹里：<项目>/data/tasks/<时间>-<类型>.json
 *
 * 【为什么本地也要存一份】
 *   后端还没接的时候，"发送"必须留下痕迹（用户能看见自己发过什么、参数是什么）；
 *   接了后端之后它依然有用 —— 它是"这次任务是谁、用什么参数发起的"的本地凭证，
 *   排查问题时不必翻服务端日志。
 *
 * @returns 写入的文件绝对路径
 */
function saveTaskRequest(projectDir, kind, payload) {
  const dir = path.join(projectDir, 'data', 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const file = path.join(dir, stamp + '-' + kind + '.json')
  writeConfig(file, payload)
  return file
}

/* ===========================================================================
 * 人工裁决留档（勘误批注页里的"保留 / 舍弃 + 备注"）
 *
 * 【为什么要落盘，而不是只存在页面状态里】
 *   这一页的产出是**人的判断**：每一条批注"保留还是舍弃、为什么"。它和任务请求一样是
 *   不可再生的凭证（刷新页面就没了），而且下一步「人工复核」界面要把它呈现出来。
 *
 * 【为什么按项目存】同一份研报可能有多轮裁决（换参数重跑、换人复核），
 *   所以一次裁决一个文件，文件名带时间戳，**绝不覆盖**。
 * ==========================================================================*/

/**
 * 把一次人工裁决留档到：<项目>/data/errata-reviews/<时间>-errata-review.json
 *
 * @returns 写入的文件绝对路径
 */
function saveErrataReview(projectDir, payload) {
  const dir = path.join(projectDir, 'data', 'errata-reviews')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  let file = path.join(dir, stamp + '-errata-review.json')
  // 同一秒内连存两次（反复点保存）也不能互相覆盖
  let suffix = 2
  while (fs.existsSync(file)) {
    file = path.join(dir, stamp + '-errata-review-' + suffix + '.json')
    suffix += 1
  }
  writeConfig(file, payload)
  return file
}

/**
 * 列出全部项目里保存过的裁决记录（按保存时间倒序）。
 *
 * 【为什么跨项目列】「人工复核」界面拿不到桌面端项目 id（它按 report_id 走 mock 数据），
 * 所以这里不做关联过滤，老老实实列出本机所有裁决记录，并带上项目名 — 用户一眼能认出是哪份。
 * 坏文件跳过，不让一条坏 JSON 把整个列表炸掉。
 */
function listErrataReviews(workspace) {
  const records = []
  let projects = []
  try {
    projects = listProjects(workspace)
  } catch {
    projects = []
  }
  for (const project of projects) {
    const dir = path.join(project.dir, 'data', 'errata-reviews')
    let files = []
    try {
      files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json'))
    } catch {
      continue
    }
    for (const name of files) {
      const file = path.join(dir, name)
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''))
        if (!parsed || typeof parsed !== 'object') continue
        records.push({ ...parsed, file, project_id: project.id, project_name: project.name })
      } catch {
        continue
      }
    }
  }
  records.sort((a, b) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')))
  return records
}

/* ===========================================================================
 * 应用配置（设置页里那些选项）
 *
 * 【为什么配置里要带默认值，而不是"文件里有什么就是什么"】
 *   配置是会随版本演进的：今天加了"相似度阈值"这一项，用户老的 settings.json 里没有它。
 *   所以读取时一律 **以默认值为底、用文件里的值覆盖**（深合并），
 *   这样新增配置项对老用户自动生效，不会出现 undefined 把界面搞崩。
 *
 * 【为什么数组不合并】
 *   配置里的数组（如果有）是"整体值"，合并会出现"删了一项永远删不掉"的问题，直接整体替换。
 * ===========================================================================*/

/** 全部配置项的默认值（设置页每一栏都对应这里的一段） */
const DEFAULT_SETTINGS = {
  schema_version: 1,
  general: {
    /** 工作区目录；null 表示用默认的 <文档>/RQC 项目库 */
    workspace_dir: null,
    /** 列表每页条数 */
    page_size: 20,
  },
  model: {
    /** 服务商：deepseek / openai / anthropic / ollama / custom */
    provider: 'deepseek',
    model: 'deepseek-chat',
    /** 采样温度 0~2，核查类任务建议低一些 */
    temperature: 0.2,
    max_tokens: 4096,
    top_p: 0.9,
    /** 同时跑几条主张 */
    concurrency: 4,
    timeout_seconds: 120,
  },
  check: {
    /** 判据严格度：loose 宽松 / standard 标准 / strict 严格 */
    strictness: 'standard',
    /** 高风险判定阈值 0~1（越高越不容易被标高风险） */
    high_risk_threshold: 0.75,
    /** 单条核查失败重试次数 */
    max_retry: 2,
    /** 失败/未覆盖的条目是否自动重跑一遍 */
    auto_recheck: false,
    /** 是否拿知识库交叉验证 */
    cross_check_with_knowledge: true,
  },
  knowledge: {
    enabled: true,
    /** 每次检索取前几条 */
    top_k: 8,
    /** 相似度阈值 0~1，低于它就不作为证据 */
    similarity_threshold: 0.65,
    /** 切片长度与重叠（字符） */
    chunk_size: 800,
    chunk_overlap: 120,
  },
  backend: {
    api_base_url: 'http://localhost:8000/api/v1',
    /** true = 走本地演示数据（后端未接入时用） */
    use_mock: true,
  },
  notify: {
    /** 任务完成后怎么提示：none / in_app / system */
    on_task_done: 'in_app',
  },
}

/** 深合并：以 base 为底，用 patch 覆盖（数组整体替换，不递归合并） */
function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(base) || Array.isArray(patch)) return patch
  if (typeof base !== 'object' || typeof patch !== 'object') return patch
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    result[key] = key in base ? deepMerge(base[key], patch[key]) : patch[key]
  }
  return result
}

/**
 * 读配置：文件不存在、内容坏了、只有半截 —— 一律返回"默认值 + 文件里能认的部分"。
 * 配置读失败绝不能让应用起不来。
 */
function readSettings(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw))
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  }
}

/**
 * 写配置：只传要改的那一段（如 { model: { temperature: 0.5 } }），其余字段原样保留。
 * @returns 合并后的完整配置
 */
function writeSettings(filePath, patch) {
  const merged = deepMerge(readSettings(filePath), patch ?? {})
  merged.updated_at = new Date().toISOString()
  writeConfig(filePath, merged)
  return merged
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  defaultWorkspace,
  ensureWorkspace,
  sanitizeFolderName,
  createProject,
  listProjects,
  openProject,
  readReportMeta,
  saveTaskRequest,
  saveErrataReview,
  listErrataReviews,
  readConfig,
  writeConfig,
  readSettings,
  writeSettings,
  deepMerge,
}