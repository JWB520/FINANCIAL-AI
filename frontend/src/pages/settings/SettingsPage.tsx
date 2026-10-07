/**
 * pages/settings/SettingsPage.tsx —— 设置（这个智能体的全部配置，改完就存）
 *
 * 【这一页的规矩】
 *   1. **能改的才放上来**：只读信息（版本号、User-Agent）不放，那是"关于"，不是"设置"；
 *   2. **每项都要说清"什么时候生效"**：
 *      · 立即生效 —— 数据模式、接口地址、工作区目录（保存后立刻按新值走）
 *      · 随任务提交 —— 模型、判据、知识库检索参数（下次发起勘误/评估时带给后端）
 *      · 界面偏好 —— 每页条数、任务完成提示方式
 *      标注在每一栏的右上角，用户不用猜；
 *   3. **配置存在一个看得见的文件里**：settings.json（点"打开位置"能直接看/改），
 *      读取时以默认值为底做合并，所以老配置文件缺字段也不会出问题。
 *
 * 【本文件定义】
 *   SettingsPage   组件（默认导出）
 *   GroupCard      分组卡片（标题 + 生效时机标签 + 内容）
 *   ProviderOptions / StrictnessOptions / NotifyOptions  下拉与单选的选项表
 */
import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { setRuntimeApiOptions } from '@/api'
import { desktop, type AppSettings } from '@/api/local/desktop'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ErrorState } from '@/shared/ui/DataStates'

/** 生效时机：标在每栏右上角，用户不用猜 */
type Effect = 'now' | 'task' | 'app'

const EFFECT_LABEL: Record<Effect, { text: string; color: string; tip: string }> = {
  now: { text: '立即生效', color: 'green', tip: '保存后马上按新值走，不用重启' },
  task: { text: '随任务提交', color: 'blue', tip: '下次发起勘误 / 评估任务时，把这些参数一起带给后端' },
  app: { text: '界面偏好', color: 'default', tip: '只影响本机界面显示' },
}

const PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek（默认）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: '本地 Ollama' },
  { value: 'custom', label: '自定义（自填模型名）' },
]

const STRICTNESS_OPTIONS = [
  { value: 'loose', label: '宽松', hint: '只报明显错误，适合初筛' },
  { value: 'standard', label: '标准', hint: '默认：有明显依据的问题都报' },
  { value: 'strict', label: '严格', hint: '存疑也报，人工复核工作量更大' },
]

const NOTIFY_OPTIONS = [
  { value: 'none', label: '不提示' },
  { value: 'in_app', label: '页内提示' },
  { value: 'system', label: '系统通知' },
]

/** 分组卡片：标题 + 生效时机标签 + 一句说明 */
function GroupCard(props: { title: string; effect: Effect; desc: string; children: React.ReactNode }) {
  const { title, effect, desc, children } = props
  const badge = EFFECT_LABEL[effect]
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space size={8}>
          <span>{title}</span>
          <Tooltip title={badge.tip}>
            <Tag color={badge.color} style={{ marginLeft: 2 }}>
              {badge.text}
            </Tag>
          </Tooltip>
        </Space>
      }
    >
      <div className="meta-text" style={{ marginTop: -4, marginBottom: 14, lineHeight: 1.7 }}>
        {desc}
      </div>
      {children}
    </Card>
  )
}

