import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * SubGoal（28 号）Web 呈现契约。
 *
 * 该类型在 28 号规范里是独立的第 8 类事实对象。本测试锁定它的呈现面与后端
 * 类型面不再回退：类型注册、状态闭集、判据类型闭集的本地化、列表卡片分支、
 * 详情阅读布局、导航入口的**撤除**（2026-11-13 Human 定案：侧栏不设子目标
 * 入口，子目标由聚焦页目标区承载并下钻）、以及**最重要的两条语义边界**——
 *
 *   1. 名下工作为空时必须是「未声明或未拆解」的歧义标注，**不得**折算成进度 0；
 *   2. 达成态不得由「名下工单都关了」推出（28 §18 红线 3）。
 *
 * 这两条不是文案偏好：它们是该类型存在的理由——若呈现层把空集读成 0%、把
 * 工单关闭数读成达成，子目标就退化成一个装饰性的进度条，判据与对齐说明都
 * 白写了。
 */

const webRoot = path.resolve('.');
function read(relativePath: string) {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
}

test('subgoal 进入后端类型面：活跃列表、详情 id 模式、markdown 载体、目录', () => {
  const facts = read('api/services/facts.ts');
  const reader = read('api/services/localFactReader.ts');
  const contract = read('api/services/factFieldContract.ts');
  const pytools = read('api/services/pytools.ts');
  const federation = read('api/routes/federation.ts');

  // ACTIVE_OBJECT_TYPES 含 subgoal（包含式，不锁整个数组字面量——列表会长）。
  const activeTypes = /ACTIVE_OBJECT_TYPES = \[([^\]]+)\]/.exec(facts);
  assert.ok(activeTypes, 'facts.ts 应导出 ACTIVE_OBJECT_TYPES');
  assert.match(activeTypes[1], /'subgoal'/, 'ACTIVE_OBJECT_TYPES 应含 subgoal');

  // 详情路由 id 前缀模式覆盖 subgoal。
  const idPattern = /OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(facts);
  assert.ok(idPattern, 'facts.ts 应定义 OBJECT_ID_PATTERN');
  assert.ok(idPattern[1].split('|').includes('subgoal'), 'OBJECT_ID_PATTERN 应覆盖 subgoal');

  // 读取器：目录、载体扩展名、markdown 类型集合、文件名 id 模式。
  assert.match(reader, /subgoal: 'subgoals'/, 'FACT_TYPE_DIRS 应登记 subgoal → subgoals');
  assert.match(reader, /subgoal: '\.md'/, 'FACT_TYPE_CARRIERS 应登记 subgoal → .md');
  const carrierSet = /MARKDOWN_CARRIER_TYPES[^=]*= new Set<[^>]+>\(\[([^\]]+)\]\)/.exec(reader);
  assert.ok(carrierSet, 'localFactReader 应定义 MARKDOWN_CARRIER_TYPES');
  assert.match(carrierSet[1], /'subgoal'/, 'MARKDOWN_CARRIER_TYPES 应含 subgoal');
  const readerIdPattern = /FACT_OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(reader);
  assert.ok(readerIdPattern, 'localFactReader 应定义 FACT_OBJECT_ID_PATTERN');
  assert.ok(readerIdPattern[1].split('|').includes('subgoal'), 'FACT_OBJECT_ID_PATTERN 应覆盖 subgoal');

  // 字段契约、pytools、联邦路由同步。
  assert.match(contract, /FACT_TYPES = \[[^\]]*'subgoal'/, 'FACT_TYPES 应含 subgoal');
  assert.match(pytools, /OBJECT_TYPES = \[[^\]]*'subgoal'/, 'pytools OBJECT_TYPES 应含 subgoal');
  assert.match(federation, /OBJECT_TYPES = \[[^\]]*'subgoal'/, '联邦 OBJECT_TYPES 应含 subgoal');
});

test('subgoal 字段契约：五个必填判据字段齐全，且不采用 urls/relations', async () => {
  const { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES, FACT_TERMINAL_STATUSES } =
    await import('../../api/services/factFieldContract.ts');

  const contract = FACT_FIELD_CONTRACT.subgoal;
  assert.ok(contract, 'FACT_FIELD_CONTRACT 应登记 subgoal');

  // 28 §8：这五项缺任一，子目标就不再是「可判定 + 已声明对齐」的对象。
  for (const required of ['parent_goal', 'criterion', 'criterion_kind', 'alignment']) {
    assert.equal(contract[required]?.required, true, `${required} 必须是必填字段（28 §8）`);
  }
  // disposition 只在 retired 出现——条件字段，不得登记为必填。
  assert.equal(contract.disposition?.required, false, 'disposition 是条件字段');

  // 28 §11：不采用 urls（判据与对齐住正文）与 relations（层级由 parent_goal+serves
  // 派生）。它们经 `...common` 进入契约表（全类型同形，spark 亦然），故此处断言
  // 的是**它们永远不会出现**：既不可能是必填，也不进列表投影的可达面。
  // 「必填面排除」由 tests/api/fact-field-contract.test.ts 的
  // COMMON_FIELD_EXEMPTIONS 承载（该处登记 subgoal 两条豁免，与 spark 同形）。
  assert.equal(contract.urls?.required, false, 'urls 不得为必填（28 §11 不采用）');
  assert.equal(contract.relations?.required, false, 'relations 不得为必填（28 §11 不采用）');

  // 正文以 report_body 承载（读取层统一投影名），列表不携带全文。
  assert.ok('report_body' in contract, 'subgoal 应以 report_body 承载正文');
  assert.ok(!FACT_LIST_FIELD_NAMES.subgoal.includes('report_body'), '列表投影不得携带正文');

  // 28 §9：achieved 与 retired 均为终态。
  assert.deepEqual([...FACT_TERMINAL_STATUSES.subgoal].sort(), ['achieved', 'retired']);
});

