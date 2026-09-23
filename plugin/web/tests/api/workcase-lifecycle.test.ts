import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WORKCASE_V5_STATUSES,
  WORKCASE_V5_OUTCOMES,
  WORKCASE_V5_FILTER_VALUES,
  WORKCASE_EXEC_PHASES,
  bodyHasResultSection,
  deriveWorkCaseV5View,
  deriveWorkCaseExecPhase,
  WORKCASE_FLOW_MARKS,
  markWorkCaseFlow,
  ownChangeLogEntries,
} from '../../shared/workcaseLifecycle.ts'

const FP = 'a'.repeat(64)

test('三态闭集常量与筛选五档常量', () => {
  assert.deepEqual([...WORKCASE_V5_STATUSES], ['draft', 'open', 'closed'])
  assert.deepEqual([...WORKCASE_V5_OUTCOMES], ['completed', 'partial', 'not-achieved', 'cancelled'])
  assert.deepEqual([...WORKCASE_V5_FILTER_VALUES], ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'all'])
})

test('draft 派生为 pending_gate1（等同 Gate 1 待批）', () => {
  const view = deriveWorkCaseV5View('draft', null, '', FP)
  assert.equal(view.resolution, 'resolved')
  assert.equal(view.status, 'draft')
  assert.equal(view.group, 'pending_gate1')
  assert.equal(view.outcome, null)
  assert.equal(view.has_result_draft, false)
})

test('open 无结果节 → executing', () => {
  const view = deriveWorkCaseV5View('open', null, '# 执行\n正文', FP)
  assert.equal(view.resolution, 'resolved')
  assert.equal(view.status, 'open')
  assert.equal(view.group, 'executing')
  assert.equal(view.has_result_draft, false)
})

test('open 含结果节 → awaiting_gate2 + has_result_draft=true', () => {
  const body = '# 执行\n做了一些事\n\n## 结果\n\n目标已完成。'
  const view = deriveWorkCaseV5View('open', null, body, FP)
  assert.equal(view.resolution, 'resolved')
  assert.equal(view.status, 'open')
  assert.equal(view.group, 'awaiting_gate2')
  assert.equal(view.has_result_draft, true)
})

test('closed 四 outcome 校验', () => {
  for (const outcome of WORKCASE_V5_OUTCOMES) {
    const view = deriveWorkCaseV5View('closed', outcome, '', FP)
    assert.equal(view.resolution, 'resolved')
    assert.equal(view.group, 'closed')
    assert.equal(view.outcome, outcome)
  }
})

test('closed + 非法 outcome → outcome 降级为 null，但仍是 resolved', () => {
  const view = deriveWorkCaseV5View('closed', 'weird', '', FP)
  assert.equal(view.resolution, 'resolved')
  assert.equal(view.group, 'closed')
  assert.equal(view.outcome, null)
})

test('bodyHasResultSection：围栏内的 ## 结果 不算', () => {
  const body = '## 执行\n```\n## 结果\n这是代码块里的文本\n```\n\n# 结尾'
  assert.equal(bodyHasResultSection(body), false)
})

test('bodyHasResultSection：缩进容错与行尾空白', () => {
  assert.equal(bodyHasResultSection('   ## 结果   '), true)
  assert.equal(bodyHasResultSection('   ## 结果'), true)
  assert.equal(bodyHasResultSection('## 结果 '), true)
})

test('bodyHasResultSection：仅更深层级或无关标题不算', () => {
  assert.equal(bodyHasResultSection('### 结果'), false)
  assert.equal(bodyHasResultSection('## 执行'), false)
  assert.equal(bodyHasResultSection(''), false)
  assert.equal(bodyHasResultSection(null), false)
  assert.equal(bodyHasResultSection(undefined), false)
})

test('bodyHasResultSection：围栏后再次出现真实结果节算数', () => {
  const body = '```\n## 结果\n```\n\n## 结果'
  assert.equal(bodyHasResultSection(body), true)
})

test('fingerprint 非法 → null，但不影响 resolution', () => {
  const view = deriveWorkCaseV5View('draft', null, '', 'not-a-hex')
  assert.equal(view.resolution, 'resolved')
  assert.equal(view.fingerprint, null)
})

test('status 非三态 → unresolved(unsupported_status)', () => {
  const view = deriveWorkCaseV5View('blocked', null, '', FP)
  assert.equal(view.resolution, 'unresolved')
  assert.equal(view.reason, 'unsupported_status')
  assert.equal(view.status, null)
  assert.equal(view.group, null)
})

// ============================================================================
// 执行期四阶段（10 §5.5「执行期阶段」）
// ============================================================================

