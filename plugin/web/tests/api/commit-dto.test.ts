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
// 21 §7 载体（.md + frontmatter）与 §8 字段闭集（v5）：open 执行中对象
// 携带 attempt 现场；plan 每项 {step, done_criteria}。
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'workcases', 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789aaa.md'),
  [
    '---',
    'title: Dashboard WorkCase 投影回归',
    'status: open',
    'created_at: ' + "'2026-07-20T06:00:00+08:00'",
    'summary: 当前结果等待独立复核。',
    'scope: 做什么：固定 v5 投影；不做什么：语义判断。',
    'plan:',
    '  - step: 完成实现',
    '    done_criteria: 实现完成且测试通过。',
    '  - step: 独立复核',
    '    done_criteria: 复核报告留档。',
    'gate_1:',
    '  approved_at: ' + "'2026-07-20T06:30:00+08:00'",
    '  approver: human-test',
    '  authorization_fingerprint: ' + 'a'.repeat(64),
    '  scope_snapshot: 做什么：固定 v5 投影；不做什么：语义判断。',
    'attempt:',
    '  attempt_id: 1',
    '  started_at: ' + "'2026-07-20T06:30:00+08:00'",
    '  controller: controller-a',
    '  heartbeat_at: ' + "'2026-07-20T07:00:00+08:00'",
    'object_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789aaa',
    'object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789aaa',
    'fact_type_key: workcase',
    'change_log:',
    '  - at: ' + "'2026-07-20T07:00:00+08:00'",
    '    summary: 执行进展。',
    '---',
    '',
    '# Dashboard WorkCase 投影回归',
    '',
    '## 摘要',
    '',
    '当前结果等待独立复核。',
    '',
    '## 授权范围',
    '',
    '做什么：固定 v5 投影；不做什么：语义判断。',
    '',
    '## 计划',
    '',
    '- 完成实现：判据——实现完成且测试通过。',
    '- 独立复核：判据——复核报告留档。',
    '',
    '## 执行',
    '',
    '- attempt 1 运行中。',
    '',
  ].join('\n'),
)
// 第三份夹具：status=open ∧ 正文**含** `## 结果` 节——即 10 §5.5 派生判据中
// `awaiting_gate2`（待批准关闭）的**唯一**成立组合。
//
// 为什么必须单独补这一份：此前夹具只有「open 且无结果节」与「closed」两种，
// `awaiting_gate2` 这条派生路径**从未被任何测试踩到**，于是列表投影剥离
// `report_body` 后下游重算导致的恒 0 缺陷长期未被发现（现值 3 份真实工单受影响）。
// 夹具必须覆盖每条派生路径——这正是本用例的回归防线。
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'workcases', 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789ccc.md'),
  [
    '---',
    'title: Dashboard 待关闭 WorkCase 派生回归',
    'status: open',
    'created_at: ' + "'2026-07-20T04:00:00+08:00'",
    'summary: 固定 awaiting_gate2 派生。',
    'scope: 做什么：固定 awaiting_gate2 派生；不做什么：其它。',
    'plan:',
    '  - step: 唯一步骤',
    '    done_criteria: 结果节写完即待关闭。',
    'gate_1:',
    '  approved_at: ' + "'2026-07-20T04:30:00+08:00'",
    '  approver: human-test',
    '  authorization_fingerprint: ' + 'a'.repeat(64),
    '  scope_snapshot: 做什么：固定 awaiting_gate2 派生；不做什么：其它。',
    'attempt:',
    '  attempt_id: 1',
    '  started_at: ' + "'2026-07-20T04:30:00+08:00'",
    '  controller: controller-a',
    '  heartbeat_at: ' + "'2026-07-20T05:00:00+08:00'",
    'object_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789ccc',
    'object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789ccc',
    'fact_type_key: workcase',
    'change_log:',
    '  - at: ' + "'2026-07-20T05:00:00+08:00'",
    '    summary: 执行进展。',
    '---',
    '',
    '# Dashboard 待关闭 WorkCase 派生回归',
    '',
    '## 摘要',
    '',
    '固定 awaiting_gate2 派生。',
    '',
    '## 授权范围',
    '',
    '做什么：固定 awaiting_gate2 派生；不做什么：其它。',
    '',
    '## 计划',
    '',
    '- 唯一步骤：判据——结果节写完即待关闭。',
    '',
    '## 执行',
    '',
    '- attempt 1 运行中。',
    '',
    '## 结果',
    '',
    '### Gate 2 提请',
    '',
    '- 待 Human 裁决。',
    '',
  ].join('\n'),
)
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'workcases', 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789bbb.md'),
  [
    '---',
    'title: Dashboard 已关闭 WorkCase 投影回归',
    'status: closed',
    'created_at: ' + "'2026-07-20T05:00:00+08:00'",
    'summary: 固定 closed 投影。',
    'scope: 做什么：固定 closed 投影；不做什么：其它。',
    'plan:',
    '  - step: 唯一步骤',
    '    done_criteria: 关闭即达成。',
    'outcome: cancelled',
    'result:',
    '  criteria_checks:',
    '    - satisfied: false',
    '      evidence: 未执行即取消。',
    '  achieved_scope: 取消关闭，实际未发生执行。',
    '  residual: []',
    'object_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789bbb',
    'object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789bbb',
    'fact_type_key: workcase',
    'change_log:',
    '  - at: ' + "'2026-07-20T05:30:00+08:00'",
    '    summary: cancelled 关闭。',
    '---',
    '',
    '# Dashboard 已关闭 WorkCase 投影回归',
    '',
    '## 摘要',
    '',
    '固定 closed 投影。',
    '',
    '## 授权范围',
    '',
    '做什么：固定 closed 投影；不做什么：其它。',
    '',
    '## 计划',
    '',
    '- 唯一步骤：判据——关闭即达成。',
    '',
    '## 执行',
    '',
    '- 未执行即取消。',
    '',
    '## 结果',
    '',
    '- 取消关闭，实际未发生执行。',
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