test('subgoal 状态闭集与判据类型闭集都有本地化词条（不得直出 raw 枚举）', async () => {
  const { getObjectStatusLocale, getFieldValueLabel } = await import('../../src/i18n/locales.ts');

  // 28 §9 三态，中文界面不得显示 active/achieved/retired 原文。
  assert.equal(getObjectStatusLocale('subgoal', 'active', 'zh'), '推进中');
  assert.equal(getObjectStatusLocale('subgoal', 'achieved', 'zh'), '已达成');
  assert.equal(getObjectStatusLocale('subgoal', 'retired', 'zh'), '已作废');
  for (const status of ['active', 'achieved', 'retired']) {
    assert.notEqual(getObjectStatusLocale('subgoal', status, 'zh'), status, `${status} 不得直出 raw 值`);
    assert.notEqual(getObjectStatusLocale('subgoal', status, 'en'), status, `${status} 英文侧同样需映射`);
  }

  // 28 §10.2 判据类型闭集——直出 metric/closure-records/executable-check 属违规。
  assert.equal(getFieldValueLabel('criterion_kind', 'metric', 'zh'), '指标');
  assert.equal(getFieldValueLabel('criterion_kind', 'closure-records', 'zh'), '闭环记录');
  assert.equal(getFieldValueLabel('criterion_kind', 'executable-check', 'zh'), '可执行校验');
});

test('subgoal 状态筛选闭集与默认过滤（28 §9：默认只列 active）', async () => {
  const filter = read('src/components/ObjectStatusFilter.tsx');
  const listStatus = read('src/utils/listStatus.ts');

  assert.match(filter, /subgoal: \['active', 'achieved', 'retired'\]/, '状态筛选闭集应登记 subgoal 三态');
  // achieved 必须进入状态排序位，否则「全部」收起时它会被排到未登记位置。
  assert.match(filter, /'achieved'/, 'STATUS_FILTER_ORDER 应含 achieved');

  const activeDefaults = /DEFAULT_ACTIVE_TYPES = new Set\(\[([^\]]+)\]\)/.exec(listStatus);
  assert.ok(activeDefaults, 'listStatus 应定义 DEFAULT_ACTIVE_TYPES');
  assert.match(activeDefaults[1], /'subgoal'/, 'subgoal 默认过滤应为 active');
});

test('subgoal 有列表卡与详情阅读布局，且二者都按锚点定位', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const detail = read('src/pages/ObjectDetail.tsx');

  assert.match(objectList, /export function SubGoalCardContent/, 'ObjectList 应导出 SubGoalCardContent');
  assert.match(objectList, /currentType === 'subgoal'/, '列表渲染应分派 subgoal 卡片');
  assert.match(layouts, /export function SubGoalReadingLayout/, '应导出 SubGoalReadingLayout');
  assert.match(detail, /objType === 'subgoal'/, '详情页应分派 subgoal 阅读布局');
  assert.match(detail, /SubGoalReadingLayout/, '详情页应 import SubGoalReadingLayout');
});

test('正文是字段的展开，不得与字段各渲染一次（否则整段重复）', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');

  // 28 §8 不变量 1 要求字段逐字出现在正文对应段——于是正文段永远以字段原文开头。
  // 若布局把字段与正文段各渲染一次，同一段话在页面上出现两遍（实测已发生）。
  // 正确形态同 27 号 NormReadingLayout：只渲染正文分节，字段仅在正文缺失时回落。
  const subGoalLayout = layouts.slice(
    layouts.indexOf('export function SubGoalReadingLayout'),
    layouts.indexOf('function SubGoalTerminalReadingNode'),
  );
  assert.ok(subGoalLayout.length > 0, '应能定位 SubGoalReadingLayout 源码段');

  // 正文分节优先：两个正文段标题都要作为条件分支出现。
  assert.match(subGoalLayout, /sectionOf\('达成条件'\)/, '达成条件须按正文分节渲染');
  assert.match(subGoalLayout, /sectionOf\('对齐说明'\)/, '对齐说明须按正文分节渲染');

  // 字段回落只能出现在正文缺失分支里，不得作为另一个独立段落并列渲染。
  const criterionFieldUses = (subGoalLayout.match(/value=\{criterion\}/g) ?? []).length;
  const alignmentFieldUses = (subGoalLayout.match(/value=\{alignment\}/g) ?? []).length;
  assert.ok(criterionFieldUses <= 1, `criterion 字段最多渲染一次（当前 ${criterionFieldUses} 处）`);
  assert.ok(alignmentFieldUses <= 1, `alignment 字段最多渲染一次（当前 ${alignmentFieldUses} 处）`);
});

