import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Goal（25 号）详情呈现契约。
 *
 * Goal 是单例冻结锚：单例三免（免 tab 免 card 免候选召回，25 §5）——不占
 * 七类事实对象的导航与列表；详情阅读面经 /api/cognition/goal 直读路由
 * 承载（25 §10 消费点直读），修订史（change_log）进认知中心近期动态。
 */

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('goal detail route projects the full reading surface from a shared reader', () => {
  const cognition = read('api/routes/cognition.ts');

  // /goal 与近期动态共用 readGoalRecord（单例读取唯一实现）。
  assert.match(cognition, /async function readGoalRecord\(project: \{ path: string \}\)/);
  // 详情投影扩展：修订史 + 创建时间 + exact-read 形态的读取层元数据
  //（canonical_path/carrier/read_status 供前端 getFactReadMeta 消费）。
  assert.match(cognition, /created_at: typeof meta\.created_at === 'string' \? meta\.created_at : undefined,/);
  assert.match(cognition, /change_log: Array\.isArray\(meta\.change_log\) \? meta\.change_log : \[\],/);
  assert.match(cognition, /canonical_path: 'ldvh-base\/goal\.md',/);
  // 呈现层轻校验：25 §6 必填闭集 + goal_key 固定值 identity。
  assert.match(cognition, /GOAL_REQUIRED_FIELDS = \['goal_key', 'title', 'status', 'created_at'\] as const/);
  assert.match(cognition, /reason: 'identity_mismatch', expected: 'project-goal'/);
});

