/**
 * pages/report-overview/ReportOverviewPage.tsx —— 结果总览
 *
 * 【这一页要在一屏里讲清四件事】
 *   1. 结论是什么：总体风险 + 一句话摘要（**由后端生成，前端绝不自己拼这句话**）；
 *   2. 问题有多少、分布在哪：风险分布条 + 维度表现表；
 *   3. 先看哪几条：复核优先级建议（点一下直接进复核裁决页对应位置）；
 *   4. 有哪些"没查到"：未覆盖与失败单独一块，写明原因。
 *
 * 【一条硬规矩】页面上所有可点击的数字，跳过去时都**已经带着筛选条件**
 *   （例如点"高风险 3"→ 复核裁决页已经筛好 risk=high），不做"跳过去再自己筛"的二次筛选。
 *
 * 【本文件导出】ReportOverviewPage 组件（默认导出）
 */
import { useState } from 'react'
import { App as AntdApp, Button, Card, Col, Row, Space, Tag, Tooltip } from 'antd'
import { ArrowLeftOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { isUsingMock, reportApi, OVERALL_RISK_LABEL, RISK_LEVEL_HEX } from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ReportLineNav } from '@/features/report-nav/ReportLineNav'
import { useGoBack } from '@/shared/hooks/useGoBack'
import { downloadText } from '@/shared/utils/download'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { RiskLegend } from '@/features/risk-badge/RiskBadge'
import { DimensionTable, PriorityList, RiskDistributionBar } from '@/features/assessment-charts/AssessmentCharts'
import { formatDateTime } from '@/shared/utils/format'

