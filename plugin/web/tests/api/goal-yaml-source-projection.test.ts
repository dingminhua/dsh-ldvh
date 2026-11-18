import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'


const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-goal-yaml-workspace-'))
const projectRoot = path.join(workspaceRoot, 'demo')
fs.mkdirSync(path.join(projectRoot, 'ldvh-base'), { recursive: true })
execFileSync('git', ['init', '-q', projectRoot])

const GOAL_FRONTMATTER = [
  'goal_key: project-goal',
  '# 夹具注释：重建兜底会丢弃注释，本行是「原文 vs 重建」的判别位',
  'status: active',
  'title: "夹具目标"',
  'created_at: "2026-09-27T00:00:00.000Z"',
  'change_log:',
  '  - at: "2026-09-27T00:00:00.000Z"',
  '    summary: 夹具初始修订',
].join('\n')

fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'goal.md'),
  `---\n${GOAL_FRONTMATTER}\n---\n\n## 目标陈述\n\n夹具目标陈述。\n\n## 子目标\n\n- SG-1 夹具子目标\n`,
)

fs.writeFileSync(
  path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml'),
  [
    'governance_instance_name: Goal yaml_source test',
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
process.env.LDVH_GOVERNED_PROJECTS_CONFIG = path.resolve(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
process.env.LDVH_WEB_WORKTREE_LOCATOR = projectRoot

let server: Server
let baseUrl = ''

before(async () => {
  const { appReady, default: app } = await import('../../api/app.ts')
  await appReady
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

test('goal 直读路由把 frontmatter 原文投影为 yaml_source（逐字一致）', async () => {
  const response = await fetch(`${baseUrl}/api/cognition/goal`)
  assert.equal(response.status, 200)
  const payload = await response.json() as { ok: boolean; goal?: Record<string, unknown> }
  assert.equal(payload.ok, true)
  const goal = payload.goal
  assert.ok(goal, 'goal 投影必须存在')
  assert.equal(goal.yaml_source, GOAL_FRONTMATTER)
  assert.match(String(goal.yaml_source), /# 夹具注释/)
  assert.equal(goal.canonical_path, 'ldvh-base/goal.md')
  assert.equal(goal.carrier, 'markdown')
  assert.equal(goal.read_status, 'readable')
})

test('路由与前端类型契约：yaml_source 取自单例读取实现的 frontmatter 原文', () => {
  const cognition = fs.readFileSync(path.resolve('api/routes/cognition.ts'), 'utf8')
  assert.match(cognition, /const frontmatterSource = lines\.slice\(1, endIdx\)\.join\('\\n'\)/)
  assert.match(cognition, /yaml_source: record\.frontmatterSource,/)
  const api = fs.readFileSync(path.resolve('src/utils/api.ts'), 'utf8')
  const goalBlockStart = api.indexOf('export interface CognitionGoalData {')
  assert.ok(goalBlockStart >= 0, 'api.ts 必须声明 CognitionGoalData')
  const goalBlockEnd = api.indexOf('\n}', goalBlockStart)
  assert.ok(goalBlockEnd > goalBlockStart, 'CognitionGoalData 类型块必须有闭合')
  assert.match(api.slice(goalBlockStart, goalBlockEnd), /yaml_source\?: string;/)
})