test('名下工作为空时标注「未声明或未拆解」的歧义，绝不折算为进度（28 §8.1）', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const locales = read('src/i18n/locales.ts');

  // 布局必须在空集时走歧义分支，而不是渲染一个 0 或「尚未开始」的进度值。
  assert.match(layouts, /servingWork\.length === 0/, '阅读布局应有空集分支');
  assert.match(layouts, /subGoalServingEmpty/, '空集分支应使用歧义标注文案');

  // 文案本身必须写明两种情形不可区分，且显式否认「进度 0%」。
  const zh = /'objectDetail\.subGoalServingEmpty':\s*'([^']*)'/.exec(locales);
  const en = /'objectDetail\.subGoalServingEmpty':\s*'([^']*)'/.exec(locales.slice(locales.indexOf("'nav.norms': 'Norms',")));
  assert.ok(zh, '中文侧应有 subGoalServingEmpty 文案');
  assert.ok(en, '英文侧应有 subGoalServingEmpty 文案');
  assert.match(zh[1], /未声明或未拆解/, '中文文案须点明「未声明或未拆解」');
  assert.match(zh[1], /不可区分/, '中文文案须说明两种情形机械层不可区分');
  assert.match(zh[1], /不是进度 0%/, '中文文案须显式否认进度 0%');
  assert.match(en[1], /Not declared or not decomposed/, '英文文案须点明同一歧义');
});

test('读不到 ≠ 名下没有工作（00 §5.6 据实声明）', () => {
  const facts = read('api/services/facts.ts');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');

  // 服务端把读取失败单列，不得并入空集。
  assert.match(facts, /serving_unreadable/, '服务端应单列读取失败');
  assert.match(facts, /serving_empty/, '服务端应单列空集');
  // 布局侧把读不到的类型显式列出。
  assert.match(layouts, /servingUnreadable/, '阅读布局应呈现读取失败');
});

test('达成态不得由「名下工作全部关闭」推出（28 §18 红线 3）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const locales = read('src/i18n/locales.ts');

  const zh = /'objectList\.subGoalAchievedNote':\s*'([^']*)'/.exec(locales);
  assert.ok(zh, '中文侧应有 subGoalAchievedNote 文案');
  // 文案必须显式否认「工单关闭即达成」这条推断。
  assert.match(zh[1], /不由名下工作全部关闭推出|不由.*工单.*推出/, '达成说明须否认「工单关闭即达成」');
  assert.match(zh[1], /判据/, '达成说明须回到判据本身');
  assert.match(objectList, /SubGoalTerminalCardContent/, '达成/作废态应有终态面板');
});

test('目标页子目标行可下钻到对象详情，legacy 行不可（28 §14.2）', () => {
  const goalSection = read('src/components/GoalSection.tsx');

  // 2026-11-03 改版：行拆成 `SubGoalRow` 组件后，可点性由「有 object_uid」决定
  // ——标题按钮在 `hasObject` 为假时禁用（legacy 行没有可下钻的对象，点进去是 404）。
  // 整行**不**可点：行内还有展开按钮，整行可点会让「展开」与「进详情」抢同一个点击。
  assert.match(goalSection, /const hasObject = Boolean\(subGoal\.object_uid\)/, '仅带 object_uid 的行可点');
  assert.match(goalSection, /disabled=\{!hasObject\}/, 'legacy 行须不可下钻');
  assert.match(goalSection, /hasObject \? 'cursor-pointer hover:text-ldvh-accent' : 'cursor-default'/, '仅带 object_uid 的行显可点');
  // 详情路由的 id 段是 `subgoal-<uid>`（带类型前缀，与列表 obj.id 同形）；
  // 只给裸 uid 会 404，故断言前缀在位。
  assert.match(
    goalSection,
    /navigate\(`\/objects\/subgoal\/subgoal-\$\{sg\.object_uid\}`\)/,
    '应下钻到 subgoal 详情路由（带类型前缀）',
  );
  assert.match(goalSection, /subGoal\.legacy &&/, 'legacy 行仍须显式标出');
});

