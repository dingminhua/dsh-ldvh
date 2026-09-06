import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  WORKCASE_CURRENT_PHASES,
  WORKCASE_PROGRESS_GROUP_ORDER,
  WORKCASE_PROGRESS_STEP_ORDER,
  deriveWorkCasePresentationProjection,
} from '../../shared/workcaseStatus.ts';
import { projectCurrentWorkCaseCard } from '../../api/services/facts.ts';
import { getFieldValueLabel, getObjectStatusLocale } from '../../src/i18n/locales.ts';
import { hasUnavailableIndependentSubagentReview } from '../../shared/workcaseCapability.ts';

const webRoot = path.resolve(import.meta.dirname, '../..');
const sourceContentFingerprint = 'a'.repeat(64);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
}

function projectCurrentCard(fact: Record<string, unknown>) {
  return projectCurrentWorkCaseCard(fact, sourceContentFingerprint);
}

function currentWorkCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workcase-0099',
    object_id: 'workcase-0099',
    type: 'workcase',
    fact_type_key: 'workcase',
    status: 'open',
    phase: 'executing',
    progress_group: 'progressing',
    progress_step: 'item_execution',
    title: '当前 WorkCase 投影',
    path: 'ldvh-base/workcases/workcase-0099.yaml',
    created_at: '2026-07-26T08:00:00+08:00',
    updated_at: '2026-07-26T12:00:00+08:00',
    updated: '2026-07-26T12:00:00+08:00',
    goal: '只消费当前字段。',
    scope: '只测试当前 Card 投影。',
    success_criterion_definitions: [
      { criterion_id: 'criterion-visible-result', statement: '完整显示当前成功标准。' },
    ],
    plan_version: 1,
    work_items: [
      {
        item_id: 'item-done',
        goal: '保留已完成项',
        expected_result: '形成已完成结果',
        status: 'completed',
        result_summary: '已形成结果。',
      },
      {
        item_id: 'item-running',
        goal: '继续当前推进',
        expected_result: '形成当前结果',
        status: 'in_progress',
        current_summary: '已完成基础修改。',
        resume_from: '继续运行当前验证。',
        depends_on: ['item-done'],
      },
      {
        item_id: 'item-blocked',
        goal: '等待外部输入',
        expected_result: '取得外部输入',
        status: 'blocked',
        current_summary: '输入尚未取得。',
        blocking_summary: '等待 Human 提供输入。',
        depends_on: ['item-done'],
      },
      {
        item_id: 'item-cancelled',
        goal: '停止不再适用的局部工作',
        expected_result: '清楚记录停止范围',
        status: 'cancelled',
        result_summary: '该局部工作已经停止。',
      },
    ],
    creation_reviews: [{
      reviewer: 'independent-reviewer',
      reviewed_at: '2026-07-26T11:00:00+08:00',
      subject_version: 1,
      scope: '检查当前计划与授权边界。',
      conclusion: 'pass',
      controller_resolution: '主控确认反馈已处理。',
      actual_method: 'subagent-read-only',
    }],
    execution_authorization: {
      authorized_actions: [{
        action_id: 'action-01', summary: '实现 Web 投影', target_scope: 'web/**', effect_scope: '只读呈现',
        risk_summary: '可能出现字段错配', rollback_summary: '回退 Web 变更', rule_refs: ['specs/21#gate-1'],
      }],
      action_ceiling: '仅 Web 范围',
      prohibited_actions: ['不得改事实 YAML'],
      allowed_adjustments: '允许修正只读呈现',
      verification_and_rollback: '运行 Web check/tests；失败时回退',
      out_of_bounds_handling: '停止并回到 Human',
    },
    execution_approval: {
      subject_version: 1,
      approved_at: '2026-07-26T11:30:00+08:00',
      summary: '批准当前 Gate 1 基线。',
      baseline_fingerprint: 'sha256:gate-one-baseline',
      source_refs: ['human-input:approval'],
    },
    ...overrides,
  };
}

test('WorkCase cards use five progress groups while retaining the four-step result track', () => {
  assert.deepEqual(WORKCASE_PROGRESS_GROUP_ORDER, ['plan_confirmation', 'progressing', 'termination_cleanup', 'closure_confirmation', 'closed']);
  assert.deepEqual(WORKCASE_PROGRESS_STEP_ORDER, ['item_execution', 'controller_self_check', 'independent_review', 'controller_synthesis']);
  assert.deepEqual(WORKCASE_CURRENT_PHASES, [
    'human_plan_confirming',
    'plan_revising',
    'executing',
    'controller_checking',
    'independent_reviewing',
    'closure_preparing',
    'human_closure_confirming',
    'termination_preparing',
  ]);
  const closurePreparing = deriveWorkCasePresentationProjection('open', 'closure_preparing', sourceContentFingerprint);
  assert.equal(closurePreparing.resolution, 'resolved');
  if (closurePreparing.resolution === 'resolved') {
    assert.equal(closurePreparing.progress_group, 'progressing');
    assert.equal(closurePreparing.progress_step, 'controller_synthesis');
  }
  const gate2 = deriveWorkCasePresentationProjection('open', 'human_closure_confirming', sourceContentFingerprint);
  assert.equal(gate2.resolution === 'resolved' ? gate2.progress_group : null, 'closure_confirmation');
  assert.equal(deriveWorkCasePresentationProjection('closed', undefined, sourceContentFingerprint).resolution, 'resolved');
  assert.equal(deriveWorkCasePresentationProjection('closed', 'executing', sourceContentFingerprint).resolution, 'unresolved');
  assert.equal(deriveWorkCasePresentationProjection('open', undefined, sourceContentFingerprint).resolution, 'unresolved');
  assert.equal(deriveWorkCasePresentationProjection('blocked', 'not-a-current-phase', sourceContentFingerprint).resolution, 'unresolved');
  const executing = deriveWorkCasePresentationProjection('open', 'executing', sourceContentFingerprint);
  assert.equal(executing.resolution === 'resolved' ? executing.progress_group : null, 'progressing');
  assert.equal(executing.resolution === 'resolved' ? executing.progress_step : null, 'item_execution');
  const termination = deriveWorkCasePresentationProjection('open', 'termination_preparing', sourceContentFingerprint);
  assert.equal(termination.resolution === 'resolved' ? termination.progress_group : null, 'termination_cleanup');
  assert.equal(termination.resolution === 'resolved' ? termination.progress_step : 'unexpected', null);
  assert.equal(termination.resolution === 'resolved' ? termination.next_required_control_step : null, 'termination_cleanup');
});

test('termination cleanup is presented with closed cards and only its terminal reason', () => {
  const termination = {
    initiated_at: '2026-07-26T12:30:00+08:00',
    source_status: 'open',
    source_phase: 'executing',
    source_content_fingerprint: sourceContentFingerprint,
    reason: 'Human stopped the original plan.',
    source_refs: ['human-input:stop'],
    item_snapshots: ['item-running::in_progress::Work had started.'],
    retained_scope: ['Existing bounded result.'],
    discarded_scope: ['none-observed: no discard requested'],
    unverified_scope: ['Environment matrix not run.'],
    relationship_impacts: ['none-observed: no dependent responsibility'],
    quality_steps: ['independent_result_review:skipped', 'closure_proposal:skipped', 'gate_2:skipped'],
    cleanup_status: 'completed',
    cleanup_summary: 'Cleanup facts are complete.',
  };
  const card = projectCurrentCard(currentWorkCase({
    phase: 'termination_preparing',
    termination,
  }));

  assert.equal(card.progress_group, 'termination_cleanup');
  assert.equal('progress_step' in card, false);
  assert.deepEqual(card.termination, termination);
  assert.equal(card.goal, '只消费当前字段。');
  assert.equal('executionItems' in card, false);
  assert.equal('work_items' in card, false);
  const list = source('src/pages/ObjectList.tsx');
  const progressFilter = source('src/components/WorkCaseProgressFilter.tsx');
  assert.match(list, /const displayProgressGroup = progressGroup === 'termination_cleanup' \? 'closed' : progressGroup/);
  assert.doesNotMatch(list, /<WorkCaseTerminationContent/);
  assert.match(progressFilter, /options\.filter\(\(\{ group \}\) => group !== 'termination_cleanup'\)/);
  assert.doesNotMatch(progressFilter, /WORKCASE_PROGRESS_GROUP_ORDER/);

  const closedCard = projectCurrentCard({
    object_id: 'workcase-0084',
    fact_type_key: 'workcase',
    title: 'Human 主动终止',
    status: 'closed',
    updated_at: '2026-07-26T15:00:00+08:00',
    goal: '停止原计划并完成善后。',
    termination,
  });
  assert.equal(closedCard.progress_group, 'closed');
  assert.deepEqual(closedCard.termination, termination);
  assert.match(list, /<WorkCaseClosedContent goal=\{obj\.goal\} terminal=\{obj\.closureTerminal\} termination=\{obj\.termination\}/);
});

