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
 *   1) 行为契约：SubGoal 载体在场 ⇒ 投影带上 title/status/criterion_kind/
 *      object_uid，且 `id` 就是 object_uid（2026-11-01 废止 SG-n 业务编号，
 *      28 §7：编号不再承担身份，故投影的 id 也不能是编号）。
 *   2) 迁移态契约：goal.md 仍有 `## 子目标` 段时，行被标 legacy:true 并排在
 *      对象行之后——它们是尚未迁移的文本，没有 uid，故只保留字面标签。
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

/** A SubGoal object, deliberately NOT written into goal.md. */
fs.writeFileSync(
  path.join(projectRoot, 'ldvh-base', 'subgoals', 'subgoal-11111111-1111-4111-8111-111111111111.md'),
  `---
title: 规范体系成为当前规则源
status: achieved
order: 1
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

  // Identity is the uid, NOT the retired SG-n label (28 §7, 2026-11-01).
  const obj = rows.find((row) => row.id === '11111111-1111-4111-8111-111111111111')
  assert.ok(obj, `对象行必须在投影里，实际：${JSON.stringify(rows)}`)
  // 文本取容器里的短标题，而不是 goal.md 旧段的行文——这是「来源已切换」的判别位。
  assert.equal(obj.text, '规范体系成为当前规则源')
  assert.equal(obj.status, 'achieved')
  assert.equal(obj.criterion_kind, 'executable-check')
  assert.equal(obj.object_uid, '11111111-1111-4111-8111-111111111111')
  assert.notEqual(obj.legacy, true)
  // Both inherited labels survive as legacy rows (SG-1 is now an object too, but
  // the carrier text is still there) — the important part is that NO legacy row
  // claims a uid, and they sit after the object rows.
  const legacyRows = rows.filter((row) => row.legacy === true)
  assert.deepEqual(legacyRows.map((row) => row.id), ['SG-1', 'SG-9'])
  for (const row of legacyRows) assert.equal(row.object_uid, undefined)
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

test('对象行按 order 排序，legacy 行排在对象之后', async () => {
  const response = await fetch(`${baseUrl}/api/cognition/goal`)
  const payload = await response.json() as { goal?: { sub_goals?: Array<Record<string, unknown>> } }
  const rows = payload.goal?.sub_goals ?? []
  // Object rows precede legacy rows: a legacy entry is not an object, so it can
  // never interleave with them by any order value.
  const firstLegacy = rows.findIndex((row) => row.legacy === true)
  if (firstLegacy >= 0) {
    assert.ok(
      rows.slice(firstLegacy).every((row) => row.legacy === true),
      `legacy 行必须全部排在对象行之后，实际：${JSON.stringify(rows)}`,
    )
  }
  const objOrders = rows.filter((row) => row.legacy !== true).map((row) => row.order)
  const known = objOrders.filter((o): o is number => typeof o === 'number')
  assert.deepEqual(known, [...known].sort((a, b) => a - b), `对象行须按 order 升序，实际：${JSON.stringify(objOrders)}`)
})

test('源码契约：路由从 subgoals 目录反查，不再用正则抽正文 SG-n 行', () => {
  const cognition = fs.readFileSync(path.resolve('api/routes/cognition.ts'), 'utf8')
  assert.match(cognition, /readSubGoalProjection\(/)
  assert.match(cognition, /legacySubGoalAnchors\(/)
  // 旧实现的特征：在 body 上跑 SG-n 正则并直接 push 进行。
  assert.doesNotMatch(cognition, /const sgRe = \/\^\\s\*\(SG-\\d\+\)/)
})

test('前端类型面声明了 status/criterion_kind/object_uid/order/legacy', () => {
  const api = fs.readFileSync(path.resolve('src/utils/api.ts'), 'utf8')
  const start = api.indexOf('export interface CognitionGoalData {')
  assert.ok(start >= 0)
  const block = api.slice(start, api.indexOf('\n}', start))
  for (const field of ['status?: string', 'criterion_kind?: string', 'object_uid?: string', 'order?: number', 'legacy?: boolean']) {
    assert.match(block, new RegExp(field.replace(/[?]/g, '\\?')), `CognitionGoalData 须声明 ${field}`)
  }
})