test('recent activity includes the singleton goal change-log stream', () => {
  const cognition = read('api/routes/cognition.ts');

  // 类型面放宽：RecentActivityBuildItem 接受 'goal'（非 ACTIVE_OBJECT_TYPES 多例）。
  assert.match(cognition, /type: ObjectType \| 'goal'/);
  // 主路由追加 goal 条目：goal.md 未创建是合法状态（静默跳过），不可读如实披露。
  assert.match(cognition, /const goalRecord = await readGoalRecord\(project\)/);
  assert.match(cognition, /\{\s*\.\.\.goalRecord\.raw,\s*\n\s*object_id: 'goal',[\s\S]*?\n\s*'goal',\s*\n\s*recentStart,/);
  assert.match(cognition, /code: 'goal_unreadable'/);
  // 读取层判定随条目携带：readable 注入防止展示层回退 'unknown' 误报；
  // 轻校验 field_issues 如实带入（goal.md 字段问题可见）。
  assert.match(cognition, /read_status: 'readable',\s*\n\s*field_issues: goalRecord\.fieldIssues,/);
  // 近期动态测试的类型白名单同步纳入 goal。
  const test = read('tests/api/cognition-inbox-contract.test.ts');
  assert.match(test, /\['workcase', 'adr', 'pitfall', 'spark', 'research', 'goal'\]\.includes/);
});

test('goal registers type semantics: label, status closure, icon, colors', () => {
  const locales = read('src/i18n/locales.ts');
  const icons = read('src/components/SemanticIcon.tsx');
  const colors = read('src/utils/categoryColors.ts');
  const statusColors = read('src/utils/statusColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.match(locales, /goal: \{ zh: '目标', en: 'Goal' \}/);
  // 25 §7 状态闭集：active/achieved。
  assert.match(locales, /goal: \{\s*\n\s*\/\/ 25 号 §7[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?achieved: \{ zh: '已达成', en: 'Achieved' \},/);
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

  // /goal 路由（单例无 :id）。
  assert.match(app, /<Route path="\/goal" element=\{<GoalDetail \/>\} \/>/);
  // 复用 ObjectIdentityHeader + FactReadingContent（与七类对象同一设计语言）。
  assert.match(goalDetail, /import \{ ObjectIdentityHeader, FactReadingContent, getAuxiliaryMetaEntries \} from '@\/pages\/ObjectDetail';/);
  assert.match(goalDetail, /objType="goal"/);
  assert.match(objectDetail, /objType === 'goal' \? \(\s*\n\s*<GoalReadingLayout obj=\{obj\} locale=\{locale\} \/>/);
  // 阅读布局：目标陈述 → 子目标（SG-n chip）→ 修订史（复用 ChangeLogReadingNode）。
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

  // 面板 object 预览对 goal 特判走 /cognition/goal（不占 /objects/:type/:id）。
  assert.match(panel, /objectType === 'goal'\s*\n\s*\? fetchCognitionGoal\(\)/);
  // Human 定案 2026-09-12：goal 不显示状态徽章（详情/面板/近期动态三处一致），
  // 复制按钮与其他对象一致（ObjectReferenceCopyButton 白名单含 goal），
  // 引用形态为 projectId@目标md路径（25 §5 单例路径即身份）。
  assert.match(panel, /const status = objectType === 'goal' \? undefined : readable/);
  assert.match(panel, /target=\{objectType === 'goal' \? readMeta\.canonicalPath \?\? objectId : objectId\}/);
  assert.match(identityActions, /\|\| objectType === 'goal'\)\) && \(/);
  assert.match(recentRow, /\{status && item\.type !== 'goal' && <StatusBadge/);
  assert.match(recentRow, /objectId=\{item\.type === 'goal' \? 'ldvh-base\/goal\.md' : item\.id\}/);
  // 详情页不传 status（头部无状态徽章）。
  assert.doesNotMatch(goalDetail, /status=\{headerStatus\}/);
});

test('cognition goal section exposes the detail entry through the title (2026-11-02 Human 定案)', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  assert.match(goalSection, /navigate\('\/goal'\)/);
  assert.match(goalSection, /t\('goalDetail\.openDetail'\)/);
  // 2026-11-02（Human 定案）：区头右侧那枚 `Maximize2` 详情图标撤除，详情入口
  // 改由**标题本身**承担。守卫改向：断言「图标按钮不在了」+「标题仍能进详情」。
  // 只看 import 行——文件头的说明注释里仍会提到这枚图标的历史（那是记录，不是
  // 渲染面），按源码全文断言会把注释误判成活代码。
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
  // 标题可点：标题内的可点元素带 role="link"，且点它时不冒泡（区头整行的点击
  // 是折叠，二者不同义）。
  assert.match(goalSection, /role="link"/);
  assert.match(goalSection, /navigate\('\/goal'\)/);
  assert.match(goalSection, /event\.stopPropagation\(\)/);
});

// ---------------------------------------------------------------------------
// 目标陈述是唯一内容字段 + 聚焦页子目标进度条（2026-11-02 Human 决定）
// ---------------------------------------------------------------------------

test('目标只有一条陈述，没有摘要字段（2026-11-02 Human 决定）', () => {
  const locales = read('src/i18n/locales.ts');
  const api = read('src/utils/api.ts');
  const cognition = read('api/routes/cognition.ts');

  // 25 §7：本类型只有一个内容字段。概要/摘要型字段一个都不许有——一旦并存
  // 「短版」与「长版」，两者必然分叉，而分叉时没有机械判据说哪版才是目标。
  assert.doesNotMatch(api, /goalSummary|goal_summary|statementSummary/, 'goal 不得有摘要型字段');
  assert.doesNotMatch(cognition, /goalSummary|goal_summary/, '服务端投影不得造摘要字段');
  assert.doesNotMatch(locales, /goalSummary|goal_summary/, 'i18n 不得登记摘要字段标签');
  // 陈述仍是唯一的内容投影，且聚焦页与详情页读的是同一个字段。
  assert.match(api, /statement: string;/, 'CognitionGoalData 仍以 statement 为唯一内容字段');
  assert.match(cognition, /statement: record\.statement,/);
});

test('聚焦页每条子目标都挂火花落实进度条（2026-11-02 Human 决定）', () => {
  const goalSection = read('src/components/GoalSection.tsx');

  // Human 原话：「当前聚焦的目标块的 sg，都要附带一个进度条」。故进度条是
  // **每一行**的组成部分，不是某一行的特例。
  assert.match(goalSection, /<ServingSparkProgressBar/, '目标区须挂进度条组件');
  assert.match(goalSection, /variant="inline"/, '目标区用行内形态（块形态会把标题挤成两行）');
  // 输入必须是原始 serving_work 行：关联投影的 status 已被换成关联状态轴，
  // 数出来恒为 0 条（2026-11-02 已在卡片上踩过一次）。
  assert.match(goalSection, /rows=\{sg\.serving_work \?\? \[\]\}/, '须读原始 serving_work 行');
  assert.doesNotMatch(goalSection, /groupServingWorkByType/, '不得把关联投影当作比值输入');

  // legacy 行不画条：它没有 object_uid，也就没有可反查的身份。给它画空条
  // 等于把「还没有对象」说成「没有火花」。
  assert.match(goalSection, /\{sg\.object_uid && \(/, 'legacy 行须排除在进度条之外');
});

test('聚焦页与详情页共用同一份比值派生（不可能算出两个数）', () => {
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const util = read('src/utils/servingSparkProgress.ts');
  const goalSection = read('src/components/GoalSection.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const list = read('src/pages/ObjectList.tsx');

  // 单点派生：三处消费面都经同一组件、同一纯函数。
  assert.match(bar, /summarizeServingSparkProgress/);
  assert.match(goalSection, /<ServingSparkProgressBar/);
  assert.match(list, /<ServingSparkProgressBar/);
  assert.match(layouts, /<ServingSparkProgressBar/);
  assert.match(util, /denominator: open \+ implemented/, '分母口径在此单点定义');

  // 行内形态不得自己算分子分母——它只是展示密度不同，判据必须同源。
  const inlineSource = bar.slice(bar.indexOf('function InlineBar'));
  assert.doesNotMatch(inlineSource, /filter\(/, '行内形态不得自己筛行');
  assert.doesNotMatch(inlineSource, /summarizeServingSparkProgress/, '行内形态接收已算好的 progress，不重算');
});

test('行内进度条：三种「算不出」给短词，完整理由挂 title（不画空条）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh;
  const en = UI_LOCALES.en;
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  // 短词必须存在且是短词——长句会把子目标标题挤成两行。
  assert.ok(zh['focusV2.subGoalProgressEmpty'].length <= 6, '空集短词须短');
  assert.ok(zh['focusV2.subGoalProgressAllDiscarded'].length <= 6, '全废弃短词须短');
  assert.ok(zh['focusV2.subGoalProgressUnavailable'].length <= 6, '读不到短词须短');
  assert.equal(zh['focusV2.subGoalProgressEmpty'], '未拆解');
  assert.equal(zh['focusV2.subGoalProgressAllDiscarded'], '已处置');
  assert.equal(zh['focusV2.subGoalProgressUnavailable'], '读不到');
  assert.ok(en['focusV2.subGoalProgressEmpty'].length > 0);
  assert.ok(en['focusV2.subGoalProgressUnavailable'].length > 0);

  // 完整说明仍须存在（挂在 title 上）：短词若没有配套说明，「读不到」会被
  // 读成一个状态而不是一个读取故障（00 §5.6）。
  assert.match(String(zh['objectList.subGoalSparkProgressUnavailable']), /读不到不等于没有/);

  // 分母为 0 时不画条：行内形态也必须守住这条（0/0 不是 0%）。
  assert.match(bar, /denominator > 0 \? \(/, '分母为 0 时不渲染条');
  assert.match(bar, /aria-hidden="true"/, '无条时占位不参与读屏');
});

test('聚焦页子目标进度条与卡片、详情共用同一口径的两种形态', () => {
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  // variant 只有两档，且默认仍是块形态——新增形态不得改动既有两处消费面。
  assert.match(bar, /variant\?: 'block' \| 'inline'/);
  assert.match(bar, /variant = 'block'/);
  // 两种形态共用同一次 summarize 调用（数值不可能不一致）。
  assert.match(bar, /const progress: ServingSparkProgress = summarizeServingSparkProgress\(rows, unreadable\);/);
  // 行内形态的条用**固定宽度**而非吃满剩余：目标区整行宽达 2000px，拉满会让
  // 9/30 看起来像「几乎走完」。固定宽度让四条仍共用同一把尺子，分数落在条尾旁边。
  assert.match(bar, /flex h-1 w-32 shrink-0 overflow-hidden rounded-full/, '行内条须固定宽度');
  assert.doesNotMatch(bar.slice(bar.indexOf('function InlineBar')), /flex-1/, '行内条不得吃满剩余宽度');
});