export default function ErrataOverviewPage() {
  const { reportId = '' } = useParams()
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [exporting, setExporting] = useState(false)

  const reportQuery = useQuery({ queryKey: ['report', reportId], queryFn: () => reportApi.detail(reportId) })
  const assessmentQuery = useQuery({
    queryKey: ['report', reportId, 'assessment'],
    queryFn: () => reportApi.assessment(reportId),
    retry: false,
  })

  // 本页有三个入口（项目界面 / 复核裁决 / 进度页），所以"返回"按历史回退，
  // 不能写死成"返回复核裁决页"；直接打开时退回它所属的项目界面，拿不到项目 id 就回工作台。
  // 注意：必须放在下面的提前 return 之前（React 要求 hook 在所有分支之前调用）。
  const goBack = useGoBack(reportQuery.data?.project_id ? '/projects/' + reportQuery.data.project_id : '/')

  if (reportQuery.isLoading) return <LoadingBlock rows={6} />
  if (reportQuery.isError) return <ErrorState error={reportQuery.error} onRetry={() => reportQuery.refetch()} />

  const report = reportQuery.data
  const assessment = assessmentQuery.data
  const metrics = assessment?.metrics

  /** 跳到复核裁决页并带上筛选条件（数字可点开明细的关键实现） */
  const openReview = (filter: { risk?: string; status?: string; dimension?: string; claim?: string }) => {
    const params = new URLSearchParams()
    if (filter.risk) params.set('risk', filter.risk)
    if (filter.status) params.set('status', filter.status)
    if (filter.dimension) params.set('dimension', filter.dimension)
    if (filter.claim) params.set('claim', filter.claim)
    navigate('/reviews/' + reportId + '/review?' + params.toString())
  }

  /**
   * 导出。
   * 【两条路的区别】真后端：window.open 打开后端生成的文件（大文件不进内存）；
   * 演示模式（假后端根本没有文件字节）：改为下载一份文本摘要。
   *   以前两种模式都走 window.open，演示时打开的地址不存在（还会被通配路由接住），点一下毫无反应。
   */
  const handleExport = async () => {
    setExporting(true)
    try {
      if (isUsingMock()) {
        const preview = await reportApi.previewText(reportId)
        downloadText(preview.filename, preview.text)
        message.success('演示模式：已下载文本摘要（接入后端后导出 docx）')
      } else {
        window.open(reportApi.exportUrl(reportId, 'docx'), '_blank')
        message.success('已开始下载；若浏览器拦截弹出窗口，请允许本站弹出后重试')
      }
    } catch (error) {
      message.error((error as Error).message || '导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page">
      {/* 返回行：与"发起任务单""项目界面"同一写法（按钮在 PageHeader 上方，细虚线下面才是标题） */}
      <div style={{ marginBottom: 10 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
          返回上一步
        </Button>
      </div>
      <PageHeader
        title="勘误结果"
        description={report?.title}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => assessmentQuery.refetch()}>
              刷新
            </Button>
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>
              {isUsingMock() ? '导出摘要（演示）' : '导出评估报告'}
            </Button>
            <Button
              type="primary"
              icon={<EyeOutlined />}
              onClick={() => navigate('/reviews/' + reportId + '/review')}
            >
              开始逐条复核
            </Button>
          </Space>
        }
      >
        <ReportLineNav reportId={reportId} />
      </PageHeader>

      {assessmentQuery.isLoading ? (
        <LoadingBlock rows={6} />
      ) : assessmentQuery.isError || !assessment ? (
        <ErrorState
          error={assessmentQuery.error}
          onRetry={() => assessmentQuery.refetch()}
        />
      ) : (
        <>
          {/* ---------- 结论卡 ---------- */}
          <Card
            size="small"
            style={{ marginBottom: 12, borderLeft: '4px solid ' + (assessment.overall_risk === 'pass' ? '#389e0d' : RISK_LEVEL_HEX[assessment.overall_risk]) }}
          >
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>
                    总体风险：{OVERALL_RISK_LABEL[assessment.overall_risk]}
                  </span>
                  <Tag>规则版本 {assessment.rule_version}</Tag>
                  <span className="meta-text">评估时间 {formatDateTime(assessment.created_at)}</span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>{assessment.summary}</div>
              </Col>
              {assessment.reference_score ? (
                <Col>
                  <Tooltip title="用于排序的加权分，不代表研报质量结论">
                    <div style={{ textAlign: 'center', padding: '0 16px' }}>
                      <div className="meta-text">参考分</div>
                      <div className="num" style={{ fontSize: 26, fontWeight: 600 }}>
                        {assessment.reference_score}
                      </div>
                      <div className="meta-text" style={{ fontSize: 11 }}>
                        仅用于排序
                      </div>
                    </div>
                  </Tooltip>
                </Col>
              ) : null}
            </Row>
          </Card>

          <Row gutter={16}>
            {/* ---------- 风险分布 ---------- */}
            <Col xs={24} lg={14}>
              <Card
                size="small"
                title="风险分布"
                style={{ marginBottom: 12 }}
              >
                {metrics ? <RiskDistributionBar metrics={metrics} onFilter={(f) => openReview(f)} /> : null}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f5f5f5' }}>
                  {/* 图例收进 ⓘ：它是"想查时看"的东西，不该常驻占一行（与复核裁决页同一写法） */}
                  <Tooltip title={<RiskLegend />} placement="bottomLeft">
                    <span className="meta-text" style={{ cursor: "help" }}>ⓘ 风险等级图例</span>
                  </Tooltip>
                </div>
              </Card>
            </Col>

            {/* ---------- 关键问题摘要 ---------- */}
            <Col xs={24} lg={10}>
              <Card size="small" title="最严重的问题" style={{ marginBottom: 12 }}>
                {assessment.key_issues.length ? (
                  assessment.key_issues.map((issue) => (
                    <div key={issue.claim_id} style={{ padding: '8px 0', borderBottom: '1px dashed #f0f0f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <WarningOutlined style={{ color: '#cf1322' }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{issue.title}</span>
                        <a style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => openReview({ claim: issue.claim_id })}>
                          定位
                        </a>
                      </div>
                      <div className="meta-text" style={{ lineHeight: 1.7, marginTop: 2 }}>
                        {issue.detail}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="meta-text">没有需要特别提示的问题</div>
                )}
              </Card>
            </Col>

            {/* ---------- 复核优先级 ---------- */}
            <Col xs={24} lg={12}>
              <div style={{ marginBottom: 12 }}>
                <PriorityList
                  items={assessment.priority_claims}
                  onOpen={(claimId) => openReview({ claim: claimId })}
                />
              </div>
            </Col>

            {/* ---------- 维度表现 ---------- */}
            <Col xs={24} lg={12}>
              <Card size="small" title="各维度表现" styles={{ body: { padding: 0 } }}>
                {metrics ? <DimensionTable metrics={metrics} onFilter={(code) => openReview({ dimension: code })} /> : null}
              </Card>
            </Col>

            {/* ---------- 未覆盖与失败单独一块 ---------- */}
            <Col span={24} style={{ marginTop: 12 }}>
              <Card size="small" title="未覆盖与失败">
                {metrics && (metrics.uncovered > 0 || metrics.error_count > 0) ? (
                  <>
                    <Space size={16} style={{ marginBottom: 10 }}>
                      <span>
                        未覆盖：
                        <a className="clickable-count num" onClick={() => openReview({ status: 'uncovered' })}>
                          {metrics.uncovered}
                        </a>{' '}
                        条
                      </span>
                      <span>
                        核查失败：
                        <a className="clickable-count num" onClick={() => openReview({ status: 'error' })}>
                          {metrics.error_count}
                        </a>{' '}
                        条
                      </span>
                    </Space>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {metrics.by_dimension
                        .filter((d) => d.uncovered_reason)
                        .map((d) => (
                          <div key={d.code} style={{ fontSize: 13 }}>
                            <Tag color="warning">{d.name}</Tag>
                            <span style={{ color: '#d46b08' }}>{d.uncovered_reason}</span>
                          </div>
                        ))}
                    </div>
                  </>
                ) : (
                  <div className="meta-text">本次全部分类都有结论，没有未覆盖或失败的条目。</div>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  )
}
