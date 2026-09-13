import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { parseCommitSignature } from '../../api/services/git.ts'

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-commit-dto-workspace-'))
const projectRoot = path.join(workspaceRoot, 'demo')
fs.mkdirSync(projectRoot, { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'ldvh-base', 'sparks'), { recursive: true })
// v5 Spark 载体（20 §7）：.md + frontmatter + 正文；无 priority（§14.2 不迁入）、
// 无 urls（§10）——更新时间由 change_log[].at 承担（03 §6.1 无公共 updated_at）。
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'sparks', 'spark-0001.md'),
  [
    '---',
    'title: Dashboard 时间字段回归',
    'status: open',
    'question: 列表更新时间是否取 change_log 末条 at？',
    'scope_boundary: 只验证列表投影的时间排序。',
    'intent: 固定列表时间字段回归。',
    'summary: 固定 v5 change_log 承载的更新时间在 Dashboard 中的相对时间投影。',
    'object_id: spark-0001',
    'fact_type_key: spark',
    "created_at: '2026-07-20T08:00:00+08:00'",
    'change_log:',
    "  - at: '2026-07-20T08:00:00+08:00'",
    '    summary: 创建夹具。',
    '---',
    '',
    '# Dashboard 时间字段回归',
    '',
    '## 当前理解',
    '',
    '固定 v5 change_log 承载的更新时间在 Dashboard 中的相对时间投影。',
    '',
  ].join('\n'),
)
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'sparks', 'spark-0002.md'),
  [
    '---',
    'title: Dashboard 状态筛选回归',
    'status: open',
    'question: 状态闭集三态在列表中是否正确计数？',
    'scope_boundary: 只验证状态 tab 计数。',
    'intent: 固定 Spark 生命周期筛选回归。',
    'summary: 固定 Spark 生命周期筛选（v5 无优先级维度）。',
    'object_id: spark-0002',
    'fact_type_key: spark',
    "created_at: '2026-07-19T08:00:00+08:00'",
    'change_log:',
    "  - at: '2026-07-19T08:00:00+08:00'",
    '    summary: 创建夹具。',
    '---',
    '',
    '# Dashboard 状态筛选回归',
    '',
    '## 当前理解',
    '',
    '固定 Spark 生命周期筛选（v5 无优先级维度）。',
    '',
  ].join('\n'),
)
fs.mkdirSync(path.join(projectRoot, 'ldvh-base', 'workcases'), { recursive: true })
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'workcases', 'workcase-0001.yaml'),
  [
    'title: Dashboard WorkCase 投影回归',
    'status: open',
    'priority: P1',
    'summary: 当前结果等待独立复核。',
    'resume_from: 继续独立复核。',
    'goal: 固定当前 WorkCase 的 Web 投影。',
    'scope: 仅测试。',
    'success_criterion_definitions:',
    '- criterion_id: criterion-01',
    '  statement: 当前标准已满足。',
    'phase: independent_reviewing',
    'plan_version: 1',
    'work_items:',
    '- item_id: item-01',
    '  goal: 完成实现',
    '  expected_result: 实现完成。',
    '  approach_summary: 按测试边界完成实现。',
    '  status: completed',
    '  result_summary: 已完成。',
    'execution_approval:',
    '  subject_version: 1',
    "  approved_at: '2026-07-20T06:00:00+08:00'",
    '  summary: Human 已批准。',
    'result_version: 1',
    'success_criterion_results:',
    '- criterion_id: criterion-01',
    '  outcome: satisfied',
    '  summary: 已满足。',
    'result_summary: 当前实现已经形成。',
    'controller_check_summary: 已完成自检。',
    'validation_summary: 已检查当前 Web 投影。',
    'waiting_on: 等待独立复核。',
    'object_id: workcase-0001',
    'fact_type_key: workcase',
    "created_at: '2026-07-20T06:00:00+08:00'",
    "updated_at: '2026-07-20T07:00:00+08:00'",
    '',
  ].join('\n'),
)
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'workcases', 'workcase-0002.yaml'),
  [
    'title: Dashboard 已废弃 WorkCase 投影回归',
    'status: closed',
    'goal: 固定无 phase 的 closed WorkCase Web 投影。',
    'scope: 仅测试 cancelled 关闭的废弃分组。',
    'success_criterion_definitions:',
    '- criterion_id: criterion-closed-group',
    '  statement: 取消关闭对象进入已废弃分组。',
    'success_criterion_results:',
    '- criterion_id: criterion-closed-group',
    '  outcome: satisfied',
    '  summary: 列表与 Dashboard 均投影为已废弃。',
    'result_summary: closed 投影已经形成。',
    'validation_summary: 已检查无 phase 的 closed 投影。',
    'closure_outcome: cancelled',
    'disposition_summary: 当前责任已取消并废弃。',
    'object_id: workcase-0002',
    'fact_type_key: workcase',
    "created_at: '2026-07-20T05:00:00+08:00'",
    "updated_at: '2026-07-20T05:30:00+08:00'",
    '',
  ].join('\n'),
)

