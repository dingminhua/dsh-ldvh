import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';


function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('goal detail route projects the full reading surface from a shared reader', () => {
  const cognition = read('api/routes/cognition.ts');

  assert.match(cognition, /async function readGoalRecord\(project: \{ path: string \}\)/);
  assert.match(cognition, /created_at: typeof meta\.created_at === 'string' \? meta\.created_at : undefined,/);
  assert.match(cognition, /change_log: Array\.isArray\(meta\.change_log\) \? meta\.change_log : \[\],/);
  assert.match(cognition, /canonical_path: 'ldvh-base\/goal\.md',/);
  assert.match(cognition, /GOAL_REQUIRED_FIELDS = \['goal_key', 'title', 'status', 'created_at'\] as const/);
  assert.match(cognition, /reason: 'identity_mismatch', expected: 'project-goal'/);
});

test('recent activity includes the singleton goal change-log stream', () => {
  const cognition = read('api/routes/cognition.ts');

  assert.match(cognition, /type: ObjectType \| 'goal'/);
  assert.match(cognition, /const goalRecord = await readGoalRecord\(project\)/);
  assert.match(cognition, /\{\s*\.\.\.goalRecord\.raw,\s*\n\s*object_id: 'goal',[\s\S]*?\n\s*'goal',\s*\n\s*recentStart,/);
  assert.match(cognition, /code: 'goal_unreadable'/);
  assert.match(cognition, /read_status: 'readable',\s*\n\s*field_issues: goalRecord\.fieldIssues,/);
  const test = read('tests/api/cognition-inbox-contract.test.ts');
  assert.match(test, /\['pitfall', 'spark', 'report', 'goal'\]\.includes/);
});

test('goal registers type semantics: label, status closure, icon, colors', () => {
  const locales = read('src/i18n/locales.ts');
  const icons = read('src/components/SemanticIcon.tsx');
  const colors = read('src/utils/categoryColors.ts');
  const statusColors = read('src/utils/statusColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.match(locales, /goal: \{ zh: '目标', en: 'Goal' \}/);
  assert.match(locales, /goal: \{[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?achieved: \{ zh: '已达成', en: 'Achieved' \},/);
  assert.match(locales, /goal_statement: \{ zh: '目标陈述', en: 'Goal Statement' \}/);
  assert.match(locales, /goal_sub_goals: \{ zh: '子目标', en: 'Sub-goals' \}/);
  assert.match(icons, /goal: Target,/);
  assert.match(colors, /goal: '#10b981'/);
  assert.match(statusColors, /achieved: \{ light: '#059669', dark: '#00d4aa' \}/);
  assert.match(typeColors, /goal: '#10b981'/);
});

test('goal detail page routes through the shared reading layout', () => {
  const app = read('src/App.tsx');
  const goalDetail = read('src/pages/GoalDetail.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');

  assert.match(app, /<Route path="\/goal" element=\{<GoalDetail \/>\} \/>/);
  assert.match(goalDetail, /import \{ ObjectIdentityHeader, FactReadingContent, getAuxiliaryMetaEntries \} from '@\/pages\/ObjectDetail';/);
  assert.match(goalDetail, /objType="goal"/);
  assert.match(objectDetail, /objType === 'goal' \? \(\s*\n\s*<GoalReadingLayout obj=\{obj\} locale=\{locale\} \/>/);
  assert.match(layouts, /export function GoalReadingLayout/);
  assert.match(layouts, /getFieldLabel\('goal_statement', locale\)/);
  assert.match(layouts, /getFieldLabel\('goal_sub_goals', locale\)/);
  assert.match(layouts, /function GoalReadingLayout[\s\S]*?<ChangeLogReadingNode/);
});

test('secondary reading panel resolves the singleton via the direct-read route', () => {
  const panel = read('src/components/reading-panel/PanelContent.tsx');
  const recentRow = read('src/pages/CognitionCenter.tsx');
  const goalDetail = read('src/pages/GoalDetail.tsx');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');

  assert.match(panel, /objectType === 'goal'\s*\n\s*\? fetchCognitionGoal\(\)/);
  assert.match(panel, /const status = objectType === 'goal' \? undefined : readable/);
  assert.match(panel, /target=\{objectType === 'goal' \? readMeta\.canonicalPath \?\? objectId : objectId\}/);
  assert.match(identityActions, /\|\| objectType === 'goal'\)\) && \(/);
  assert.match(recentRow, /\{status && item\.type !== 'goal' && <StatusBadge/);
  assert.match(recentRow, /objectId=\{item\.type === 'goal' \? 'ldvh-base\/goal\.md' : item\.id\}/);
  assert.doesNotMatch(goalDetail, /status=\{headerStatus\}/);
});

test('cognition goal section exposes the detail entry through the title (2026-11-02 Human 定案)', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  assert.match(goalSection, /navigate\('\/goal'\)/);
  assert.match(goalSection, /t\('goalDetail\.openDetail'\)/);
  assert.doesNotMatch(
    goalSection,
    /from 'lucide-react';[^\n]*Maximize2|import \{[^}]*Maximize2/,
    'Maximize2 详情图标已于 2026-11-02 撤除（Human 定案「这个图标去掉」）',
  );
  assert.doesNotMatch(
    goalSection,
    /<Maximize2/,
    'Maximize2 详情图标已于 2026-11-02 撤除（Human 定案「这个图标去掉」）',
  );
  assert.match(goalSection, /role="link"/);
  assert.match(goalSection, /navigate\('\/goal'\)/);
  assert.match(goalSection, /event\.stopPropagation\(\)/);
});


test('目标只有一条陈述，没有摘要字段（2026-11-02 Human 决定）', () => {
  const locales = read('src/i18n/locales.ts');
  const api = read('src/utils/api.ts');
  const cognition = read('api/routes/cognition.ts');

  assert.doesNotMatch(api, /goalSummary|goal_summary|statementSummary/, 'goal 不得有摘要型字段');
  assert.doesNotMatch(cognition, /goalSummary|goal_summary/, '服务端投影不得造摘要字段');
  assert.doesNotMatch(locales, /goalSummary|goal_summary/, 'i18n 不得登记摘要字段标签');
  assert.match(api, /statement: string;/, 'CognitionGoalData 仍以 statement 为唯一内容字段');
  assert.match(cognition, /statement: record\.statement,/);
});

test('聚焦页每条子目标都挂火花落实进度条（2026-11-02 Human 决定）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const parts = read('src/components/SubGoalCardParts.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  assert.match(goalSection, /<ServingSparkProgressBar/, '目标区须挂进度条组件');
  assert.match(goalSection, /variant="inline"/, '目标区用行内形态');
  assert.match(goalSection, /subGoal\.serving_work \?\? \[\]/, '须读原始 serving_work 行');
  assert.doesNotMatch(goalSection, /groupServingWorkByType/, '不得把关联投影当作比值输入');
  assert.doesNotMatch(goalSection, /summarizeServingSparkProgress/, '目标区不得自算比值');

  assert.match(parts, /<ServingSparkProgressBar/, '名下工作区须挂进度条组件');
  assert.match(parts, /progressVariant\?: 'block' \| 'inline'/, '进度条形态须可切换');
  assert.match(parts, /variant=\{progressVariant\}/, '形态须传给进度条组件');
  assert.match(bar, /summarizeServingSparkProgress/, '比值由组件内部单点派生');

  assert.match(goalSection, /const hasObject = Boolean\(subGoal\.object_uid\)/, 'legacy 行须排除在进度条之外');
  assert.match(goalSection, /\{hasObject && \(/, '进度条只对有对象的行给出');
});

test('聚焦页与详情页共用同一份比值派生（不可能算出两个数）', () => {
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const util = read('src/utils/servingSparkProgress.ts');
  const goalSection = read('src/components/GoalSection.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const list = read('src/pages/ObjectList.tsx');

  const parts = read('src/components/SubGoalCardParts.tsx');
  assert.match(bar, /summarizeServingSparkProgress/);
  assert.match(goalSection, /<ServingSparkProgressBar/, '聚焦页须经同一个进度条组件取派生');
  assert.doesNotMatch(goalSection, /summarizeServingSparkProgress/, '聚焦页不得自算一份派生');
  assert.match(parts, /<ServingSparkProgressBar/);
  assert.match(list, /<SubGoalServingWorkZone/, '列表卡须调用共享的关联区实现');
  assert.match(layouts, /<ServingSparkProgressBar/);
  assert.match(util, /denominator: open \+ implemented/, '分母口径在此单点定义');

  const inlineSource = bar.slice(bar.indexOf('function InlineBar'));
  assert.doesNotMatch(inlineSource, /filter\(/, '行内形态不得自己筛行');
  assert.doesNotMatch(inlineSource, /summarizeServingSparkProgress/, '行内形态接收已算好的 progress，不重算');
});

test('行内进度条：三种「算不出」给短词，完整理由挂 title（不画空条）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh;
  const en = UI_LOCALES.en;
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  assert.ok(zh['focusV2.subGoalProgressEmpty'].length <= 6, '空集短词须短');
  assert.ok(zh['focusV2.subGoalProgressAllDiscarded'].length <= 6, '全废弃短词须短');
  assert.ok(zh['focusV2.subGoalProgressUnavailable'].length <= 6, '读不到短词须短');
  assert.equal(zh['focusV2.subGoalProgressEmpty'], '未拆解');
  assert.equal(zh['focusV2.subGoalProgressAllDiscarded'], '已处置');
  assert.equal(zh['focusV2.subGoalProgressUnavailable'], '读不到');
  assert.ok(en['focusV2.subGoalProgressEmpty'].length > 0);
  assert.ok(en['focusV2.subGoalProgressUnavailable'].length > 0);

  assert.match(String(zh['objectList.subGoalSparkProgressUnavailable']), /读不到不等于没有/);

  assert.match(bar, /denominator > 0 \? \(/, '分母为 0 时不渲染条');
  assert.match(bar, /aria-hidden="true"/, '无条时占位不参与读屏');
});

test('聚焦页子目标进度条与卡片、详情共用同一口径的两种形态', () => {
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  assert.match(bar, /variant\?: 'block' \| 'inline'/);
  assert.match(bar, /variant = 'block'/);
  assert.match(bar, /const progress: ServingSparkProgress = summarizeServingSparkProgress\(rows, unreadable\);/);
  assert.match(bar, /flex h-1 w-full shrink-0 overflow-hidden rounded-full/, '行内条须铺满固定宽度');
  assert.match(bar, /flex w-24 shrink-0 flex-col items-center gap-1/, '行内组须定宽竖排且居中');
  assert.doesNotMatch(bar.slice(bar.indexOf('function InlineBar')), /flex-1/, '行内条不得吃满剩余宽度');

  const blockSource = bar.slice(
    bar.indexOf('const { implemented, denominator, unknownStatus } = progress;'),
    bar.indexOf('function InlineBar'),
  );
  assert.match(blockSource, /flex min-w-0 items-baseline justify-center gap-2 text-center/, '块形态说明行须居中');
  assert.doesNotMatch(blockSource, /text-ldvh-text-primary/, '块形态的分数不得取主色（须弱化为次级色）');
  assert.doesNotMatch(blockSource, /implementedLabel|openLabel/, '块形态不得给两档明细');
  assert.doesNotMatch(blockSource, /\{open\}/, '块形态不得渲染待处理计数');
  assert.match(blockSource, /font-mono text-ldvh-text-secondary\/70/, '块形态的分数须弱化为次级色的七成');
  assert.match(blockSource, /aria-label=\{`\$\{progressLabel\} \$\{implemented\} \/ \$\{denominator\}`\}/, '完整口径名仍在 aria-label');
  assert.doesNotMatch(bar, /openLabel|implementedLabel/, '进度条组件不得再声明两档明细的 prop');
});

test('目标区行内进度组：数字弱而小、居中，条更短；展开区＝判据面 + 名下的工作（2026-11-03 定案）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const inlineSource = bar.slice(bar.indexOf('function InlineBar'));

  assert.doesNotMatch(goalSection, /!expanded &&/, '进度组不得随展开收起');
  assert.match(goalSection, /\{hasObject && \(/, '进度组常显，仅对有对象的行给出');

  assert.match(inlineSource, /flex w-24 shrink-0 flex-col items-center gap-1/, '行内形态须竖排且居中');
  assert.doesNotMatch(inlineSource, /implementedLabel|openLabel/, '行内形态不给两档明细');
  assert.doesNotMatch(inlineSource, /metricLabel/, '行内形态不给指标名');
  assert.match(inlineSource, /aria-label=\{`\$\{progressLabel\} \$\{implemented\} \/ \$\{denominator\}`\}/, '完整口径名仍在 aria-label');

  assert.match(inlineSource, /font-mono text-\[11px\] leading-6 text-ldvh-text-secondary/,
    '行内数字须取次级色 + 11px（弱而小）');
  assert.doesNotMatch(inlineSource, /text-ldvh-text-primary/, '行内数字不得取主色（那是标题的权重）');
  assert.match(inlineSource, /text-center/, '行内数字须在条上方居中');

  assert.match(inlineSource, /labels\.empty, labels\.emptyTitle/, '空集短词');
  assert.match(inlineSource, /labels\.allDiscarded, labels\.allDiscardedTitle/, '全废弃短词');
  assert.match(inlineSource, /labels\.unavailable, labels\.unavailableTitle/, '读不到短词');
  assert.match(inlineSource, /denominator > 0 \? \(/, '分母为 0 时不渲染条');

  assert.match(goalSection, /<SubGoalCriterionSurface/, '展开区保留判据面');
  assert.match(goalSection, /<SubGoalServingWorkZone/, '展开区保留名下的工作');
  assert.match(goalSection, /showProgress=\{false\}/, '展开区不得重复给进度组');

  assert.doesNotMatch(goalSection, /subGoalCriterionLabel/, '展开区不得有「达成条件」小标题');
  assert.doesNotMatch(goalSection, /subGoalAlignmentLabel/, '展开区不得有「对齐说明」小标题');
  assert.doesNotMatch(goalSection, /SubGoalAlignmentNote/, '展开区不得给对齐说明正文');
  assert.doesNotMatch(goalSection, /alignment/, '聚焦页不消费 alignment（投影也不传它）');

  assert.doesNotMatch(
    goalSection,
    /className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"/,
    '子目标行不得整行换行',
  );
  assert.match(goalSection, /flex min-w-0 items-start gap-x-2 gap-y-1/, '标题行须顶对齐且不换行');
  assert.match(goalSection, /ldvh-body min-w-0 flex-1 break-words/, '标题须可换行');
});

test('目标区行内垂直基准＝标题那一条线（2026-11-03 定案）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const inlineSource = bar.slice(bar.indexOf('function InlineBar'));

  assert.match(inlineSource, /text-\[11px\] leading-6 text-ldvh-text-secondary/,
    '行内数字的行盒须与标题同高（leading-6）');
  assert.match(inlineSource, /text-center leading-6 \$\{tone\}/, '行内短词须与标题同高且居中');
  assert.match(inlineSource, /-mt-1 flex h-1 w-full/, '行内条须上提，不因数字变高而拉长整组');

  const chipBoxes = goalSection.match(/<span className="flex h-6 shrink-0 items-center">/g) ?? [];
  assert.ok(chipBoxes.length >= 3, '次序 chip、状态 chip、legacy chip 须各自裹一枚 24px 盒子');
  assert.match(goalSection, /<span className="flex h-6 shrink-0 items-center">\s*<SubGoalOrderBadge/,
    '次序 chip 须在 24px 盒子里');

  assert.match(goalSection, /px-1\.5 py-0\.5/, '展开按钮内边距须取 py-0.5（按钮文字落在标题线上）');
  assert.doesNotMatch(goalSection, /px-1\.5 py-1\b/, '展开按钮不得取 py-1（会低半行）');

  assert.match(goalSection, /aria-label=\{t\(expanded \? 'focusV2\.subGoalCollapse' : 'focusV2\.subGoalExpand'\)\}/,
    '撤掉屏幕文字后，可读名须落在 aria-label 上');
  assert.match(goalSection, /title=\{t\(expanded \? 'focusV2\.subGoalCollapse' : 'focusV2\.subGoalExpand'\)\}/,
    '撤掉屏幕文字后，悬停提示须落在 title 上');
  assert.doesNotMatch(goalSection, /<span className="min-w-0 truncate">\{t\(expanded/,
    '目标区行内不得再渲染「展开/收起」文字');

  assert.match(goalSection, /flex h-6 min-w-0 shrink-0 items-center justify-center rounded-md px-1\.5 py-0\.5/,
    '只剩箭头后按钮须定高 24px（靠内边距撑不出最小目标尺寸）');

  assert.match(goalSection, /flex min-w-0 items-start gap-x-2 gap-y-1/, '行须顶对齐（对齐标题首行）');
});
