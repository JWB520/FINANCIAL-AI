/**
 * pages/projects/ProjectDetailPage.tsx —— 项目界面（一个项目 = 一份研报 + 可选知识库）
 *
 * 【这一页就是软件的"主界面"，只有三个入口】
 *   勘误      逐句核对：哪句话算错了、前后矛盾、缺证据（带原文位置与证据）
 *   评估      整篇质量：论证链、数据支撑、风险披露、观点交叉（四个维度 + 参考分）
 *   人工复核  AI 结论由人裁决：接受 / 驳回 / 已核实 / 人工修改
 *
 * 【页面上的信息都来自本地项目配置】
 *   研报路径、知识库路径都直接读 project.json（用户能在资源管理器里看到同一份东西），
 *   下面显示的结论数字则来自后端（演示环境是假数据）；两边靠 reportApi.ensureProject 对上。
 *
 * 【本文件定义】
 *   ProjectDetailPage  组件（默认导出）
 *   ActionCard         三个入口卡片（内部小组件）
 *   fileNameOf()       从路径取文件名（展示用）
 */
import { Button, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, AuditOutlined, FileSearchOutlined, FolderOpenOutlined, FundOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { desktop } from '@/api/local/desktop'
import { useLocalProject } from '@/features/project/useLocalProject'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { formatRelative } from '@/shared/utils/format'

/** 从路径取文件名（界面只显示文件名，完整路径放 tooltip） */
function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

/** 三个入口卡片：图标 + 名字 + 一句说明 + 当前摘要 */
function ActionCard(props: {
  icon: React.ReactNode
  title: string
  desc: string
  summary: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  const { icon, title, desc, summary, disabled, onClick } = props
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        flex: 1,
        minWidth: 260,
        background: '#fff',
        border: '1px solid #eef1f5',
        borderRadius: 10,
        padding: '22px 22px 18px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20, color: '#1677ff' }}>{icon}</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      </div>
      <div className="meta-text" style={{ marginTop: 10, lineHeight: 1.8, minHeight: 44 }}>
        {desc}
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5 }}>{summary}</div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { config, report, isLoading, error, refetch } = useLocalProject(projectId)

  if (isLoading) return <LoadingBlock rows={5} />

  if (error || !config) {
    return (
      <div className="page">
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            返回工作台
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            项目打不开
          </Typography.Title>
        </div>
        <ErrorState error={error} onRetry={refetch} />
        <div className="meta-text" style={{ marginTop: 12 }}>
          可能原因：项目文件夹被移动或删除、project.json 损坏，或当前不是桌面端环境。
          工作台 → 导入已有项目，可以重新挑一个。
        </div>
      </div>
    )
  }

  const ready = Boolean(report)
  const unreviewed = report ? Math.max(0, (report.review_total ?? 0) - (report.reviewed_count ?? 0)) : 0

  return (
    <div className="page">
      {/* ---------- 项目信息：就是 project.json 里那几行 ---------- */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {config.name}
          </Typography.Title>
          <div className="meta-text" style={{ marginTop: 6, lineHeight: 2 }}>
            <div>
              研报：<Typography.Text title={config.report_path}>{fileNameOf(config.report_path)}</Typography.Text>
            </div>
            <div>
              知识库：
              {config.knowledge_dir ? (
                <Typography.Text title={config.knowledge_dir}>{fileNameOf(config.knowledge_dir)}</Typography.Text>
              ) : (
                <span>未关联</span>
              )}
              {config.knowledge_dir ? null : <span className="meta-text">（不需要知识库时可不选）</span>}
            </div>
            <div>创建于 {formatRelative(config.created_at)} · {config.dir}</div>
          </div>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            返回工作台
          </Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => desktop.openInExplorer(config.dir)}>
            打开项目文件夹
          </Button>
        </Space>
      </div>

      {/* ---------- 三个入口：软件的全部功能 ---------- */}
      <div style={{ display: 'flex', gap: 16, marginTop: 28, flexWrap: 'wrap' }}>
        <ActionCard
          icon={<FileSearchOutlined />}
          title="勘误"
          desc="逐句核对：算错、前后矛盾、缺证据都在这里"
          disabled={!ready}
          summary={
            ready ? (
              <Space size={4} wrap>
                {report?.findings_high ? <Tag color="red">高风险 {report.findings_high}</Tag> : null}
                {report?.findings_medium ? <Tag color="orange">中风险 {report.findings_medium}</Tag> : null}
                {report?.findings_low ? <Tag color="gold">低风险 {report.findings_low}</Tag> : null}
                {report?.uncovered ? <Tag>未覆盖 {report.uncovered}</Tag> : null}
              </Space>
            ) : (
              <span className="meta-text">报告准备中…</span>
            )
          }
          onClick={() => navigate('/projects/' + projectId + '/task/new?kind=errata')}
        />

        <ActionCard
          icon={<FundOutlined />}
          title="评估"
          desc="整篇质量：四个维度各自做得怎么样"
          disabled={!ready}
          summary={ready ? <span className="meta-text">四个质量维度 + 参考分</span> : <span className="meta-text">报告准备中…</span>}
          onClick={() => navigate('/projects/' + projectId + '/task/new?kind=assessment')}
        />

        <ActionCard
          icon={<AuditOutlined />}
          title="人工复核"
          desc="AI 结论由人裁决：接受 / 驳回 / 已核实 / 人工修改"
          disabled={!ready}
          summary={ready ? <span className="meta-text">待复核 {unreviewed} / 共 {report?.review_total ?? 0} 条</span> : <span className="meta-text">报告准备中…</span>}
          onClick={() => navigate('/reviews/' + report!.id + '/queue')}
        />
      </div>
    </div>
  )
}