export default function SettingsPage() {
  const [form] = Form.useForm<AppSettings>()
  const { message, modal } = AntdApp.useApp()
  const queryClient = useQueryClient()
  const supported = desktop.isDesktop()

  const [dirty, setDirty] = useState(false)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => desktop.getSettings(),
    enabled: supported,
    retry: false,
  })

  /** 拉回来的配置填进表单（表单是唯一编辑入口，不直接改 query 缓存） */
  useEffect(() => {
    if (settingsQuery.data) form.setFieldsValue(settingsQuery.data)
  }, [settingsQuery.data, form])

  const workspaceQuery = useQuery({
    queryKey: ['workspace-dir'],
    queryFn: () => desktop.workspaceDir(),
    enabled: supported,
    retry: false,
  })

  /** 保存：写盘 → 把"数据模式 / 接口地址"立刻接进 api 层（不用重启）→ 刷新相关查询 */
  const saveMutation = useMutation({
    mutationFn: (values: AppSettings) => desktop.saveSettings(values),
    onSuccess: (saved) => {
      message.success('设置已保存到 settings.json')
      setRuntimeApiOptions({ useMock: saved.backend.use_mock, apiBaseUrl: saved.backend.api_base_url })
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['workspace-dir'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error) => message.error((error as Error).message || '保存失败'),
  })

  /** 选工作区目录（系统原生文件夹窗口） */
  const pickWorkspace = async () => {
    try {
      const dir = await desktop.pickWorkspaceDir()
      if (!dir) return
      form.setFieldValue(['general', 'workspace_dir'], dir)
      setDirty(true)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  if (!supported) {
    return (
      <div className="page">
        <PageHeader title="设置" description="配置存在本地文件里，需要桌面端读写" />
        <Card size="small">
          <div style={{ lineHeight: 2 }}>
            当前是浏览器打开，读不到也存不了配置。
            <br />
            请用桌面端启动（命令见 README 第 1 节），启动后在应用窗口里进"设置"。
          </div>
        </Card>
      </div>
    )
  }

  // 两个查询都必须"要么成功、要么有错误出口"：
  // 以前只看 settingsQuery.isLoading，工作区查询失败时 supported 为真、data 为空，
  // 页面就一直停在"正在读取配置…"，用户没有任何恢复手段。
  if (settingsQuery.isLoading || workspaceQuery.isLoading) {
    return (
      <div className="page">
        <PageHeader title="设置" description="正在读取配置…" />
      </div>
    )
  }

  if (settingsQuery.isError || workspaceQuery.isError) {
    return (
      <div className="page">
        <PageHeader title="设置" />
        <ErrorState
          error={settingsQuery.error ?? workspaceQuery.error}
          onRetry={() => {
            settingsQuery.refetch()
            workspaceQuery.refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="设置"
        description="这个智能体的全部配置；改完点右下角保存，标注了每项什么时候生效"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => desktop.revealSettingsFile().then((file) => message.info('配置文件：' + file))}
            >
              配置文件位置
            </Button>
            <Button
              danger
              onClick={() =>
                modal.confirm({
                  title: '把所有设置恢复为默认值？',
                  content: '只会重置配置项，不会动你的项目和研报。',
                  okText: '恢复默认',
                  onOk: async () => {
                    const defaults = await desktop.resetSettings()
                    form.setFieldsValue(defaults)
                    setRuntimeApiOptions({ useMock: defaults.backend.use_mock, apiBaseUrl: defaults.backend.api_base_url })
                    setDirty(false)
                    message.success('已恢复默认设置')
                    queryClient.invalidateQueries()
                  },
                })
              }
            >
              恢复默认
            </Button>
          </Space>
        }
      />

      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => setDirty(true)}
        onFinish={(values) => saveMutation.mutate(values)}
      >
        {/* ---------------- 工作区与数据 ---------------- */}
        <GroupCard
          title="工作区与数据"
          effect="now"
          desc="项目文件夹建在哪、业务数据从哪来。"
        >
          <Form.Item label="工作区目录" name={['general', 'workspace_dir']} extra="项目文件夹都建在这个目录下；留空则用默认的「文档 / RQC 项目库」">
            <Input
              readOnly
              placeholder="（默认：文档 / RQC 项目库）"
              addonAfter={
                <Space size={4}>
                  <a onClick={pickWorkspace}>选择文件夹</a>
                  <a
                    onClick={() => {
                      form.setFieldValue(['general', 'workspace_dir'], null)
                      setDirty(true)
                    }}
                  >
                    用默认
                  </a>
                </Space>
              }
            />
          </Form.Item>

          <Form.Item
            label="数据模式"
            name={['backend', 'use_mock']}
            valuePropName="checked"
            extra="打开 = 用本机演示数据（后端未接入时用）；关闭 = 连下面的接口地址取真实数据"
          >
            <Switch checkedChildren="演示数据" unCheckedChildren="真实后端" />
          </Form.Item>

          <Form.Item
            label="后端接口地址"
            name={['backend', 'api_base_url']}
            extra="真实后端部署在哪；本机开发一般是 http://localhost:8000/api/v1"
          >
            <Input placeholder="http://localhost:8000/api/v1" />
          </Form.Item>
        </GroupCard>

        {/* ---------------- 模型与推理 ---------------- */}
        <GroupCard
          title="模型与推理"
          effect="task"
          desc="用哪个模型跑核查、跑多快。"
        >
          <Space size={16} style={{ display: 'flex', flexWrap: 'wrap' }} align="start">
            <Form.Item label="服务商" name={['model', 'provider']} style={{ minWidth: 200, marginBottom: 12 }}>
              <Radio.Group optionType="button" buttonStyle="solid" options={PROVIDER_OPTIONS} />
            </Form.Item>
            <Form.Item label="模型名" name={['model', 'model']} style={{ minWidth: 220, marginBottom: 12 }}>
              <Input placeholder="deepseek-chat" />
            </Form.Item>
          </Space>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Form.Item
              label="采样温度（越低越不容易自由发挥）"
              name={['model', 'temperature']}
              style={{ minWidth: 300, flex: 1 }}
            >
              <Slider min={0} max={2} step={0.05} marks={{ 0: '0', 0.2: '0.2', 1: '1', 2: '2' }} />
            </Form.Item>
            <Form.Item label="top_p" name={['model', 'top_p']} style={{ minWidth: 260, flex: 1 }}>
              <Slider min={0} max={1} step={0.05} />
            </Form.Item>
          </div>

          <Space size={16} wrap>
            <Form.Item label="最大输出 token" name={['model', 'max_tokens']} style={{ marginBottom: 8 }}>
              <InputNumber min={256} max={32768} step={256} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item label="并发条数" name={['model', 'concurrency']} style={{ marginBottom: 8 }}>
              <InputNumber min={1} max={32} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item label="单次超时（秒）" name={['model', 'timeout_seconds']} style={{ marginBottom: 8 }}>
              <InputNumber min={10} max={600} step={10} style={{ width: 120 }} />
            </Form.Item>
          </Space>
        </GroupCard>

        {/* ---------------- 核查判据 ---------------- */}
        <GroupCard
          title="核查判据"
          effect="task"
          desc="什么算问题、什么算高风险。"
        >
          <Form.Item label="判据严格度" name={['check', 'strictness']}>
            <Radio.Group>
              <Space direction="vertical" size={4}>
                {STRICTNESS_OPTIONS.map((item) => (
                  <Radio key={item.value} value={item.value}>
                    <span style={{ fontSize: 13.5 }}>{item.label}</span>
                    <span className="meta-text" style={{ marginLeft: 8 }}>
                      {item.hint}
                    </span>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label="高风险判定阈值"
            name={['check', 'high_risk_threshold']}
            extra="调低 = 更多问题被标成高风险（宁可多报）；调高 = 只有很确定的才标高风险"
            style={{ maxWidth: 420 }}
          >
            <Slider min={0} max={1} step={0.05} marks={{ 0.3: '多报', 0.75: '默认', 1: '少报' }} />
          </Form.Item>

          <Space size={24} wrap>
            <Form.Item label="失败重试次数" name={['check', 'max_retry']} style={{ marginBottom: 8 }}>
              <InputNumber min={0} max={5} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item
              label="自动重跑未覆盖项"
              name={['check', 'auto_recheck']}
              valuePropName="checked"
              style={{ marginBottom: 8 }}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="用知识库交叉验证"
              name={['check', 'cross_check_with_knowledge']}
              valuePropName="checked"
              style={{ marginBottom: 8 }}
            >
              <Switch />
            </Form.Item>
          </Space>
        </GroupCard>

        {/* ---------------- 知识库检索 ---------------- */}
        <GroupCard
          title="知识库检索"
          effect="task"
          desc="关联的知识库文件夹怎么被检索。"
        >
          <Form.Item label="启用知识库" name={['knowledge', 'enabled']} valuePropName="checked" style={{ marginBottom: 12 }}>
            <Switch />
          </Form.Item>

          <Space size={16} wrap>
            <Form.Item label="召回条数 TopK" name={['knowledge', 'top_k']} style={{ marginBottom: 8 }}>
              <InputNumber min={1} max={50} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item label="切片长度（字符）" name={['knowledge', 'chunk_size']} style={{ marginBottom: 8 }}>
              <InputNumber min={200} max={4000} step={100} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item label="切片重叠（字符）" name={['knowledge', 'chunk_overlap']} style={{ marginBottom: 8 }}>
              <InputNumber min={0} max={1000} step={20} style={{ width: 130 }} />
            </Form.Item>
          </Space>

          <Form.Item
            label="相似度阈值"
            name={['knowledge', 'similarity_threshold']}
            extra="低于这个相似度的资料不会被当作证据（调高 = 更保守，宁可说没查到）"
            style={{ maxWidth: 420 }}
          >
            <Slider min={0} max={1} step={0.05} marks={{ 0.4: '宽', 0.65: '默认', 0.9: '严' }} />
          </Form.Item>
        </GroupCard>

        {/* ---------------- 界面偏好 ---------------- */}
        <GroupCard title="界面偏好" effect="app" desc="只影响本机显示，不影响核查结果。">
          <Space size={24} wrap>
            <Form.Item label="列表每页条数" name={['general', 'page_size']} style={{ marginBottom: 8 }}>
              <InputNumber min={10} max={100} step={10} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="任务完成后" name={['notify', 'on_task_done']} style={{ marginBottom: 8 }}>
              <Radio.Group options={NOTIFY_OPTIONS} optionType="button" />
            </Form.Item>
          </Space>
        </GroupCard>

        {/* ---------------- 底部：保存 ---------------- */}
        <Card size="small">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div className="meta-text" style={{ lineHeight: 1.8 }}>
              配置保存在 <code>settings.json</code>（点右上角"配置文件位置"可以打开看到）。
              {dirty ? <span style={{ color: '#d46b08' }}>有改动尚未保存。</span> : '当前没有未保存的改动。'}
              <br />
              工作区：{workspaceQuery.data ?? '读取中…'}
              <br />
              配置位置与项目数据分开存放：项目在 <code>文档\RQC 项目库</code>，配置在应用数据目录。
            </div>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  settingsQuery.refetch()
                  setDirty(false)
                }}
              >
                放弃改动
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!dirty}
                loading={saveMutation.isPending}
                onClick={() => form.submit()}
              >
                保存设置
              </Button>
            </Space>
          </div>
        </Card>
      </Form>

    </div>
  )
}
