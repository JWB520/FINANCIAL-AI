/**
 * pages/dashboard/DashboardPage.tsx —— 工作台（软件唯一入口，就两件事）
 *
 * 【这一页刻意只有两个按钮，多一个都不要】
 *   新建项目：选一份研报（系统原生文件窗口）→ 问要不要关联知识库（系统原生文件夹窗口）→ 建成项目
 *   导入已有项目：列出工作区里已有的项目（按时间倒序、可搜索）→ 选中进入
 *   两条路都通向同一个地方：项目界面（勘误 / 评估 / 人工复核 三个入口）。
 *
 * 【为什么必须用桌面端】
 *   浏览器出于安全，永远拿不到本地文件的真实路径。所以要弹"系统原生"的文件/文件夹窗口、
 *   要在磁盘上建项目文件夹，只能由桌面端主进程来做（见 electron/main.cjs）。
 *   用普通浏览器打开时，两个按钮会给出明确提示而不是静默失败。
 *
 * 【项目的落盘形态（用户能在资源管理器里直接看到）】
 *   <文档>/RQC 项目库/<项目名>/
 *   ├── project.json   研报路径 + 知识库路径 + 创建时间
 *   └── data/          留给核查结果与导出
 *
 * 【本文件定义】
 *   DashboardPage   组件（默认导出）
 *   EntryCard       入口卡片（内部小组件）：标题 + 说明 + 点击
 *   baseName()      从路径里取文件名（默认项目名用）
 */
import { useState } from 'react'
import { App as AntdApp, Button, Empty, Input, Modal, Space, Tag, Typography } from 'antd'
import { FileAddOutlined, FolderOpenOutlined, FolderOutlined, ImportOutlined } from '@ant-design/icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { reportApi } from '@/api'
import { desktop, type LocalProjectConfig } from '@/api/local/desktop'
import { formatRelative } from '@/shared/utils/format'
import { ErrorState } from '@/shared/ui/DataStates'

/** 从路径里取文件名（默认项目名 = 研报文件名去掉扩展名） */
function baseName(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  return fileName.replace(/\.[^.]+$/, '')
}