test('聚焦目标区不呈现作废子目标，但详情与投影仍保留（28 §9 终态可查）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const cognition = read('api/routes/cognition.ts');

  // Human 2026-11-08：「聚焦里不呈现作废 sg」。过滤发生在**呈现层**：
  // 投影继续返回全部子目标，详情页与状态筛选据此仍可看到 `retired`——
  // 若在投影层过滤，作废这一历史事实将在任何界面都不可见（28 §9：retired 是
  // 终态，作废是应当可查的历史，不是应被抹掉的错误）。
  assert.match(goalSection, /const visibleSubGoals = \(goal\?\.sub_goals \?\? \[\]\)\.filter\(\(sg\) => sg\.status !== 'retired'\)/,
    '聚焦区须派生一个排除 retired 的可见集合');
  assert.match(goalSection, /\{visibleSubGoals\.map\(/, '列表须渲染可见集合，不得直接遍历 sub_goals');
  // 计数与列表同源：分别取值会出现「标题写 4、下面只列 2 条」而读者无法分辨。
  assert.match(goalSection, /\{visibleSubGoals\.length\}.*?text-ldvh-text-secondary/s,
    '区头计数须取同一份可见集合');
  assert.match(goalSection, /goal && visibleSubGoals\.length > 0/, '空态判断亦须取可见集合');

  // 投影层**不得**过滤：那里仍按载体原样返回每一条（含 retired）。
  assert.doesNotMatch(cognition, /status !== 'retired'/,
    '投影层不得按状态过滤子目标——过滤只在聚焦呈现层');
});

test('导航：侧栏不设子目标入口（2026-11-13 Human 定案），图标与色相仍在', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const icons = read('src/components/SemanticIcon.tsx');
  const categoryColors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  // 2026-11-13（Human 定案）：**侧栏撤除子目标入口**（项目态与联邦态同）。
  //
  // 撤的是**导航入口**，不是这个事实类型：28 号载体、类型注册、列表页、详情页、
  // 聚焦页目标区的呈现与下钻都在。故此处断言「侧栏里没有子目标入口」，
  // 而不是断言「子目标不存在」。
  assert.doesNotMatch(sidebar, /to: '\/objects\/subgoal'/, '项目态导航不应有 subgoal 入口');
  assert.doesNotMatch(sidebar, /to: '\/federation\/objects\/subgoal'/, '联邦态导航不应有 subgoal 入口');
  assert.doesNotMatch(sidebar, /nav\.subgoals/, '导航不应再引用子目标的导航词条');
  assert.doesNotMatch(sidebar, /OBJECT_TYPE_ICONS\.subgoal/, '侧栏不应再取子目标类型图标');

  // 导航次序：聚焦之后直接是火花——子目标原在此处（2026-11-01 定案），现已撤除。
  const navBlock = sidebar.slice(sidebar.indexOf('const NAV_ITEMS'), sidebar.indexOf('const FEDERATION_NAV_ITEMS'));
  const first = navBlock.indexOf("labelKey: 'nav.cognition'");
  const sparkAt = navBlock.indexOf("labelKey: 'nav.sparks'");
  assert.ok(first >= 0 && sparkAt > first, '聚焦之后应直接是火花');
  const between = navBlock.slice(first, sparkAt);
  const otherEntries = between.match(/\{ to:/g) ?? [];
  assert.equal(otherEntries.length, 1, '聚焦与火花之间不得夹其它入口（子目标已撤除）');

  // 图标与色相仍在：子目标的卡面、详情头、引用行仍要取同一枚图标与同一色值。
  assert.match(icons, /subgoal: Milestone/, '应登记 subgoal 图标');
  // 前后端色值必须一致（typeColors 注释也要求对齐）。
  const front = /subgoal: '(#[0-9a-f]{6})'/.exec(categoryColors);
  const back = /subgoal: '(#[0-9a-f]{6})'/.exec(typeColors);
  assert.ok(front, 'CATEGORY_COLORS 应登记 subgoal 色');
  assert.ok(back, 'TYPE_COLORS 应登记 subgoal 色');
  assert.equal(front[1], back[1], '前后端 subgoal 色值必须一致');
  // 与 goal 必须不同值，否则目标与子目标在图上不可区分。
  const goal = /goal: '(#[0-9a-f]{6})'/.exec(categoryColors);
  assert.ok(goal, 'CATEGORY_COLORS 应登记 goal 色');
  assert.notEqual(front[1], goal[1], 'subgoal 与 goal 不得同色');

  // **例外反向断言**（呈现收窄登记表 `docs/13` §3 第四腿）：本条收窄只针对
  // **侧栏入口**——子目标仍由帮助页对象地图解释（也仍由聚焦页目标区承载）。
  // 撤掉侧栏入口若顺手把导览里那一类也删了，子目标就成了「Web 上无处可寻」
  // 的类型；此处把这条例外钉住。
  const help = read('src/pages/Help.tsx');
  assert.ok(
    help.includes('help.objects.subgoal.what'),
    '子目标仍须在帮助页对象地图上被解释',
  );
});

test('子目标详情页的返回落回聚焦页，不再回列表（2026-11-13 Human 定案）', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const federationObjects = read('src/pages/FederationObjects.tsx');

  // 侧栏已无子目标入口，列表页 `/objects/subgoal` 不再有导航落点；详情页再退回
  // 它就是把读者送进一条死路。故子目标的返回一律回聚焦页（联邦态回联邦聚焦）。
  assert.match(
    objectDetail,
    /const returnPath = objType === 'subgoal'/,
    '子目标的返回目标须单独判定',
  );
  assert.match(
    objectDetail,
    /fromPath\?\.startsWith\('\/federation'\) \? '\/federation' : '\/'/,
    '子目标详情页应回聚焦页（联邦上下文回联邦聚焦）',
  );

  // 联邦上下文从哪来：联邦聚合列表跳详情时须带 `from`——否则详情页无从判断
  // 读者是从联邦进来的（此前联邦跳详情不带 `from`，返回会落到项目态列表）。
  assert.match(
    federationObjects,
    /state: \{ from: `\/federation\/objects\/\$\{currentType\}` \}/,
    '联邦聚合列表跳详情须带 from',
  );
});