test('terminal status labels remain type-specific across fact types', () => {
  assert.equal(getObjectStatusLocale('workcase', 'discarded', 'zh'), '已废弃');
  assert.equal(getObjectStatusLocale('adr', 'retired', 'zh'), '已废弃');
  assert.equal(getObjectStatusLocale('pitfall', 'draft', 'zh'), '待确认');
  assert.equal(getObjectStatusLocale('pitfall', 'active', 'zh'), '活跃');
  assert.equal(getObjectStatusLocale('pitfall', 'discarded', 'zh'), '已废弃');
  assert.equal(getObjectStatusLocale('study', 'retired', 'zh'), '已废弃');
});

test('closure proposals are labelled as proposals instead of established terminal outcomes', () => {
  const locales = source('src/i18n/locales.ts');
  const list = source('src/pages/ObjectList.tsx');

  assert.equal(getFieldValueLabel('proposed_outcome', 'completed', 'zh'), '目标达成');
  assert.equal(getFieldValueLabel('proposed_outcome', 'completed', 'en'), 'Achieved');
  assert.equal(getFieldValueLabel('closure_outcome', 'completed', 'zh'), '完成');
  assert.match(locales, /proposed_outcome:[\s\S]{0,180}completed: \{ zh: '目标达成', en: 'Achieved' \}/);
  assert.match(list, /mode === 'proposal'[\s\S]{0,120}<ClipboardList/);
  assert.match(list, /<ClipboardList[^>]+className=\{`shrink-0 \$\{CLOSURE_PROPOSAL_TEXT_CLASS\}`\}/);
});

