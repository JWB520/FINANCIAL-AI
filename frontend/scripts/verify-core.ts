/**
 * scripts/verify-core.ts —— 核心纯逻辑自检（不需要浏览器、不需要后端）
 *
 * 【为什么要有这个脚本】
 *   系统里最致命的缺陷不是"页面丑"，而是两类静默错误：
 *     1. **高亮错位**：原文切片与真实位置对不上 → 用户会直接不信任所有结论；
 *     2. **数字对不上**：风险分布、覆盖率、复核进度互相矛盾 → 演示时被一问就穿帮。
 *   这两类问题都藏在纯函数与数据里，所以用这个脚本在命令行直接验，几秒钟就有结论。
 *
 * 【怎么跑】
 *   cd frontend
 *   .\node_modules\.bin\esbuild.cmd scripts/verify-core.ts --bundle --platform=node --format=esm ^
 *     --outfile=scripts/verify-core.mjs --alias:@=./src
 *   node scripts/verify-core.mjs
 *   （Windows 下用 esbuild 直接跑 TS，无需额外安装测试框架）
 *
 * 【它检查什么（共 8 项）】
 *   1. 原文无损：按区间切分再拼回来，必须与原文一字不差
 *   2. 结论区间正确：每条主张的原始文本，必须等于它在原文里截出来的那一段（高亮不错位的直接证据）
 *   3. 区间重叠：同一句话被多条结论覆盖时，主色取最严重的，且所有 id 都保留
 *   4. 计数自洽：高+中+低+通过+未覆盖+失败 == 主张总数
 *   5. 覆盖率 = 有结论条数 / 总数
 *   6. 色带百分比合法（0~100，且不越界）
 *   7. 每条主张至少有一条结论
 *   8. 三态结论：已裁决过的条目状态不是"待复核"，未裁决的必须是"待复核"
 */
import { buildSegments, pickPrimaryRisk } from '@/shared/utils/segment'
import { buildRibbonBlocks } from '@/shared/utils/ribbon'
import {
  MOCK_ASSESSMENT,
  MOCK_BLOCKS,
  MOCK_CLAIMS,
  MOCK_FINDINGS,
  MOCK_REVIEW_ACTIONS,
  buildClaimSpans,
  buildConclusion,
} from '@/api/mock/mockData'
import { MOCK_REPORTS } from '@/api/mock/mockDataMore'
import { buildAssessmentRows } from '@/api/mock/mockAssessments'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    failures.push(name + (detail ? ' —— ' + detail : ''))
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

console.log('== 1. 原文无损（切分后拼回来必须与原文一致）==')
{
  const spans = buildClaimSpans()
  let ok = true
  let badBlock = ''
  for (const block of MOCK_BLOCKS) {
    const blockSpans = spans.filter((span) => span.block_id === block.id)
    const joined = buildSegments(block.text, blockSpans)
      .map((segment) => segment.text)
      .join('')
    if (joined !== block.text) {
      ok = false
      badBlock = block.id
      break
    }
  }
  check('全部 ' + MOCK_BLOCKS.length + ' 个原文块切分无损', ok, ok ? '' : '异常块：' + badBlock)
}

console.log('== 2. 结论区间正确（高亮不错位的直接证据）==')
{
  let ok = true
  let badClaim = ''
  for (const claim of MOCK_CLAIMS) {
    const block = MOCK_BLOCKS.find((b) => b.id === claim.block_id)
    if (!block) {
      ok = false
      badClaim = claim.id + '（找不到所属原文块）'
      break
    }
    const sliced = block.text.slice(claim.start_offset, claim.end_offset)
    if (sliced !== claim.text) {
      ok = false
      badClaim = claim.id + '（截出来是「' + sliced + '」）'
      break
    }
  }
  check('全部 ' + MOCK_CLAIMS.length + ' 条主张的偏移与原文一致', ok, ok ? '' : '异常：' + badClaim)
}

console.log('== 3. 区间重叠的处理 ==')
{
  const text = '共计营收 12.3 亿元，同比增长 25%。'
  const spans = [
    { id: 'a', block_id: 'b', start_offset: 6, end_offset: 12, risk_level: 'low' as const, status: 'risk' as const },
    { id: 'b', block_id: 'b', start_offset: 9, end_offset: 18, risk_level: 'high' as const, status: 'risk' as const },
  ]
  const segments = buildSegments(text, spans)
  const overlapped = segments.find((segment) => segment.claimIds.length > 1)
  check('重叠片段同时保留两条结论 id', Boolean(overlapped))
  check('重叠片段主色取最严重的（high）', overlapped?.risk === 'high', String(overlapped?.risk))
  check('重叠片段仍无损（拼回来等于原文）', segments.map((s) => s.text).join('') === text)
  check('取最严重风险的辅助函数正确', pickPrimaryRisk([{ risk_level: 'low' }, { risk_level: 'high' }]) === 'high')
}

