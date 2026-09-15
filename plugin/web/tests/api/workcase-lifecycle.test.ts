import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WORKCASE_V5_STATUSES,
  WORKCASE_V5_OUTCOMES,
  WORKCASE_V5_FILTER_VALUES,
  bodyHasResultSection,
  deriveWorkCaseV5View,
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
