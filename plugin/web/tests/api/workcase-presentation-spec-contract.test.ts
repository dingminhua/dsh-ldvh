import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// v5 规范载体迁移：WorkCase 外部卡片的呈现契约（进展分组、四步结果、plan_revising、
// plan_confirmation / closure_confirmation 输入区）由代码模块强制承载，不再依赖 v4
// 归档的 `specs/08-Web 呈现与交互规范.md` 等编号文件。以下断言从实际代码模块自洽，
// 与既有第 5-8 个测试的代码自洽模式保持一致。
const WEB_DIR = path.resolve(import.meta.dirname, '../..');

/** 读取 plugin/web 下源码；容忍可选 `web/` 前缀（旧式指向仓库根的来源）。 */
function readWebSource(relativePath: string): string {
  const clean = relativePath.startsWith('web/') ? relativePath.slice('web/'.length) : relativePath;
  return fs.readFileSync(path.join(WEB_DIR, clean), 'utf8');
}

/** 进展分组闭集与顺序是唯一强来源（shared/workcaseStatus.ts），五个值一字不差。 */
function progressGroupsViaStatus(): readonly string[] {
  const workflow = readWebSource('shared/workcaseStatus.ts');
  const block = workflow.match(/WORKCASE_PROGRESS_GROUP_ORDER = \[[\s\S]*?\n\] as const/);
  assert.ok(block, 'workcaseStatus.ts must declare WORKCASE_PROGRESS_GROUP_ORDER');
  return (block[0].match(/'([^']+)'/g) ?? []).map((token) => token.replace(/'/g, ''));
}

/** 四步结果闭集与顺序是唯一强来源（shared/workcaseStatus.ts）。 */
function progressStepsViaStatus(): readonly string[] {
  const workflow = readWebSource('shared/workcaseStatus.ts');
  const block = workflow.match(/WORKCASE_PROGRESS_STEP_ORDER = \[[\s\S]*?\n\] as const/);
  assert.ok(block, 'workcaseStatus.ts must declare WORKCASE_PROGRESS_STEP_ORDER');
  return (block[0].match(/'([^']+)'/g) ?? []).map((token) => token.replace(/'/g, ''));
}

/** 进展分组到中文标题的映射唯一来源于 locales.ts 的 progressGroup 段。 */
function progressGroupLocales(): Map<string, { zh: string; en: string }> {
  const locales = readWebSource('src/i18n/locales.ts');
  const result = new Map<string, { zh: string; en: string }>();
  for (const key of ['plan_confirmation', 'progressing', 'termination_cleanup', 'closure_confirmation', 'closed']) {
    const m = locales.match(new RegExp(`${key}: \\{ zh: '([^']+)', en: '([^']+)' \\}`));
    assert.ok(m, `locales.ts must carry ${key} progress-group label`);
    result.set(key, { zh: m[1], en: m[2] });
  }
  return result;
}

test('progress groups are a closed five-value set with ordered four-step result track', () => {
  const groups = progressGroupsViaStatus();
  assert.deepEqual(groups, ['plan_confirmation', 'progressing', 'termination_cleanup', 'closure_confirmation', 'closed']);

  const steps = progressStepsViaStatus();
  assert.deepEqual(steps, ['item_execution', 'controller_self_check', 'independent_review', 'controller_synthesis']);

  const locales = progressGroupLocales();
  assert.equal(locales.get('plan_confirmation')!.zh, '方案待确认');
  assert.equal(locales.get('progressing')!.zh, '推进中');
  assert.equal(locales.get('termination_cleanup')!.zh, '终止善后中');
  assert.equal(locales.get('closure_confirmation')!.zh, '关闭待确认');
  assert.equal(locales.get('closed')!.zh, '已关闭');

  // 四步由共享轨迹组件按 WORKCASE_PROGRESS_STEP_ORDER 渲染，不新增第五步。
  const track = readWebSource('src/components/WorkCaseProgressTrack.tsx');
  assert.match(track, /WORKCASE_PROGRESS_STEP_ORDER\.map/);
  // 进度跟踪消费 current_snapshot_projection 的四步位置，不读裸 phase。
  assert.match(track, /progressStep\??: WorkCaseProgressStep \| null/);
});