console.log('== 4. 计数自洽（演示数据不能自相矛盾）==')
{
  const metrics = MOCK_ASSESSMENT.metrics
  const riskSum = metrics.risk_counts.high + metrics.risk_counts.medium + metrics.risk_counts.low
  const total = riskSum + metrics.risk_counts.pass + metrics.uncovered + metrics.error_count
  check('风险 + 通过 + 未覆盖 + 失败 == 主张总数', total === metrics.claims_total, total + ' vs ' + metrics.claims_total)
  check('主张总数 == 演示数据里的主张条数', metrics.claims_total === MOCK_CLAIMS.length, metrics.claims_total + ' vs ' + MOCK_CLAIMS.length)
}

console.log('== 5. 覆盖率口径 ==')
{
  const metrics = MOCK_ASSESSMENT.metrics
  const rate = metrics.covered / metrics.claims_total
  check('覆盖率 = 有结论条数 / 总数', Math.abs(rate - metrics.coverage_rate) < 0.001, rate.toFixed(4) + ' vs ' + metrics.coverage_rate)
  check('已覆盖条数 = 通过 + 有问题', metrics.covered === metrics.risk_counts.pass + metrics.risk_counts.high + metrics.risk_counts.medium + metrics.risk_counts.low)
}

console.log('== 6. 色带位置合法 ==')
{
  const spans = buildClaimSpans()
  const totalChars = MOCK_BLOCKS.reduce((sum, block) => sum + block.text.length + 1, 0)
  const absolute = spans.map((span) => {
    const base = MOCK_BLOCKS.find((block) => block.id === span.block_id)?.start_offset ?? 0
    return { ...span, start_offset: base + span.start_offset, end_offset: base + span.end_offset }
  })
  const blocks = buildRibbonBlocks(absolute, totalChars)
  const allValid = blocks.every((block) => block.top >= 0 && block.top <= 100 && block.height > 0 && block.top + block.height <= 100.01)
  check('每个色块都在 0~100% 范围内且不越界', allValid)
  check('色块数量 == 有结论的主张数', blocks.length === spans.filter((span) => span.end_offset > span.start_offset).length)
}

console.log('== 7. 每条主张都有结论 ==')
{
  const withoutFinding = MOCK_CLAIMS.filter((claim) => !MOCK_FINDINGS.some((finding) => finding.claim_id === claim.id))
  check('没有"孤儿主张"', withoutFinding.length === 0, withoutFinding.map((c) => c.id).join(','))
}

console.log('== 8. 三态结论与复核进度 ==')
{
  const reviewed = MOCK_REVIEW_ACTIONS.map((action) => action.claim_id)
  const conclusionChecked = reviewed.every((claimId) => buildConclusion(claimId).state !== 'pending')
  const pendingChecked = MOCK_CLAIMS.filter((claim) => !reviewed.includes(claim.id)).every(
    (claim) => buildConclusion(claim.id).state === 'pending' && buildConclusion(claim.id).effective_conclusion === '待复核'
  )
  check('已裁决条目的状态不是"待复核"', conclusionChecked)
  check('未裁决条目的生效结论是"待复核"（不是"通过"）', pendingChecked)
  check('复核进度 = 已复核条数（与报告列表一致）', reviewed.length === 4, '实际 ' + reviewed.length)
}

console.log('== 9. 研报评估（整篇质量这一层）==')
{
  const assessmentRows = buildAssessmentRows()
  check('评估列表一份报告一行', assessmentRows.length === MOCK_REPORTS.length)
  check(
    '未评估的报告参考分为 null（不是 0 分）',
    assessmentRows.filter((row) => row.status === 'not_started').every((row) => row.reference_score === null)
  )
  check(
    '已评估的报告一定有参考分',
    assessmentRows.filter((row) => row.status === 'completed').every((row) => row.reference_score !== null)
  )
  check(
    '覆盖率低的评估一定列出了未覆盖维度（否则用户会以为都查过了）',
    assessmentRows
      .filter((row) => row.status === 'completed' && row.quality_coverage < 1)
      .every((row) => row.uncovered_dimensions.length > 0)
  )
}

console.log('')
console.log('==============================================')
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项')
if (failed) {
  console.log('失败清单：')
  failures.forEach((item) => console.log('  - ' + item))
  process.exitCode = 1
} else {
  console.log('全部通过：高亮不会错位、演示数据自洽。')
}
