/**
 * pages/login/LoginPage.tsx —— 登录 / 注册
 *
 * 【这一页的设计目标：让人 30 秒内进入系统】
 *   比赛演示和日常使用都不希望在登录页浪费时间，所以：
 *     1. 演示账号已经预填好，点一下"登录"就进去了；
 *     2. 右边直接写清"这个系统解决什么问题"，评委第一眼就知道我们在做什么；
 *     3. 演示模式下给出提示（所有数据都是演示数据）。
 *
 * 【本文件导出】LoginPage 组件（默认导出，供路由懒加载）
 */
import { useState } from 'react'
import { App as AntdApp, Button, Card, Form, Input, Segmented, Tag, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { authApi, authToken, USE_MOCK, type RegisterPayload } from '@/api'

export default function LoginPage() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'登录' | '注册'>('登录')
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setLoading(true)
    try {
      const result =
        mode === '登录'
          ? await authApi.login(values.username, values.password)
          : await authApi.register({
              username: values.username,
              password: values.password,
              name: values.name,
              company: values.company,
              role: 'researcher',
            } satisfies RegisterPayload)

      // 令牌统一由 api/client.ts 的 authToken 管理，页面不直接碰 localStorage
      authToken.save(result.access_token, result.refresh_token)
      message.success('欢迎回来，' + result.user.name)
      navigate('/', { replace: true })
    } catch (error) {
      message.error((error as { userMessage?: string }).userMessage || '登录失败，请检查账号密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        background: 'linear-gradient(120deg, #f0f6ff 0%, #f7f9fc 55%, #ffffff 100%)',
      }}
    >
      {/* 左：登录表单 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Card style={{ width: 380, boxShadow: '0 8px 30px rgba(22,119,255,0.08)' }} bordered={false}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  background: 'linear-gradient(135deg,#1677ff,#4096ff)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                RQC
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>研报核查与质量评估平台</div>
                <div className="meta-text">Research Quality Check</div>
              </div>
            </div>
            <Segmented
              block
              options={['登录', '注册']}
              value={mode}
              onChange={(v) => setMode(v as '登录' | '注册')}
            />
          </div>

          <Form form={form} layout="vertical" initialValues={{ username: 'wangxiaoming', password: 'demo1234', company: '中信证券研究部' }}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="登录名" size="large" />
            </Form.Item>

            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>

            {mode === '注册' ? (
              <>
                <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input placeholder="用于显示在复核记录里" size="large" />
                </Form.Item>
                <Form.Item name="company" label="所属机构" rules={[{ required: true, message: '请输入机构名称' }]}>
                  <Input placeholder="例如：中信证券研究部" size="large" />
                </Form.Item>
              </>
            ) : null}

            <Button type="primary" size="large" block loading={loading} onClick={handleSubmit}>
              {mode === '登录' ? '登录' : '注册并进入'}
            </Button>
          </Form>

          {USE_MOCK ? (
            <div className="meta-text" style={{ marginTop: 14, textAlign: 'center' }}>
              <Tag color="blue">演示模式</Tag>
              后端未接入，当前展示的是内置演示数据（中瓷电子半年报点评）
            </div>
          ) : null}
        </Card>
      </div>

      {/* 右：产品说明（评委与第一次使用的同事看这块） */}
      <div style={{ display: 'flex', alignItems: 'center', padding: 48 }}>
        <div style={{ maxWidth: 520 }}>
          <Typography.Title level={3} style={{ marginBottom: 8 }}>
            把"逐句找错"变成"按风险排序地确认"
          </Typography.Title>
          <Typography.Paragraph style={{ color: 'var(--ink-2)', lineHeight: 2 }}>
            人工核查一份研报要逐句核对事实、复算数字、检查表述合规，既慢又不一致。
            本系统把这件事拆成一条可审计的流水线：解析 → 拆句 → 分类 → 分维度核查 → 报告级汇总，
            每一条结论都附带<strong>证据</strong>、<strong>可复算的计算过程</strong>与<strong>命中的规则编号</strong>，
            再由人逐条确认。
          </Typography.Paragraph>

          <div style={{ display: 'grid', gap: 10 }}>
            {[
              ['结论必须带证据', '没有证据的"高风险"结论会被降级为未覆盖，不允许凭空下判断'],
              ['数字不让模型算', '数值结论交给确定性计算工具，算式与中间值原样展示，可自己验算'],
              ['查不了会明说', '"未覆盖"单独统计并写明原因 —— 没查不等于没问题，这是全系统信任的基础'],
              ['判据由人掌握', '人工裁决沉淀为规则修改候选，经人审核发布、版本化、可回滚'],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: '#1677ff', fontWeight: 700 }}>·</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
                  <div className="meta-text" style={{ lineHeight: 1.7 }}>
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}