test('plan revision stays inside "progressing" without highlighting a four-step position', () => {
  const workflow = readWebSource('shared/workcaseStatus.ts');
  const contract = readWebSource('shared/workcasePresentationContract.generated.ts');
  const track = readWebSource('src/components/WorkCaseProgressTrack.tsx');
  const locales = readWebSource('src/i18n/locales.ts');

  // plan_revising 投影到推进中但省略 progress_step（轨迹外位置），不新增第五个 step。
  assert.match(contract, /"plan_revising"/);
  assert.match(workflow, /WORKCASE_PROGRESS_STEP_ORDER = \[/);
  assert.match(track, /const planRevising = lifecyclePosition === 'plan_revising'/);
  assert.match(track, /if \(planRevising\)/);
  // 方案修订中的专属标签与"轨道外"提示由 locales 提供。
  assert.match(locales, /plan_revising: \{ zh: '方案修订中'/);
  assert.match(locales, /workcaseOutsideProgressTrack/);
});

test('plan-confirmation and progressing Card inputs read the latest WorkCase fields', () => {
  const objectList = readWebSource('src/pages/ObjectList.tsx');

  // plan_confirmation Card 是 Gate1 入口：读取 goal + success_criterion_definitions + execution_authorization。
  assert.match(objectList, /export function WorkCasePlanConfirmationContent/);
  assert.match(objectList, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} \/>/);
  assert.match(objectList, /successCriterionDefinitions=\{obj\.success_criterion_definitions\}/);
  assert.match(objectList, /executionAuthorization=\{obj\.execution_authorization\}/);

  // progressing Card 只显示"目标"与"当前情况"两区，经 WorkCaseGoalSection supporting + WorkCaseProgressTrack。
  assert.match(objectList, /export function WorkCaseProgressingContent/);
  assert.match(objectList, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} emphasis="supporting" \/>/);
  assert.match(objectList, /t\('objectDetail\.workcaseCurrentSnapshot'\)/);

  // 顶层 blocking_summary 与 waiting_on 在判断输入区外独立呈现，不构成第四项阅读入口。
  assert.match(objectList, /export function WorkCaseBlockingNotice/);
  assert.match(objectList, /export function WorkCaseWaitingOnNotice/);
  assert.match(objectList, /isBlocked && <WorkCaseBlockingNotice blockingSummary=\{blockingSummary\}/);

  // 工作项按 status 排序（completed 前、in_progress 突出、pending 弱化、cancelled 保留），不显示完成比例。
  const progressing = objectList.slice(objectList.indexOf('export function WorkCaseProgressingContent'));
  assert.match(progressing, /completed: 0, in_progress: 1, blocked: 2, pending: 3, cancelled: 4/);
  assert.doesNotMatch(progressing, /已完成 N\/T/);
  // 不允许把 item-03 写成"第三项"，且无全局轮次计数。
  assert.doesNotMatch(progressing, /第 N 轮|轮次未记录|item-03/);
});

