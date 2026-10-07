/**
 * features/review-actions/ReviewActionBar.tsx —— 四个复核动作（人机协同的落点）
 *
 * 【这是整个系统里唯一会"写库"的地方，所以要特别小心两件事】
 *   1. **驳回必须填理由**：理由不是形式，它是经验学习的原料（系统靠它变得更准）。
 *      所以这里做了前端校验，后端也会校验，两边都不放过。
 *   2. **并发冲突**：两个人可能同时看同一条。提交时带上 revision，
 *      如果别人先改了，后端返回 409，前端要明确告诉用户"已刷新为最新状态"，
 *      而不是把别人的结论悄悄覆盖掉。
 *
 * 【本文件导出】ReviewActionBar 组件
 *   props: claimId / revision / onReviewed（提交成功后的回调，页面用它刷新数据）
 */
import { useState } from 'react'
import { App as AntdApp, Button, Form, Input, Modal, Space, Tooltip } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  FileAddOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, claimApi, REVIEW_ACTION_HINT, type ReviewActionType } from '@/api'

export function ReviewActionBar({
  claimId,
  revision,
  onReviewed,
}: {
  claimId: string
  /** 该主张的当前版本号，提交时用于并发控制（对应后端 If-Match） */
  revision: number
  /** 提交成功后的回调（页面里一般用它失效查询、刷新列表） */
  onReviewed?: (action: ReviewActionType) => void
}) {
  const { message, modal } = AntdApp.useApp()
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [rejectForm] = Form.useForm<{ reason: string }>()
  const [editForm] = Form.useForm<{ edited_text: string }>()
  const [evidenceForm] = Form.useForm<{ snippet: string; uri: string }>()

  /** 提交动作：统一走这里，好处是错误处理、刷新、提示只有一份实现 */
  const submitMutation = useMutation({
    mutationFn: (payload: { action: ReviewActionType; reason?: string; payload?: Record<string, unknown> }) =>
      claimApi.submitReview(claimId, { ...payload, revision }),
    onSuccess: (_data, variables) => {
      message.success('已提交：' + REVIEW_ACTION_HINT[variables.action].split('，')[0])
      // 只失效与该条相关的查询，避免整页重新加载（04 §4 的失效规则）
      queryClient.invalidateQueries({ queryKey: ['claim', claimId] })
      queryClient.invalidateQueries({ queryKey: ['claims'] })
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      onReviewed?.(variables.action)
    },
    onError: (error: unknown) => {
      const apiError = error as ApiError
      if (apiError?.isRevisionConflict) {
        // 别人先改了：提示并把最新数据拉回来，绝不覆盖别人的结论
        modal.warning({
          title: '该条已被他人复核',
          content: '系统已为你刷新为最新状态，请基于最新结论重新判断。',
          okText: '知道了',
        })
        queryClient.invalidateQueries({ queryKey: ['claim', claimId] })
        queryClient.invalidateQueries({ queryKey: ['claims'] })
        return
      }
      message.error(apiError?.userMessage || '提交失败，请稍后重试')
    },
  })

  /** 驳回：必须填理由，前端先拦一道 */
  const handleReject = async () => {
    const values = await rejectForm.validateFields()
    submitMutation.mutate({ action: 'reject', reason: values.reason })
    setRejectOpen(false)
    rejectForm.resetFields()
  }

  const loading = submitMutation.isPending

  return (
    <>
      <Space wrap size={8}>
        <Tooltip title={REVIEW_ACTION_HINT.accept}>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={loading}
            onClick={() => submitMutation.mutate({ action: 'accept' })}
          >
            接受修改
          </Button>
        </Tooltip>

        <Tooltip title={REVIEW_ACTION_HINT.reject}>
          <Button danger icon={<CloseCircleOutlined />} onClick={() => setRejectOpen(true)}>
            驳回 AI
          </Button>
        </Tooltip>

        <Tooltip title={REVIEW_ACTION_HINT.verify}>
          <Button
            icon={<CheckCircleOutlined />}
            loading={loading}
            onClick={() => submitMutation.mutate({ action: 'verify', reason: '人工核实无误' })}
          >
            标记已核实
          </Button>
        </Tooltip>

        <Tooltip title={REVIEW_ACTION_HINT.add_evidence}>
          <Button icon={<FileAddOutlined />} onClick={() => setEvidenceOpen(true)}>
            补充证据
          </Button>
        </Tooltip>

        <Tooltip title={REVIEW_ACTION_HINT.manual_edit}>
          <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
            人工修改
          </Button>
        </Tooltip>
      </Space>

      {/* 驳回弹窗：理由输入框是必填的，而且提示了"为什么必须填" */}
      <Modal
        title="驳回 AI 结论"
        open={rejectOpen}
        onOk={handleReject}
        onCancel={() => setRejectOpen(false)}
        okText="提交驳回"
        okButtonProps={{ danger: true, loading }}
      >
        <p className="meta-text" style={{ marginTop: 0 }}>
          理由会进入经验学习闭环：多条同样理由的驳回会生成"规则/提示词该怎么改"的候选（需人工审核后才生效）。
        </p>
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="驳回理由"
            rules={[
              { required: true, message: '必须填写理由，否则这条驳回对系统没有价值' },
              { min: 5, message: '请写具体一点（至少 5 个字）' },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：该表述有行业协会公开数据支撑，判定过严" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 人工修改：保留修改前后对比，所以这里只填"改后文本" */}
      <Modal
        title="人工修改"
        open={editOpen}
        onOk={async () => {
          const values = await editForm.validateFields()
          submitMutation.mutate({ action: 'manual_edit', payload: { edited_text: values.edited_text } })
          setEditOpen(false)
        }}
        onCancel={() => setEditOpen(false)}
        okText="保存修改"
        okButtonProps={{ loading }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="edited_text" label="修改后的表述" rules={[{ required: true, message: '请填写修改后的文本' }]}>
            <Input.TextArea rows={3} placeholder="填写改后的说法，系统会保留修改前后的对比" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 补充证据：人工也能加证据，让结论更有据可查 */}
      <Modal
        title="补充证据"
        open={evidenceOpen}
        onOk={async () => {
          const values = await evidenceForm.validateFields()
          submitMutation.mutate({
            action: 'add_evidence',
            payload: { evidence: { type: 'in_text', snippet: values.snippet, uri: values.uri } },
          })
          setEvidenceOpen(false)
          evidenceForm.resetFields()
        }}
        onCancel={() => setEvidenceOpen(false)}
        okText="添加证据"
        okButtonProps={{ loading }}
      >
        <Form form={evidenceForm} layout="vertical">
          <Form.Item name="snippet" label="证据内容" rules={[{ required: true, message: '请粘贴证据原文' }]}>
            <Input.TextArea rows={3} placeholder="粘贴可以支撑判断的原文或数据" />
          </Form.Item>
          <Form.Item name="uri" label="来源链接（可选）">
            <Input placeholder="数据源页面地址或文件路径" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}