const UID = 'd5273e1c'
const entry = (summary: string) => ({ at: '2026-09-23T00:00:00.000Z', provider: 'p', model: 'm', summary })
const review = { at: '2026-09-23T00:00:00.000Z', provider: 'p', model: 'm', summary: '复核结论' }

test('阶段常量闭集四值', () => {
  assert.deepEqual([...WORKCASE_EXEC_PHASES], ['executing', 'reviewing', 'revising', 'closing'])
})

test('非 executing 分组不派生阶段', () => {
  assert.equal(deriveWorkCaseExecPhase('pending_gate1', undefined, [], UID), null)
  assert.equal(deriveWorkCaseExecPhase('awaiting_gate2', [review], [], UID), null)
  assert.equal(deriveWorkCaseExecPhase('closed', [review], [], UID), null)
  assert.equal(deriveWorkCaseExecPhase(null, undefined, [], UID), null)
})

test('① 执行中：无 reviews 且无复核发起条目', () => {
  assert.equal(deriveWorkCaseExecPhase('executing', undefined, [entry('计划步骤 1 完成')], UID), 'executing')
  assert.equal(deriveWorkCaseExecPhase('executing', [], [], UID), 'executing')
})

test('② 复核中：有复核发起条目且 reviews 尚未录入（兼容既有写法）', () => {
  // 既有写法两种，均在 21 §8 纪律覆盖内（摘要含「复核」+「发起」二词）
  for (const s of [
    '步骤 1–3 完成（③ 已证伪回退、①② 落地并变异验证）；复核已发起',
    '步骤 1–8 完成、提交 48d1264；独立复核已发起',
  ]) {
    assert.equal(
      deriveWorkCaseExecPhase('executing', undefined, [entry('计划步骤 1 完成'), entry(s)], UID),
      'reviewing',
      s,
    )
  }
})

test('② 复核中 → ④ 结项中：录入 reviews 后不再是复核中（防「只认发起」的浅判）', () => {
  const cl = [entry('独立复核已发起')]
  assert.equal(deriveWorkCaseExecPhase('executing', undefined, cl, UID), 'reviewing')
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
})

test('② 判别力：只含「复核」或只含「发起」都不算发起条目', () => {
  // 只含「复核」——如 d5273e1c 的「录入独立复核概要」，那是复核完成而非发起
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('录入独立复核概要')], UID),
    'executing',
  )
  // 只含「发起」——如「发起 Gate 2 提请」，与复核无关
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('发起 Gate 2 提请')], UID),
    'executing',
  )
  // 二词齐全才算（这是判据的最小形态）
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('复核已发起')], UID),
    'reviewing',
  )
})

