/**
 * pages/report-quality/ReportQualityPage.tsx —— 研报质量评估（4 个质量维度）
 *
 * 【它和"核查"的区别（这一点必须讲清楚）】
 *   核查维度回答"这句话有没有错"（逐句），质量评估回答"这份报告整体写得怎么样"（整篇）。
 *   所以质量评估的结论不带"风险等级"，而是给出：覆盖率、问题数、未覆盖原因，
 *   以及一句说明"这一项弱在哪"。
 *
 * 【四个维度（后端注册表里的 group=quality）】
 *   quality_logic 逻辑质量 / quality_data 数据支撑 / quality_risk 风险披露 / quality_cross 观点交叉验证
 *   —— 每个维度下面都写清了"它看什么"，避免用户把四个概念混在一起。
 *
 * 【本文件导出】ReportQualityPage 组件（默认导出）
 */
import { Alert, Button, Card, Col, Progress, Row, Space, Table, Tag, Tooltip } from 'antd'
import { ArrowLeftOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { reportApi, type DimensionMetric } from '@/api'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ReportLineNav } from '@/features/report-nav/ReportLineNav'
import { ErrorState, LoadingBlock } from '@/shared/ui/DataStates'
import { QualityRadar } from '@/features/assessment-charts/AssessmentCharts'
import { formatPercent } from '@/shared/utils/format'
import { useGoBack } from '@/shared/hooks/useGoBack'

/** 四个质量维度的说明（前端补充的业务解释，帮助页里也有对应词条） */
const QUALITY_HINT: Record<string, { what: string; how: string }> = {
  quality_logic: {
    what: '论证链是否完整、结论有没有数据或来源支撑',
    how: '统计"无数据支撑的定性表述"占比，占比越高说明越像"讲故事"',
  },
  quality_data: {
    what: '文中的关键数字是否有出处、现金流与利润是否匹配',
    how: '用数据源核对关键财务数据；数据源不可用时如实标记为未覆盖',
  },
  quality_risk: {
    what: '风险提示是否覆盖需求、供给、成本等主要风险',
    how: '对照内部规范的风险披露清单逐项核对',
  },
  quality_cross: {
    what: '与同业观点是否明显偏离，是否存在没说明理由的"独家判断"',
    how: '与外部研报库交叉比对（需要先上传外部研报库，否则本维度为未覆盖）',
  },
}

