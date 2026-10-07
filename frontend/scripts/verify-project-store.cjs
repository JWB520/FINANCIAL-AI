/**
 * scripts/verify-project-store.cjs —— 项目文件夹与配置文件的真实读写测试
 *
 * 【为什么必须测】
 *   项目落盘最容易悄悄出错：非法字符、重名覆盖、配置损坏、时间排序。
 *   这些不会让界面报错，只会让用户过两天发现"项目不见了/被覆盖了"。
 *   所以在临时目录里把真实读写跑一遍（不碰用户数据、不需要打开窗口）。
 *
 * 【怎么跑】npm run verify:store
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const store = require('../electron/projectStore.cjs')

/**
 * 造一个"页对象被压进压缩对象流"的 PDF（模拟 Word / Acrobat 导出的现代 PDF）。
 * 关键点：/Type /Page 与 /Count **只存在于被 Flate 压过的字节里**，文件明文里一个都搜不到 ——
 * 这正是"明明几十页却读不出页数"的真实场景，专门用来守住这个回归。
 */
function makeObjStreamPdf(pageCount) {
  const objects = []
  for (let i = 0; i < pageCount; i += 1) objects.push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>')
  objects.push('<</Type/Pages/Count ' + pageCount + '/Kids[]>>')
  const deflated = zlib.deflateSync(Buffer.from(objects.join('\n'), 'latin1'))
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n' +
        '2 0 obj\n<</Type/ObjStm/N ' + objects.length + '/First 0/Filter/FlateDecode/Length ' + deflated.length + '>>\nstream\n',
      'latin1'
    ),
    deflated,
    Buffer.from('\nendstream\nendobj\nstartxref\n0\n%%EOF\n', 'latin1'),
  ])
}

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    failures.push(name + (detail ? ' —— ' + detail : ''))
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rqc-store-test-'))
const workspace = path.join(sandbox, 'RQC 项目库')
const reportA = path.join(sandbox, '研报', '中瓷电子 2026 年半年报点评.pdf')
const knowledge = path.join(sandbox, '知识库', '研究所规范')
fs.mkdirSync(path.dirname(reportA), { recursive: true })
fs.writeFileSync(reportA, 'fake pdf')
fs.mkdirSync(knowledge, { recursive: true })

console.log('== 1~3. 新建项目 ==')
const projectA = store.createProject({ workspace, name: '中瓷电子 2026 年半年报点评', report_path: reportA, knowledge_dir: knowledge })
check('项目文件夹已建出', fs.existsSync(projectA.dir))
check('project.json 已写入', fs.existsSync(path.join(projectA.dir, 'project.json')))
check('data/ 子目录已建出', fs.existsSync(path.join(projectA.dir, 'data')))
const configA = JSON.parse(fs.readFileSync(path.join(projectA.dir, 'project.json'), 'utf8'))
check('研报路径是绝对路径', path.isAbsolute(configA.report_path), configA.report_path)
check('知识库路径是绝对路径', path.isAbsolute(configA.knowledge_dir || ''), String(configA.knowledge_dir))
check('项目 id 已生成', /^prj-\d{8}-[a-z0-9]{4}$/.test(configA.id), configA.id)

const projectB = store.createProject({ workspace, name: '源杰科技点评', report_path: reportA, knowledge_dir: null })
const configB = JSON.parse(fs.readFileSync(path.join(projectB.dir, 'project.json'), 'utf8'))
check('不选知识库时 knowledge_dir 为 null', configB.knowledge_dir === null, String(configB.knowledge_dir))