test('④ 结项中：reviews 存在且其后无本对象条目', () => {
  const cl = [entry('计划步骤 1 完成'), entry('录入独立复核概要')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
})

test('③ 修订中：reviews 之后仍有本对象条目', () => {
  const cl = [entry('录入独立复核概要'), entry('执行期记录（第二轮）：补回传通道')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('口径②：复核后条目若提及他对象，不参与本对象判定', () => {
  const cl = [entry('录入独立复核概要'), entry('迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c）')]
  // 该条提及他对象 d5273e1c，而本对象是 UID=1c6afa19 → 应判结项中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, '1c6afa19'), 'closing')
  // 反证：若本对象就是 d5273e1c，则该条是自指，仍算本对象条目 → 修订中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('口径③：以「格式治理：」开头的条目不参与判定', () => {
  const cl = [entry('录入独立复核概要'), entry('格式治理：摘要分块（忠实重排）——作者原文逐字未改')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
  // 反证：去掉前缀后同一文本会被算作修订（证明前缀确实在起作用）
  const cl2 = [entry('录入独立复核概要'), entry('摘要分块（忠实重排）——作者原文逐字未改')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl2, UID), 'revising')
})

test('口径①：判定按数组序，不受条目时间字段影响', () => {
  const later = { at: '2020-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '执行期记录' }
  const cl = [entry('录入独立复核概要'), later]
  // 即使后一条时间早于前一条，仍按数组序判为修订中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('他对象引用兼容空格与短横两种写法', () => {
  for (const ref of ['WorkCase 1c6afa19', 'workcase-1c6afa19']) {
    const cl = [entry('录入独立复核概要'), entry(`迁移：${ref} 的字段`)]
    assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing', ref)
  }
})

test('口径①（判别力）：after 含多条且顺序与时间相反时，结论必须跟数组序', () => {
  // after 两条：数组序 [本对象(时间早), 他对象(时间晚)]
  // · 正解（按数组序全量过滤）→ 排除他对象后仍有本对象条目 → 修订中
  // · 错误实现（取时间最新一条）→ 取到他对象条目 → 被排除 → 结项中
  // 故本用例对「按时间序」的实现有判别力（单元素数组的排序是空操作，不可区分）。
  const own = { at: '2020-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '执行期记录（第二轮）' }
  const other = { at: '2030-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '迁移：补齐字段（WorkCase 1c6afa19）' }
  const cl = [entry('录入独立复核概要'), own, other]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')

  // 反向：数组序 [他对象(时间晚), 本对象(时间早)] 同样应跟数组序
  const cl2 = [entry('录入独立复核概要'), other, own]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl2, UID), 'revising')

  // 边界：after 只有他对象条目 → 结项中（排除生效）
  const cl3 = [entry('录入独立复核概要'), other]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl3, UID), 'closing')
})

test('口径①（判别力·多复核条目）：lastReviewAt 必须按数组序取最后一条，而非按时间取最新', () => {
  // 两条复核类条目，数组序在后的那条 at 更早（时间倒序）。
  // · 正解（数组序取最后一条复核条目）：最后复核在第 2 位 → 其后仅他对象条目 → 结项中
  // · 错误实现（取 at 最大的复核条目）：会取第 1 位那条 → 其后含本对象条目 → 修订中
  const revOld = { at: '2030-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '复核 2 项必须处置已落地' }
  const revNew = { at: '2020-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '复核处置完成' }
  const other = { at: '2020-06-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '迁移：补齐字段（WorkCase 1c6afa19）' }
  const cl = [revOld, revNew, other]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
})

test('口径③（判别力·前缀位置）：豁免只认【以】「格式治理：」开头，不认中间出现', () => {
  // 摘要【中间】出现「格式治理：」但并非以它开头 → 仍是本对象条目，应算修订中。
  // 该用例对 startsWith → includes 的弱化变异有判别力。
  const mid = { at: '2026-09-23T00:00:00.000Z', provider: 'p', model: 'm',
                summary: '计划步骤 4 补记：格式治理：摘要分块已完成' }
  const cl = [entry('录入独立复核概要'), mid]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

// ============================================================================
// 变更流水的行动标记（10 §5.5 的呈现代替品，Human 2026-09-23）
// ============================================================================

test('流水标记闭集二值', () => {
  assert.deepEqual([...WORKCASE_FLOW_MARKS], ['review', 'revise'])
})

test('标记与输入逐项对应（长度一致，无标记为 null）', () => {
  const cl = [entry('受控创建'), entry('计划步骤 1 完成')]
  const marks = markWorkCaseFlow(undefined, cl, UID)
  assert.equal(marks.length, cl.length)
  assert.deepEqual(marks, [null, null])
})

test('复核标记：机械标记优先（[review recorded by session]）', () => {
  const cl = [entry('端到端演练 [review recorded by session abc; reviews entries: 1]')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), ['review'])
})

test('复核标记：措辞兜底（同含「复核」+「发起」）', () => {
  for (const s of ['复核已发起', '独立复核已发起：隔离子代理']) {
    assert.deepEqual(markWorkCaseFlow(undefined, [entry(s)], UID), ['review'], s)
  }
})

test('修订标记：最后一条复核条目之后的本对象条目', () => {
  const cl = [entry('受控创建'), entry('录入独立复核概要'), entry('执行期记录（第二轮）')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, 'review', 'revise'])
})

test('修订标记：无 reviews 时不得出现（未复核谈不上复核后修订）', () => {
  const cl = [entry('受控创建'), entry('录入独立复核概要')]
  assert.deepEqual(markWorkCaseFlow(undefined, cl, UID), [null, null])
})

test('口径②：他对象条目不标记（也不占用数组序）', () => {
  const cl = [entry('录入独立复核概要'), entry('迁移：补齐字段（WorkCase 1c6afa19）')]
  // 他对象条目既不是 review 也不是 revise
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), ['review', null])
})

test('口径③：格式治理条目不标记', () => {
  const cl = [entry('录入独立复核概要'), entry('格式治理：摘要分块（忠实重排）')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), ['review', null])
})

test('ownChangeLogEntries：逐项返回原始下标（供流水渲染对齐）', () => {
  const cl = [entry('受控创建'), entry('迁移：他对象（WorkCase 1c6afa19）'), entry('计划步骤 1 完成')]
  const own = ownChangeLogEntries(cl, UID)
  assert.deepEqual(own.map((o) => o.index), [0, 2])
})

test('markWorkCaseFlow 判别力：复核在中间 + 其后两条 → 一条 review、两条 revise', () => {
  // 修订标记需 reviews 非空（未复核谈不上复核后修订），故此处传入 review。
  const cl = [entry('a'), entry('录入独立复核概要'), entry('b'), entry('c')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, 'review', 'revise', 'revise'])
})

test('判别力：复核条目在【末尾】时其后无 revise', () => {
  const cl = [entry('a'), entry('b'), entry('录入独立复核概要')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, null, 'review'])
})
