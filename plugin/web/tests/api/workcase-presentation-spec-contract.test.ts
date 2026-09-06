import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// v4 迁移适配：specs 根可用 LDVH_SPEC_ROOT 覆盖（默认保持 v4 布局的相对推算）。
const repositoryRoot = process.env.LDVH_SPEC_ROOT || path.resolve(import.meta.dirname, '../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function workCaseCardSection(): string {
  const webSpec = source('specs/08-Web 呈现与交互规范.md');
  return webSpec.slice(
    webSpec.indexOf('### 7.4 WorkCase 外部卡片的进展分组投影'),
    webSpec.indexOf('## 8. Web 交互边界'),
  );
}

test('Specs define five progress groups and retain a four-step result track', () => {
  const cardSection = workCaseCardSection();

  assert.match(cardSection, /不是 WorkCase 的 `status`、`phase`、生命周期分类/);
  assert.match(cardSection, /不得显示为“生命周期”“生命周期分类”/);
  assert.match(cardSection, /每张 WorkCase 外部 Card 必须直接、可识别地显示其当前 `progress_group`/);
  assert.match(cardSection, /Dashboard 的 WorkCase 聚合键必须命名为 `byProgressGroup`/);
  assert.match(cardSection, /条目必须以 `progress_group` 承载这五个值/);
  assert.match(cardSection, /不得把派生分组写入名为 `status` 的字段/);
  assert.match(cardSection, /另以 `source_status` 原样承载/);
  assert.match(cardSection, /\| `plan_confirmation` \| 方案待确认 \|/);
  assert.match(cardSection, /\| `progressing` \| 推进中 \|/);
  assert.match(cardSection, /\| `termination_cleanup` \| 终止善后中 \|/);
  assert.match(cardSection, /实际存在的 Human 等待或责任阻塞另行呈现，不改变进展分组/);
  assert.match(cardSection, /\| `closure_confirmation` \| 关闭待确认 \|/);
  assert.match(cardSection, /\| `closed` \| 已关闭 \|/);
  assert.match(cardSection, /Human 已依据完整关闭提案完成普通 Gate2，或 Human 主动中止后的专属善后事务已经完成/);
  assert.match(cardSection, /固定以“关闭提案”为标题/);
  assert.match(cardSection, /不得取代“关闭提案”标题/);
  assert.match(cardSection, /“目标达成 \/ 部分达成 \/ 未达成 \/ 取消”/);
  assert.match(cardSection, /英文为“Achieved \/ Partial \/ Not achieved \/ Cancel”/);
  assert.match(cardSection, /标签不得再重复“提议结论 \/ Proposed conclusion”前缀/);
  assert.match(cardSection, /不得显示裸“完成 \/ Completed”/);
  assert.match(cardSection, /提案使用稳定的中性提案图标和独立的琥珀色提案色调/);
  assert.match(cardSection, /Card 与详情均不得在“终态处置”旁重复显示“完成”/);
  assert.doesNotMatch(cardSection, /Human 已批准当前结果与报告/);
  assert.match(cardSection, /\| `item_execution` \| 工作项执行 \| 当前工作项推进 \|/);
  assert.match(cardSection, /\| `controller_self_check` \| 主控自检 \| 完整结果投影形成 \|/);
  assert.match(cardSection, /\| `independent_review` \| 结果复核 \| 当前结果的实际 Reviewer 第二视角；稳定键不证明实际方法为 subagent 或执行环境独立 \|/);
  assert.match(cardSection, /\| `controller_synthesis` \| 主控收敛 \| 关闭提案形成 \|/);
  assert.match(cardSection, /确定性 `status \+ phase` 映射.*闭集只见 21 §9\.3，本节不重复/);
});

test('Specs place plan revision outside the four-step track without losing current facts', () => {
  const cardSection = workCaseCardSection();

  assert.match(cardSection, /`lifecycle_position=plan_revising` 投影为“推进中”但省略 `progress_step`/);
  assert.match(cardSection, /`lifecycle_position=plan_revising` 时，Card 必须在“推进中”下明确显示“方案修订中”/);
  assert.match(cardSection, /不得高亮四步中的任一项/);
  assert.match(cardSection, /不得新增第五个稳定 `progress_step`/);
  assert.match(cardSection, /真实 active item、`waiting_on` 与 `blocking_summary` 仍按当前事实显示/);
});