/** 入口卡片：一个大按钮，说明写在下面一行 */
function EntryCard(props: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  const { icon, title, desc, onClick } = props
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        maxWidth: 320,
        background: '#fff',
        border: '1px solid #eef1f5',
        borderRadius: 10,
        padding: '28px 24px',
        cursor: 'pointer',
        transition: 'border-color .15s ease',
      }}
    >
      <div style={{ fontSize: 26, color: '#1677ff' }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>{title}</div>
      <div className="meta-text" style={{ marginTop: 6, lineHeight: 1.7 }}>
        {desc}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { message, modal } = AntdApp.useApp()
  const supported = desktop.isDesktop()

  /** 新建项目的草稿：选完研报就进入弹窗，再决定要不要知识库 */
  const [draft, setDraft] = useState<{ reportPath: string; knowledgeDir: string | null } | null>(null)
  const [projectName, setProjectName] = useState('')
  const [importing, setImporting] = useState(false)
  const [keyword, setKeyword] = useState('')

  const workspaceQuery = useQuery({
    queryKey: ['workspace-dir'],
    queryFn: () => desktop.workspaceDir(),
    enabled: supported,
    retry: false,
  })

  const projectsQuery = useQuery<LocalProjectConfig[]>({
    queryKey: ['local-projects'],
    queryFn: () => desktop.listProjects(),
    enabled: supported && importing,
    retry: false,
  })

  /** 桌面端不可用时的统一提示（不要让按钮点了没反应） */
  const warnNoDesktop = () => {
    modal.warning({
      title: '需要桌面端才能选本地文件',
      content:
        '浏览器出于安全拿不到本地文件的真实路径。请用桌面端启动（命令见 README 第 1 节）：' +
        '启动后会弹出应用窗口，在那里新建项目即可。',
      okText: '知道了',
    })
  }

  /** 新建项目 · 第 1 步：选研报文件（系统原生"打开文件"窗口） */
  const pickReport = async () => {
    if (!supported) return warnNoDesktop()
    try {
      const filePath = await desktop.pickReportFile()
      if (!filePath) return // 用户取消，什么都不做
      setDraft({ reportPath: filePath, knowledgeDir: null })
      setProjectName(baseName(filePath))
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  /** 新建项目 · 第 2 步：选知识库文件夹（系统原生"选择文件夹"窗口） */
  const pickKnowledge = async () => {
    try {
      const dir = await desktop.pickKnowledgeDir()
      if (!dir) return
      setDraft((prev) => (prev ? { ...prev, knowledgeDir: dir } : prev))
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  /** 新建项目 · 第 3 步：建文件夹 + 写配置 + 保证报告就绪，然后进入项目界面 */
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('还没有选择研报')
      const project = await desktop.createProject({
        name: projectName.trim() || baseName(draft.reportPath),
        report_path: draft.reportPath,
        knowledge_dir: draft.knowledgeDir,
      })
      // 让这个项目立刻有一份"报告"可看（结论都挂在报告上）
      await reportApi.ensureProject({
        project_id: project.id,
        report_path: project.report_path,
        report_name: project.name,
      })
      return project
    },
    onSuccess: (project) => {
      message.success('项目已创建：' + project.dir)
      setDraft(null)
      navigate('/projects/' + project.id)
    },
    onError: (error) => message.error((error as Error).message || '创建项目失败'),
  })

  const filtered = (projectsQuery.data ?? []).filter((project) => {
    if (!keyword) return true
    return (
      project.name.includes(keyword) ||
      project.report_path.includes(keyword) ||
      (project.knowledge_dir ?? '').includes(keyword)
    )
  })

  return (
    <div className="page">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 56 }}>
        <Typography.Title level={3} style={{ marginBottom: 6 }}>
          研报核查与质量评估
        </Typography.Title>
        <div className="meta-text" style={{ marginBottom: 40 }}>
          一个项目 = 一份研报 + 可选的知识库，项目以文件夹形式保存在本地
        </div>

        <div style={{ display: 'flex', gap: 20, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
          <EntryCard
            icon={<FileAddOutlined />}
            title="新建项目"
            desc="选一份研报，软件自动建好项目文件夹"
            onClick={pickReport}
          />
          <EntryCard
            icon={<ImportOutlined />}
            title="导入已有项目"
            desc="按时间浏览、搜索、打开已有项目"
            onClick={() => {
              if (!supported) return warnNoDesktop()
              setImporting(true)
            }}
          />
        </div>

        <div className="meta-text" style={{ marginTop: 36, textAlign: 'center', lineHeight: 1.8 }}>
          {workspaceQuery.isError ? (
            // 读不到工作区要如实说：以前错误被静默忽略，界面只会显示"（桌面端启动后显示）"，
            // 用户以为是自己没启动桌面端，其实是读取失败
            <span style={{ color: '#cf1322' }}>
              项目保存位置读取失败
              <Button size="small" type="link" onClick={() => workspaceQuery.refetch()}>
                重试
              </Button>
            </span>
          ) : (
            <>项目保存位置：{workspaceQuery.data ?? '（桌面端启动后显示）'}</>
          )}
          {!supported ? (
            <div style={{ color: '#d46b08' }}>
              当前用浏览器打开，无法选择本地文件；请改用桌面端启动方式（见 README 第 1 节）。
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- 新建项目弹窗：研报已选好，这里问"要不要知识库"并确认项目名 ---------- */}
      <Modal
        title="新建项目"
        open={Boolean(draft)}
        width={620}
        okText="创建项目"
        okButtonProps={{ loading: createMutation.isPending }}
        onCancel={() => setDraft(null)}
        onOk={() => createMutation.mutate()}
      >
        {draft ? (
          <div style={{ lineHeight: 1.9 }}>
            <div style={{ marginBottom: 16 }}>
              <div className="meta-text">研报文件</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Typography.Text style={{ flex: 1, wordBreak: 'break-all' }}>{draft.reportPath}</Typography.Text>
                <Button size="small" onClick={pickReport}>
                  重新选择
                </Button>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="meta-text">知识库文件夹（可选，用于规范核查、估值规则等）</div>
              {draft.knowledgeDir ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text style={{ flex: 1, wordBreak: 'break-all' }}>{draft.knowledgeDir}</Typography.Text>
                  <Button size="small" onClick={pickKnowledge}>
                    重选
                  </Button>
                  <Button size="small" onClick={() => setDraft({ ...draft, knowledgeDir: null })}>
                    移除
                  </Button>
                </div>
              ) : (
                <Space>
                  <Button icon={<FolderOutlined />} onClick={pickKnowledge}>
                    选择知识库文件夹
                  </Button>
                  <span className="meta-text">不需要知识库？直接创建即可（之后可再补）</span>
                </Space>
              )}
            </div>

            <div>
              <div className="meta-text">项目名</div>
              <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="默认取研报文件名" />
            </div>

            <div className="meta-text" style={{ marginTop: 16 }}>
              项目会保存为：{workspaceQuery.data ?? ''}\{projectName.trim() || baseName(draft.reportPath)}\
              <br />
              其中 project.json 记录研报路径与知识库路径，data\ 目录留给核查结果。
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------- 导入已有项目：按时间倒序 + 搜索 ---------- */}
      <Modal
        title="导入已有项目"
        open={importing}
        width={720}
        footer={null}
        onCancel={() => setImporting(false)}
      >
        <Input
          allowClear
          placeholder="搜索项目名 / 研报路径 / 知识库路径"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ marginBottom: 12 }}
        />
        {projectsQuery.isError ? (
          // 列表读取失败必须给错误态与重试：以前失败时会落到"项目库还是空的"，
          // 用户以为自己的项目丢了
          <ErrorState error={projectsQuery.error} onRetry={() => projectsQuery.refetch()} />
        ) : projectsQuery.isLoading ? (
          <div className="meta-text" style={{ padding: '24px 0', textAlign: 'center' }}>
            正在读取本地项目库…
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? '没有匹配的项目' : '项目库还是空的，先新建一个项目'}
          />
        ) : (
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {filtered.map((project) => (
              <div
                key={project.id}
                className="row-link"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setImporting(false)
                  navigate('/projects/' + project.id)
                }}
              >
                <div className="row-link__title">
                  <FolderOpenOutlined className="meta-text" />
                  {project.name}
                  {project.knowledge_dir ? <Tag>含知识库</Tag> : null}
                </div>
                <div className="row-link__meta" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span>研报：{project.report_path}</span>
                  <span>创建于 {formatRelative(project.created_at)} · {project.dir}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