test('近期动态覆盖 subgoal（加入 OBJECT_TYPES 时不得遗漏）', () => {
  const cognition = read('api/routes/cognition.ts');

  assert.match(cognition, /listObjects\('subgoal'/, '应拉取 subgoal 列表供近期动态');
  assert.match(cognition, /\['subgoal', subGoalResult\]/, '近期动态取数范围应含 subgoal');
});

test('serves 不参与 Web 呈现：解析组件与筛选组件都已撤除', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');
  const model = read('src/pages/object-detail/model.ts');

  // 2026-11-01（Human 定案）：**`serves` 不再在 Web 上呈现或筛选**。
  //
  // 方向在这里：子目标是承载体，spark 与工单挂上去只是归属引用。「这个子目标
  // 下面有哪些工作」由子目标详情页的「名下的工作」正向回答（`deriveServingWork`
  // 反查），不该让 Human 在每个列表页先选一个子目标再看被过滤的池子。
  //
  // 上一版这里断言 `ServesSgBadge` / `ServesSgFilter` / `useSubGoals` 三个文件
  // 的解析细节——即「uid 如何解析成标题」。撤除呈现后**没有 uid 要解析了**，
  // 故断言随之反转：三个文件都不应存在，四个呈现点都不得回归。
  //
  // **撤的是呈现，不是字段**：`serves` 仍有四个非呈现消费方（25 §9 达成判定、
  // 21 §10.3 局部重批、子目标详情反查、召回 F1/F2）。
  for (const removed of [
    'src/components/ServesSgBadge.tsx',
    'src/components/ServesSgFilter.tsx',
    'src/hooks/useSubGoals.ts',
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(removed)),
      false,
      `${removed} 应已撤除——serves 不再参与 Web 呈现（2026-11-01 定案）`,
    );
  }

  // 四个呈现点：列表卡头、详情头、近期动态行、健康度行。
  assert.doesNotMatch(objectList, /ServesSgBadge|ServesSgFilter|servesSg/,
    '列表页不得回归 serves 呈现或筛选');
  assert.doesNotMatch(objectDetail, /ServesSgBadge/, '详情头不得回归 serves 徽章');
  assert.doesNotMatch(cognition, /ServesSgBadge/, '认知中心不得回归 serves 徽章');

  // 旧链接里的 `?serves=<uid>` 必须被清掉——留着会让 URL 看起来仍在生效。
  assert.match(objectList, /if \(removesRetiredServes\) nextParams\.delete\('serves'\);/,
    '退役的 serves 查询参数应被清理');

  // 辅助元信息表里不得再有 spark 的 serves 登记（那是「在元信息行呈现」的登记；
  // 撤掉呈现就不该留着它，否则「不呈现」这个决定没有落点）。
  //
  // 判据限定在**对象字面量内**：表上方的注释会反复说明「serves 曾在此」，对全文
  // 匹配会被注释判成失败。这与联邦 `type: objectType` 那条守卫同一教训。
  const auxTable = model.slice(
    model.indexOf('AUXILIARY_META_KEYS_BY_TYPE'),
    model.indexOf('};', model.indexOf('AUXILIARY_META_KEYS_BY_TYPE')),
  );
  assert.match(auxTable, /spark: \[\]/, 'spark 辅助元信息不得再有 serves');
  assert.doesNotMatch(auxTable, /'serves'/, 'serves 不得留在 spark 辅助元信息表');
});

