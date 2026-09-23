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
import {
  workCaseCheckState,
  workCaseCheckLabelFor,
  workCaseCheckStateFromDraftStatus,
  workCaseCheckStateFromWord,
  workCaseDraftCheckRows,
  workCaseResultCheckRows,
} from '../../src/utils/workcaseCheckState.ts'

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

test('② 复核中：有「复核：」前缀条目且 reviews 尚未录入', () => {
  for (const s of [
    '复核：步骤 1–3 完成（③ 已证伪回退、①② 落地并变异验证）；复核已发起',
    '复核：录入独立复核概要（隔离子代理对抗复核）',
  ]) {
    assert.equal(
      deriveWorkCaseExecPhase('executing', undefined, [entry('计划步骤 1 完成'), entry(s)], UID),
      'reviewing',
      s,
    )
  }
})

test('② 复核中 → ④ 结项中：录入 reviews 后不再是复核中（防「只认发起」的浅判）', () => {
  const cl = [entry('复核：独立复核已发起')]
  assert.equal(deriveWorkCaseExecPhase('executing', undefined, cl, UID), 'reviewing')
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
})

test('② 判别力：含「复核」但无前缀，不算复核条目', () => {
  // 「复核 2 项必须处置全部落地」是修订动作、「更正执行节记账…复核与处置非计划步骤」
  // 是记账更正——都含「复核」却无前缀。旧实现按关键词把它们误标为复核，前缀判据下不成立。
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('复核 2 项必须处置全部落地')], UID),
    'executing',
  )
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('更正执行节记账——复核与处置非计划步骤')], UID),
    'executing',
  )
  // 加前缀才是复核条目
  assert.equal(
    deriveWorkCaseExecPhase('executing', undefined, [entry('复核：独立复核已发起')], UID),
    'reviewing',
  )
})

test('④ 结项中：reviews 存在且其后无本对象条目', () => {
  const cl = [entry('计划步骤 1 完成'), entry('复核：录入独立复核概要')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
})

test('③ 修订中：reviews 之后仍有本对象条目', () => {
  const cl = [entry('复核：录入独立复核概要'), entry('执行期记录（第二轮）：补回传通道')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('口径②：复核后条目若提及他对象，不参与本对象判定', () => {
  const cl = [entry('复核：录入独立复核概要'), entry('迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c）')]
  // 该条提及他对象 d5273e1c，而本对象是 UID=1c6afa19 → 应判结项中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, '1c6afa19'), 'closing')
  // 反证：若本对象就是 d5273e1c，则该条是自指，仍算本对象条目 → 修订中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('口径③：以「格式治理：」开头的条目不参与判定', () => {
  const cl = [entry('复核：录入独立复核概要'), entry('格式治理：摘要分块（忠实重排）——作者原文逐字未改')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'closing')
  // 反证：去掉前缀后同一文本会被算作修订（证明前缀确实在起作用）
  const cl2 = [entry('复核：录入独立复核概要'), entry('摘要分块（忠实重排）——作者原文逐字未改')]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl2, UID), 'revising')
})

test('口径①：判定按数组序，不受条目时间字段影响', () => {
  const later = { at: '2020-01-01T00:00:00.000Z', provider: 'p', model: 'm', summary: '执行期记录' }
  const cl = [entry('复核：录入独立复核概要'), later]
  // 即使后一条时间早于前一条，仍按数组序判为修订中
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')
})

test('他对象引用兼容空格与短横两种写法', () => {
  for (const ref of ['WorkCase 1c6afa19', 'workcase-1c6afa19']) {
    const cl = [entry('复核：录入独立复核概要'), entry(`迁移：${ref} 的字段`)]
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
  const cl = [entry('复核：录入独立复核概要'), own, other]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl, UID), 'revising')

  // 反向：数组序 [他对象(时间晚), 本对象(时间早)] 同样应跟数组序
  const cl2 = [entry('复核：录入独立复核概要'), other, own]
  assert.equal(deriveWorkCaseExecPhase('executing', [review], cl2, UID), 'revising')

  // 边界：after 只有他对象条目 → 结项中（排除生效）
  const cl3 = [entry('复核：录入独立复核概要'), other]
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
  const cl = [entry('复核：录入独立复核概要'), mid]
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

test('复核标记：「复核：」前缀', () => {
  for (const s of ['复核：独立复核已发起：隔离子代理', '复核：录入独立复核概要']) {
    assert.deepEqual(markWorkCaseFlow(undefined, [entry(s)], UID), ['review'], s)
  }
})

test('复核标记判别力：含「复核」但无前缀 → 不标复核', () => {
  for (const s of ['复核 2 项必须处置全部落地', '更正执行节记账——复核与处置非计划步骤']) {
    assert.deepEqual(markWorkCaseFlow(undefined, [entry(s)], UID), [null], s)
  }
})

test('修订标记：最后一条复核条目之后的本对象条目', () => {
  const cl = [entry('受控创建'), entry('复核：录入独立复核概要'), entry('执行期记录（第二轮）')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, 'review', 'revise'])
})

test('修订标记：无 reviews 时不得出现（未复核谈不上复核后修订）', () => {
  // 前缀条目仍标「复核」，但因其后无 reviews，绝不产出「修订」。
  const cl = [entry('受控创建'), entry('复核：录入独立复核概要')]
  assert.deepEqual(markWorkCaseFlow(undefined, cl, UID), [null, 'review'])

  // 判别力：前缀复核条目**之后**仍有条目，但无 reviews → 该条目不得标「修订」。
  // （若去掉 reviews 前提，这里会误判为 revise。）
  const cl2 = [entry('复核：录入独立复核概要'), entry('执行期记录（第二轮）')]
  assert.deepEqual(markWorkCaseFlow(undefined, cl2, UID), ['review', null])
})

test('口径②：他对象条目不标记（也不占用数组序）', () => {
  const cl = [entry('复核：录入独立复核概要'), entry('迁移：补齐字段（WorkCase 1c6afa19）')]
  // 他对象条目既不是 review 也不是 revise
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), ['review', null])
})

