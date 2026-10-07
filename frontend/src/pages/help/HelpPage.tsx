/**
 * pages/help/HelpPage.tsx —— 帮助（怎么用、概念解释）
 *
 * 【它为什么必须有】
 *   系统里有几个"第一次一定会问"的概念：未覆盖是什么意思、风险等级怎么定、三态结论、
 *   项目为什么是文件夹、为什么驳回必须写理由。这些写在代码注释里用户看不到，
 *   所以集中在这一页，改成文案也不用发版（内容走后端接口 helpApi.articles）。
 *
 * 【结构】左侧目录（按分组 + 可搜索）+ 右侧正文。
 *
 * 【本文件定义】
 *   HelpPage          组件（默认导出）
 *   ArticleBody       正文渲染小组件（把换行按段落/列表项渲出来）
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Input, Row, Tag, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { helpApi } from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { formatDate } from '@/shared/utils/format'

/** 正文渲染：每行一段；以 · / 数字开头当作列表项 */
function ArticleBody({ content }: { content: string }) {
  const lines = content.split('\n').filter((line) => line.trim())
  return (
    <div style={{ fontSize: 13.5, lineHeight: 2, color: 'var(--ink-2)' }}>
      {lines.map((line, index) => {
        const isListItem = /^[·•]|^\d+[）)]/.test(line.trim())
        return (
          <div key={index} style={{ paddingLeft: isListItem ? 14 : 0, marginBottom: isListItem ? 2 : 10 }}>
            {line}
          </div>
        )
      })}
    </div>
  )
}

export default function HelpPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')

  const query = useQuery({ queryKey: ['help', 'articles'], queryFn: () => helpApi.articles() })
  const articles = useMemo(() => query.data ?? [], [query.data])

  const groups = useMemo(() => {
    const map = new Map<string, typeof articles>()
    articles.forEach((article) => {
      const list = map.get(article.group) ?? []
      list.push(article)
      map.set(article.group, list)
    })
    return Array.from(map.entries())
  }, [articles])

  const filtered = useMemo(() => {
    if (!keyword) return articles
    return articles.filter((article) => article.title.includes(keyword) || article.content.includes(keyword))
  }, [articles, keyword])

  const current = articles.find((article) => article.slug === slug) ?? filtered[0] ?? articles[0]

  // 进来没带 slug 时自动选中第一篇，让地址栏与内容一致（可分享）
  useEffect(() => {
    if (!slug && articles.length) navigate('/help/' + articles[0].slug, { replace: true })
  }, [slug, articles, navigate])

  if (query.isLoading) return <LoadingBlock rows={6} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  return (
    <div className="page">
      <PageHeader title="帮助" description="怎么用、概念解释、以及系统里那几条硬规则" />

      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card size="small" title="目录" style={{ marginBottom: 12 }}>
            <Input
              allowClear
              placeholder="搜索标题或正文"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              style={{ marginBottom: 12 }}
            />
            {filtered.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的内容" />
            ) : (
              groups.map(([group, items]) => {
                const visible = items.filter((item) => filtered.some((hit) => hit.id === item.id))
                if (!visible.length) return null
                return (
                  <div key={group} style={{ marginBottom: 14 }}>
                    <div className="meta-text" style={{ marginBottom: 6 }}>
                      {group}
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      {visible.map((article) => {
                        const active = current?.id === article.id
                        return (
                          <a
                            key={article.id}
                            onClick={() => navigate('/help/' + article.slug)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              background: active ? '#f0f7ff' : undefined,
                              fontWeight: active ? 600 : 400,
                              color: active ? '#1677ff' : 'var(--ink-2)',
                              fontSize: 13,
                            }}
                          >
                            {article.title}
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          {current ? (
            <Card size="small">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Tag>{current.group}</Tag>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {current.title}
                </Typography.Title>
              </div>
              <ArticleBody content={current.content} />
              <div className="meta-text" style={{ marginTop: 16 }}>
                最后更新：{formatDate(current.updated_at)}
              </div>
            </Card>
          ) : (
            <Empty description="帮助内容还没配置" />
          )}
        </Col>
      </Row>
    </div>
  )
}