function git(args: string[]) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' }).trim()
}

git(['init', '--quiet'])
git(['config', 'user.email', 'tester@example.com'])
git(['config', 'user.name', 'Tester'])
fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Demo\n')
git(['add', 'README.md'])
git([
  'commit', '--quiet', '-m', 'feat(web)!: 调整提交接口', '-m',
  [
    '动机:', '- 统一提交记录结构。', '', '验证结论:', '- 由特征测试固定当前 DTO。', '',
    'LDVH-Product-Name: Cindy',
    'LDVH-Model-Name: gpt-5.6-luna',
  ].join('\n'),
])
const remoteRoot = path.join(workspaceRoot, 'remote.git')
execFileSync('git', ['init', '--bare', '--quiet', remoteRoot])
git(['branch', '-M', 'main'])
git(['remote', 'add', 'origin', remoteRoot])
git(['push', '--quiet', '--set-upstream', 'origin', 'main'])

fs.writeFileSync(
  path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml'),
  [
    'governance_instance_name: Commit DTO test',
    'product_description: Code-controlled governance resolution fixture.',
    'projects:',
    '  - id: demo',
    `    path: ${projectRoot}`,
    '    name: Demo',
    '    description: Test project.',
    '',
  ].join('\n'),
)
process.env.LDVH_ROOT = projectRoot
process.env.LDVH_WORKSPACE_ROOT = workspaceRoot
// v5 现状：治理范围经 Node git 解析，不依赖 v4 Python Helper。登记载体指向本测试
// 自建的工作区治理 YAML，触发 governanceScope 的 Node git 分支。CI 可用覆盖。
process.env.LDVH_GOVERNED_PROJECTS_CONFIG = path.resolve(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
process.env.LDVH_WEB_WORKTREE_LOCATOR = projectRoot
process.env.LDVH_WEB_WORKSPACE_ROOT = workspaceRoot
process.env.LDVH_WEB_GOVERNED_PROJECT_ID = 'demo'

let server: Server
let baseUrl = ''

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

function assertCommitDto(entry: Record<string, unknown>) {
  assert.equal(typeof entry.hash, 'string')
  assert.equal(typeof entry.shortHash, 'string')
  assert.equal(entry.message, 'feat(web)!: 调整提交接口')
  assert.equal(entry.category, 'feat')
  assert.equal(entry.scope, 'web')
  assert.equal(entry.description, '调整提交接口')
  assert.equal(entry.isBreaking, true)
  assert.equal(entry.pushStatus, 'pushed')
  assert.deepEqual(entry.signature, {
    productName: 'Cindy',
    modelName: 'gpt-5.6-luna',
  })
  assert.match(String(entry.body), /动机:/)
  assert.match(String(entry.body), /验证结论:/)
}

async function getJson(pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`)
  const body = await response.text()
  assert.equal(response.status, 200, body)
  return JSON.parse(body) as unknown
}

test('preserves the shared commit DTO across current API consumers', async () => {
  const changelog = await getJson('/api/changelog?count=1&locale=zh') as Array<Record<string, unknown>>
  assert.equal(changelog.length, 1)
  assertCommitDto(changelog[0])

  const workcases = await getJson('/api/objects/workcase') as {
    data: {
      items: Array<Record<string, unknown>>
      progressOptions: Array<Record<string, unknown>>
    }
  }
  const workcase = workcases.data.items.find((item) => item.object_id === 'workcase-0001')
  const closedWorkcase = workcases.data.items.find((item) => item.object_id === 'workcase-0002')
  assert.ok(workcase)
  assert.ok(closedWorkcase)
  assert.equal(workcase.status, 'open')
  assert.equal(workcase.phase, 'independent_reviewing')
  assert.equal('responsibilityStatus' in workcase, false)
  assert.equal(workcase.progress_group, 'progressing')
  assert.equal(workcase.progress_step, 'independent_review')
  assert.equal(workcase.executionItemsProjectionValid, true)
  assert.deepEqual(workcase.executionItems, [{
    id: 'item-01',
    title: '完成实现',
    status: 'completed',
  }])
  assert.equal('executionItemTotal' in workcase, false)
  assert.equal('executionItemDone' in workcase, false)
  assert.equal('executionItemCancelled' in workcase, false)
  assert.equal('executionItemsActive' in workcase, false)
  assert.equal('progressHistoryState' in workcase, false)
  assert.equal('progressRound' in workcase, false)
  assert.equal('successCriteria' in workcase, false)
  assert.equal('success_criterion_definitions' in workcase, false)
  assert.equal('work_items' in workcase, false)
  assert.equal('hasPlanConfirmedAt' in workcase, false)
  assert.equal('hasClosureRequestedAt' in workcase, false)
  assert.equal('hasVerificationEvidence' in workcase, false)
  assert.equal('hasClosureEvidence' in workcase, false)
  assert.equal(closedWorkcase.status, 'closed')
  assert.equal(closedWorkcase.progress_group, 'closed')
  assert.equal('progress_step' in closedWorkcase, false)
  assert.equal('executionItems' in closedWorkcase, false)
  assert.equal('executionItemsProjectionValid' in closedWorkcase, false)
  assert.equal('successCriteria' in closedWorkcase, false)
  assert.equal('success_criterion_definitions' in closedWorkcase, false)
  // 21 §160：列表分组 = 状态闭集三态 draft/open/closed（此前为 v4 五值进展分组）。
  // workcase-0001 status=open；workcase-0002 status=closed（cancelled）。
  assert.deepEqual(workcases.data.progressOptions, [
    { group: 'draft', count: 0 },
    { group: 'open', count: 1 },
    { group: 'closed', count: 1 },
  ])

  // 20 §289 / 21 §8：v5 无 priority 字段——列表 API 不再提供 priority 过滤与投影。
  const prioritizedWorkcases = await getJson('/api/objects/workcase?priority=P1') as {
    data: {
      items: Array<Record<string, unknown>>
      priorityOptions?: Array<{ status: string; count: number }>
    }
  }
  // priority 参数已被忽略：不再按优先级收窄，返回全部 WorkCase。
  assert.deepEqual(
    prioritizedWorkcases.data.items.map((item) => item.object_id).sort(),
    ['workcase-0001', 'workcase-0002'],
  )
  assert.equal(prioritizedWorkcases.data.priorityOptions, undefined)

  // 20 §8/§14.2：v5 Spark 无 priority——状态闭集三态直接过滤，无优先级维度。
  const openSparks = await getJson('/api/objects/spark?status=open') as {
    data: {
      items: Array<Record<string, unknown>>
      statusOptions: Array<{ status: string; count: number }>
      priorityOptions?: Array<{ status: string; count: number }>
    }
  }
  // 更新时间降序（change_log 末条 at 承担）：spark-0001（07-20）先于 spark-0002（07-19）。
  assert.deepEqual(openSparks.data.items.map((item) => item.object_id), ['spark-0001', 'spark-0002'])
  assert.equal(openSparks.data.priorityOptions, undefined)
  assert.ok(openSparks.data.statusOptions.some((option) => option.status === 'open' && option.count === 2))

  // 21 §160 三态过滤：open 命中 workcase-0001；closed 命中 workcase-0002（cancelled）。
  const reviewWorkcases = await getJson('/api/objects/workcase?progress=open') as {
    data: { items: Array<Record<string, unknown>> }
  }
  assert.deepEqual(reviewWorkcases.data.items.map((item) => item.object_id), ['workcase-0001'])

  const closedWorkcases = await getJson('/api/objects/workcase?progress=closed') as {
    data: { items: Array<Record<string, unknown>> }
  }
  assert.deepEqual(closedWorkcases.data.items.map((item) => item.object_id), ['workcase-0002'])

  // v4 的 discarded 分组已随五值进展分组一并移除（非 21 §160 三态之一）。
  const discardedResponse = await fetch(`${baseUrl}/api/objects/workcase?progress=discarded`)
  assert.equal(discardedResponse.status, 400)

  const workcaseDetail = await getJson('/api/objects/workcase/workcase-0001') as {
    summary: Record<string, unknown>
  }
  assert.equal(workcaseDetail.summary.status, 'open')
  assert.equal(workcaseDetail.summary.phase, undefined)

  const commits = await getJson('/api/project-files/git/commits?projectId=demo&count=1') as {
    entries: Array<Record<string, unknown>>
  }
  assert.equal(commits.entries.length, 1)
  assertCommitDto(commits.entries[0])
  assert.deepEqual(commits.entries[0].parents, [])
  assert.equal(commits.entries[0].isMerge, false)
})

test('commit signature display reads only current LDVH trailers', () => {
  assert.deepEqual(parseCommitSignature([
    'LDVH-Product-Name: Cindy',
    'LDVH-Model-Name: gpt-5.6-luna',
  ].join('\n')), {
    productName: 'Cindy',
    modelName: 'gpt-5.6-luna',
  })
  assert.equal(parseCommitSignature([
    'Session-ID: legacy-session',
    'Model-ID: gpt-5',
    'Workbench-Name: Cindy',
  ].join('\n')), undefined)
  assert.deepEqual(parseCommitSignature([
    'LDVH-Model-Name: chatgpt/gpt-5.6-terra',
    'LDVH-Product-Name: cindy',
  ].join('\n')), { modelName: 'gpt-5.6-terra', productName: 'Cindy' })
})

test('commit signature display reads the v5 LDVH-Provider/LDVH-Model trailers (specs/06 §6.1)', () => {
  // v5 受控提交的权威 trailer 词汇：以区分键逐字返回（供应商 id 不美化——
  // 签名值零清理原则），显示层经 normalizeSignature 合并呈现。
  assert.deepEqual(parseCommitSignature([
    'LDVH-Provider: modlens-zzztoken-glm',
    'LDVH-Model: glm-5.3',
  ].join('\n')), {
    provider: 'modlens-zzztoken-glm',
    model: 'glm-5.3',
  })
  // 只有 provider 也可读（模型缺省不补造）。
  assert.deepEqual(parseCommitSignature([
    'LDVH-Provider: zzztoken-glm',
  ].join('\n')), { provider: 'zzztoken-glm' })
  // v4 词汇与 v5 词汇同时出现时 v4 优先（真实提交只带一种词汇，防御性约定）。
  assert.deepEqual(parseCommitSignature([
    'LDVH-Product-Name: Cindy',
    'LDVH-Model-Name: gpt-5.6-luna',
    'LDVH-Provider: zzztoken-glm',
    'LDVH-Model: glm-5.3',
  ].join('\n')), {
    productName: 'Cindy',
    modelName: 'gpt-5.6-luna',
  })
  // LDVH-Model 不会误匹配 LDVH-Model-Name（键名精确匹配）。
  assert.deepEqual(parseCommitSignature([
    'LDVH-Model-Name: gpt-5.6-luna',
  ].join('\n')), { modelName: 'gpt-5.6-luna' })
})
