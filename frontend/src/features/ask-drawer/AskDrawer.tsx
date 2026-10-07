/**
 * features/ask-drawer/AskDrawer.tsx —— 单条追问抽屉（流式回答）
 *
 * 【它能回答什么问题】
 *   用户看到一条"高风险"结论，最大的疑问往往是"凭什么"、"规则合不合理"、
 *   "这条我要不要改"。追问就是让用户直接问，系统结合这条主张的结论与证据回答。
 *
 * 【三条边界（刻意的设计，不是没做）】
 *   1. 追问只带这一条主张的上下文，不把全文塞进去 —— 又贵又不准；
 *   2. 回答**不落库为核查结论**，只是对话记录 —— 避免聊天内容污染结论体系；
 *   3. 回答中出现的规则编号、证据可以是可点的（这里用文字标注，点击由页面处理）。
 *
 * 【本文件导出】AskDrawer 组件
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Input, Space, Tag } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { askClaimStream } from '@/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 是否还在流式输出中（用于显示光标） */
  streaming?: boolean
}

export function AskDrawer({
  open,
  claimId,
  claimText,
  onClose,
}: {
  open: boolean
  /** 追问针对的主张 id */
  claimId: string | null
  /** 主张原文（显示在抽屉顶部，让用户知道在问哪一句） */
  claimText?: string
  onClose: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * 流式回答的"代号"。
   * 【为什么需要】流是异步分段吐字的：用户切到另一条主张后，旧流仍在回调里往
   * messages 里追加文字 —— 结果旧回答被写进了新对话（还会把新对话的 loading 状态搞乱）。
   * 每次切换主张、每次重新提问都让代号 +1，回调发现代号变了就整段丢弃。
   */
  const streamToken = useRef(0)

  // 换了主张就把对话清空（不同话题混在一起会让用户困惑），并让正在跑的旧流作废
  useEffect(() => {
    streamToken.current += 1
    setMessages([])
    setInput('')
    setStreaming(false)
  }, [claimId])

  // 新消息出现时自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const ask = async (question: string) => {
    if (!claimId || !question.trim() || streaming) return
    setInput('')
    setStreaming(true)
    const token = (streamToken.current += 1)

    // 先把用户问题放上去，再放一个空的助手消息（后面往里填字）
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true }])

    await askClaimStream(claimId, question, {
      onChunk: (text) => {
        if (token !== streamToken.current) return
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') last.content += text
          return next
        })
      },
      onDone: () => {
        if (token !== streamToken.current) return
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last) last.streaming = false
          return next
        })
        setStreaming(false)
      },
      onError: (error) => {
        if (token !== streamToken.current) return
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last) {
            last.content = last.content || '回答失败：' + error.userMessage
            last.streaming = false
          }
          return next
        })
        setStreaming(false)
      },
    })
  }

  return (
    <Drawer
      title="追问（针对当前这一条结论）"
      placement="right"
      width={460}
      open={open}
      onClose={onClose}
      styles={{ body: { display: 'flex', flexDirection: 'column', padding: 16 } }}
    >
      {claimText ? (
        <div
          style={{
            padding: '8px 10px',
            background: '#fafafa',
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.7,
            marginBottom: 12,
          }}
        >
          <Tag color="blue">当前主张</Tag>
          {claimText}
        </div>
      ) : null}

      {/* 常见问题是"为什么被判这个等级"，直接给快捷入口，省得用户组织语言 */}
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        {['为什么判这个等级？', '这条判定依据是什么规则？', '我该怎么改？'].map((q) => (
          <Button key={q} size="small" onClick={() => ask(q)} disabled={streaming}>
            {q}
          </Button>
        ))}
      </Space>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
        {messages.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="可以问什么"
            description={
              <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                <div>· 判定依据：为什么是高风险？命中了哪条规则？</div>
                <div>· 计算细节：这个数是怎么算出来的？</div>
                <div>· 处理建议：我该怎么改这句话？</div>
              </div>
            }
          />
        ) : null}

        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              margin: '10px 0',
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '88%',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                background: msg.role === 'user' ? '#e6f4ff' : '#fafafa',
                border: '1px solid ' + (msg.role === 'user' ? '#bae0ff' : '#f0f0f0'),
              }}
            >
              {msg.content}
              {msg.streaming ? <span style={{ color: '#1677ff' }}>▍</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={input}
            placeholder="就这一条结论提问，回车发送"
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => ask(input)}
            disabled={streaming}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={() => ask(input)} loading={streaming}>
            发送
          </Button>
        </Space.Compact>
      </div>
    </Drawer>
  )
}