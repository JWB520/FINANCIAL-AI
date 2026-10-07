/**
 * scripts/verify-mock-learning.ts —— 经验学习"删除"逻辑的真实验证
 *
 * 【为什么单独测这个】
 *   删除规则不像"加一条数据"那样看一眼就知道对不对：
 *     · 已审核候选不带理由必须被拦住（400）；
 *     · 删"生效中"的版本必须自动把上一个历史版本切回生效，否则系统就没有判据了。
 *   这两条错了界面不会报错，只会悄悄出问题 —— 所以直接打假后端把它们跑一遍。
 *
 * 【跑法】npm run verify:mock
 */
import { handleMockRequest } from '@/api/mock/mockHandlers'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    failures.push(name + (detail ? ' —— ' + detail : ''))
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return handleMockRequest<T>(method, path, { body } as never)
}

/** 期望报错：返回错误对象（拿不到就是"没报错"，也算失败） */
async function callExpectError(method: string, path: string, body?: unknown): Promise<{ code?: string; httpStatus?: number; message?: string }> {
  try {
    await call(method, path, body)
    return {}
  } catch (error) {
    return error as { code?: string; httpStatus?: number; message?: string }
  }
}

interface Paged<T> {
  items: T[]
  total: number
}

async function main() {
  console.log('== 1. 准备：看清演示数据里有什么 ==')
  const candidates = await call<Paged<{ id: string; state: string; content: string }>>('GET', '/learning/candidates')
  const versions = await call<Paged<{ id: string; key: string; version: number; state: string }>>('GET', '/learning/versions')
  const cases = await call<Paged<{ id: string }>>('GET', '/learning/cases')

  const pending = candidates.items.find((c) => c.state === 'pending')
  const reviewed = candidates.items.find((c) => c.state !== 'pending')
  // 挑一个「有同规则历史版本」的生效版本：演示数据里有的规则只有一版，不能随便抓第一个
  const active = versions.items.find(
    (v) => v.state === 'active' && versions.items.some((other) => other.state === 'archived' && other.key === v.key)
  )
  const archivedSameKey = active ? versions.items.find((v) => v.state === 'archived' && v.key === active.key) : undefined

  check('演示数据里有待审核候选', Boolean(pending))
  check('演示数据里有已审核候选', Boolean(reviewed))
  check('演示数据里有生效中的版本', Boolean(active))
  check('生效中的版本存在同规则的历史版本（用于验证自动切回）', Boolean(archivedSameKey))

  console.log('== 2. 候选：待审核的直接删 ==')
  if (pending) {
    const before = candidates.total
    await call('DELETE', '/learning/candidates/' + pending.id)
    const after = await call<Paged<unknown>>('GET', '/learning/candidates')
    check('待审核候选删除成功，列表少一条', after.total === before - 1, before + ' → ' + after.total)
  }

  console.log('== 3. 候选：已审核的不填理由必须被拦住 ==')
  if (reviewed) {
    const error = await callExpectError('DELETE', '/learning/candidates/' + reviewed.id)
    check('不带理由删除已审核候选 → 被拦', Boolean(error.code), JSON.stringify(error))
    check('拦截原因是参数校验（不是 404/500）', error.code === 'VALIDATION_FAILED', String(error.code))
    const still = await call<Paged<{ id: string }>>('GET', '/learning/candidates')
    check('被拦之后数据还在（没被误删）', still.items.some((c) => c.id === reviewed.id))
  }

  console.log('== 4. 候选：已审核的填了理由可以删 ==')
  if (reviewed) {
    const before = (await call<Paged<unknown>>('GET', '/learning/candidates')).total
    await call('DELETE', '/learning/candidates/' + reviewed.id, { reason: '规则已作废，撤下重做' })
    const after = await call<Paged<unknown>>('GET', '/learning/candidates')
    check('带理由后删除成功', after.total === before - 1, before + ' → ' + after.total)
  }

  console.log('== 5. 版本：删"生效中"的必须自动切回上一个历史版本 ==')
  if (active && archivedSameKey) {
    const result = await call<{ deleted: boolean; promoted: { version: number } | null }>(
      'DELETE',
      '/learning/versions/' + active.id
    )
    check('生效中的版本删除成功', result.deleted === true)
    check('返回值告知切回了哪一版', Boolean(result.promoted), JSON.stringify(result))
    check('自动切回的是同规则的历史版本', result.promoted?.version === archivedSameKey.version, String(result.promoted?.version))

    const after = await call<Paged<{ id: string; key: string; state: string; version: number }>>('GET', '/learning/versions')
    const actives = after.items.filter((v) => v.key === active.key && v.state === 'active')
    check('该规则现在仍然有且只有一个生效版本（系统不会没有判据）', actives.length === 1, JSON.stringify(actives.map((v) => v.version)))
    check('被删的那个版本确实没了', !after.items.some((v) => v.id === active.id))
  }

  console.log('== 6. 版本：历史版本可以删 ==')
  const anyArchived = versions.items.find((v) => v.state === 'archived' && v.id !== archivedSameKey?.id)
  if (anyArchived) {
    const before = (await call<Paged<unknown>>('GET', '/learning/versions')).total
    await call('DELETE', '/learning/versions/' + anyArchived.id)
    const after = await call<Paged<unknown>>('GET', '/learning/versions')
    check('历史版本删除成功', after.total === before - 1, before + ' → ' + after.total)
  } else {
    check('（演示数据里没有第二个历史版本，跳过）', true)
  }

  console.log('== 7. 案例：可以删 ==')
  if (cases.items[0]) {
    const before = cases.total
    await call('DELETE', '/learning/cases/' + cases.items[0].id)
    const after = await call<Paged<unknown>>('GET', '/learning/cases')
    check('案例删除成功', after.total === before - 1, before + ' → ' + after.total)
  }

  console.log('== 8. 删除不存在的东西要报 404（不能静默成功）==')
  const missing = await callExpectError('DELETE', '/learning/versions/ver-does-not-exist')
  check('删除不存在的版本 → 报错', Boolean(missing.code), JSON.stringify(missing))

  console.log('')
  console.log('==============================================')
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项')
  if (failed) {
    failures.forEach((item) => console.log('  - ' + item))
    process.exitCode = 1
  } else {
    console.log('经验学习的删除规则正常：能删、该拦的拦住、删生效版本会自动兜底。')
  }
}

void main()