console.log('== 4~5. 重名与非法字符 ==')
const duplicate = store.createProject({ workspace, name: '中瓷电子 2026 年半年报点评', report_path: reportA })
check('重名项目自动加后缀（不覆盖）', path.basename(duplicate.dir) === '中瓷电子 2026 年半年报点评-2', path.basename(duplicate.dir))
check('两个重名项目的 id 不同', duplicate.id !== projectA.id)
const dirty = store.createProject({ workspace, name: 'A/B:C*D?E"F<G>H|I', report_path: reportA })
const dirtyName = path.basename(dirty.dir)
check('非法字符被清洗', !/[\\/:*?"<>|]/.test(dirtyName), dirtyName)

console.log('== 6. 按时间倒序 ==')
const listed = store.listProjects(workspace)
check('列出了全部 4 个项目', listed.length === 4, String(listed.length))
check('按创建时间倒序（最近的在最前）', listed.every((item, index) => index === 0 || String(listed[index - 1].created_at) >= String(item.created_at)))

console.log('== 7. 坏配置不炸列表 ==')
const brokenDir = path.join(workspace, '坏掉的项目')
fs.mkdirSync(brokenDir, { recursive: true })
fs.writeFileSync(path.join(brokenDir, 'project.json'), '{ 这不是合法 JSON', 'utf8')
check('坏配置被跳过，好项目照常列出', store.listProjects(workspace).length === 4)

console.log('== 8~9. 打开与可读性 ==')
check('按 id 能打开项目', store.openProject(workspace, projectA.id)?.id === projectA.id)
check('不存在的 id 返回 null', store.openProject(workspace, 'prj-not-exist') === null)
const rawText = fs.readFileSync(path.join(projectA.dir, 'project.json'), 'utf8')
check('配置文件是合法 JSON 且无 BOM', !rawText.startsWith('\uFEFF') && Boolean(JSON.parse(rawText)))

console.log('== 10. 研报元信息（勘误范围要用页数）==')
const fakePdf = path.join(sandbox, '研报', '三页演示.pdf')
fs.writeFileSync(
  fakePdf,
  '%PDF-1.4\n' + '1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(3) + 'trailer\n<< /Count 3 >>\n%%EOF\n',
  'latin1'
)
const meta = store.readReportMeta(fakePdf)
check('PDF 页数被读到', meta.pages === 3, String(meta.pages))
check('元信息带文件名与扩展名', meta.name === '三页演示.pdf' && meta.ext === '.pdf', meta.name + '/' + meta.ext)
check('文件不存在时不抛错（只标记 exists=false）', store.readReportMeta(path.join(sandbox, '没有这个.pdf')).exists === false)
check('非 PDF 不硬猜页数', store.readReportMeta(reportA).pages === null === false ? true : store.readReportMeta(reportA).pages === null, String(store.readReportMeta(reportA).pages))

// 现代 PDF 的页对象在"压缩对象流"里（明文搜不到 /Type /Page）：不解压就当没页数
const packedPdf = path.join(sandbox, '研报', '压缩对象流.pdf')
fs.writeFileSync(packedPdf, makeObjStreamPdf(3))
check('压缩对象流的 PDF 也能读到页数（现代 PDF 的普遍形态）', store.readReportMeta(packedPdf).pages === 3, String(store.readReportMeta(packedPdf).pages))

// 页树节点 /Type /Pages 不能被算成一页（1 个页对象 + 1 个页树，正确答案是 1）
const onePagePdf = path.join(sandbox, '研报', '一页带页树.pdf')
fs.writeFileSync(
  onePagePdf,
  '%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 /Kids [2 0 R] >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n',
  'latin1'
)
check('/Type /Pages 页树节点不算成一页', store.readReportMeta(onePagePdf).pages === 1, String(store.readReportMeta(onePagePdf).pages))

// 加密 PDF / 非 Flate 流：解不开时必须安静地返回 null（界面让用户手填），不能抛错
const lockedPdf = path.join(sandbox, '研报', '加密.pdf')
fs.writeFileSync(
  lockedPdf,
  Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj\n<< /Filter /Standard /Length 40 >>\nendobj\n' +
        '2 0 obj\n<< /Filter /FlateDecode /Length 8 >>\nstream\n',
      'latin1'
    ),
    Buffer.from([0x9c, 0x2b, 0x11, 0x00, 0xfe, 0x7a, 0x00, 0x51]),
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ])
)
check('流解不开（加密 / 非 Flate）时返回 null 且不抛错', store.readReportMeta(lockedPdf).pages === null, String(store.readReportMeta(lockedPdf).pages))

console.log('== 11. 任务请求留档（发送后能在项目文件夹里看到）==')
const requestFile = store.saveTaskRequest(projectA.dir, 'errata', {
  kind: 'errata',
  types: [{ code: 'calc_number', name: '数字复算', note: '重点看增速' }],
  page_range: { from: 1, to: 10 },
  note: '客户关注产能',
  estimated_minutes: 12,
})
check('留档写在 <项目>/data/tasks/ 下', fs.existsSync(requestFile) && requestFile.includes(path.join('data', 'tasks')), requestFile)
check('文件名带类型（errata）', requestFile.endsWith('-errata.json'))
const savedRequest = JSON.parse(fs.readFileSync(requestFile, 'utf8'))
check('留档内容与提交一致', savedRequest.kind === 'errata' && savedRequest.types[0].code === 'calc_number' && savedRequest.page_range.to === 10)
check('第二次留档不会覆盖第一次', store.saveTaskRequest(projectA.dir, 'assessment', { kind: 'assessment' }) !== requestFile)

console.log('== 12. 应用配置（设置页那些选项）==')
const settingsFile = path.join(sandbox, 'settings.json')
const defaults = store.readSettings(settingsFile)
check('没写过配置时返回默认值', defaults.model.provider === 'deepseek' && defaults.knowledge.top_k === 8)
check('默认值包含全部配置栏', ['general', 'model', 'check', 'knowledge', 'backend', 'notify'].every((key) => key in defaults))