test('口径③：格式治理条目不标记', () => {
  const cl = [entry('复核：录入独立复核概要'), entry('格式治理：摘要分块（忠实重排）')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), ['review', null])
})

test('ownChangeLogEntries：逐项返回原始下标（供流水渲染对齐）', () => {
  const cl = [entry('受控创建'), entry('迁移：他对象（WorkCase 1c6afa19）'), entry('计划步骤 1 完成')]
  const own = ownChangeLogEntries(cl, UID)
  assert.deepEqual(own.map((o) => o.index), [0, 2])
})

test('markWorkCaseFlow 判别力：复核在中间 + 其后两条 → 一条 review、两条 revise', () => {
  // 修订标记需 reviews 非空（未复核谈不上复核后修订），故此处传入 review。
  const cl = [entry('a'), entry('复核：录入独立复核概要'), entry('b'), entry('c')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, 'review', 'revise', 'revise'])
})

test('判别力：复核条目在【末尾】时其后无 revise', () => {
  const cl = [entry('a'), entry('b'), entry('复核：录入独立复核概要')]
  assert.deepEqual(markWorkCaseFlow([review], cl, UID), [null, null, 'review'])
})

test('复核标记判别力：前缀必须在**开头**，中间出现不算', () => {
  // 21 §8 规定「以『复核：』开头」。中间出现「复核：」的句子不是复核条目
  // （如「补记：复核：…已被处置」这类叙述），按 includes 会误标。
  assert.deepEqual(
    markWorkCaseFlow(undefined, [entry('计划步骤 4 补记：复核：该结论已并入正文')], UID),
    [null],
  )
})

// 三态映射的**输入域**契约：解析器枚举（英文）与正文词表（中文）是两条不同的入口，
// 混用会让整卡落成「未记录」。
//
// 为什么需要这条守卫（2026-09-24 实测踩到）：把 `WorkCaseCheckStatus`（`achieved`
// / `partial` / `not-achieved`）丢给按**中文词**判定的 `workCaseCheckStateFromWord`，
// 因枚举不含中文而全部返回 `unknown`——「待批准关闭」卡上每条核对都显示「未记录」，
// 而 338 项测试全绿（当时没有任何用例区分这两个输入域）。
test('三态映射：枚举入口与词表入口不可互换', () => {
  // 枚举入口（解析器输出，英文值）。
  assert.equal(workCaseCheckStateFromDraftStatus('achieved'), 'satisfied');
  assert.equal(workCaseCheckStateFromDraftStatus('partial'), 'partial');
  assert.equal(workCaseCheckStateFromDraftStatus('not-achieved'), 'unsatisfied');
  assert.equal(workCaseCheckStateFromDraftStatus(null), 'unknown');
  assert.equal(workCaseCheckStateFromDraftStatus(undefined), 'unknown');

  // 词表入口（正文三词，中文）。
  assert.equal(workCaseCheckStateFromWord('达成'), 'satisfied');
  assert.equal(workCaseCheckStateFromWord('部分达成'), 'partial');
  assert.equal(workCaseCheckStateFromWord('未达成'), 'unsatisfied');
  assert.equal(workCaseCheckStateFromWord(null), 'unknown');

  // **判别力**：枚举值不是中文词，故词表入口对枚举必然落空——这正是两者不可互换的
  // 理由，也锁住了「有人把枚举改喂词表入口」这一回归。
  assert.equal(workCaseCheckStateFromWord('achieved'), 'unknown');
  assert.equal(workCaseCheckStateFromWord('partial'), 'unknown');
  assert.equal(workCaseCheckStateFromWord('not-achieved'), 'unknown');
});

