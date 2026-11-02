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
  const parts = read('src/components/SubGoalCardParts.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');

  // Human 原话：「当前聚焦的目标块的 sg，都要附带一个进度条」。故进度条是
  // **每一行**的组成部分，不是某一行的特例。
  //
  // 2026-11-03 改版：目标区的每条子目标**常显**一个可数比值（`9 / 30`）+ 两档明细
  // + 等宽条，展开时**额外**给出达成条件、对齐说明与名下工作行。
  //
  // 呈现与子目标卡**同一组件**（`ServingSparkProgressBar` 的行内形态）：口径是
  // 单点派生（`utils/servingSparkProgress.ts`），呈现也不该有两份。
  assert.match(goalSection, /<ServingSparkProgressBar/, '目标区须挂进度条组件');
  assert.match(goalSection, /variant="inline"/, '目标区用行内形态');
  assert.match(goalSection, /subGoal\.serving_work \?\? \[\]/, '须读原始 serving_work 行');
  assert.doesNotMatch(goalSection, /groupServingWorkByType/, '不得把关联投影当作比值输入');
  // 比值不得在目标区里另算一份——行内形态自己不算，它接收已算好的派生。
  assert.doesNotMatch(goalSection, /summarizeServingSparkProgress/, '目标区不得自算比值');

  // 名下工作区（列表卡与详情页共用的那个实现）仍挂同一个进度条组件。
  assert.match(parts, /<ServingSparkProgressBar/, '名下工作区须挂进度条组件');
  assert.match(parts, /progressVariant\?: 'block' \| 'inline'/, '进度条形态须可切换');
  assert.match(parts, /variant=\{progressVariant\}/, '形态须传给进度条组件');
  assert.match(bar, /summarizeServingSparkProgress/, '比值由组件内部单点派生');

  // legacy 行不画条：它没有 object_uid，也就没有可反查的身份。给它画空条
  // 等于把「还没有对象」说成「没有火花」。
  assert.match(goalSection, /const hasObject = Boolean\(subGoal\.object_uid\)/, 'legacy 行须排除在进度条之外');
  assert.match(goalSection, /\{hasObject && \(/, '进度条只对有对象的行给出');
});