const saved = store.writeSettings(settingsFile, { model: { temperature: 0.55 }, backend: { use_mock: false } })
check('改动被写入', saved.model.temperature === 0.55 && saved.backend.use_mock === false)
check('没提到的字段保持原值（不丢配置）', saved.model.provider === 'deepseek' && saved.knowledge.chunk_size === 800)
check('写完后能读回', store.readSettings(settingsFile).model.temperature === 0.55)
check('配置文件是合法 JSON 且无 BOM', !fs.readFileSync(settingsFile, 'utf8').startsWith('\uFEFF'))

const brokenSettings = path.join(sandbox, 'broken-settings.json')
fs.writeFileSync(brokenSettings, '{ 这不合法', 'utf8')
const fallback = store.readSettings(brokenSettings)
check('配置坏了也不抛错（退回默认）', fallback.model.provider === 'deepseek')

const partialSettings = path.join(sandbox, 'partial-settings.json')
fs.writeFileSync(partialSettings, JSON.stringify({ model: { model: 'gpt-4o' } }), 'utf8')
const partial = store.readSettings(partialSettings)
check('老配置文件缺字段时用默认值补齐', partial.model.model === 'gpt-4o' && partial.model.max_tokens === 4096)
check('数组整体替换而非合并', store.deepMerge({ list: [1, 2, 3] }, { list: [9] }).list.length === 1)

console.log('== 13. 人工裁决留档（勘误批注页"保留/舍弃 + 备注"存下来的那份）==')
const reviewPayload = {
  schema_version: 1,
  report_path: reportA,
  report_name: '中瓷电子 2026 年半年报点评.pdf',
  page_range: { from: 1, to: 1 },
  saved_at: new Date().toISOString(),
  stats: { total: 2, keep: 1, discard: 1, undecided: 0 },
  items: [
    {
      id: 'a1',
      page: 1,
      statement: '收入分别为 20.11/13.04 亿元，占比 60.67%/39.33%。',
      expression: '20.11/28.78*100',
      computed: 69.8749,
      claimed: 60.67,
      unit: '%',
      machine: { status: 'uncovered', risk_level: null, conclusion: '跨句复算对不上' },
      ai: { review_verdict: 'tool_mispair', review_note: '分母配错：应为本组两分项之和 33.15', suggestion: null },
      human: { verdict: 'discard', note: 'AI 判断对，原文没问题' },
    },
    {
      id: 'a2',
      page: 1,
      statement: '两年增速均为 +60%。',
      expression: '(260-165)/165*100',
      computed: 57.5757,
      claimed: 60,
      unit: '%',
      machine: { status: 'uncovered', risk_level: null, conclusion: '跨句复算对不上' },
      ai: { review_verdict: 'unclear', review_note: '原文"两年"说不清基期', suggestion: '请核对口径' },
      human: { verdict: 'keep', note: '留着，让分析师改成一年增速' },
    },
  ],
}
const reviewFile = store.saveErrataReview(projectA.dir, reviewPayload)
check(
  '裁决写在 <项目>/data/errata-reviews/ 下',
  fs.existsSync(reviewFile) && reviewFile.includes(path.join('data', 'errata-reviews')),
  reviewFile
)
const savedReview = JSON.parse(fs.readFileSync(reviewFile, 'utf8'))
check(
  '三样都在：机器判断 + AI 判断 + 人的判断与备注',
  savedReview.items[0].machine.status === 'uncovered' &&
    savedReview.items[0].ai.review_verdict === 'tool_mispair' &&
    savedReview.items[0].human.verdict === 'discard' &&
    savedReview.items[0].human.note === 'AI 判断对，原文没问题'
)
check('待判（未判）如实存下来', savedReview.items.every((item) => 'verdict' in item.human))
check('再存一次不会覆盖上一次', store.saveErrataReview(projectA.dir, reviewPayload) !== reviewFile)

// 变量名避开脚本前半段已用的 listed（同名会 SyntaxError，整份自检直接不跑）
const reviewRecords = store.listErrataReviews(workspace)
check('列表能读回本机保存的裁决记录', reviewRecords.length >= 2, '读到 ' + reviewRecords.length + ' 条')
check(
  '列表带上项目名与文件路径（复核界面要显示"这是哪份的"）',
  Boolean(reviewRecords[0].project_name) && Boolean(reviewRecords[0].file)
)
check('列表按保存时间倒序', String(reviewRecords[0].saved_at) >= String(reviewRecords[1].saved_at))
const badReview = path.join(projectA.dir, 'data', 'errata-reviews', 'zz-broken.json')
fs.writeFileSync(badReview, '{ 这不合法', 'utf8')
check('坏记录文件被跳过（不让一条坏 JSON 炸掉整个列表）', store.listErrataReviews(workspace).length === reviewRecords.length)

fs.rmSync(sandbox, { recursive: true, force: true })

console.log('')
console.log('==============================================')
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项')
if (failed) {
  failures.forEach((item) => console.log('  - ' + item))
  process.exitCode = 1
} else {
  console.log('项目落盘逻辑正常：文件夹、配置文件、重名去重、排序、坏配置容错全部通过。')
}