test('order 取代 anchor：呈现面不得再读 anchor 字段', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const detail = read('src/pages/ObjectDetail.tsx');
  const model = read('src/pages/object-detail/model.ts');
  const api = read('src/utils/api.ts');
  const contract = read('api/services/factFieldContract.ts');

  // 28 §7（2026-11-01）：anchor（SG-n）已废止——身份由 object_uid 承担、
  // 显示次序由可选 `order` 承担。呈现面若仍读 anchor，读到的是 undefined。
  assert.doesNotMatch(objectList, /obj\.anchor/, '列表卡不得再读 anchor');
  assert.doesNotMatch(layouts, /obj\.anchor/, '详情阅读布局不得再读 anchor');
  assert.match(objectList, /obj\.order/, '列表卡应读 order');
  // **2026-11-02（Human 定案）**：`order` 在详情页由**身份头**呈现，不在阅读布局里。
  // 断言随之改指 `ObjectDetail.tsx`——Human 那句「详细页面里也要有顺序的那个 icon」
  // 要的是与列表卡卡头同一枚 chip，而阅读布局顶部的锚点块已被定案收窄为「只保留判法」。
  // 若继续断言布局读 order，守卫就会逼着一处与定案相反的呈现复活。
  assert.match(detail, /objectType === 'subgoal' && <SubGoalOrderBadge value=\{source\.order\} \/>/,
    '详情身份头应经同一枚 SubGoalOrderBadge 读 order');
  assert.doesNotMatch(layouts, /obj\.order/,
    '阅读布局不得再读 order（次序在身份头，只留一处呈现）');
  assert.match(api, /order\?: number;/, 'ObjectItem 应声明 order');
  assert.doesNotMatch(api, /\n {2}anchor\?: string;/, 'ObjectItem 不得再声明 anchor');
  assert.match(model, /subgoal: \[\s*\n\s*'order'/, 'subgoal 字段序应以 order 起头');
  assert.match(contract, /order: field\('subgoal-order', 'number', false\)/, '契约里 order 应为可选数值');
  // 缺失合法、可重复、可不连续——故必填表里不能有它。
  assert.doesNotMatch(contract, /order: field\('subgoal-order', 'number', true\)/,
    'order 不得改为必填（28 §8：可缺失）');
});

test('联邦对象列表不得让 subgoal 卡片落到空内容', () => {
  const federationObjects = read('src/pages/FederationObjects.tsx');

  // renderContent 的每条分支对应一类卡体；缺 subgoal 分支时该类型在联邦视图里
  // 渲染成空卡——对象在、类型在、唯独没有内容。
  assert.match(federationObjects, /if \(currentType === 'subgoal'\) return <SubGoalCardContent obj=\{item\} \/>;/,
    '联邦卡体应分派 SubGoalCardContent');
  // 导入断言写成「SubGoalCardContent 在导入列表里」而不是「它是列表最后一项」：
  // 后者会在任何新类型追加到导入列表时误报（2026-11-02 加 devlog 时就撞了一次）。
  // 本守卫要的是「联邦视图真的拿到了这个卡体」，不是「它排在末尾」。
  assert.match(federationObjects, /SubGoalCardContent,[\s\S]*?\} from '@\/pages\/ObjectList';/,
    '应从 ObjectList 导入 SubGoalCardContent');
});

test('联邦列表的类型短名由路由补上（卡片类型 chip 不得空白）', () => {
  const federation = read('api/routes/federation.ts');

  // `listObjects` 的投影只带 `fact_type_key`（03 §6.1 载体值域），而卡片的类型
  // chip 读 `obj.type`。单项目列表路由经 `normalizeItem` 补过一次，联邦路由直接
  // 消费 `listObjects` 输出、没有那道归一化——八类对象的联邦卡类型 chip 曾全是
  // 空白（对象在、类型在、唯独卡面没有字）。
  // 断在 map 回调内部：`res.json({ ok: true, type: objectType, ... })` 里也有同样的
  // 字面量，只对全文 match 会让「把 map 里的那行删掉」照样通过（负向验证实测过）。
  const mapStart = federation.indexOf('return listing.items.map');
  assert.ok(mapStart > 0, '应能定位联邦列表的 map 回调');
  const mapBlock = federation.slice(mapStart, federation.indexOf('.flat()', mapStart));
  assert.match(mapBlock, /type: objectType,/, '联邦路由应在 map 回调里写回 type');
  // 不得写成 `type: item.fact_type_key` 或 `type: item.type` 这类反推/透传：
  // 查询上下文本身已确定类型，从载体字段再推一次只是多一处可能与读取层分歧的判定。
  assert.doesNotMatch(mapBlock, /type:\s*item\./, '联邦路由不得从载体字段反推类型');
});

