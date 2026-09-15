// WorkCase 详情呈现契约（v5，21 号三态直读）——源码形态断言。
//
// 本文件断言 WorkCase 详情阅读面（ReadingLayout v5 重写后）的形态：
//   1. 按 21 号派生 group 四分流（draft/executing/awaiting_gate2/closed），
//      不再有 v4 的 phase 分流与 12 段 marker 顺序；
//   2. closed 呈现 outcome 四值徽标 + result.criteria_checks 逐条核对 + gate_1 授权；
//   3. open 呈现 attempt 执行现场（controller/attempt_id/heartbeat_at）；
//   4. draft 呈现计划判据与「待 Gate 1 批准」标识；
//   5. identity 与列表组同源（共用 objectList.workcaseGroup.* 词条）；
//   6. 详情源不消费 v4 字段、不调用列表 fetchObjects('workcase')；
//   7. 详情字段问题（field issues）在 ObjectDetail 层就地显示。
// 测试断言规格本身，不弱化断言凑绿；v4 的 12 marker 顺序契约已随 phase 分流退役。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

test('ReadingLayout branches on the four derived groups, never on v4 phases', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  for (const body of ['DraftBody', 'ExecutingBody', 'AwaitingGate2Body', 'ClosedBody']) {
    assert.match(layout, new RegExp(`function ${body}\\(`), `${body} 必须存在`);
  }
  // 四分流按派生 group，非 status/phase switch（v4 形态禁止）。
  assert.match(layout, /group === 'pending_gate1' && <DraftBody/);
  assert.match(layout, /group === 'executing' && <ExecutingBody/);
  assert.match(layout, /group === 'awaiting_gate2' && <AwaitingGate2Body/);
  assert.match(layout, /group === 'closed' && <ClosedBody/);
  assert.doesNotMatch(layout, /obj\.phase|switch\s*\([^)]*phase/);
});

test('closed detail exposes outcome badge, per-criterion checks, and gate_1 authorization', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  // outcome 四值徽标（OUTCOME_LABEL_KEY 是 WorkCaseV5Outcome 全键 Record）。
  assert.match(layout, /Record<WorkCaseV5Outcome,/);
  // 判据逐条核对（criteria_checks 过 WorkCaseCriteriaList 轻对象）。
  assert.match(layout, /result\.criteria_checks/);
  assert.match(layout, /WorkCaseCriteriaList/);
  // 已证实范围与残留责任可见。
  assert.match(layout, /workcaseAchievedScope/);
  assert.match(layout, /workcaseResidual/);
  // Gate 1 授权信息（批准人/时间）。
  assert.match(layout, /workcaseGate1Approver/);
  assert.match(layout, /workcaseGate1ApprovedAt/);
});

test('open detail exposes the attempt execution scene; draft awaits Gate 1', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  // attempt 现场三字段。
  assert.match(layout, /attempt\.controller/);
  assert.match(layout, /attempt\.attempt_id/);
  assert.match(layout, /attempt\.heartbeat_at/);
  // 结果草稿标记（关闭准备窗口）。
  assert.match(layout, /has_result_draft/);
  assert.match(layout, /workcaseResultDraftPresent/);
  // draft 的待批准标识。
  assert.match(layout, /workcaseAwaitingGate1/);
  // 计划判据经 WorkCaseCriteriaList 呈现。
  assert.match(layout, /PlanList/);
});

test('ReadingLayout consumes only 21-spec fields — v4 field vocabulary is absent', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const objectDetail = readSource('web/src/pages/ObjectDetail.tsx');
  const panel = readSource('web/src/components/reading-panel/PanelContent.tsx');
  const retired = /success_criterion_definitions|success_criterion_results|work_items|closure_proposal|closure_outcome|execution_authorization|execution_approval|creation_reviews|plan_version|result_version|validation_summary|blocking_summary|termination\b|waiting_on|resume_from|disposition_summary|obj\.goal\b/;
  assert.doesNotMatch(layout, retired);
  assert.doesNotMatch(objectDetail, /fetchObjects\(['"]workcase['"]\)/);
  assert.doesNotMatch(panel, /fetchObjects\(['"]workcase['"]\)/);
  // 详情重建 YAML 供精确引用（保留既有契约）。
  assert.match(objectDetail, /reconstructFactYaml\(obj\)/);
});

test('detail identity uses the same group labels as the list filter (one source)', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const locales = readSource('web/src/i18n/locales.ts');
  // GROUP_LABEL_KEY 的四组词条与筛选器同 key（objectList.workcaseGroup.*）。
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2', 'closed']) {
    assert.match(layout, new RegExp(`objectList\\.workcaseGroup\\.${group}`));
    assert.match(locales, new RegExp(`'objectList\\.workcaseGroup\\.${group}'`));
  }
  // unknown 组有回落词条。
  assert.match(layout, /objectList\.workcaseGroup\.unknown/);
});

test('field-level issues surface in place inside the WorkCase reading flow', () => {
  const objectDetail = readSource('web/src/pages/ObjectDetail.tsx');
  const fieldIssues = readSource('web/src/pages/object-detail/fieldIssues.ts');
  // ObjectDetail 层消费 fieldIssues（就地显示，不做记录完备性噪音）。
  assert.match(objectDetail, /fieldIssue/);
  assert.match(fieldIssues, /export function fieldIssue/);
});

test('criteria use light objects in detail while the Card keeps its compact bullet list', () => {
  const criteriaList = readSource('web/src/components/WorkCaseCriteriaList.tsx');
  // 轻对象：每条 {key, statement}（列表卡片与详情共用，喂 v5 plan/criteria_checks）。
  assert.match(criteriaList, /WorkCaseCriterionListItem/);
  assert.match(criteriaList, /statement\.trim\(\)/);
});
