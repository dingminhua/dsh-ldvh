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

// ---------------------------------------------------------------------------
// 全部 WC 卡须显示变更流水；已关闭默认收起（Human 2026-10-17）
//
// 覆盖要求是「全部」而非「部分」——此前逐条补（先列表卡、再聚焦卡）恰好暴露了
// 逐条补的坏处：补一处、漏一处，Human 不得不反复指出。故此处对**四个派生分组
// × 两个呈现面**逐分支断言，任何一处缺失都会红。
// ---------------------------------------------------------------------------

/** 截取一段源码：从 startMarker 到 endMarker（不含）。 */
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `未找到起点标记：${startMarker}`)
  const end = src.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `未找到终点标记：${endMarker}`)
  return src.slice(start, end)
}

test('覆盖：列表卡四个派生分组的卡体都渲染变更流水', () => {
  const objectList = read('src/pages/ObjectList.tsx')
  const body = sliceBetween(objectList, 'export function WorkCaseListCardBody', 'export function WorkCaseListCard(')
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2', 'closed']) {
    const marker = `if (group === '${group}') {`
    const nextMarker = group === 'closed'
      ? 'return (\n    <p className={`ldvh-card-decision-body'
      : `if (group === '`
    const block = sliceBetween(body, marker, nextMarker)
    assert.match(block, /<WorkCaseExecFlow/,
      `列表卡 ${group} 分组缺变更流水——「全部 WC 卡都要显示 changelog」`)
  }
})

test('覆盖：聚焦收件箱两个 WC 卡体都渲染变更流水', () => {
  const cognition = read('src/pages/CognitionCenter.tsx')
  const plan = sliceBetween(
    cognition,
    "if (item.inboxKind === 'plan_confirmation') {",
    "if (item.inboxKind === 'closure_confirmation') {",
  )
  assert.match(plan, /<WorkCaseExecFlow/, '聚焦 plan_confirmation 缺变更流水')

  const closure = sliceBetween(
    cognition,
    "if (item.inboxKind === 'closure_confirmation') {",
    '\n  }\n',
  )
  assert.match(closure, /<WorkCaseExecFlow/, '聚焦 closure_confirmation 缺变更流水')
})

test('收起：已关闭卡传 defaultCollapsed，其余分组不传（默认展开）', () => {
  const objectList = read('src/pages/ObjectList.tsx')
  const body = sliceBetween(objectList, 'export function WorkCaseListCardBody', 'export function WorkCaseListCard(')

  // closed 分支必须传 defaultCollapsed
  const closedBlock = sliceBetween(
    body,
    "if (group === 'closed') {",
    'return (\n    <p className={`ldvh-card-decision-body',
  )
  assert.match(closedBlock, /defaultCollapsed/, '已关闭卡的变更流水须默认收起')

  // 其余三组不得默认收起（它们是当下判断所需，铺开才可读）
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2']) {
    const block = sliceBetween(body, `if (group === '${group}') {`, 'if (group === ')
    assert.doesNotMatch(block, /defaultCollapsed\b/, `${group} 不应默认收起`)
  }
})

test('收起：组件支持整块收起并由 defaultCollapsed 决定初值', () => {
  const flow = read('src/components/WorkCaseExecFlow.tsx')
  assert.match(flow, /defaultCollapsed\?: boolean/, '须声明 defaultCollapsed 属性')
  assert.match(flow, /useState\(!defaultCollapsed\)/, '收起状态初值须取反 defaultCollapsed')
  // 收起时必须有可点的恢复入口，否则一旦收起就再也看不到
  assert.match(flow, /objectList\.workcaseFlowShow/, '收起态须给「显示 N 条变更流水」入口')
  assert.match(flow, /aria-expanded/, '展开/收起须有 aria 状态')
  // 点按钮不得顺带打开详情（卡片外层可点）
  assert.match(flow, /event\.stopPropagation\(\)/, '按钮须阻止冒泡，避免点展开时打开详情')
})

test('收起能力：所有派生分组都能收起，defaultCollapsed 只管初值不管能否收起 (2026-10-17)', () => {
  const flow = read('src/components/WorkCaseExecFlow.tsx')
  // 「收起变更流水」按钮**不得**被 defaultCollapsed 条件包裹——它必须是无条件渲染的。
  // 此前 `{defaultCollapsed && (<button …收起变更流水…>)}` 使除已关闭外根本无法收起：
  // Human 截图指出「这个是所有生命周期都要有的，只是已关闭是默认收起」。
  assert.doesNotMatch(
    flow,
    /\{defaultCollapsed\s*&&\s*\(\s*<div[\s\S]{0,400}?workcaseFlowHide/,
    '收起按钮不得以 defaultCollapsed 为渲染条件——收起能力须对所有派生分组一律提供',
  )
  // 正向断言：收起按钮存在，且位于 defaultCollapsed 判断之外
  assert.match(flow, /objectList\.workcaseFlowHide/, '须有「收起变更流水」按钮')
  const hideIdx = flow.indexOf('objectList.workcaseFlowHide')
  assert.ok(hideIdx > 0, '须有收起按钮')
  // 按钮之前最近的一次 `{defaultCollapsed &&` 不应把它包住
  const before = flow.slice(0, hideIdx)
  const lastCond = before.lastIndexOf('{defaultCollapsed &&')
  const lastClose = before.lastIndexOf(')}')
  assert.ok(lastCond < 0 || lastClose > lastCond,
    '收起按钮须在 defaultCollapsed 条件块之外（条件块已闭合）')
})