test('次序呈现在卡头，与其余卡头 chip 同规格（Human 定案 2026-11-02）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const badge = read('src/components/SubGoalOrderBadge.tsx');

  // `order` 是**跨条比较**的扫读要素（这一条排第几），与「优先级」同级；判据框只
  // 回答「这一条自己怎么算达成」。此前把次序做成判据框内的小标题行，等于让判据框
  // 同时承担一个与判据无关的量——Human 因此指认「次序放到上面」。
  const head = objectList.slice(
    objectList.indexOf('<PriorityIcon source={obj}'),
    objectList.indexOf("title={t('cognition.recent.activityCount'"),
  );
  assert.ok(head.length > 0, '应能定位到卡头 chip 区');
  assert.match(head, /obj\.type === 'subgoal' && <SubGoalOrderBadge value=\{obj\.order\} \/>/,
    '次序 chip 须在卡头，且在类型/优先级之后、修改次数之前');

  // 判据框不得再自己渲染次序（否则同一个字段在卡上出现两处，且两处样式会分叉）。
  //
  // 2026-11-03：判据框的**渲染**下沉到 `components/SubGoalCardParts.tsx`
  // （聚焦页目标区与子目标卡同源），故这段断言读共享组件的实现段。
  const parts = read('src/components/SubGoalCardParts.tsx');
  const body = parts.slice(
    parts.indexOf('export function SubGoalCriterionSurface'),
    parts.indexOf('export function SubGoalDisclosureButton'),
  );
  assert.ok(body.length > 0, '应能定位到判据框源码段');
  assert.doesNotMatch(body, /\bordery?:/, '判据框不得再读 order 字段');
  assert.doesNotMatch(body, /subGoalOrderLabel/, '判据框不得再渲染「次序」小标题');
  // 判据类型（「闭环记录」等）同样退出卡面（Human 定案 2026-11-02「次序 闭环记录
  // 都不用显示」）——它是判定口径，住详情页判据锚点，卡面只回答「算什么」。
  assert.doesNotMatch(body, /criterion_kind/, '判据框不得再读 criterion_kind');
  assert.doesNotMatch(body, /subgoal_criterion_kind/, '判据框不得再渲染「判据类型」标题');

  // 几何对齐统一判据面形态（同一次定案「左侧的线条不要加粗」），但**色相取本类型色**
  // （Human 同日晚定案「圈出来的要和类型的颜色对上，也就是同一个色系的」）。故：
  // 几何单源复用、色相不得复用别的类型的色面，也不得再用决策块壳（左色条家族）。
  assert.match(body, /min-w-0 rounded-lg border px-3 py-2/, '判据框几何须复用统一判据面形态');
  assert.match(body, /getTypeSurfaceTint\(type\)/, '判据框色相须由类型色单一来源算得');
  assert.match(body, /style=\{tint\.surface\}/, '承载面的色相须贴在面上');
  assert.match(body, /style=\{tint\.body\}/, '正文色须同源取用（面与正文成对，不得各写一份）');
  assert.doesNotMatch(body, /border-blue-400\/20 bg-blue-500/,
    '判据框不得整面复用另一类型的判据面色——那会把某个类型的类型色当成这一类面的通用色');
  assert.doesNotMatch(body, /text-blue-900\/70/, '正文色不得取别的类型的蓝灰档');
  assert.doesNotMatch(body, /DECISION_CARD_SHELL_CLASS/,
    '判据框不得再用决策块壳（该类带左侧 2px 粗线，Human 明确不要）');
  assert.doesNotMatch(body, /border-l-2/, '判据框不得出现左侧粗线');

  // 样式不是新发明一套：走卡头那排 chip 的同一规格（`ldvh-chip-sm` + 12px 图标 +
  // 与修改次数 chip 同色相），否则「样式对齐其他的 icon」只对了一半。
  assert.match(badge, /ldvh-chip-sm shrink-0 gap-1 border-ldvh-accent\/25 bg-ldvh-accent\/5 text-ldvh-accent/,
    '次序 chip 须复刻卡头 chip 的规格');
  assert.match(badge, /<ListOrdered size=\{12\} aria-hidden="true" \/>/, '图标 12px，与 occurrence/修改次数同尺寸');
  // 28 §8：`order` 可缺失。缺失时保留图标、值渲染成 `·`（同 GoalSection 约定），
  // 且**不得补隐式编号**——`·` 不是 0、不是上一条 +1。
  assert.match(badge, /Number\.isInteger\(value\) && value > 0/, '闭集外取值按缺失处置');
  assert.match(badge, /'·'/, '缺失渲染为占位符而非隐藏');
});

