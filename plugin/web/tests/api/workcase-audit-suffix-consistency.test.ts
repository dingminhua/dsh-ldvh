// 建前审核后缀在**所有呈现面同形**的契约测试（21 §8 `pre_reviews`，2026-10-17）。
//
// 起因：后缀最初只加在列表卡（`ObjectList` 的局部 const），聚焦页四处徽标仍各自
// 直调 `getObjectStatusLocale`，于是同一张工单在列表卡显示「待批准执行 · 待审核」、
// 在聚焦收件箱只显示「待批准执行」。Human 2026-10-17 指出「聚焦栏的 card 表现要同步」。
//
// 治本不是补某一处，而是让判据只有一个来源：`getObjectStatusDisplayLabel`。
// 本工件同时钉住两件事：
//   ① 该单一入口的行为（有/无 pass 结论、非 workcase、非 pending_gate1）；
//   ② 各呈现面**确实在调它**（源码级断言）——只测行为不测调用链，漏改一处仍会全绿。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { getObjectStatusDisplayLabel } from '../../src/i18n/locales.ts'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('后缀行为：workcase 的 pending_gate1 未审时追加「· 待审核」', () => {
  assert.equal(getObjectStatusDisplayLabel('workcase', 'pending_gate1', 'zh', false), '待批准执行 · 待审核')
})

test('后缀行为：已取得通过结论时保持原词，不加后缀', () => {
  assert.equal(getObjectStatusDisplayLabel('workcase', 'pending_gate1', 'zh', true), '待批准执行')
})

test('后缀行为：判据缺失（undefined）按未审处理——fail-closed', () => {
  // 宁可多显示「待审核」，也不把「不知道审没审」显示成「已审」
  assert.equal(getObjectStatusDisplayLabel('workcase', 'pending_gate1', 'zh', undefined), '待批准执行 · 待审核')
})

test('后缀行为：非 workcase、或 workcase 的其它派生组不受影响', () => {
  assert.equal(getObjectStatusDisplayLabel('spark', 'open', 'zh', true), getObjectStatusDisplayLabel('spark', 'open', 'zh'))
  assert.equal(getObjectStatusDisplayLabel('workcase', 'executing', 'zh', false), '执行中')
  assert.equal(getObjectStatusDisplayLabel('workcase', 'awaiting_gate2', 'zh', false), '待批准关闭')
})

test('后缀行为：英文同样生效', () => {
  assert.equal(getObjectStatusDisplayLabel('workcase', 'pending_gate1', 'en', false), 'Pending Gate 1 · Awaiting audit')
})

test('调用链：列表卡与聚焦页的状态文案都经同一入口（防「只改一处」复发）', () => {
  const objectList = read('src/pages/ObjectList.tsx')
  const cognition = read('src/pages/CognitionCenter.tsx')
  assert.match(objectList, /getObjectStatusDisplayLabel\(/, '列表卡须经单一入口')
  assert.match(cognition, /getObjectStatusDisplayLabel\(/, '聚焦页须经单一入口')

  // 聚焦页的近期动态行是平铺消费的徽标，也必须带上判据
  assert.match(cognition, /getObjectStatusDisplayLabel\(item\.type, status, locale, item\.pre_audit_passed\)/,
    '聚焦页近期动态行须传入 pre_audit_passed')

  // 聚焦卡的 ObjectItem 必须透传判据，否则共用的 ObjectCardFrame 算不出后缀
  assert.match(cognition, /pre_audit_passed: item\.card\.pre_audit_passed/,
    '聚焦卡须把 card 上的判据透传到 ObjectItem')
})

test('数据通路：两个类型都声明了 pre_audit_passed', () => {
  const api = read('src/utils/api.ts')
  // ObjectItem（列表卡）与 CognitionInboxCard（聚焦卡）各一处
  const occurrences = api.match(/pre_audit_passed\?: boolean/g) ?? []
  assert.ok(occurrences.length >= 3,
    `pre_audit_passed 须在 ObjectItem / CognitionInboxCard / CognitionRecentActivityItem 三处类型声明，实得 ${occurrences.length} 处`)
})

// ---------------------------------------------------------------------------
// 卡体「块的选择」一致性（2026-10-17）
//
// 徽标后缀恢复后，Human 仍指出「没有 changelog」——同一张待决定卡，徽标修好了、
// 流水仍缺。根因与上一条同类：**块的选择不同**，不是样式差异。
//
// 反面判据（此前已由 Human 2026-09-24 确立）：「聚焦里，待决定事项中的 wc card…
// 保持与 wc card 一样的显示」。既然列表卡的 pending_gate1 卡体有流水，聚焦的
// plan_confirmation 卡体就必须也有。
// ---------------------------------------------------------------------------

test('卡体一致性：列表卡的 pending_gate1 与聚焦的 plan_confirmation 都渲染变更流水', () => {
  const objectList = read('src/pages/ObjectList.tsx')
  const cognition = read('src/pages/CognitionCenter.tsx')

  // 列表卡 pending_gate1 分支 → 有 WorkCaseExecFlow（既有）
  const listPending = objectList.slice(
    objectList.indexOf("if (group === 'pending_gate1') {"),
    objectList.indexOf("if (group === 'executing') {"),
  )
  assert.match(listPending, /<WorkCaseExecFlow/, '列表卡 pending_gate1 卡体须有变更流水')

  // 聚焦 plan_confirmation 分支 → 也必须有（本次修复）
  const inboxPlan = cognition.slice(
    cognition.indexOf("if (item.inboxKind === 'plan_confirmation') {"),
    cognition.indexOf("if (item.inboxKind === 'closure_confirmation') {"),
  )
  assert.match(inboxPlan, /<WorkCaseExecFlow/, '聚焦 plan_confirmation 卡体须有变更流水（与列表卡同构）')
  assert.match(inboxPlan, /changeLog=\{item\.card\.change_log\}/, '须传入该卡的 change_log')
})
