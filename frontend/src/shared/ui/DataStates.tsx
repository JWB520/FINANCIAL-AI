/**
 * shared/ui/DataStates.tsx —— 列表页/详情页必须齐备的四种状态（04_前端架构.md §9.3）
 *
 * 【为什么单独抽出来】
 *   一个页面"能不能用"往往不是看好数据，而是看好数据之外的情况：
 *   加载时有没有骨架屏、空的时候有没有说明为什么空、出错时能不能重试、
 *   没权限时知不知道找谁开。如果每个页面各写一遍，必然有页面漏掉。
 *
 * 【本文件导出】
 *   LoadingBlock   骨架屏（不是转圈：骨架屏能让用户预期布局）
 *   EmptyState     空态（说明为什么空 + 下一步做什么）
 *   ErrorState     错误态（错误说明 + 追踪号 + 重试按钮）
 *   ForbiddenState 无权限态
 */
import type { ReactNode } from 'react'
import { Alert, Button, Empty, Skeleton, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ApiError } from '@/api'

/** 加载中：默认给 4 行骨架，与列表行高接近，视觉上不会跳动 */
export function LoadingBlock({ rows = 4, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0' }}>
      <Skeleton active paragraph={{ rows }} title={title} />
    </div>
  )
}

/** 空态：description 一定要写"为什么空、接下来能做什么" */
export function EmptyState(props: { description: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: '40px 20px', border: '1px solid #f0f0f0' }}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>{props.description}</span>}>
        {props.action ? <Space>{props.action}</Space> : null}
      </Empty>
    </div>
  )
}

/**
 * 错误态：把 ApiError 的信息完整展示出来。
 * 注意 traceId 一定要显示 —— 用户报障时给工程师这个编号，就能精确找到日志。
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error as ApiError
  const message = apiError?.userMessage || apiError?.message || '加载失败，请稍后重试'
  const traceId = apiError?.traceId

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0' }}>
      <Alert
        type="error"
        showIcon
        message="加载失败"
        description={
          <div>
            <div>{message}</div>
            {traceId ? (
              <div className="meta-text" style={{ marginTop: 6 }}>
                追踪号：{traceId}
              </div>
            ) : null}
          </div>
        }
        action={
          onRetry ? (
            <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
              重试
            </Button>
          ) : null
        }
      />
    </div>
  )
}

/** 无权限态：说清缺什么权限、找谁开通（而不是干巴巴一个 403） */
export function ForbiddenState({ permission }: { permission?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0' }}>
      <Alert
        type="warning"
        showIcon
        message="没有访问权限"
        description={
          <div>
            <div>当前账号缺少{permission ? '「' + permission + '」' : '该页面所需的'}权限。</div>
            <div className="meta-text" style={{ marginTop: 6 }}>
              请联系管理员在「系统管理 → 角色权限」中开通。
            </div>
          </div>
        }
      />
    </div>
  )
}