export default function AssessmentDetailPage() {
  const { reportId = '' } = useParams()
  const navigate = useNavigate()

  const query = useQuery({
    queryKey: ['report', reportId, 'assessment', 'quality'],
    queryFn: () => reportApi.assessment(reportId),
    retry: false,
  })

  // 本页从项目界面（评估入口）与勘误结果都进得来，所以"返回"按历史回退；
  // 直接打开时退回这份报告的勘误结果页（同报告下一定存在）。
  // 注意：必须放在下面的提前 return 之前（hook 不能排在条件 return 后面）。
  const goBack = useGoBack('/errata/' + reportId + '/overview')

  if (query.isLoading) return <LoadingBlock rows={6} />
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  const assessment = query.data
  const qualityDims = assessment.metrics.by_dimension.filter((dim) => dim.code.startsWith('quality_'))
  const uncoveredDims = qualityDims.filter((dim) => dim.coverage === 0)

  return (
    <div className="page">
      <div style={{ marginBottom: 10 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
          返回上一步
        </Button>
      </div>
      <PageHeader
        title="研报评估"
        description="整篇质量：只给覆盖率与问题数，不带风险等级"
        extra={
          <Space>
            <Button type="primary" onClick={() => navigate('/reviews/' + reportId + '/review')}>
              去逐条复核
            </Button>
          </Space>
        }
      >
        <ReportLineNav reportId={reportId} />
      </PageHeader>

      <Row gutter={16}>
        {/* 四个维度卡片 */}
        <Col xs={24} lg={14}>
          <Row gutter={[12, 12]}>
            {qualityDims.map((dim) => {
              const hint = QUALITY_HINT[dim.code]
              const notCovered = dim.coverage === 0
              return (
                <Col xs={24} md={12} key={dim.code}>
                  <Card
                    size="small"
                    title={
                      <Space size={6}>
                        {dim.name}
                        <Tooltip
                          title={
                            hint ? (
                              <div style={{ maxWidth: 260 }}>
                                {hint.what}
                                <div style={{ marginTop: 4, opacity: 0.8 }}>{hint.how}</div>
                              </div>
                            ) : (
                              ''
                            )
                          }
                        >
                          <InfoCircleOutlined className="meta-text" />
                        </Tooltip>
                      </Space>
                    }
                    style={{ borderColor: notCovered ? '#ffe58f' : undefined }}
                  >
                    {notCovered ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 10, fontSize: 12.5 }}
                        message="本次未覆盖"
                        description={dim.uncovered_reason || '缺少必要资料，未做核对'}
                      />
                    ) : null}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div>
                        <div className="meta-text">查出问题</div>
                        <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
                          {dim.problems}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="meta-text">覆盖率</div>
                        <div className="num" style={{ fontSize: 22 }}>
                          {formatPercent(dim.coverage)}
                        </div>
                      </div>
                    </div>

                    <Progress
                      percent={Math.round(dim.coverage * 100)}
                      size="small"
                      status={notCovered ? 'exception' : dim.coverage >= 0.99 ? 'success' : 'normal'}
                    />

                  </Card>
                </Col>
              )
            })}
          </Row>

          {uncoveredDims.length ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message={'有 ' + uncoveredDims.length + ' 个质量维度未覆盖'}
              description={
                <div>
                  {uncoveredDims.map((dim) => (
                    <div key={dim.code}>
                      · <b>{dim.name}</b>：{dim.uncovered_reason}
                    </div>
                  ))}
                  <div className="meta-text" style={{ marginTop: 4 }}>
                    补齐资料后重新核查即可覆盖这些维度。
                  </div>
                </div>
              }
              action={
                <Button size="small" onClick={() => navigate(-1)}>
                  返回上一页
                </Button>
              }
            />
          ) : null}
        </Col>

        {/* 雷达图 + 明细表 */}
        <Col xs={24} lg={10}>
          <Card size="small" title="四个质量维度的覆盖情况" style={{ marginBottom: 12 }}>
            <QualityRadar metrics={assessment.metrics} />
          </Card>

          <Card size="small" title="指标明细" styles={{ body: { padding: 0 } }}>
            <Table<DimensionMetric>
              size="small"
              rowKey="code"
              pagination={false}
              dataSource={qualityDims}
              columns={[
                { title: '维度', dataIndex: 'name' },
                { title: '问题', dataIndex: 'problems', align: 'right', className: 'num', width: 70 },
                { title: '检查', dataIndex: 'checked', align: 'right', className: 'num', width: 70 },
                {
                  title: '覆盖率',
                  dataIndex: 'coverage',
                  width: 90,
                  render: (value: number) => <span className="num">{formatPercent(value)}</span>,
                },
              ]}
            />
            <div style={{ padding: 12 }}>
              <div className="meta-text" style={{ lineHeight: 1.8 }}>
                <div>
                  无数据支撑的定性表述占比：{formatPercent(assessment.metrics.qualitative_without_data_rate)}
                </div>
                <div>
                  风险披露是否覆盖主要风险：
                  {assessment.metrics.risk_disclosure_covered ? (
                    <Tag color="success">已覆盖</Tag>
                  ) : (
                    <Tag color="warning">不完整</Tag>
                  )}
                </div>
                <div>
                  观点交叉验证：一致 {assessment.metrics.cross_view_consistent ?? 0} 条 / 冲突{' '}
                  {assessment.metrics.cross_view_conflicts ?? 0} 条
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