test('closure-confirmation Card defines a decision-input zone and reuses shared associations', () => {
  const objectList = readWebSource('src/pages/ObjectList.tsx');
  const api = readWebSource('src/utils/api.ts');

  // 关闭判断输入区：目标 + 关闭提案（proposed_outcome / disposition_summary / residual_decisions / spark_suggestions）。
  assert.match(objectList, /export function WorkCaseClosureConfirmationContent/);
  assert.match(objectList, /WorkCaseGoalSection goal=\{goal\} t=\{t\} \/>/);
  // 关闭提案固定以"关闭提案"为标题。
  assert.match(objectList, /t\('objectList\.workcaseClosureProposal'\)/);
  // 四值闭集 proposed_outcome + 三类处置 disposition。
  assert.match(objectList, /completed: 'border-emerald-400\/25/);
  assert.match(objectList, /partial: 'border-amber-400\/25/);
  assert.match(objectList, /'not-achieved': 'border-red-400\/25/);
  assert.match(objectList, /cancelled: 'border-zinc-400\/25/);
  assert.match(objectList, /route_existing: 'border-emerald-400\/25/);
  assert.match(objectList, /suggest_spark: 'border-emerald-400\/25/);
  assert.match(objectList, /accept_stop: 'border-cyan-400\/25/);
  assert.match(objectList, /closureProposal\.residualDecisions/);
  assert.match(objectList, /closureProposal\.sparkSuggestions/);

  // 正式 relations 复用共享关联行；WorkCase 不引入 approve/expire 控件。
  assert.match(api, /WorkCaseContributionTarget/);

  // 关闭决定由专属事务消费，不持久化 approval / 关闭时间收据。
  assert.doesNotMatch(api, /\bclosure_approval\b/);
  assert.doesNotMatch(api, /\bclosure_requested_at\b/);
});

test('Cognition Center reuses pending and progressing WorkCase Cards with secondary reading', () => {
  const cognitionCenter = readWebSource('src/pages/CognitionCenter.tsx');
  const objectList = readWebSource('src/pages/ObjectList.tsx');
  const apiTypes = readWebSource('src/utils/api.ts');
  const cognitionRoute = readWebSource('api/routes/cognition.ts');

  // 收件箱卡片沿用对象 Card，标题只打开次级阅读面板，不发生路由跳转。
  assert.match(cognitionCenter, /CognitionInboxItem/);
  assert.match(cognitionCenter, /inboxKind/);
  assert.match(cognitionCenter, /<ObjectCardFrame/);
  assert.match(cognitionCenter, /mode="card"/);
  assert.match(cognitionCenter, /objectType: item\.type/);
  assert.match(cognitionCenter, /ldvh-section-grid/);
  assert.match(cognitionCenter, /aria-controls="cognition-inbox-content"/);
  assert.match(cognitionCenter, /inboxExpanded/);
  assert.match(cognitionCenter, /CognitionActiveWorkCaseItem/);
  assert.match(cognitionCenter, /<WorkCaseProgressingContent/);
  assert.match(cognitionCenter, /<PitfallCardContent obj=\{toObjectCard\(item\)\} \/>/);
  assert.match(cognitionCenter, /item\.inboxKind === 'blocked_resolution'/);
  assert.match(cognitionCenter, /<WorkCaseBlockingNotice/);
  assert.match(cognitionCenter, /aria-controls="cognition-active-workcases-content"/);
  assert.match(cognitionCenter, /activeExpanded/);
  assert.doesNotMatch(cognitionCenter, /navigate\(/);
  assert.doesNotMatch(cognitionCenter, /\.byStatus\b/);

  // 两个 Human Gate 的“目标”语义相同，应使用同一主目标色阶；关闭确认不降为若有若无的 supporting 色阶。
  const closureConfirmationBlock = objectList.match(/export function WorkCaseClosureConfirmationContent[\s\S]*?\n}\n\nfunction WorkCaseClosedContent/);
  assert.ok(closureConfirmationBlock);
  assert.match(closureConfirmationBlock[0], /<WorkCaseGoalSection goal=\{goal\} t=\{t\} \/>/);
  assert.doesNotMatch(closureConfirmationBlock[0], /emphasis="supporting"/);

  // 类型层：WorkCase 仍只携带 progress_group；Pitfall 明确用 draft 状态进入确认收件箱。
  assert.match(apiTypes, /export interface CognitionWorkCaseInboxItem[\s\S]*?progress_group: 'plan_confirmation' \| 'closure_confirmation';/);
  assert.match(apiTypes, /export interface CognitionPitfallInboxItem[\s\S]*?type: 'pitfall';[\s\S]*?status: 'draft';[\s\S]*?inboxKind: 'pitfall_confirmation';/);
  assert.match(apiTypes, /CognitionInboxKind =[\s\S]*?'plan_confirmation'[\s\S]*?'closure_confirmation'[\s\S]*?'blocked_resolution'[\s\S]*?'pitfall_confirmation'/);
  assert.match(apiTypes, /export type CognitionInboxItem = CognitionWorkCaseInboxItem \| CognitionPitfallInboxItem;/);
  assert.match(apiTypes, /export interface CognitionActiveWorkCaseItem[\s\S]*?progress_group: 'progressing' \| 'termination_cleanup';[\s\S]*?isBlocked: boolean;/);
  const workCaseInboxBlock = apiTypes.match(/export interface CognitionWorkCaseInboxItem extends CognitionInboxItemBase \{[\s\S]*?\n\}/);
  assert.ok(workCaseInboxBlock);
  assert.doesNotMatch(workCaseInboxBlock[0], /\bstatus\??:\s/);
  assert.doesNotMatch(workCaseInboxBlock[0], /source_status/);
  const pitfallCard = objectList.match(/export function PitfallCardContent[\s\S]*?\n}\n\nfunction AdrTerminalCardContent/);
  assert.ok(pitfallCard);
  for (const field of ['symptoms', 'trigger_conditions', 'resolution', 'avoidance', 'validation_summary', 'applicability']) {
    assert.match(objectList, new RegExp(`'${field}'`));
  }
  const blockedResolutionBlock = cognitionCenter.match(/if \(item\.inboxKind === 'blocked_resolution'\)[\s\S]*?\n  }\n  if \(item\.inboxKind === 'plan_confirmation'\)/);
  assert.ok(blockedResolutionBlock);
  assert.doesNotMatch(blockedResolutionBlock[0], /WorkCasePlanConfirmationContent|WorkCaseClosureConfirmationContent|gate1_waiting|gate2_waiting/);
  assert.match(cognitionRoute, /if \(raw\.status !== 'draft'\) continue/);
});

test('Current Web WorkCase sources reject retired fields and states', () => {
  const currentWorkCaseSources = [
    'web/shared/workcaseStatus.ts',
    'web/src/pages/object-detail/WorkCaseReadingLayout.tsx',
  ];
  const retiredTokens = /\b(?:orchestration|execution_items|success_criteria|verification_evidence|closure_evidence|review_needed|closure_approval|closure_requested_at|review_requested_at|done|skipped)\b/;

  for (const relativePath of currentWorkCaseSources) {
    assert.doesNotMatch(readWebSource(relativePath), retiredTokens, relativePath);
  }
});

test('Current WorkCase phases have direct labels and colors with no retired display keys', () => {
  const locales = readWebSource('web/src/i18n/locales.ts');
  const colors = readWebSource('web/src/utils/statusColors.ts');

  assert.match(locales, /plan_revising: \{ zh: '方案修订中', en: 'Plan Revision' \}/);
  assert.match(locales, /controller_checking: \{ zh: '主控自检中', en: 'Controller Self-check' \}/);
  assert.match(locales, /independent_reviewing: \{ zh: '结果复核中', en: 'Result Review' \}/);
  assert.match(locales, /closure_preparing: \{ zh: '主控收敛中', en: 'Controller Synthesis' \}/);
  assert.match(colors, /plan_revising: \{ light:/);
  assert.match(colors, /controller_checking: \{ light:/);
  assert.match(colors, /independent_reviewing: \{ light:/);
  assert.match(colors, /closure_preparing: \{ light:/);
  assert.doesNotMatch(locales, /result_self_checking|subagents_result_reviewing/);
  assert.doesNotMatch(colors, /result_self_checking|subagents_result_reviewing/);
});

test('Fact projections provide no application-level refresh controls', () => {
  const objectList = readWebSource('web/src/pages/ObjectList.tsx');
  const objectDetail = readWebSource('web/src/pages/ObjectDetail.tsx');
  const cognitionCenter = readWebSource('web/src/pages/CognitionCenter.tsx');
  const panelContent = readWebSource('web/src/components/reading-panel/PanelContent.tsx');

  const refreshableSources = [objectList, objectDetail, cognitionCenter, panelContent].join('\n');
  assert.doesNotMatch(refreshableSources, /useManualFactRefresh|refreshFacts|RefreshCw|setInterval|visibilitychange|FACT_REFRESH_INTERVAL_MS/);
  assert.match(panelContent, /\(data as Record<string, unknown> \| undefined\) \?\? detail\?\.data/);
});