test('Specs fix plan-confirmation and progressing Card inputs to the latest fields', () => {
  const cardSection = workCaseCardSection();

  assert.match(cardSection, /`plan_confirmation` Card 是 Gate1 的对象入口。在通用对象身份、标题和进展分组之外，\*\*计划与授权概览区\*\*显示以下三项 Human 阅读入口/);
  assert.match(cardSection, /\*\*目标\*\*：直接读取当前 WorkCase 的 `goal`/);
  assert.match(cardSection, /\*\*成功标准\*\*：直接读取 `success_criterion_definitions\[\]\.statement`/);
  assert.match(cardSection, /\*\*执行授权边界\*\*：直接读取 `execution_authorization`，确定性显示允许动作、禁止项和实际存在的 Human 前置条件数量/);
  assert.match(cardSection, /Card 不提供执行授权的展开、折叠或条目正文/);
  assert.match(cardSection, /完整授权基线仅在同源详情页呈现/);
  assert.match(cardSection, /Human 在 Gate1 操作前必须进入详情阅读完整 authorized action、目标范围、影响范围、风险、回滚/);
  assert.match(cardSection, /字段缺失或不可读时必须明确显示相应信息缺失并禁用批准/);
  assert.match(cardSection, /成功标准是没有先后关系的并列集合，在 Card 中必须统一使用圆点/);
  assert.match(cardSection, /在判断输入区之外另设独立的当前状态提示区，完整显示顶层 `blocking_summary`/);
  assert.match(cardSection, /该提示不构成第四项阅读入口/);
  assert.match(cardSection, /`progressing` Card 在相同通用对象身份、标题和进展分组之外，正文只显示“目标”和“当前情况”两个区域/);
  assert.match(cardSection, /不得引入全局轮次、返回次数、审核次数、完成比例或其它过程计数/);
  assert.match(cardSection, /当前环节为 `item_execution` 时，Card 必须完整列出全部当前 work item/);
  assert.match(cardSection, /不显示“已完成 N\/T”或其它进度比例/);
  assert.match(cardSection, /`completed` 项在前并使用完成勾选/);
  assert.match(cardSection, /`in_progress` 项随后，以当前强调样式突出/);
  assert.match(cardSection, /`pending` 项以弱化样式置于进行中\/阻塞项之后/);
  assert.match(cardSection, /`cancelled` 项也必须保留并明确标识/);
  assert.match(cardSection, /其它推进环节不展开完整工作项清单/);
  assert.match(cardSection, /渲染顺序不表示推进顺序/);
  assert.match(cardSection, /不得把 `item-03` 改写成“第三项”/);
  assert.match(cardSection, /当 `waiting_on` 实际存在时.*“等待对象”标题完整显示正在等待的对象或条件/);
  assert.match(cardSection, /“阻塞说明”标题附加完整显示顶层 `blocking_summary`/);
  assert.match(cardSection, /附加完整显示顶层 `blocking_summary`/);
  assert.match(cardSection, /每条成功标准必须按与工作项一致的对象语法形成独立轻量对象/);
  assert.match(cardSection, /结果摘要作为默认收起的次级内容/);
  assert.match(cardSection, /只保留小号文字与相邻箭头，不使用整行色块或完整边框/);
  assert.match(cardSection, /工作项的预期结果、方法边界和工作项结果遵守同一轻量披露层级/);
  assert.match(cardSection, /只由当前 `success_criterion_results` 是否实际存在决定，不得按 `phase` 推断/);
  assert.match(cardSection, /外部 Card 仍使用本节定义的紧凑圆点清单/);
  assert.match(cardSection, /`progressing` Card 不显示成功标准、scope、依赖、方法、完整工作项计划中的预期结果或执行细节、执行态势条/);
  assert.doesNotMatch(cardSection, /progress_history|第 N 轮|轮次未记录/);
});