test('三态映射：布尔入口与词表入口对同一语义给同一词', () => {
  const t = (key: string) => key;
  // 布尔 true 与词表「达成」必须落到同一词条（21 §8 登记的映射：达成 ⇔ true）。
  assert.equal(workCaseCheckState(true), workCaseCheckStateFromWord('达成'));
  assert.equal(workCaseCheckState(false), workCaseCheckStateFromWord('未达成'));
  assert.equal(workCaseCheckState(undefined), workCaseCheckStateFromWord(null));
  // 「部分达成」在布尔域无对应值（21 §8：部分达成 ⇔ false）——它只能来自词表域，
  // 且不得与「未达成」合并（两者去向不同，见 21 §9.3）。
  assert.notEqual(workCaseCheckStateFromWord('部分达成'), workCaseCheckStateFromWord('未达成'));
  assert.equal(workCaseCheckStateFromWord('部分达成'), 'partial');
  // 词条解析经共享单点，不得自造。
  assert.equal(workCaseCheckLabelFor('satisfied', t as never), 'objectList.workcaseCheck.achieved');
});

// 核对行的**配对与状态映射**契约（纯函数，可直接断言）。
//
// 为什么需要（2026-09-24 实测教训）：枚举→状态名的映射原先内联在组件 JSX 里，
// 把枚举误喂给按中文词判定的入口时，「待批准关闭」卡上每条核对都显示「未记录」，
// 而当时的 340 项测试全绿——组件的 JSX 不在 node:test 的可达范围内。抽成纯函数后
// 该映射有了行为覆盖。
test('核对行：枚举入口不得落成「未记录」（回归守卫）', () => {
  const plan = [{ step: '甲' }, { step: '乙' }, { step: '丙' }];
  const rows = workCaseDraftCheckRows(
    [
      { planIndex: 0, status: 'achieved' },
      { planIndex: 1, status: 'partial' },
      { planIndex: 2, status: 'not-achieved' },
    ],
    plan,
  );
  assert.deepEqual(rows.map((r) => r.state), ['satisfied', 'partial', 'unsatisfied']);
  assert.deepEqual(rows.map((r) => r.title), ['甲', '乙', '丙']);
  // 判别力：若误用按中文词判定的入口，三行都会是 unknown（这正是被修掉的缺陷）。
  assert.ok(rows.every((r) => r.state !== 'unknown'), '枚举输入不得落成 unknown');
});

test('核对行：closed 的布尔入口', () => {
  const plan = [{ step: '甲' }, { step: '乙' }, { step: '丙' }];
  // 三态**逐一**覆盖：只有 true/false 两值时，把状态写死成 satisfied 的变异不会被
  // 捕获（2026-09-24 实测：该变异首轮逃逸，补上 false 与 undefined 后才拦住）。
  const rows = workCaseResultCheckRows(
    [{ satisfied: true }, { satisfied: false }, { satisfied: undefined }],
    plan,
  );
  assert.deepEqual(rows.map((r) => r.state), ['satisfied', 'unsatisfied', 'unknown']);
  assert.deepEqual(rows.map((r) => r.title), ['甲', '乙', '丙']);
  // 缺失 satisfied ⇒ unknown（「未记录」），不得与 false 合并（21 §9.3）。
  const unknown = workCaseResultCheckRows([{ satisfied: undefined }], plan);
  assert.deepEqual(unknown.map((r) => r.state), ['unknown']);
  assert.notEqual(unknown[0].state, 'unsatisfied');
});

test('核对行：标题缺失的行不产出（不猜、不错位）', () => {
  // plan 只有 2 步却有 3 条核对：第 3 条配不上，不产出（调用方按「无对应条目」呈现）。
  const rows = workCaseResultCheckRows(
    [{ satisfied: true }, { satisfied: true }, { satisfied: true }],
    [{ step: '甲' }, { step: '乙' }],
  );
  assert.equal(rows.length, 2);
  // plan 步标题为空串 ⇒ 该行不产出（空标题无从呈现）。
  const blank = workCaseResultCheckRows([{ satisfied: true }], [{ step: '   ' }]);
  assert.equal(blank.length, 0);
  // planIndex 越界（-1 / 超界）⇒ 不产出。
  assert.equal(workCaseDraftCheckRows([{ planIndex: -1, status: 'achieved' }], [{ step: '甲' }]).length, 0);
  assert.equal(workCaseDraftCheckRows([{ planIndex: 5, status: 'achieved' }], [{ step: '甲' }]).length, 0);
  // 无 plan / 无 checks ⇒ 空数组，不抛错。
  assert.deepEqual(workCaseResultCheckRows(undefined, undefined), []);
  assert.deepEqual(workCaseDraftCheckRows(undefined, [{ step: '甲' }]), []);
});
