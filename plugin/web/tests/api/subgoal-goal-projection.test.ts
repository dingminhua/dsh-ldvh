import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

/**
 * GET /api/cognition/goal 的 sub_goals 投影（specs/25 §7 + specs/28 §8.1，2026-11）。
 *
 * 子目标已移出 goal.md，改由 SubGoal 事实对象承载。该路由的 sub_goals 因此从
 * 「在正文里正则抽 SG-n 行」变成「按 subgoals/ 目录反查」——两处必须一起验：
 *
 *   1) 行为契约：SubGoal 载体在场 ⇒ 投影带上 anchor/title/status/criterion_kind/
 *      object_uid；goal.md 里写不写 SG-n 行都不影响结果（正文明文不再是来源）。
 *   2) 迁移态契约：goal.md 仍有 `## 子目标` 段时，行被标 legacy:true；
 *      且**一旦该锚点已有 SubGoal 对象，就不得再出现第二行**——否则同一批锚点
 *      会有两处来源，二者可分叉（28 §14.2 禁止）。
 */

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-subgoal-projection-'))
const projectRoot = path.join(workspaceRoot, 'demo')
fs.mkdirSync(path.join(projectRoot, 'ldvh-base', 'subgoals'), { recursive: true })
execFileSync('git', ['init', '-q', projectRoot])

const GOAL = `---
goal_key: project-goal
title: 夹具目标
status: active
created_at: 2026-09-27T00:00:00.000Z
change_log:
  - at: 2026-09-27T00:00:00.000Z
    summary: 夹具初始修订
---

# 夹具目标

## 目标陈述

夹具目标陈述。

## 子目标

- SG-1 旧段里的子目标（已迁移）
- SG-9 只存在于旧段、尚未迁移
`
fs.writeFileSync(path.join(projectRoot, 'ldvh-base', 'goal.md'), GOAL)

/** A SubGoal carrier for SG-1, deliberately NOT written into goal.md. */
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'subgoals', 'subgoal-11111111-1111-4111-8111-111111111111.md'),
  `---
title: 规范体系成为当前规则源
status: achieved
anchor: SG-1
parent_goal: project-goal
criterion: 全部规范成为当前规则源成员且彼此互咬有效。
criterion_kind: executable-check
alignment: 目标陈述要求框架可被外部验证；规范体系是该框架的规则承载。
object_uid: 11111111-1111-4111-8111-111111111111
fact_type_key: subgoal
created_at: 2026-10-31T00:00:00.000Z
change_log:
  - at: 2026-10-31T00:00:00.000Z
    summary: 夹具
---

# 规范体系成为当前规则源

## 达成条件

全部规范成为当前规则源成员且彼此互咬有效。

## 对齐说明

目标陈述要求框架可被外部验证；规范体系是该框架的规则承载。
`,
)

fs.writeFileSync(
  path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml'),
  [
    'governance_instance_name: SubGoal projection test',
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

test('sub_goals 来自 SubGoal 载体，且带 anchor/status/criterion_kind/object_uid', async () => {
  const response = await fetch(`${baseUrl}/api/cognition/goal`)
  assert.equal(response.status, 200)
  const payload = await response.json() as { ok: boolean; goal?: { sub_goals?: Array<Record<string, unknown>> } }
  assert.equal(payload.ok, true)
  const rows = payload.goal?.sub_goals ?? []

  const sg1 = rows.find((row) => row.id === 'SG-1')
  assert.ok(sg1, `SG-1 必须在投影里，实际：${JSON.stringify(rows)}`)
  // 文本取容器里的短标题，而不是 goal.md 旧段的行文——这是「来源已切换」的判别位。
  assert.equal(sg1.text, '规范体系成为当前规则源')
  assert.equal(sg1.status, 'achieved')
  assert.equal(sg1.criterion_kind, 'executable-check')
  assert.equal(sg1.object_uid, '11111111-1111-4111-8111-111111111111')
  // 已由对象承载 ⇒ 不得再被旧段补一行（同锚点两处来源会分叉）。
  assert.equal(rows.filter((row) => row.id === 'SG-1').length, 1)
  assert.notEqual(sg1.legacy, true)
})

test('旧段里尚未迁移的锚点仍显示，但被标 legacy 而不是当成对象', async () => {
  const response = await fetch(`${baseUrl}/api/cognition/goal`)
  const payload = await response.json() as { goal?: { sub_goals?: Array<Record<string, unknown>> } }
  const rows = payload.goal?.sub_goals ?? []
  const sg9 = rows.find((row) => row.id === 'SG-9')
  assert.ok(sg9, `SG-9 必须仍在场（否则迁移中的项目会静默丢子目标），实际：${JSON.stringify(rows)}`)
  assert.equal(sg9.legacy, true)
  assert.equal(sg9.status, undefined)
  assert.equal(sg9.object_uid, undefined)
})

test('投影按数字锚点排序，不按目录序', async () => {
  const response = await fetch(`${baseUrl}/api/cognition/goal`)
  const payload = await response.json() as { goal?: { sub_goals?: Array<Record<string, unknown>> } }
  const ids = (payload.goal?.sub_goals ?? []).map((row) => String(row.id))
  const nums = ids.map((id) => Number(id.replace(/^SG-/, '')))
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), `锚点须按编号排序，实际：${ids.join(',')}`)
})

test('源码契约：路由从 subgoals 目录反查，不再用正则抽正文 SG-n 行', () => {
  const cognition = fs.readFileSync(path.resolve('api/routes/cognition.ts'), 'utf8')
  assert.match(cognition, /readSubGoalProjection\(/)
  assert.match(cognition, /legacySubGoalAnchors\(/)
  // 旧实现的特征：在 body 上跑 SG-n 正则并直接 push 进行。
  assert.doesNotMatch(cognition, /const sgRe = \/\^\\s\*\(SG-\\d\+\)/)
})

test('前端类型面声明了 status/criterion_kind/object_uid/legacy', () => {
  const api = fs.readFileSync(path.resolve('src/utils/api.ts'), 'utf8')
  const start = api.indexOf('export interface CognitionGoalData {')
  assert.ok(start >= 0)
  const block = api.slice(start, api.indexOf('\n}', start))
  for (const field of ['status?: string', 'criterion_kind?: string', 'object_uid?: string', 'legacy?: boolean']) {
    assert.match(block, new RegExp(field.replace(/[?]/g, '\\?')), `CognitionGoalData 须声明 ${field}`)
  }
})