test('plan revision is progressing but remains outside the four-step track', () => {
  const track = source('src/components/WorkCaseProgressTrack.tsx');
  const locales = source('src/i18n/locales.ts');

  const projection = deriveWorkCasePresentationProjection('open', 'plan_revising', sourceContentFingerprint);
  assert.equal(projection.resolution === 'resolved' ? projection.progress_group : null, 'progressing');
  assert.equal(projection.resolution === 'resolved' ? projection.progress_step : 'unexpected', null);
  assert.match(track, /const planRevising = lifecyclePosition === 'plan_revising'/);
  assert.doesNotMatch(track, /phase\?:|phase=\{|getWorkCaseProgressProjection/);
  assert.match(track, /objectList\.workcasePlanRevising/);
  assert.match(track, /objectList\.workcaseOutsideProgressTrack/);
  assert.match(track, /if \(planRevising\)/);
  assert.match(locales, /plan_revising: \{ zh: '方案修订中'/);
  assert.match(locales, /'objectList\.workcaseOutsideProgressTrack': '四步轨迹之外'/);
});

test('plan confirmation keeps its compact Gate 1 entry for the list and cognition cards', () => {
  const list = source('src/pages/ObjectList.tsx');
  const sharedCriteria = source('src/components/WorkCaseCriteriaList.tsx');
  const branchStart = list.indexOf("if (progressGroup === 'plan_confirmation')");
  const branchEnd = list.indexOf("if (progressGroup === 'progressing')", branchStart);
  const branch = list.slice(branchStart, branchEnd);
  const contentStart = list.indexOf('function WorkCasePlanConfirmationContent');
  const contentEnd = list.indexOf('function WorkCaseGoalSection', contentStart);
  const content = list.slice(contentStart, contentEnd);
  const noticeStart = list.indexOf('function WorkCaseBlockingNotice');
  const noticeEnd = list.indexOf('function WorkCaseProgressingContent', noticeStart);
  const notice = list.slice(noticeStart, noticeEnd);

  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.ok(contentStart >= 0 && contentEnd > contentStart);
  assert.ok(noticeStart >= 0 && noticeEnd > noticeStart);
  assert.match(branch, /<WorkCasePlanConfirmationContent[\s\S]*?mode="card"[\s\S]*?goal=\{obj\.goal\}[\s\S]*?successCriterionDefinitions=\{obj\.success_criterion_definitions\}[\s\S]*?executionAuthorization=\{obj\.execution_authorization\}/);
  assert.doesNotMatch(branch, /scope=\{obj\.scope\}|workItems=\{obj\.work_items\}|creationReviews=\{obj\.creation_reviews\}|executionApproval=\{obj\.execution_approval\}/);
  assert.doesNotMatch(branch, /prominentTitle/);
  assert.doesNotMatch(branch, /waiting_on/);
  assert.match(branch, /isBlocked=\{currentProjection\?\.blocking_overlay \?\? false\}/);
  assert.doesNotMatch(branch, /obj\.status === 'blocked'/);
  assert.match(branch, /blockingSummary=\{obj\.blocking_summary\}/);
  assert.match(content, /ldvh-card-decision-title/);
  assert.match(content, /ldvh-caption/);
  assert.match(content, /<section className=\{WORKCASE_CRITERIA_SURFACE_CLASS\}>/);
  assert.match(content, /<WorkCaseCriteriaList/);
  assert.match(content, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} \/>/);
  assert.match(content, /const showsCompleteGateMaterial = mode === 'decision';/);
  assert.match(content, /<ExecutionAuthorizationCard[\s\S]*?compact=\{mode === 'card'\}/);
  assert.match(content, /t\('objectDetail\.workcaseSuccessCriteria'\)/);
  assert.match(sharedCriteria, /bg-blue-500\/\[0\.025\]/);
  assert.match(sharedCriteria, /className="ldvh-card-decision-body text-blue-900\/70 dark:text-blue-100\/75"/);
  assert.match(sharedCriteria, /className="mt-\[0\.5rem\] h-1 w-1/);
  assert.doesNotMatch(content, /list-disc/);
  assert.doesNotMatch(content, /<ol|line-clamp|slice\(0,/);
  assert.match(content, /\{showsCompleteGateMaterial && \(/);
  assert.match(content, /fieldKey="scope"/);
  assert.match(content, /fieldKey="work_items"/);
  assert.match(content, /fieldKey="creation_reviews"/);
  assert.match(content, /showsCompleteGateMaterial && executionApproval !== undefined/);
  assert.match(content, /fieldKey="execution_authorization"/);
  assert.match(content, /workcaseAuthorizedActionCount/);
  assert.match(content, /workcaseProhibitedActionCount/);
  assert.match(content, /workcasePrerequisiteCount/);
  assert.doesNotMatch(content, /workcaseAuthorizationExpand|<details/);
  for (const field of ['authorized_actions', 'action_ceiling', 'prohibited_actions', 'allowed_adjustments', 'verification_and_rollback', 'out_of_bounds_handling', 'human_prerequisites', 'baseline_fingerprint', 'source_refs']) {
    assert.match(content, new RegExp(field));
  }
  assert.match(content, /workcaseGateFieldMalformed/);
  assert.match(content, /\{isBlocked && <WorkCaseBlockingNotice blockingSummary=\{blockingSummary\} t=\{t\} \/>\}/);
  assert.ok(content.indexOf('<WorkCaseBlockingNotice') < content.indexOf('<WorkCaseGoalSection'));
  assert.match(notice, /role="status"/);
  assert.match(notice, /getFieldLabel\('blocking_summary', locale\)/);
  assert.match(notice, /aria-label=\{label\}/);
  assert.match(notice, /border-rose-400\/30 border-l-2 border-l-rose-400 bg-rose-500\/\[0\.045\]/);
  assert.match(notice, /flex min-w-0 items-center gap-2/);
  assert.match(notice, /ldvh-card-decision-title min-w-0 text-rose-700\/80 dark:text-rose-200\/80/);
});

test('WorkCase cards use only current authorization tabs', () => {
  const list = source('src/pages/ObjectList.tsx');
  const authorization = list.slice(
    list.indexOf('function ExecutionAuthorizationCard'),
    list.indexOf('function GateOneValue'),
  );

  assert.match(
    authorization,
    /'actions' \| 'prohibited' \| 'prerequisites' \| null/,
  );
  assert.match(authorization, /workcaseAuthorizedActionCount/);
  assert.match(authorization, /workcaseProhibitedActionCount/);
  assert.match(authorization, /workcasePrerequisiteCount/);
  assert.doesNotMatch(
    authorization,
    /reviewer_policy|capability_limitations|fallback_order|actual_model/,
  );
});
test('WorkCase identity exposes an unavailable independent-subagent capability beside status', () => {
  const factSource = {
    creation_reviews: [{ actual_method: 'same-ai-switched-role-read-only' }],
  };
  assert.equal(hasUnavailableIndependentSubagentReview(factSource), true);
  assert.equal(
    hasUnavailableIndependentSubagentReview({
      independentSubagentUnavailable: true,
    }),
    true,
  );
  assert.equal(
    hasUnavailableIndependentSubagentReview({
      creation_reviews: [{ actual_method: 'subagent-read-only' }],
    }),
    false,
  );

  const list = source('src/pages/ObjectList.tsx');
  const detail = source('src/pages/ObjectDetail.tsx');
  const badge = source('src/components/WorkCaseCapabilityStatusBadge.tsx');
  assert.match(
    list,
    /statusLeadingBadges=\{<WorkCaseCapabilityStatusBadge source=\{obj\} \/>\}/,
  );
  assert.match(
    detail,
    /statusLeadingBadges=\{capabilityStatusBadge\}[\s\S]{0,100}actionBadges=\{actionBadges\}/,
  );
  assert.match(badge, /border-amber-400\/35 bg-amber-500\/\[0\.07\]/);
  assert.match(badge, /workcaseIndependentSubagentUnavailable/);
  assert.match(badge, /aria-label=\{hint\}/);
  assert.match(
    badge,
    /<CircleAlert size=\{12\} strokeWidth=\{2\} aria-hidden="true" \/>/,
  );
  assert.match(
    source('src/i18n/locales.ts'),
    /'objectList\.workcaseIndependentSubagentUnavailable': 'Sub Agent'/,
  );
});

test('progressing Card projection carries only the derived independent-subagent warning', () => {
  const projected = projectCurrentCard(
    currentWorkCase({
      creation_reviews: [{ actual_method: 'same-ai-switched-role-read-only' }],
    }),
  );
  assert.equal(projected.independentSubagentUnavailable, true);
  assert.equal('execution_authorization' in projected, false);
});

test('WorkCase cards keep a neutral outer surface and move emphasis with the current decision', () => {
  const list = source('src/pages/ObjectList.tsx');
  const goal = list.slice(list.indexOf('function WorkCaseGoalSection'), list.indexOf('function WorkCaseBlockingNotice'));
  const progressing = list.slice(list.indexOf('function WorkCaseProgressingContent'), list.indexOf('function sortObjectsForList'));
  const closure = list.slice(list.indexOf('function WorkCaseClosureConfirmationContent'), list.indexOf('function WorkCaseContributionsContent'));
  const closed = list.slice(list.indexOf('function WorkCaseClosedContent'), list.indexOf('function WorkCaseContributionsContent'));
  const frame = list.slice(list.indexOf('function ObjectCardFrame'), list.indexOf('function hasSparkResolvedFact'));

  assert.doesNotMatch(list, /ldvh-card-plan-confirmation|isPlanConfirmation/);
  assert.match(frame, /className="flex min-w-0 flex-col gap-2 rounded-lg border border-ldvh-border bg-ldvh-panel p-3 text-left"/);
  assert.match(goal, /emphasis\?: 'primary' \| 'supporting'/);
  assert.match(goal, /border-violet-400\/20 border-l-violet-400\/70 bg-violet-500\/\[0\.025\] dark:bg-violet-950\/20/);
  assert.match(progressing, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} emphasis="supporting" \/>/);
  assert.match(closure, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} emphasis="supporting" \/>/);
  assert.match(closed, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} emphasis="supporting" \/>/);
  // waiting_on 琥珀提示块抽取为共享组件（认知中心决定依据区同源消费，02 §7.5），语义不变。
  const waitingNotice = list.slice(list.indexOf('function WorkCaseWaitingOnNotice'), list.indexOf('function WorkCaseBlockingNotice'));
  assert.match(waitingNotice, /ldvh-card-decision-title min-w-0 text-amber-700\/80 dark:text-amber-200\/80/);
  assert.match(progressing, /<WorkCaseWaitingOnNotice waitingOn=\{waitingOn\} \/>/);
});

test('semantic WorkCase cards share one title-to-body spacing token', () => {
  const list = source('src/pages/ObjectList.tsx');
  const goal = list.slice(list.indexOf('function WorkCaseGoalSection'), list.indexOf('function WorkCaseBlockingNotice'));
  const outcome = list.slice(list.indexOf('function WorkCaseOutcomeNotice'), list.indexOf('function WorkCaseSparkSuggestions'));
  const suggestions = list.slice(list.indexOf('function WorkCaseSparkSuggestions'), list.indexOf('function WorkCaseClosureConfirmationContent'));
  const closure = list.slice(list.indexOf('function WorkCaseClosureConfirmationContent'), list.indexOf('function WorkCaseContributionsContent'));
  const closed = list.slice(list.indexOf('function WorkCaseClosedContent'), list.indexOf('function WorkCaseContributionsContent'));

  assert.match(list, /const WORKCASE_CARD_TITLE_BODY_GAP_CLASS = 'mt-1\.5'/);
  for (const section of [goal, outcome, suggestions, closure, closed]) {
    assert.match(section, /WORKCASE_CARD_TITLE_BODY_GAP_CLASS/);
  }
  assert.match(closure, /showStatus=\{false\} compact/);
  assert.doesNotMatch(closed, /showStatus=\{false\} compact/);

  // 彩色 Card 正文使用与背景同色相的低饱和深色，避免高饱和标题色贯穿长正文。
  assert.match(goal, /text-violet-950\/65 dark:text-violet-100\/75/);
  assert.match(list, /ldvh-meta shrink-0 text-blue-700\/60 dark:text-blue-200\/65/);
  assert.match(list, /completed: 'text-emerald-950\/70 dark:text-emerald-100\/75'/);
  assert.match(list, /partial: 'text-amber-950\/70 dark:text-amber-100\/75'/);
  assert.match(list, /accept_stop: 'text-cyan-950\/70 dark:text-cyan-100\/75'/);
});

test('Card targets remain plain relationship facts while Focus may opt into secondary reading', () => {
  const list = source('src/pages/ObjectList.tsx');
  const target = list.slice(list.indexOf('function WorkCaseContributionTargetRow'), list.indexOf('function contributionTargetTitle'));
  const frame = list.slice(list.indexOf('function ObjectCardFrame'), list.indexOf('function hasSparkResolvedFact'));

  assert.match(target, /<ObjectTypeIcon type=\{target\.factTypeKey\}/);
  assert.match(target, /flex min-w-0 items-center gap-2/);
  assert.match(target, /size=\{13\} className="shrink-0"/);
  assert.match(target, /<span className="ldvh-meta-primary min-w-0 flex-1 whitespace-normal break-words text-left">[\s\S]*\{title\}/);
  assert.doesNotMatch(target, /\{target\.objectId \?\? target\.objectUid\}/);
  assert.match(target, /onOpenTarget\?: \(target: WorkCaseContributionTarget, title: string\) => void/);
  assert.match(target, /if \(onOpenTarget && canOpenTarget\) \{/);
  assert.match(target, /<button[\s\S]*onClick=\{\(\) => onOpenTarget\(target, title\)\}/);
  assert.match(target, /<div className=\{rowClassName\}>\{rowContent\}<\/div>/);
  assert.match(frame, /role="button"[\s\S]*tabIndex=\{0\}[\s\S]*onClick=\{\(\) => onOpen\(obj\.id\)\}[\s\S]*onKeyDown=/);
  assert.match(frame, /ldvh-object-title-tray[\s\S]*cursor-pointer/);
  assert.doesNotMatch(frame, /<button[\s\S]*onClick=\{\(\) => onOpen\(obj\.id\)\}/);
  assert.doesNotMatch(frame, /<ArrowRight size=\{14\}/);
});

test('progressing cards show only goal and current situation facts', () => {
  const list = source('src/pages/ObjectList.tsx');
  const track = source('src/components/WorkCaseProgressTrack.tsx');
  const branchStart = list.indexOf("if (progressGroup === 'progressing')");
  const branchEnd = list.indexOf("if (displayProgressGroup === 'closure_confirmation')", branchStart);
  const branch = list.slice(branchStart, branchEnd);
  const content = list.slice(list.indexOf('function WorkCaseProgressingContent'), list.indexOf('function sortObjectsForList'));
  const notice = list.slice(list.indexOf('function WorkCaseBlockingNotice'), list.indexOf('function WorkCaseProgressingContent'));

  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.match(branch, /<WorkCaseProgressingContent/);
  assert.match(branch, /goal=\{obj\.goal\}/);
  assert.match(branch, /lifecyclePosition=\{currentProjection\?\.lifecycle_position \?\? null\}/);
  assert.match(branch, /executionItems=\{obj\.executionItems \?\? \[\]\}/);
  assert.match(branch, /waitingOn=\{obj\.waiting_on\}/);
  assert.match(branch, /blockingSummary=\{obj\.blocking_summary\}/);
  assert.doesNotMatch(branch, /successCriteria|closure|approval/);
  assert.match(content, /<h3 className="ldvh-card-decision-title text-sky-700\/85 dark:text-sky-200\/85">\{t\('objectDetail\.workcaseCurrentSnapshot'\)\}<\/h3>/);
  assert.doesNotMatch(content, /currentExecutionPosition|currentExecutionItem|workcaseItemProgress/);
  assert.match(content, /const displayedExecutionItems = itemExecution/);
  assert.match(content, /completed: 0, in_progress: 1, blocked: 2, pending: 3, cancelled: 4/);
  assert.match(content, /displayedExecutionItems\.map/);
  assert.match(content, /<CircleCheck size=\{14\}/);
  assert.match(content, /<CirclePlay size=\{14\}/);
  assert.match(content, /<CircleAlert size=\{14\}/);
  assert.match(content, /<CircleMinus size=\{14\}/);
  assert.match(content, /<Circle size=\{14\}/);
  assert.match(content, /flex min-w-0 items-center gap-2/);
  assert.match(content, /<div className="mt-0\.5">/);
  assert.match(content, /ldvh-card-decision-body \[&_p\]:my-0/);
  assert.match(content, /bg-emerald-500\/5/);
  assert.match(content, /bg-ldvh-bg\/60/);
  assert.match(content, /<WorkCaseProgressTrack[\s\S]{0,240}lifecyclePosition=\{lifecyclePosition\}[\s\S]{0,240}progressGroup="progressing"[\s\S]{0,240}progressStep=\{progressStep\}/);
  assert.match(track, /top-2\.5 z-0 h-px bg-ldvh-border/);
  assert.match(track, /bg-sky-100 font-semibold text-sky-600/);
  assert.match(content, /text-sky-950\/70 dark:text-sky-100\/75/);
  assert.match(content, /text-sky-600\/70 dark:text-sky-300\/70/);
  assert.match(content, /text-emerald-950\/70 dark:text-emerald-100\/75/);
  assert.match(content, /text-slate-700\/70 dark:text-slate-200\/70/);
  assert.doesNotMatch(content, /grid-cols-\[1rem_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(content, /workcaseItemCompleted|workcaseItemInProgress|workcaseItemBlocked|workcaseItemPending|workcaseItemCancelled/);
  // waiting_on 提示块为共享组件（与认知中心收件箱同源），断言组件本体保留原设计语言。
  const waitingNotice = list.slice(list.indexOf('function WorkCaseWaitingOnNotice'), list.indexOf('function WorkCaseBlockingNotice'));
  assert.match(waitingNotice, /getFieldLabel\('waiting_on', locale\)/);
  assert.match(waitingNotice, /border-amber-400\/30 border-l-2 border-l-amber-400 bg-amber-500\/\[0\.045\]/);
  assert.match(waitingNotice, /ldvh-card-decision-body \[&_p\]:my-0 text-amber-950\/70/);
  assert.match(content, /<WorkCaseWaitingOnNotice waitingOn=\{waitingOn\} \/>/);
  assert.match(content, /<WorkCaseBlockingNotice blockingSummary=\{blockingSummary\}/);
  assert.ok(content.indexOf('<WorkCaseBlockingNotice') < content.indexOf('<WorkCaseGoalSection'));
  assert.ok(content.indexOf('<WorkCaseBlockingNotice') < content.indexOf('<WorkCaseWaitingOnNotice'));
  assert.ok(content.indexOf('<WorkCaseWaitingOnNotice') < content.indexOf('<WorkCaseGoalSection'));
  assert.match(content, /\{!isBlocked && waitingOn\?\.trim\(\) && \(/);
  assert.match(notice, /getFieldLabel\('blocking_summary', locale\)/);
  assert.match(notice, /border-rose-400\/30 border-l-2 border-l-rose-400 bg-rose-500\/\[0\.045\]/);
  assert.doesNotMatch(content, /progressHistory|roundLabel|workcaseRound/);
});

test('list ordering supports updated and created time descending with a deterministic locator tiebreaker', () => {
  const list = source('src/pages/ObjectList.tsx');
  const start = list.indexOf('function sortObjectsForList');
  const end = list.indexOf('function sparkViewItem', start);
  const sorting = list.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(sorting, /compareRfc3339Timestamps\(b\.updated, a\.updated\)/);
  assert.match(sorting, /compareRfc3339Timestamps\(b\.created, a\.created\)/);
  assert.match(sorting, /sort === 'created_desc'/);
  assert.match(sorting, /b\.id\.localeCompare\(a\.id\)/);
  assert.doesNotMatch(sorting, /id_desc|id_asc|updated_asc|created_asc/);
  assert.doesNotMatch(sorting, /isTerminalListCard|terminalDelta/);
  assert.doesNotMatch(sorting, /progress_group|progress_step|PROGRESS_GROUP_INDEX|PROGRESS_STEP_INDEX/);
});

test('closure confirmation cards render the closure-decision input zone and shared formal associations', () => {
  const list = source('src/pages/ObjectList.tsx');
  const branchStart = list.indexOf("if (displayProgressGroup === 'closure_confirmation')");
  const branchEnd = list.indexOf("if (displayProgressGroup === 'closed')", branchStart);
  const branch = list.slice(branchStart, branchEnd);
  const content = list.slice(list.indexOf('function WorkCaseClosureConfirmationContent'), list.indexOf('function WorkCaseContributionsContent'));
  const contributions = list.slice(list.indexOf('function WorkCaseContributionsContent'), list.indexOf('function sortObjectsForList'));

  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.match(branch, /displayStatus="closure_confirmation"/);
  assert.doesNotMatch(branch, /prominentTitle/);
  assert.match(branch, /<WorkCaseClosureConfirmationContent goal=\{obj\.goal\} closureProposal=\{obj\.closureProposal\} \/>/);
  assert.doesNotMatch(branch, /<WorkCaseContributionsContent contributions=\{obj\.contributedTo\}/);
  assert.match(list, /<FactAssociationsCardContent associations=\{obj\.factAssociations\} \/>/);
  assert.doesNotMatch(branch, /executionItems|successCriteria|blocking_summary/);

  assert.match(content, /<WorkCaseGoalSection goal=\{goal\} t=\{t\} emphasis="supporting" \/>/);
  assert.match(content, /closureProposal \? \(/);
  assert.match(content, /<WorkCaseOutcomeNotice outcome=\{closureProposal\.proposedOutcome\} dispositionSummary=\{closureProposal\.dispositionSummary\} mode="proposal" \/>/);
  assert.match(content, /closureProposal\.residualDecisions\.map/);
  assert.match(content, /getFieldValueLabel\('proposed_disposition', decision\.proposedDisposition, locale\)/);
  assert.match(content, /objectList\.workcaseClosureProposalMissing/);
  assert.match(content, /WorkCaseSparkSuggestions suggestions=\{closureProposal\.sparkSuggestions\}/);
  assert.match(list, /CLOSURE_PROPOSAL_NOTICE_CLASS/);
  assert.match(list, /border-amber-400\/25 border-l-amber-400 bg-amber-500\/5/);
  assert.match(list, /mode === 'proposal'[\s\S]{0,100}CLOSURE_PROPOSAL_TEXT_CLASS/);
  assert.match(list, /mode === 'proposal'[\s\S]{0,100}CLOSURE_PROPOSAL_BODY_CLASS/);
  assert.match(list, /mode === 'proposal'[\s\S]{0,120}objectList\.workcaseClosureProposal/);
  assert.match(list, /objectList\.workcaseTerminalDisposition/);
  assert.match(list, /const outcomeLabel = mode === 'proposal'[\s\S]{0,100}: null/);
  assert.match(list, /\{outcomeLabel && <span className=\{`ldvh-meta ml-auto shrink-0 \$\{tone\}`\}>\{outcomeLabel\}<\/span>\}/);
  assert.match(content, /PROPOSED_DISPOSITION_NOTICE_CLASS\[decision\.proposedDisposition\]/);
  assert.match(content, /rounded-md border border-l-2 px-3\.5 py-3/);
  assert.match(list, /function WorkCaseSparkSuggestions/);
  assert.match(list, /const WORKCASE_SECTION_ICON_SIZE = 14/);
  assert.match(content, /Lightbulb size=\{WORKCASE_SECTION_ICON_SIZE\}/);
  assert.match(content, /ArrowRight size=\{WORKCASE_SECTION_ICON_SIZE\}/);
  assert.match(list, /function QuarterCircle/);
  assert.match(list, /<QuarterCircle className="shrink-0 text-amber-500/);
  assert.match(content, /decision\.proposedDisposition === 'accept_stop'/);
  assert.match(list, /ldvh-card-decision-title min-w-0 \$\{tone\}/);
  assert.match(content, /ldvh-card-decision-title min-w-0 \$\{PROPOSED_DISPOSITION_TEXT_CLASS/);
  assert.match(content, /decision\.routeTarget/);
  assert.match(content, /onOpenTarget\?: \(target: WorkCaseContributionTarget, title: string\) => void;/);
  assert.match(content, /<WorkCaseContributionTargetRow target=\{decision\.routeTarget\} locale=\{locale\} showStatus=\{false\} compact onOpenTarget=\{onOpenTarget\} \/>/);
  assert.doesNotMatch(content, /<ol|successCriterionResults|controller_check|validation_summary/);

  assert.match(contributions, /if \(!contributions \|\| contributions\.length === 0\) return null;/);
  assert.match(contributions, /objectList\.workcaseContributions/);
  assert.match(contributions, /onOpenTarget\?: \(target: WorkCaseContributionTarget, title: string\) => void;/);
  assert.match(contributions, /fetchObjectDetail\(target\.factTypeKey, target\.objectId\)/);
  assert.match(contributions, /<ObjectTypeIcon type=\{target\.factTypeKey\}/);
  assert.doesNotMatch(contributions, /\{target\.objectId \?\? target\.objectUid\}/);
  assert.doesNotMatch(contributions, /getTypeLabel\(target\.factTypeKey, locale\)/);
  assert.match(contributions, /if \(!detail \|\| !isReadableFact\(readMeta\)\) return '—';/);
  assert.match(contributions, /objectList\.workcaseTargetReading/);
  assert.match(contributions, /getFieldValueLabel\('read_status', readMeta\.readStatus \?\? 'unreadable', locale\)/);
  assert.match(contributions, /whitespace-normal break-words/);
  assert.doesNotMatch(contributions, /flex-1 truncate/);
  assert.match(contributions, /if \(onOpenTarget && canOpenTarget\) \{/);
  assert.match(contributions, /onClick=\{\(\) => onOpenTarget\(target, title\)\}/);
  assert.match(contributions, /<ArrowRight size=\{13\}/);

  const cognition = source('src/pages/CognitionCenter.tsx');
  assert.match(cognition, /<WorkCaseClosureConfirmationContent[\s\S]*onOpenTarget=\{onOpenContribution\}/);
  assert.match(cognition, /<WorkCaseContributionsContent contributions=\{item\.card\.contributedTo\} locale=\{locale\} onOpenTarget=\{onOpenContribution\} \/>/);
  assert.match(cognition, /onOpenContribution=\{\(target, targetTitle\) => openPanel\(\{/);
});

test('closed cards use terminal closure content while unclassified cards stay minimal', () => {
  const list = source('src/pages/ObjectList.tsx');
  const closedContent = list.slice(list.indexOf('function WorkCaseClosedContent'), list.indexOf('function WorkCaseContributionsContent'));
  const terminalStatus = list.indexOf("displayStatus={progressGroup ?? 'unknown'}");
  const progressingEnd = list.lastIndexOf('      return (', terminalStatus);
  const adrStart = list.indexOf("if (currentType === 'adr')");
  const terminalBranch = list.slice(progressingEnd, adrStart);

  assert.match(terminalBranch, /<ObjectCardFrame/);
  assert.match(terminalBranch, /displayStatus=\{progressGroup \?\? 'unknown'\}/);
  assert.match(terminalBranch, /workcaseProgressGroupUnavailable/);
  assert.match(list, /<WorkCaseClosedContent goal=\{obj\.goal\} terminal=\{obj\.closureTerminal\} termination=\{obj\.termination\} \/>/);
  assert.doesNotMatch(terminalBranch, /<WorkCaseContributionsContent contributions=\{obj\.contributedTo\}/);
  assert.match(list, /<FactAssociationsCardContent associations=\{obj\.factAssociations\} \/>/);
  assert.doesNotMatch(list, /getFieldValueLabel\('proposed_disposition', 'route_existing', locale\)/);
  assert.match(list, /getFieldValueLabel\('proposed_disposition', 'suggest_spark', locale\)/);
  assert.match(closedContent, /<WorkCaseOutcomeNotice outcome=\{terminal\.outcome\} dispositionSummary=\{terminal\.dispositionSummary\} mode="terminal" \/>/);
  assert.doesNotMatch(closedContent, /terminal\.routedTo/);
  assert.match(closedContent, /terminal\.acceptedStop\.map/);
  assert.match(closedContent, /<WorkCaseSparkSuggestions suggestions=\{terminal\.sparkSuggestions\} \/>/);
  assert.match(closedContent, /CircleMinus size=\{WORKCASE_SECTION_ICON_SIZE\}/);
  assert.doesNotMatch(closedContent, /ArrowRight size=\{WORKCASE_SECTION_ICON_SIZE\}/);
  assert.doesNotMatch(closedContent, /border-t border-ldvh-border\/45/);
  assert.doesNotMatch(terminalBranch, /executionItems|successCriteria|RecordItem|Integrity|Evidence|BlockingNotice|blocking_summary/);
  assert.doesNotMatch(list, /hasClosureRequestedAt|hasClosureEvidence|hasClosedIntegrityIssue|WorkCaseRecordItem/);
});

test('closure confirmation and closed public Card projections carry goal but no blocked notice or detail body', () => {
  const closure = projectCurrentCard({
    object_id: 'workcase-0100',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'blocked',
    phase: 'human_closure_confirming',
    priority: 'P0',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '关闭 Card 正文可读的目标',
    blocking_summary: '详情仍应保留的阻塞事实',
    success_criterion_definitions: [{ criterion_id: 'criterion-hidden', statement: '不得透传' }],
    work_items: [{ item_id: 'item-hidden', goal: '不得透传', status: 'completed' }],
  });
  const closed = projectCurrentCard({
    object_id: 'workcase-0101',
    fact_type_key: 'workcase',
    title: '已经关闭',
    status: 'closed',
    priority: 'P0',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '进入已关闭 Card 正文的目标',
    closure_outcome: 'completed',
    disposition_summary: '当前责任已经完成。',
  });

  assert.deepEqual(Object.keys(closure).sort(), [
    'blocking_summary', 'current_snapshot_projection', 'fact_type_key', 'goal', 'object_id', 'phase',
    'progress_group', 'status', 'title', 'updated_at',
  ]);
  assert.equal(closure.goal, '关闭 Card 正文可读的目标');
  assert.equal(closure.blocking_summary, '详情仍应保留的阻塞事实');
  assert.equal('closureProposal' in closure, false);
  assert.equal('successCriteria' in closure, false);
  assert.equal('executionItemsActive' in closure, false);
  assert.equal('contributedTo' in closure, false);
  assert.deepEqual(Object.keys(closed).sort(), [
    'closureTerminal', 'closure_outcome', 'current_snapshot_projection', 'fact_type_key', 'goal', 'object_id',
    'progress_group', 'status', 'title', 'updated_at',
  ]);
  assert.equal(closed.goal, '进入已关闭 Card 正文的目标');
  assert.equal(closed.closure_outcome, 'completed');
  assert.equal('contributedTo' in closed, false);
});

test('closure confirmation projects a stable closure-proposal subset only when well-formed', () => {
  const valid = projectCurrentCard({
    object_id: 'workcase-0110',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '完成当前责任。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '接受部分完成并分流剩余责任。',
      residual_decisions: [
        { residual_id: 'residual-a', summary: '后续验证', proposed_disposition: 'route_existing', route_target: { governed_project_id: 'sample', fact_type_key: 'workcase', object_id: 'workcase-0111', content_fingerprint: 'a'.repeat(64) } },
        { residual_id: 'residual-b', summary: '放弃试验分支', proposed_disposition: 'accept_stop' },
      ],
      spark_suggestions: [{ suggestion_id: 'suggestion-next', suggestion_kind: 'follow_up_opportunity', summary: '保留后续机会', follow_up_summary: '由 Human 日后判断是否建立 Spark。' }],
    },
  });

  assert.equal(valid.goal, '完成当前责任。');
  assert.deepEqual(valid.closureProposal, {
    proposedOutcome: 'partial',
    dispositionSummary: '接受部分完成并分流剩余责任。',
    residualDecisions: [
      { residualId: 'residual-a', summary: '后续验证', proposedDisposition: 'route_existing', routeTarget: { governedProjectId: 'sample', factTypeKey: 'workcase', objectId: 'workcase-0111' } },
      { residualId: 'residual-b', summary: '放弃试验分支', proposedDisposition: 'accept_stop' },
    ],
    sparkSuggestions: [{ suggestionId: 'suggestion-next', suggestionKind: 'follow_up_opportunity', summary: '保留后续机会', followUpSummary: '由 Human 日后判断是否建立 Spark。' }],
  });
});

test('closure confirmation preserves UID route targets without rewriting them to legacy triples', () => {
  const objectUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
  const projected = projectCurrentCard({
    object_id: 'workcase-0112',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '保留 UID 路由身份。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '路由剩余责任。',
      residual_decisions: [{
        residual_id: 'residual-uid',
        summary: '继续跟进',
        proposed_disposition: 'route_existing',
        route_target: { object_uid: objectUid, content_fingerprint: 'a'.repeat(64) },
      }],
    },
  });

  const closureProposal = projected.closureProposal as {
    residualDecisions: Array<{ routeTarget?: Record<string, string> }>;
  };
  assert.deepEqual(closureProposal.residualDecisions[0].routeTarget, { objectUid });
});

test('UID-only WorkCase route targets resolve to readable locators when the UID is unique', () => {
  const objectUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
  const uidTargets = new Map([[objectUid, {
    governedProjectId: 'sample',
    factTypeKey: 'spark',
    objectId: 'spark-01KZXN5TXNE0QB8DXQKC9HMXDX',
  }]])
  const projected = projectCurrentWorkCaseCard({
    object_id: 'workcase-0113',
    fact_type_key: 'workcase',
    title: 'UID 路由目标',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '解析 UID 路由。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '路由剩余责任。',
      residual_decisions: [{
        residual_id: 'residual-uid-resolved',
        summary: '继续跟进',
        proposed_disposition: 'route_existing',
        route_target: { object_uid: objectUid, content_fingerprint: 'a'.repeat(64) },
      }],
    },
  }, sourceContentFingerprint, uidTargets)
  const closureProposal = projected.closureProposal as { residualDecisions: Array<{ routeTarget?: Record<string, string> }> }
  assert.deepEqual(closureProposal.residualDecisions[0].routeTarget, {
    objectUid,
    governedProjectId: 'sample',
    factTypeKey: 'spark',
    objectId: 'spark-01KZXN5TXNE0QB8DXQKC9HMXDX',
  })
});

test('closure confirmation accepts legacy triple route targets with UID-native Base32 locators', () => {
  const projected = projectCurrentCard({
    object_id: 'workcase-0114',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '保留 Base32 分流目标。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '路由剩余责任。',
      residual_decisions: [{
        residual_id: 'residual-base32',
        summary: '继续跟进',
        proposed_disposition: 'route_existing',
        route_target: {
          governed_project_id: 'ldvh',
          fact_type_key: 'spark',
          object_id: 'spark-01KZXN5TXNEKMANG1WTFBKT5FW',
          content_fingerprint: 'a'.repeat(64),
        },
      }],
    },
  });

  const closureProposal = projected.closureProposal as { residualDecisions: Array<{ routeTarget?: Record<string, string> }> };
  assert.deepEqual(closureProposal.residualDecisions[0].routeTarget, {
    governedProjectId: 'ldvh',
    factTypeKey: 'spark',
    objectId: 'spark-01KZXN5TXNEKMANG1WTFBKT5FW',
  });
});

test('closure confirmation rejects legacy triple route targets whose locator prefix mismatches the fact type', () => {
  const projected = projectCurrentCard({
    object_id: 'workcase-0115',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '类型前缀必须匹配。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '路由剩余责任。',
      residual_decisions: [{
        residual_id: 'residual-mismatch',
        summary: '继续跟进',
        proposed_disposition: 'route_existing',
        route_target: {
          governed_project_id: 'ldvh',
          fact_type_key: 'spark',
          object_id: 'workcase-01M09NEMZBEP7SX71SYYETB27E',
          content_fingerprint: 'a'.repeat(64),
        },
      }],
    },
  });

  assert.equal('closureProposal' in projected, false);
});

test('closure confirmation rejects route targets without an exact fingerprint and proposals with unknown members', () => {
  const base = {
    object_id: 'workcase-0115',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '目标仍应保留。',
  };
  const proposal = {
    proposed_outcome: 'partial',
    proposed_disposition_summary: '将责任路由至已有对象。',
    residual_decisions: [{
      residual_id: 'residual-route',
      summary: '路由责任',
      proposed_disposition: 'route_existing',
      route_target: {
        governed_project_id: 'sample',
        fact_type_key: 'workcase',
        object_id: 'workcase-0111',
        content_fingerprint: 'b'.repeat(64),
      },
    }],
  };

  const missingFingerprint = structuredClone(proposal);
  delete (missingFingerprint.residual_decisions[0].route_target as { content_fingerprint?: string }).content_fingerprint;
  const badFingerprint = structuredClone(proposal);
  badFingerprint.residual_decisions[0].route_target.content_fingerprint = 'not-a-sha256';
  const unknownProposalMember = { ...proposal, generated_hint: 'must not be ignored' };
  const unknownTargetMember = structuredClone(proposal);
  Object.assign(unknownTargetMember.residual_decisions[0].route_target, { title: 'must be reread, not trusted' });

  for (const closureProposal of [missingFingerprint, badFingerprint, unknownProposalMember, unknownTargetMember]) {
    const projected = projectCurrentCard({ ...base, closure_proposal: closureProposal });
    assert.equal('closureProposal' in projected, false);
    assert.equal(projected.goal, '目标仍应保留。');
  }
});

test('closure confirmation rejects malformed proposal-local IDs and type-mismatched route object IDs', () => {
  const base = {
    object_id: 'workcase-0116',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '目标仍应保留。',
  };
  const validRoute = {
    proposed_outcome: 'partial',
    proposed_disposition_summary: '将责任路由至已有对象。',
    residual_decisions: [{
      residual_id: 'residual-route',
      summary: '路由责任',
      proposed_disposition: 'route_existing',
      route_target: {
        governed_project_id: 'sample',
        fact_type_key: 'spark',
        object_id: 'spark-0111',
        content_fingerprint: 'c'.repeat(64),
      },
    }],
  };
  const malformedResidual = structuredClone(validRoute);
  malformedResidual.residual_decisions[0].residual_id = 'residual_bad';
  const mismatchedTarget = structuredClone(validRoute);
  mismatchedTarget.residual_decisions[0].route_target.object_id = 'workcase-0111';
  const malformedSuggestion = {
    proposed_outcome: 'completed',
    proposed_disposition_summary: '没有剩余责任。',
    spark_suggestions: [{
      suggestion_id: 'suggestion_bad',
      suggestion_kind: 'follow_up_opportunity',
      summary: '后续机会',
      follow_up_summary: '由 Human 日后判断。',
    }],
  };

  for (const closureProposal of [malformedResidual, mismatchedTarget, malformedSuggestion]) {
    const projected = projectCurrentCard({ ...base, closure_proposal: closureProposal });
    assert.equal('closureProposal' in projected, false);
  }
});

test('closure confirmation drops the whole proposal when any residual member is malformed', () => {
  const projected = projectCurrentCard({
    object_id: 'workcase-0113',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '目标仍应保留。',
    closure_proposal: {
      proposed_outcome: 'partial',
      proposed_disposition_summary: '不能静默忽略坏成员。',
      residual_decisions: [
        { residual_id: 'residual-a', summary: '有效责任', proposed_disposition: 'accept_stop' },
        { summary: '缺少稳定 residual_id', proposed_disposition: 'accept_stop' },
      ],
    },
  });

  assert.equal('closureProposal' in projected, false);
  assert.equal(projected.goal, '目标仍应保留。');
});

test('completed closure proposal rejects constrained-responsibility Spark suggestions', () => {
  const projected = projectCurrentCard({
    object_id: 'workcase-0114',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '目标仍应保留。',
    closure_proposal: {
      proposed_outcome: 'completed',
      proposed_disposition_summary: '错误地遗留了受限责任。',
      spark_suggestions: [{
        suggestion_id: 'suggestion-blocked',
        suggestion_kind: 'constrained_responsibility',
        summary: '受限责任',
        restriction_reason: '缺少外部条件。',
        impact_summary: '责任尚未完成。',
        resume_condition: '条件恢复。',
        follow_up_summary: '由 Human 判断是否建立 Spark。',
      }],
    },
  });

  assert.equal('closureProposal' in projected, false);
});

test('closure confirmation drops the whole proposal when outcome or disposition summary is invalid', () => {
  const base = {
    object_id: 'workcase-0112',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    goal: '目标仍应保留。',
  };
  const missingOutcome = projectCurrentCard({ ...base, closure_proposal: { proposed_disposition_summary: '只有摘要。' } });
  const emptySummary = projectCurrentCard({ ...base, closure_proposal: { proposed_outcome: 'completed', proposed_disposition_summary: '   ' } });
  const unknownOutcome = projectCurrentCard({ ...base, closure_proposal: { proposed_outcome: 'done', proposed_disposition_summary: '摘要。' } });

  assert.equal('closureProposal' in missingOutcome, false);
  assert.equal('closureProposal' in emptySummary, false);
  assert.equal('closureProposal' in unknownOutcome, false);
  assert.equal(missingOutcome.goal, '目标仍应保留。');
});

test('closure confirmation projection carries only stable contributed-to target triples', () => {
  const closure = projectCurrentCard({
    object_id: 'workcase-0102',
    fact_type_key: 'workcase',
    title: '等待关闭确认',
    status: 'open',
    phase: 'human_closure_confirming',
    updated_at: '2026-07-27T00:00:00+08:00',
    relations: [
      { relation_key: 'contributed-to', target: { governed_project_id: 'sample', fact_type_key: 'adr', object_id: 'adr-0007' } },
      { relation_key: 'contributed-to', target: { governed_project_id: 'sample', fact_type_key: 'pitfall', object_id: 'pitfall-0003' } },
      { relation_key: 'routed-to', target: { governed_project_id: 'sample', fact_type_key: 'workcase', object_id: 'workcase-0103' } },
      { relation_key: 'contributed-to', target: { fact_type_key: 'spark' } },
      { relation_key: 'contributed-to' },
    ],
  });

  assert.deepEqual(closure.contributedTo, [
    { governedProjectId: 'sample', factTypeKey: 'pitfall', objectId: 'pitfall-0003' },
  ]);
});

test('closed projection carries only Pitfall contributions', () => {
  const closed = projectCurrentCard({
    object_id: 'workcase-0104',
    fact_type_key: 'workcase',
    title: '已经关闭',
    status: 'closed',
    updated_at: '2026-07-27T00:00:00+08:00',
    relations: [
      { relation_key: 'contributed-to', target: { governed_project_id: 'sample', fact_type_key: 'pitfall', object_id: 'pitfall-0009' } },
    ],
  });

  assert.deepEqual(closed.contributedTo, [{ governedProjectId: 'sample', factTypeKey: 'pitfall', objectId: 'pitfall-0009' }]);
});

test('relation labels include contributed-to and the detail chip resolves it by key', () => {
  const locales = source('src/i18n/locales.ts');
  const associations = source('src/pages/object-detail/FactAssociationsSection.tsx');

  assert.match(locales, /relation_contributed_to: \{ zh: '贡献了', en: 'Contributed To' \}/);
  assert.match(locales, /'objectList\.workcaseContributions': '后续贡献'/);
  assert.match(locales, /'objectList\.workcaseContributions': 'Follow-up contributions'/);
  assert.match(associations, /relation_\$\{relationKey\.replace\(\/-\/g, '_'\)\}/);
});

test('current list projection preserves every real work-item identity and current status', () => {
  const summary = projectCurrentCard(currentWorkCase());

  assert.equal(summary.executionItemsProjectionValid, true);
  const items = summary.executionItems as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((item) => item.id), ['item-done', 'item-running', 'item-blocked', 'item-cancelled']);
  assert.deepEqual(items.map((item) => item.status), ['completed', 'in_progress', 'blocked', 'cancelled']);
  assert.equal(items[2]?.blockingReason, '等待 Human 提供输入。');
  assert.equal('successCriteria' in summary, false);
});

test('public progressing projection keeps counts and active items without the complete item plan', () => {
  const facts = source('api/services/facts.ts');
  const projectionStart = facts.indexOf('function projectCurrentWorkCaseCardShape');
  const projectionEnd = facts.indexOf('export async function listObjects', projectionStart);
  const publicProjection = facts.slice(projectionStart, projectionEnd);

  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  assert.match(publicProjection, /projectCardWorkItems\(fact\.work_items\)/);
  assert.doesNotMatch(publicProjection, /projected\.work_items/);
  assert.doesNotMatch(facts, /export function projectWorkCaseCard\b/);
});

test('public work-item projection exposes only fields consumed by the Card', () => {
  const projected = projectCurrentCard(currentWorkCase());
  const items = projected.executionItems as Array<Record<string, unknown>>;

  assert.deepEqual(Object.keys(items[0] ?? {}).sort(), ['id', 'status', 'title']);
  assert.deepEqual(Object.keys(items[2] ?? {}).sort(), ['blockingReason', 'id', 'status', 'title']);
});

test('malformed current items and criteria become unavailable without generated replacements', () => {
  const summary = projectCurrentCard(currentWorkCase({
    success_criterion_definitions: [{ criterion_id: 'criterion-visible-result' }],
    success_criteria: ['不得读取的已退出标准'],
    work_items: [
      {
        goal: '缺少稳定 item_id',
        expected_result: '不应形成投影',
        status: 'in_progress',
        current_summary: '正在执行。',
        resume_from: '继续执行。',
      },
    ],
  }));

  assert.equal(summary.executionItemsProjectionValid, false);
  assert.deepEqual(summary.executionItems, []);
  assert.equal('successCriteria' in summary, false);
});

test('closed summaries do not reconstruct removed process fields or completeness diagnostics', () => {
  const summary = projectCurrentCard(currentWorkCase({
    status: 'closed',
    phase: undefined,
    progress_group: 'closed',
    progress_step: undefined,
    priority: undefined,
    plan_version: undefined,
    work_items: undefined,
    closure_outcome: 'completed',
    disposition_summary: '责任已经关闭。',
  }));

  assert.equal('executionItemsProjectionValid' in summary, false);
  assert.equal('executionItems' in summary, false);
  assert.equal('hasClosureRequestedAt' in summary, false);
  assert.equal('hasPlanConfirmedAt' in summary, false);
  assert.equal('hasVerificationEvidence' in summary, false);
  assert.equal('hasClosureEvidence' in summary, false);
  assert.equal('successCriteria' in summary, false);
});

test('plan confirmation projection preserves every criterion statement without truncation', () => {
  const summary = projectCurrentCard(currentWorkCase({
    phase: 'human_plan_confirming',
    progress_group: 'plan_confirmation',
    progress_step: undefined,
  }));

  assert.deepEqual(summary.successCriteria, ['完整显示当前成功标准。']);
  assert.equal(summary.scope, '只测试当前 Card 投影。');
  assert.deepEqual(summary.success_criterion_definitions, currentWorkCase().success_criterion_definitions);
  assert.deepEqual(summary.work_items, currentWorkCase().work_items);
  assert.deepEqual(summary.creation_reviews, currentWorkCase().creation_reviews);
  assert.deepEqual(summary.execution_authorization, currentWorkCase().execution_authorization);
  assert.deepEqual(summary.execution_approval, currentWorkCase().execution_approval);
  assert.equal('executionItems' in summary, false);
});

test('blocked plan confirmation projects a separate complete state-alert fact', () => {
  const summary = projectCurrentCard(currentWorkCase({
    status: 'blocked',
    phase: 'human_plan_confirming',
    progress_group: 'plan_confirmation',
    progress_step: undefined,
    blocking_summary: '等待 Human 明确当前计划边界。',
  }));

  assert.equal(summary.goal, '只消费当前字段。');
  assert.deepEqual(summary.successCriteria, ['完整显示当前成功标准。']);
  assert.equal(summary.blocking_summary, '等待 Human 明确当前计划边界。');
  assert.equal('executionItems' in summary, false);
  assert.equal('waiting_on' in summary, false);
});

test('WorkCase list code has no profile, date-boundary, or historical item projection path', () => {
  const route = source('api/routes/objects.ts');
  const shared = source('shared/workcaseStatus.ts');

  assert.doesNotMatch(route, /WorkCaseProfileKind|WORKCASE_CURRENT_BOUNDARY|WORKCASE_V2_BOUNDARY|workcase_profile/);
  assert.doesNotMatch(route, /parseStrictRfc3339|execution-item-|orchestration\.execution_items/);
  assert.doesNotMatch(route, /closure_requested_at|review_requested_at|closure_approval/);
  assert.doesNotMatch(route, /hasClosureRequestedAt|hasPlanConfirmedAt|hasVerificationEvidence|hasClosureEvidence/);
  assert.doesNotMatch(shared, /result_self_checking|subagents_result_reviewing|review_needed|draft|active/);
});

test('detail copy actions never fall back from an exact canonical path to a list or route path', () => {
  const detail = source('src/pages/ObjectDetail.tsx');

  assert.doesNotMatch(detail, /canonical_path\s*\?\?\s*(?:obj\.)?path/);
  assert.doesNotMatch(detail, /CopyPathButton path=\{item\?\.path\}/);
  assert.doesNotMatch(detail, /function DetailObjectRow|function buildCurrentFlowItem/);
});

test('WorkCase list does not expose application-level reread controls', () => {
  const list = source('src/pages/ObjectList.tsx');

  assert.doesNotMatch(list, /WorkCaseObservationControls|coverageObservedAt|reloadVersion|setReloadVersion|useManualFactRefresh|refreshFacts|RefreshCw|setInterval|visibilitychange/);
  assert.match(list, /currentType === 'workcase' \? \(/);
});

test('WorkCase list reports field-level issues without restoring the V4 machine transport', () => {
  const facts = source('api/services/facts.ts');
  const listStart = facts.indexOf('export async function listObjects');
  const listEnd = facts.indexOf('export async function showObject', listStart);
  const diagnostics = facts.slice(listStart, listEnd);
  const list = source('src/pages/ObjectList.tsx');

  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(diagnostics, /item\.field_issues/);
  assert.doesNotMatch(facts, /v4FactReader|v4FactsTransport|machine\.py/);
  assert.match(list, /workcaseProgressGroupUnavailable/);
});
