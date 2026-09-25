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

test('ReadingLayout uses ONE fixed node sequence, never branching on the four derived groups', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // 2026-09-24（Human：「详情页面需要有统一的设计语言」）：本判据由「四分流存在」
  // **反转为「四分流不存在」**。依据 `docs/01 §1.10` 内容结构第 2 条：
  // 「只按字段是否实际存在省略节点，**不按状态或 Card 分组切换结构**」。
  //
  // 此前实现是 DraftBody/ExecutingBody/AwaitingGate2Body/ClosedBody 四套各拼一份，
  // 与上述规范条直接冲突；后果是同一字段在不同阶段出现在不同位置、甚至缺席
  // （`gate_1` 只在 closed 组出现，而 21 §8 规定它「批准后必填」，open 期本就有值）。
  for (const body of ['DraftBody', 'ExecutingBody', 'AwaitingGate2Body', 'ClosedBody']) {
    assert.doesNotMatch(layout, new RegExp(`function ${body}\\(`), `${body} 不应存在（已合并为单一序列）`);
  }
  // 单一正文序列存在
  assert.match(layout, /function WorkCaseBody\(/);
  // 且不按派生分组分支
  assert.doesNotMatch(
    layout,
    /group === '(pending_gate1|executing|awaiting_gate2|closed)'/,
    '正文不得按派生分组分支（docs/01 §1.10）',
  );
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
  // 结果草稿标记（关闭准备窗口）**不在 executing 分支**——2026-09-17 复核确认它是
  // 不可达代码：has_result_draft 为真 ⇔ 正文含「## 结果」节 ⇔ group=awaiting_gate2，
  // 而本组仅在 group=executing 时渲染，条件恒假。同一提示由 AwaitingGate2Body 承载。
  assert.doesNotMatch(
    layout,
    /workcaseResultDraftPresent/,
    'executing 分支不得再承载关闭准备窗口提示——该分支不可达，且其着色入参与所在分组不一致',
  );
  // 卡体内不再有派生分组提示行（Human 2026-09-19 定案：与卡头徽标同义，属冗余）。
  assert.doesNotMatch(
    layout,
    /workcaseAwaitingGate/,
    'ReadingLayout 不得再渲染派生分组提示行——分组语义由头部徽标承载',
  );
  // 计划判据经 WorkCaseCriteriaList 呈现。
  assert.match(layout, /PlanNode/);
  assert.match(layout, /WorkCaseCriteriaList/);
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
  const filter = readSource('web/src/components/WorkCaseProgressFilter.tsx');
  const locales = readSource('web/src/i18n/locales.ts');

  // 2026-09-17：分组词条的**唯一来源**是 OBJECT_STATUS_LOCALES.workcase——
  // 徽标（getObjectStatusLocale）、筛选器（getWorkCaseGroupLabel）与详情身份头部
  // 共用同一张表。此前筛选器另走 UI_LOCALES 的 objectList.workcaseGroup.* 平行词条，
  // 同一组字符串登记两处必然漂移，故该平行表已删除。
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'unknown']) {
    assert.match(
      locales,
      new RegExp(`\\b${group}: \\{ zh:`),
      `派生分组 ${group} 必须登记于类型专属表`,
    );
  }
  // 筛选器经共享取值函数读词条，不自行键拼。
  // 断言**调用点**而非 import——只匹配标识符会被「保留 import 但改回键拼」绕过
  // （该变异已实测逃逸一次，故此处收紧为调用形态）。
  assert.match(filter, /\{getWorkCaseGroupLabel\(group, locale\)\}/);
  assert.doesNotMatch(
    filter,
    /objectList\.workcaseGroup\.\$\{/,
    '筛选器不得自行拼分组键——分组词条必须经共享取值函数取，防两处漂移',
  );
  assert.doesNotMatch(
    locales,
    /'objectList\.workcaseGroup\./,
    '平行词条表必须已删除——分组词条单一来源，防两处漂移',
  );
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

test('reviews node renders the review summaries and is wired into every lifecycle body (21 §8)', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const api = readSource('web/src/utils/api.ts');
  const locales = readSource('web/src/i18n/locales.ts');
  const contract = readSource('web/api/services/factFieldContract.ts');

  // 字段与类型：reviews 是 {at, provider, model, summary} 数组（21 §8）。
  assert.match(api, /export interface WorkCaseReviewEntry/);
  assert.match(api, /reviews\?: WorkCaseReviewEntry\[\]/);
  assert.match(contract, /reviews: field\('workcase-reviews', 'array', false\)/);

  // 呈现：节点存在、读 obj.reviews、并经 ReadingNodeSection 落位（10 §5.3）。
  assert.match(layout, /function ReviewsNode\(/);
  assert.match(layout, /Array\.isArray\(obj\.reviews\)/);
  assert.match(layout, /entry\.summary/);
  // 2026-09-24：四套 body 合并为单一序列后，`ReviewsNode` **只接一次**——原先的
  // 「四个派生主体各接一次」（=4）是为防「某分组漏接 reviews」（2026-09-17
  // awaiting_gate2 曾漏接）；现在结构上不存在分组分支，漏接已不可能，
  // 故判据由「四次」改为「一次且不在任何分组分支内」，比原判据更强。
  assert.equal(
    (layout.match(/<ReviewsNode obj=\{obj\} locale=\{locale\} \/>/g) ?? []).length,
    1,
    'ReviewsNode 应恰接一次（单一序列）',
  );
  assert.doesNotMatch(
    layout,
    /group === '(pending_gate1|executing|awaiting_gate2|closed)'/,
    'ReviewsNode 不得再处于分组分支内',
  );

  // 词条：详情标题与列表组同源策略一致，须两地登记。
  assert.match(locales, /'objectDetail\.workcaseReviews'/);
  assert.match(layout, /objectDetail\.workcaseReviews/);
});