test('聚焦页与详情页共用同一份比值派生（不可能算出两个数）', () => {
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const util = read('src/utils/servingSparkProgress.ts');
  const goalSection = read('src/components/GoalSection.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const list = read('src/pages/ObjectList.tsx');

  // 单点派生：各处消费面都经同一组件、同一纯函数。
  // 2026-11-03：聚焦页目标区改为复用子目标卡的关联区实现与同一个进度条组件，
  // 故它的比值经 `ServingSparkProgressBar` 挂载（不再直接在 GoalSection 里算）——
  // 派生仍是同一份。
  const parts = read('src/components/SubGoalCardParts.tsx');
  assert.match(bar, /summarizeServingSparkProgress/);
  assert.match(goalSection, /<ServingSparkProgressBar/, '聚焦页须经同一个进度条组件取派生');
  assert.doesNotMatch(goalSection, /summarizeServingSparkProgress/, '聚焦页不得自算一份派生');
  assert.match(parts, /<ServingSparkProgressBar/);
  // 2026-11-03：列表卡的关联区实现下沉到共享组件，故进度条经共享组件挂载；
  // 列表卡仍须**调用**它（单点纪律）。
  assert.match(list, /<SubGoalServingWorkZone/, '列表卡须调用共享的关联区实现');
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
  // 行内形态竖排（数字在上、条在下），条宽由外层定死（`w-24`），条自身取满。
  assert.match(bar, /flex h-1 w-full shrink-0 overflow-hidden rounded-full/, '行内条须铺满固定宽度');
  assert.match(bar, /flex w-24 shrink-0 flex-col items-center gap-1/, '行内组须定宽竖排且居中');
  assert.doesNotMatch(bar.slice(bar.indexOf('function InlineBar')), /flex-1/, '行内条不得吃满剩余宽度');

  // ## 块形态的说明行：居中、弱化，且**不给两档明细**（Human 2026-11-03 定案）
  //
  // 子目标卡／详情页那一行「火花落实 9 / 30 · 已落实 9 · 待处理 21」是**这一块的
  // 注解**，不是这一块的标题。此前它左对齐贴边、且分数取主色（近黑），读起来像卡上
  // 的一个独立小标题。故三处同改：居中（浮在满宽条的正上方）+ 分数弱化 + **两档明细
  // 整段撤除**——「已落实 9 · 待处理 21」是分数的算术展开（加起来就是分母），不是
  // 新信息，是同一件事的第二种说法（`docs/10` §5.5「同类信息只有一处」）。
  const blockSource = bar.slice(
    bar.indexOf('const { implemented, denominator, unknownStatus } = progress;'),
    bar.indexOf('function InlineBar'),
  );
  assert.match(blockSource, /flex min-w-0 items-baseline justify-center gap-2 text-center/, '块形态说明行须居中');
  assert.doesNotMatch(blockSource, /text-ldvh-text-primary/, '块形态的分数不得取主色（须弱化为次级色）');
  // 两档明细不得再出现：口径名 + 分数就是这一行的全部。
  assert.doesNotMatch(blockSource, /implementedLabel|openLabel/, '块形态不得给两档明细');
  assert.doesNotMatch(blockSource, /\{open\}/, '块形态不得渲染待处理计数');
  // 分数再弱一档（次级色的七成）：它是这一块的注解，不是这一块的主角。
  assert.match(blockSource, /font-mono text-ldvh-text-secondary\/70/, '块形态的分数须弱化为次级色的七成');
  // 口径不因弱化而丢失：完整说法仍在条的 aria-label 上。
  assert.match(blockSource, /aria-label=\{`\$\{progressLabel\} \$\{implemented\} \/ \$\{denominator\}`\}/, '完整口径名仍在 aria-label');
  // 两档明细的传参 prop 一并撤除：留一个无人传的 prop，等于让读模型替读者做了个
  // 没人兑现的承诺。
  assert.doesNotMatch(bar, /openLabel|implementedLabel/, '进度条组件不得再声明两档明细的 prop');
});

test('目标区行内进度组：数字弱而小、居中，条更短；展开区＝判据面 + 名下的工作（2026-11-03 定案）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const inlineSource = bar.slice(bar.indexOf('function InlineBar'));

  // ## 比值常显
  //
  // 比值是这一行的**标题级数字**：读者扫目标区问的是「哪条走得远、哪条没动」。
  // 若它随展开收起，它就会在展开时从标题行跳进别的区块，「行 ↔ 比值」的对应断掉。
  assert.doesNotMatch(goalSection, /!expanded &&/, '进度组不得随展开收起');
  assert.match(goalSection, /\{hasObject && \(/, '进度组常显，仅对有对象的行给出');

  // ## 行内形态：数字在上、条在下，无指标名、无两档明细
  //
  // 横排那一组会占掉子目标标题的宽度——窗口一窄，标题就被挤成一列字。
  assert.match(inlineSource, /flex w-24 shrink-0 flex-col items-center gap-1/, '行内形态须竖排且居中');
  assert.doesNotMatch(inlineSource, /implementedLabel|openLabel/, '行内形态不给两档明细');
  assert.doesNotMatch(inlineSource, /metricLabel/, '行内形态不给指标名');
  // 口径名仍在 title / aria-label 上——去掉屏幕上的指标名，不等于丢掉口径。
  assert.match(inlineSource, /aria-label=\{`\$\{progressLabel\} \$\{implemented\} \/ \$\{denominator\}`\}/, '完整口径名仍在 aria-label');

  // ## 数字弱而小、居中（Human 2026-11-03 定案）
  //
  // 比值是这一行的**附属信息**，主角是子目标标题。此前数字取主色 12px，视觉权重
  // 与标题相仿；收弱、收小、居中之后，读者先读标题再读分数。
  assert.match(inlineSource, /font-mono text-\[11px\] leading-6 text-ldvh-text-secondary/,
    '行内数字须取次级色 + 11px（弱而小）');
  assert.doesNotMatch(inlineSource, /text-ldvh-text-primary/, '行内数字不得取主色（那是标题的权重）');
  assert.match(inlineSource, /text-center/, '行内数字须在条上方居中');

  // ## 三种「算不出」在行内也各有短词
  //
  // 收起态若什么都不给，读者会把它读成「这条没有进度信息」——那也是一句假话。
  // 短词落在**数字该在的那一格**：那一列是四条共用的标尺。
  assert.match(inlineSource, /labels\.empty, labels\.emptyTitle/, '空集短词');
  assert.match(inlineSource, /labels\.allDiscarded, labels\.allDiscardedTitle/, '全废弃短词');
  assert.match(inlineSource, /labels\.unavailable, labels\.unavailableTitle/, '读不到短词');
  // 分母为 0 时不画条——空集不是 0%。
  assert.match(inlineSource, /denominator > 0 \? \(/, '分母为 0 时不渲染条');

  // ## 展开区＝判据面 + 名下的工作（与子目标卡同形）
  //
  // Human 2026-11-03 定案：展开后就是子目标卡那两块（判据面 + 名下工作关联行）。
  // 两块都与子目标卡同源（`components/SubGoalCardParts`），各写一份必分叉。
  assert.match(goalSection, /<SubGoalCriterionSurface/, '展开区保留判据面');
  assert.match(goalSection, /<SubGoalServingWorkZone/, '展开区保留名下的工作');
  // 展开区不重复给进度：比值常显在标题行上，同一条子目标不出现第二个比值
  // （`docs/10` §5.5「同类信息只有一处」）。
  assert.match(goalSection, /showProgress=\{false\}/, '展开区不得重复给进度组');

  // ## 展开区不有小标题、不给对齐说明（Human 圈出后去掉）
  //
  // 判据面自带类型色，「达成条件」小标题是复述；对齐说明是**理由**不是判定，
  // 它留在子目标详情页读。
  assert.doesNotMatch(goalSection, /subGoalCriterionLabel/, '展开区不得有「达成条件」小标题');
  assert.doesNotMatch(goalSection, /subGoalAlignmentLabel/, '展开区不得有「对齐说明」小标题');
  assert.doesNotMatch(goalSection, /SubGoalAlignmentNote/, '展开区不得给对齐说明正文');
  assert.doesNotMatch(goalSection, /alignment/, '聚焦页不消费 alignment（投影也不传它）');

  // ## 标题在自己的格子里换行
  //
  // 整行换行会把进度组与展开按钮甩到标题下一行，四条子目标于是错成两种行高。
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

  // ## 数字的行盒与标题的行盒同高
  //
  // 标题是 `ldvh-body`（14px/24px）；数字此前取 `leading-4`（16px），光心比标题
  // 高 4px——同一条行里两条基线错开，扫读时「这个数说的是哪一条」要靠位置去猜
  // （Human 2026-11-03：「这里没垂直居中」）。
  assert.match(inlineSource, /text-\[11px\] leading-6 text-ldvh-text-secondary/,
    '行内数字的行盒须与标题同高（leading-6）');
  // 短词分支（「空集」「已处置」「读不到」）占的是数字那一格，须同样落在标题线上。
  assert.match(inlineSource, /text-center leading-6 \$\{tone\}/, '行内短词须与标题同高且居中');
  // 数字行盒变高后，条若顺延会被推离数字 10px，中间浮一段空白：收回 4px，
  // 整组高度（28px）与行高不变。
  assert.match(inlineSource, /-mt-1 flex h-1 w-full/, '行内条须上提，不因数字变高而拉长整组');

  // ## chip 外裹 24px 盒子
  //
  // `ldvh-chip-sm` 是 18px 高的盒子。裸放时它顶对齐于 24px 的标题行盒，盒心比
  // 标题光心高 3px——次序 chip、状态 chip 各偏一点，整行读起来就是「没对齐」。
  const chipBoxes = goalSection.match(/<span className="flex h-6 shrink-0 items-center">/g) ?? [];
  assert.ok(chipBoxes.length >= 3, '次序 chip、状态 chip、legacy chip 须各自裹一枚 24px 盒子');
  assert.match(goalSection, /<span className="flex h-6 shrink-0 items-center">\s*<SubGoalOrderBadge/,
    '次序 chip 须在 24px 盒子里');

  // ## 展开按钮的文字落在标题线上
  //
  // 按钮内容盒是 `ldvh-meta` 的 20px 行盒；`py-1` 时内容盒低 2px，按钮文字比
  // 标题低半行——同一行里两处文字错开半行，是最容易被眼睛抓住的那种不齐。
  assert.match(goalSection, /px-1\.5 py-0\.5/, '展开按钮内边距须取 py-0.5（按钮文字落在标题线上）');
  assert.doesNotMatch(goalSection, /px-1\.5 py-1\b/, '展开按钮不得取 py-1（会低半行）');

  // ## 行仍取 items-start（不 items-center）
  //
  // 标题换行时，各项须对齐标题的**首行**，而不是整块居中到两行中间。
  assert.match(goalSection, /flex min-w-0 items-start gap-x-2 gap-y-1/, '行须顶对齐（对齐标题首行）');
});
