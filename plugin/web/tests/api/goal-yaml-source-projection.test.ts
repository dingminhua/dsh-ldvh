import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

/**
 * goal 详情直读路由的 yaml_source 投影（specs/25 §10 消费点直读；workcase 9208ce82）。
 *
 * Goal 是单例冻结锚，不走事实对象读取层，其详情阅读面由 GET /api/cognition/goal
 * 承载。单例读取实现 readGoalRecord 早已解析出 frontmatter 逐字原文
 * （frontmatterSource），但该路由此前未把原文投影成 yaml_source，于是前端
 * YamlDataNode 的「原文优先、重建兜底」对 goal 恒走重建分支——Human 在 goal
 * 详情页读到的是重整过的 YAML，而非 goal.md 原文（残留见 workcase 63700bd2）。
 *
 * 两段互补守护：
 *   1) 行为契约：在真实临时工作区起真实 app、请求真实路由，断言响应
 *      yaml_source 与 goal.md frontmatter **逐字一致**；
 *   2) 源码契约：投影确有该字段且取自单例读取实现的原文，前端类型面同步。
 * 夹具 frontmatter 故意使用非字典序键序 + 一条注释 + 显式引号：重建兜底
 * （reconstructFactYaml → dumpYaml(projectFactObjectFields(obj))）走的是解析后
 * 重排，注释与引号必然丢失，故该断言真正区分「原文」与「重建」，而不是仅断言
 * 字段存在。
 */

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
  // 先断开 keep-alive 连接再关服务，避免 close 回调等待空闲连接自然超时。
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
  // 逐字一致：键序、注释与显式引号都要原样在场——重建兜底不可能复现。
  assert.equal(goal.yaml_source, GOAL_FRONTMATTER)
  // 判别位自证：注释行只在原文里；缺失即说明该字段落到了重建兜底（或缺投影）。
  assert.match(String(goal.yaml_source), /# 夹具注释/)
  // 读取层元数据与原文同时在场（getFactReadMeta 消费面不因新增字段变化）。
  assert.equal(goal.canonical_path, 'ldvh-base/goal.md')
  assert.equal(goal.carrier, 'markdown')
  assert.equal(goal.read_status, 'readable')
})

test('路由与前端类型契约：yaml_source 取自单例读取实现的 frontmatter 原文', () => {
  const cognition = fs.readFileSync(path.resolve('api/routes/cognition.ts'), 'utf8')
  // 原文在单例读取实现里已解析（勿退化为自行重排/重建）。
  assert.match(cognition, /const frontmatterSource = lines\.slice\(1, endIdx\)\.join\('\\n'\)/)
  assert.match(cognition, /yaml_source: record\.frontmatterSource,/)
  // 前端类型面同步声明。断言范围必须限定在 CognitionGoalData 块内：api.ts 另有一处
  // 多例 FactObject 的同名字段，全文级正则会被它满足而空转（2026-09-27 复核实测）。
  // 该声明是契约记录，不是 tsc 的硬约束——GoalDetail.tsx 消费面经
  // `as unknown as Record<string, unknown>` 放宽，删掉本字段 tsc 仍退 0，
  // 故这里只能断言「声明在场」，不能声称「否则 tsc 会拒绝」。
  const api = fs.readFileSync(path.resolve('src/utils/api.ts'), 'utf8')
  const goalBlockStart = api.indexOf('export interface CognitionGoalData {')
  assert.ok(goalBlockStart >= 0, 'api.ts 必须声明 CognitionGoalData')
  const goalBlockEnd = api.indexOf('\n}', goalBlockStart)
  assert.ok(goalBlockEnd > goalBlockStart, 'CognitionGoalData 类型块必须有闭合')
  assert.match(api.slice(goalBlockStart, goalBlockEnd), /yaml_source\?: string;/)
})
