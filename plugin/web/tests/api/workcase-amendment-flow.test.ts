// 增量审批在**流水**里的判定逻辑（21 §14；10 §5.5）。
//
// 三条判定都必须机械可靠，因为呈现层据此显示"这一单在等谁"：
//   ① pendingAmendment —— 判据是「**末项**无 decision」（不是"存在无 decision"）；
//   ② amendmentMarkOf —— 决定标记由 writer 发出的方括号判定（不是措辞约定）；
//   ③ approvedAmendmentSteps —— 详情面据此给"后来追加的步骤"打标（逐字匹配）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  amendmentMarkOf,
  approvedAmendmentSteps,
  markWorkCaseFlow,
  pendingAmendment,
} from '../../shared/workcaseLifecycle.ts';

test('pendingAmendment：只有**末项**无 decision 才算待批（10 §5.5 的判据）', () => {
  assert.equal(pendingAmendment(undefined), null);
  assert.equal(pendingAmendment([]), null);
  assert.equal(pendingAmendment([{ decision: { kind: 'approved' } }]), null, '全部已决定 → 无待批');
  const pending = { requested_at: 'x', items: [{ step: 's' }] };
  assert.equal(pendingAmendment([pending]), pending, '唯一一条且未决定 → 待批');
  assert.equal(
    pendingAmendment([{ decision: { kind: 'rejected' } }, pending]),
    pending,
    '末项未决定 → 待批',
  );
  assert.equal(
    pendingAmendment([pending, { decision: { kind: 'approved' } }]),
    null,
    '非末项未决定**不算**待批（与校验器的"待批必须在末位"同口径）',
  );
});

test('amendmentMarkOf：决定标记取 writer 的机械方括号，两种决定各归其位', () => {
  assert.equal(amendmentMarkOf('增量审批：Human 批准 [adjustment approved by LaoDing; plan +1]'), 'adjustment-approved');
  assert.equal(amendmentMarkOf('增量审批：Human 拒绝 [adjustment rejected by LaoDing; plan/scope unchanged]'), 'adjustment-rejected');
  assert.equal(amendmentMarkOf('登记一条增量审批申请（待批） [adjustment requested; amendments: 1; pending]'), null, '申请本身不是决定');
  assert.equal(amendmentMarkOf('普通的一条执行记录'), null);
  assert.equal(amendmentMarkOf(undefined), null);
});

test('markWorkCaseFlow：决定标记优先于「修订」，且不影响复核标记', () => {
  const entries = [
    { at: '2026-09-30T01:00:00.000Z', summary: '记录一条复核结论 [review recorded by session s-1]' },
    { at: '2026-09-30T02:00:00.000Z', summary: '增量审批：Human 批准 [adjustment approved by H; plan +1]' },
    { at: '2026-09-30T03:00:00.000Z', summary: '增量审批：Human 拒绝 [adjustment rejected by H; plan/scope unchanged]' },
    { at: '2026-09-30T04:00:00.000Z', summary: '执行记录' },
  ];
  const marks = markWorkCaseFlow([{ at: '2026-09-30T01:00:00.000Z', summary: '记录一条复核结论' }], entries, null);
  assert.equal(marks[0], 'review');
  assert.equal(marks[1], 'adjustment-approved', '决定标记不得被"复核之后即修订"吞掉');
  assert.equal(marks[2], 'adjustment-rejected');
  assert.equal(marks[3], 'revise', '普通条目仍按既有规则判为修订');
});

test('approvedAmendmentSteps：只收**已批准**条目的 step，逐字返回（供详情面打标）', () => {
  const amendments = [
    { items: [{ step: '被拒绝的一步' }], decision: { kind: 'rejected' } },
    { items: [{ step: '被批准的一步' }, { step: '同批的另一步' }], decision: { kind: 'approved' } },
    { items: [{ step: '待批的一步' }] },
  ];
  assert.deepEqual(approvedAmendmentSteps(amendments), ['被批准的一步', '同批的另一步']);
  assert.deepEqual(approvedAmendmentSteps(undefined), []);
  assert.deepEqual(approvedAmendmentSteps([{ items: 'bad', decision: { kind: 'approved' } }]), []);
});