test('详情身份头有次序 icon，阅读面只留判法（Human 定案 2026-11-02）', () => {
  const detail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const model = read('src/pages/object-detail/model.ts');
  const badge = read('src/components/SubGoalOrderBadge.tsx');

  // Human：「详细页面里也要有顺序的那个 icon」——详情身份头必须挂**同一枚**组件，
  // 不是另写一枚 chip（两处各写一份，缺失态与样式规格会分叉）。
  assert.match(detail, /import SubGoalOrderBadge from '@\/components\/SubGoalOrderBadge'/,
    '详情页应引用共享的次序 chip');
  assert.match(detail, /objectType === 'subgoal' && <SubGoalOrderBadge value=\{source\.order\} \/>/,
    '详情身份头应挂次序 chip');
  // 位置与列表卡卡头同序：类型 → 优先级 → 次序 → 修改次数。两端都靠这段邻接
  // 断言「次序在修改次数之前」，否则把次序挪到状态徽标旁不会被任何守卫看见。
  const head = detail.slice(
    detail.indexOf('<PriorityIcon source={source}'),
    detail.indexOf('title={t(\'cognition.recent.activityCount\''),
  );
  assert.ok(head.length > 0, '应能定位详情身份头的 chip 区');
  assert.match(head, /SubGoalOrderBadge/, '次序 chip 应在修改次数之前');

  // 阅读面顶部那块「次序 / 判据类型 / 服务目标 / 判法」的锚点块整体撤除。
  const layout = layouts.slice(
    layouts.indexOf('export function SubGoalReadingLayout'),
    layouts.indexOf('function SubGoalTerminalReadingNode'),
  );
  assert.ok(layout.length > 0, '应能定位 SubGoalReadingLayout 源码段');
  assert.doesNotMatch(layout, /DECISION_DETAIL_LIME_SHELL_CLASS/,
    '阅读面不得再用黄绿详情锚点块（该块已撤）');
  assert.doesNotMatch(layout, /obj\.order/, '阅读面不得再读 order');
  assert.doesNotMatch(layout, /obj\.parent_goal/, '阅读面不得再读 parent_goal（该字段已整行撤除呈现）');

  // 「这个地方只保留判法即可，样式和达成条件一样，放到名下工作上面」：
  assert.match(layout, /title=\{getFieldLabel\('subgoal_kind_hint'/,
    '判法须自成阅读节点，标题取「判法」词条');
  // 样式与达成条件一样：两者都经 AdrProseNode 渲染（ReadingNodeSection + 正文 markdown）。
  assert.match(layout, /<AdrProseNode[\s\S]{0,200}?value=\{kindHint\}/,
    '判法须与达成条件同一正文节点承载（样式一致）');
  // 位置在「名下的工作」**之前**。
  const hintIndex = layout.indexOf('value={kindHint}');
  const servingIndex = layout.indexOf("t('objectDetail.subGoalServingWork')");
  assert.ok(hintIndex > 0 && servingIndex > 0, '判法节点与名下工作区都应存在');
  assert.ok(hintIndex < servingIndex, '判法须排在名下的工作之前');

  // 判据类型的**词**不上屏：闭集名只留在词表里（供筛选/校验），不再有一枚 chip。
  assert.doesNotMatch(layout, /getFieldValueLabel\('criterion_kind'/,
    '阅读面不得再把判据类型的词拼上屏');
  assert.doesNotMatch(layout, /kindLabel/, '判据类型的 chip 已撤');

  // `parent_goal` 整行撤除呈现（Human 定案 2026-11-02，截图圈出身份头底部的
  // 「服务目标 project-goal」——「圈出来的不用显示」）。
  //
  // 它此前登记在辅助元信息表里，正是那句定案要撤掉的那一行。故这里断言的是
  // **不得再登记**：表是「呈现登记」，留着它等于说「这个字段在元信息行呈现」，
  // 而它已不呈现。归属关系不靠这一行存活——`parent_goal` 字段仍在对象上，
  // 目标区的子目标列表就是它的可见形态（28 §8.1 反查派生）。
  //
  // 出列后它会落回兜底字段区，但不会冒出来：subgoal 详情走 `SubGoalReadingLayout`，
  // 该布局不消费 `extraEntries`（与 `serves` 2026-11-01 出列时同一处境）。
  // 判据限定在**对象字面量内**：表上方的注释会反复解释「parent_goal 为何撤除」，
  // 对全文匹配会被注释判成失败（与联邦 `type: objectType` 那条守卫同一教训）。
  const auxTableLocal = model.slice(
    model.indexOf('AUXILIARY_META_KEYS_BY_TYPE'),
    model.indexOf('};', model.indexOf('AUXILIARY_META_KEYS_BY_TYPE')),
  );
  const subgoalAux = auxTableLocal.slice(
    auxTableLocal.indexOf('subgoal:'),
    auxTableLocal.indexOf('};', auxTableLocal.indexOf('subgoal:')),
  );
  assert.doesNotMatch(subgoalAux, /parent_goal/, 'parent_goal 不得再登记为辅助元信息（呈现已撤）');
  assert.doesNotMatch(model, /subgoal: \['parent_goal'\]/, '辅助元信息表不得回到「呈现 parent_goal」的旧态');
  // 共享 chip 仍是单一来源（两处消费不得各自手写）。
  assert.match(badge, /<ListOrdered size=\{12\}/, '次序 chip 图标规格不变');
});