test('Specs define the closure-decision input zone and shared formal associations for closure confirmation cards', () => {
  const cardSection = workCaseCardSection();

  assert.match(cardSection, /`closure_confirmation` Card 在通用对象身份、标题、进展分组和更新时间之外，正文定义以下两区/);
  assert.match(cardSection, /\*\*关闭判断输入区\*\*：回答“当前请求确认的是哪一种关闭结论与责任处置”/);
  assert.match(cardSection, /\*\*目标\*\*：直接读取当前 WorkCase 的 `goal`/);
  assert.match(cardSection, /\*\*关闭结论（提议）\*\*：该语义块固定以“关闭提案”为标题/);
  assert.match(cardSection, /直接读取 `closure_proposal\.proposed_outcome`/);
  assert.match(cardSection, /`completed \/ partial \/ not-achieved \/ cancelled` 四值闭集的紧凑本地化标签/);
  assert.match(cardSection, /“关闭提案”标题已经提供提议身份/);
  assert.match(cardSection, /必须在标题旁使用弱信号标签表达/);
  assert.match(cardSection, /不渲染为大面积实心色块或强告警色/);
  assert.match(cardSection, /\*\*处置摘要\*\*：直接读取 `closure_proposal\.proposed_disposition_summary`，完整显示/);
  assert.match(cardSection, /\*\*遗留事项处置建议\*\*：直接读取 `closure_proposal\.residual_decisions\[\]`/);
  assert.match(cardSection, /`route_existing`“路由到已有对象”、`suggest_spark`“建议后续建立 Spark”、`accept_stop`“接受停止”/);
  assert.match(cardSection, /各项是没有先后关系的并列集合，使用与处置语义相称的状态图标/);
  assert.match(cardSection, /route_existing 显示已回读目标的当前标题与类型/);
  assert.match(cardSection, /直接读取 `closure_proposal\.spark_suggestions\[\]`/);
  assert.match(cardSection, /`closure_proposal` 缺失、结构不符或其必要成员不可读时/);
  assert.match(cardSection, /Web 也不得为 `closure_proposal` 补写生成的占位提案/);
  assert.match(cardSection, /正式 `relations` 由所有五类事实对象 Card 统一呈现，而不是链接、URL、材料或引用列表/);
  assert.match(cardSection, /所有可读关联目标（包括已关闭与已废弃的终态目标）均保留/);
  assert.match(cardSection, /活跃 → 推进中 → 待处理 → 已关闭 → 已废弃/);
  assert.match(cardSection, /`contributed-to` 只是其中一类正式关联，不再在 WorkCase Card 另设“后续贡献”模块/);
  assert.match(cardSection, /不根据 relation key 推断分流、依赖、承接责任或终态处置/);
  assert.match(cardSection, /不提供 promote、discard、批量审核或自动过期控件/);
  assert.match(cardSection, /`closure_confirmation` Card 不显示关闭完整性诊断/);
  assert.match(cardSection, /除关闭判断输入区与通用正式关联区外，不展开成功标准结果、结果与验证、主控自检、独立结果复核或执行统计/);
  assert.match(cardSection, /`gate2_position_blocked` 必须改用 blocker-qualified closure-position Card/);
  assert.match(cardSection, /首先显示“关闭位置受阻”及完整 `blocking_summary`/);
  assert.match(cardSection, /不得显示 Gate 2 判断入口、readiness 话术或关闭操作/);
  assert.match(cardSection, /关闭决定由专属事务消费，不持久化 approval 或关闭时间收据/);
  assert.match(cardSection, /详情“关闭提案”节点把 `proposed_outcome` 的紧凑分类放在“关闭提案”标题行/);
  assert.match(cardSection, /`closed` Card 使用与上述关闭 Card 相同的扫读结构/);
  assert.match(cardSection, /route_existing 从 `routed-to` 与当前 target title 呈现/);
  assert.match(cardSection, /正式 `relations` 由所有五类事实对象 Card 统一呈现/);
  assert.doesNotMatch(cardSection, /control-contract|workcase_profile|closure_requested_at|review_requested_at|closure_approval/);
});

test('Cognition Center reuses pending and progressing WorkCase Cards with secondary reading', () => {
  const cognitionCenter = source('web/src/pages/CognitionCenter.tsx');
  const objectList = source('web/src/pages/ObjectList.tsx');
  const apiTypes = source('web/src/utils/api.ts');
  const cognitionRoute = source('web/api/routes/cognition.ts');

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
    assert.doesNotMatch(source(relativePath), retiredTokens, relativePath);
  }
});

test('Current WorkCase phases have direct labels and colors with no retired display keys', () => {
  const locales = source('web/src/i18n/locales.ts');
  const colors = source('web/src/utils/statusColors.ts');

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
  const objectList = source('web/src/pages/ObjectList.tsx');
  const objectDetail = source('web/src/pages/ObjectDetail.tsx');
  const cognitionCenter = source('web/src/pages/CognitionCenter.tsx');
  const panelContent = source('web/src/components/reading-panel/PanelContent.tsx');

  const refreshableSources = [objectList, objectDetail, cognitionCenter, panelContent].join('\n');
  assert.doesNotMatch(refreshableSources, /useManualFactRefresh|refreshFacts|RefreshCw|setInterval|visibilitychange|FACT_REFRESH_INTERVAL_MS/);
  assert.match(panelContent, /\(data as Record<string, unknown> \| undefined\) \?\? detail\?\.data/);
});
