import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';


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

  const activeTypes = /ACTIVE_OBJECT_TYPES = \[([^\]]+)\]/.exec(facts);
  assert.ok(activeTypes, 'facts.ts 应导出 ACTIVE_OBJECT_TYPES');
  assert.match(activeTypes[1], /'subgoal'/, 'ACTIVE_OBJECT_TYPES 应含 subgoal');

  const idPattern = /OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(facts);
  assert.ok(idPattern, 'facts.ts 应定义 OBJECT_ID_PATTERN');
  assert.ok(idPattern[1].split('|').includes('subgoal'), 'OBJECT_ID_PATTERN 应覆盖 subgoal');

  assert.match(reader, /subgoal: 'subgoals'/, 'FACT_TYPE_DIRS 应登记 subgoal → subgoals');
  assert.match(reader, /subgoal: '\.md'/, 'FACT_TYPE_CARRIERS 应登记 subgoal → .md');
  const carrierSet = /MARKDOWN_CARRIER_TYPES[^=]*= new Set<[^>]+>\(\[([^\]]+)\]\)/.exec(reader);
  assert.ok(carrierSet, 'localFactReader 应定义 MARKDOWN_CARRIER_TYPES');
  assert.match(carrierSet[1], /'subgoal'/, 'MARKDOWN_CARRIER_TYPES 应含 subgoal');
  const readerIdPattern = /FACT_OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(reader);
  assert.ok(readerIdPattern, 'localFactReader 应定义 FACT_OBJECT_ID_PATTERN');
  assert.ok(readerIdPattern[1].split('|').includes('subgoal'), 'FACT_OBJECT_ID_PATTERN 应覆盖 subgoal');

  assert.match(contract, /FACT_TYPES = \[[^\]]*'subgoal'/, 'FACT_TYPES 应含 subgoal');
  assert.match(pytools, /OBJECT_TYPES = \[[^\]]*'subgoal'/, 'pytools OBJECT_TYPES 应含 subgoal');
  assert.match(federation, /OBJECT_TYPES = \[[^\]]*'subgoal'/, '联邦 OBJECT_TYPES 应含 subgoal');
});

test('subgoal 字段契约：五个必填判据字段齐全，且不采用 urls/relations', async () => {
  const { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES, FACT_TERMINAL_STATUSES } =
    await import('../../api/services/factFieldContract.ts');

  const contract = FACT_FIELD_CONTRACT.subgoal;
  assert.ok(contract, 'FACT_FIELD_CONTRACT 应登记 subgoal');

  for (const required of ['parent_goal', 'criterion', 'criterion_kind', 'alignment']) {
    assert.equal(contract[required]?.required, true, `${required} 必须是必填字段（28 §8）`);
  }
  assert.equal(contract.disposition?.required, false, 'disposition 是条件字段');

  assert.equal(contract.urls?.required, false, 'urls 不得为必填（28 §11 不采用）');
  assert.equal(contract.relations?.required, false, 'relations 不得为必填（28 §11 不采用）');

  assert.ok('report_body' in contract, 'subgoal 应以 report_body 承载正文');
  assert.ok(!FACT_LIST_FIELD_NAMES.subgoal.includes('report_body'), '列表投影不得携带正文');

  assert.deepEqual([...FACT_TERMINAL_STATUSES.subgoal].sort(), ['achieved', 'retired']);
});

test('subgoal 状态闭集与判据类型闭集都有本地化词条（不得直出 raw 枚举）', async () => {
  const { getObjectStatusLocale, getFieldValueLabel } = await import('../../src/i18n/locales.ts');

  assert.equal(getObjectStatusLocale('subgoal', 'active', 'zh'), '推进中');
  assert.equal(getObjectStatusLocale('subgoal', 'achieved', 'zh'), '已达成');
  assert.equal(getObjectStatusLocale('subgoal', 'retired', 'zh'), '已作废');
  for (const status of ['active', 'achieved', 'retired']) {
    assert.notEqual(getObjectStatusLocale('subgoal', status, 'zh'), status, `${status} 不得直出 raw 值`);
    assert.notEqual(getObjectStatusLocale('subgoal', status, 'en'), status, `${status} 英文侧同样需映射`);
  }

  assert.equal(getFieldValueLabel('criterion_kind', 'metric', 'zh'), '指标');
  assert.equal(getFieldValueLabel('criterion_kind', 'closure-records', 'zh'), '闭环记录');
  assert.equal(getFieldValueLabel('criterion_kind', 'executable-check', 'zh'), '可执行校验');
});

test('subgoal 状态筛选闭集与默认过滤（28 §9：默认只列 active）', async () => {
  const filter = read('src/components/ObjectStatusFilter.tsx');
  const listStatus = read('src/utils/listStatus.ts');

  assert.match(filter, /subgoal: \['active', 'achieved', 'retired'\]/, '状态筛选闭集应登记 subgoal 三态');
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

  const subGoalLayout = layouts.slice(
    layouts.indexOf('export function SubGoalReadingLayout'),
    layouts.indexOf('function SubGoalTerminalReadingNode'),
  );
  assert.ok(subGoalLayout.length > 0, '应能定位 SubGoalReadingLayout 源码段');

  assert.match(subGoalLayout, /sectionOf\('达成条件'\)/, '达成条件须按正文分节渲染');
  assert.match(subGoalLayout, /sectionOf\('对齐说明'\)/, '对齐说明须按正文分节渲染');

  const criterionFieldUses = (subGoalLayout.match(/value=\{criterion\}/g) ?? []).length;
  const alignmentFieldUses = (subGoalLayout.match(/value=\{alignment\}/g) ?? []).length;
  assert.ok(criterionFieldUses <= 1, `criterion 字段最多渲染一次（当前 ${criterionFieldUses} 处）`);
  assert.ok(alignmentFieldUses <= 1, `alignment 字段最多渲染一次（当前 ${alignmentFieldUses} 处）`);
});

test('名下工作为空时标注「未声明或未拆解」的歧义，绝不折算为进度（28 §8.1）', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const locales = read('src/i18n/locales.ts');

  assert.match(layouts, /servingWork\.length === 0/, '阅读布局应有空集分支');
  assert.match(layouts, /subGoalServingEmpty/, '空集分支应使用歧义标注文案');

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

  assert.match(facts, /serving_unreadable/, '服务端应单列读取失败');
  assert.match(facts, /serving_empty/, '服务端应单列空集');
  assert.match(layouts, /servingUnreadable/, '阅读布局应呈现读取失败');
});

test('达成态不得由「名下工作全部关闭」推出（28 §18 红线 3）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const locales = read('src/i18n/locales.ts');

  const zh = /'objectList\.subGoalAchievedNote':\s*'([^']*)'/.exec(locales);
  assert.ok(zh, '中文侧应有 subGoalAchievedNote 文案');
  assert.match(zh[1], /不由名下工作全部关闭推出/, '达成说明须否认「关闭即达成」');
  assert.match(zh[1], /判据/, '达成说明须回到判据本身');
  assert.match(objectList, /SubGoalTerminalCardContent/, '达成/作废态应有终态面板');
});

test('目标区子目标标题点击＝展开/收起，不再下钻详情页（2026-11-15 Human 定案）', () => {
  const goalSection = read('src/components/GoalSection.tsx');

  assert.match(goalSection, /const toggleExpanded = \(\) => setExpanded\(\(current\) => !current\)/,
    '展开/收起取单一 toggleExpanded（标题与箭头同源）');
  assert.equal(
    (goalSection.match(/onClick=\{toggleExpanded\}/g) ?? []).length,
    2,
    '标题与右侧箭头两枚控件都调 toggleExpanded',
  );
  assert.doesNotMatch(goalSection, /navigate\(`\/objects\/subgoal/, '目标区不得再下钻到子目标详情路由');
  assert.doesNotMatch(goalSection, /disabled=\{!hasObject\}/, '标题不得再按 hasObject 禁用');
  assert.doesNotMatch(goalSection, /onOpen=/, 'SubGoalRow 不再接下钻回调');

  assert.match(goalSection, /const hasObject = Boolean\(subGoal\.object_uid\)/, 'hasObject 仍派生自身份');
  assert.match(goalSection, /\{hasObject && \(/, '进度组与名下工作区仍只对有对象的行给出');
  assert.match(goalSection, /subGoal\.legacy &&/, 'legacy 行仍须显式标出');

  assert.match(goalSection, /navigate\('\/goal'\)/, '目标区头标题仍可进 /goal 详情页');
});

test('聚焦目标区不呈现作废子目标，但详情与投影仍保留（28 §9 终态可查）', () => {
  const goalSection = read('src/components/GoalSection.tsx');
  const cognition = read('api/routes/cognition.ts');

  assert.match(goalSection, /const visibleSubGoals = \(goal\?\.sub_goals \?\? \[\]\)\.filter\(\(sg\) => sg\.status !== 'retired'\)/,
    '聚焦区须派生一个排除 retired 的可见集合');
  assert.match(goalSection, /\{visibleSubGoals\.map\(/, '列表须渲染可见集合，不得直接遍历 sub_goals');
  assert.match(goalSection, /\{visibleSubGoals\.length\}.*?text-ldvh-text-secondary/s,
    '区头计数须取同一份可见集合');
  assert.match(goalSection, /goal && visibleSubGoals\.length > 0/, '空态判断亦须取可见集合');

  assert.doesNotMatch(cognition, /status !== 'retired'/,
    '投影层不得按状态过滤子目标——过滤只在聚焦呈现层');
});

test('导航：侧栏不设子目标入口（2026-11-13 Human 定案），图标与色相仍在', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const icons = read('src/components/SemanticIcon.tsx');
  const categoryColors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.doesNotMatch(sidebar, /to: '\/objects\/subgoal'/, '项目态导航不应有 subgoal 入口');
  assert.doesNotMatch(sidebar, /to: '\/federation\/objects\/subgoal'/, '联邦态导航不应有 subgoal 入口');
  assert.doesNotMatch(sidebar, /nav\.subgoals/, '导航不应再引用子目标的导航词条');
  assert.doesNotMatch(sidebar, /OBJECT_TYPE_ICONS\.subgoal/, '侧栏不应再取子目标类型图标');

  const navBlock = sidebar.slice(sidebar.indexOf('const NAV_ITEMS'), sidebar.indexOf('const FEDERATION_NAV_ITEMS'));
  const first = navBlock.indexOf("labelKey: 'nav.cognition'");
  const sparkAt = navBlock.indexOf("labelKey: 'nav.sparks'");
  assert.ok(first >= 0 && sparkAt > first, '聚焦之后应直接是火花');
  const between = navBlock.slice(first, sparkAt);
  const otherEntries = between.match(/\{ to:/g) ?? [];
  assert.equal(otherEntries.length, 1, '聚焦与火花之间不得夹其它入口（子目标已撤除）');

  assert.match(icons, /subgoal: Milestone/, '应登记 subgoal 图标');
  const front = /subgoal: '(#[0-9a-f]{6})'/.exec(categoryColors);
  const back = /subgoal: '(#[0-9a-f]{6})'/.exec(typeColors);
  assert.ok(front, 'CATEGORY_COLORS 应登记 subgoal 色');
  assert.ok(back, 'TYPE_COLORS 应登记 subgoal 色');
  assert.equal(front[1], back[1], '前后端 subgoal 色值必须一致');
  const goal = /goal: '(#[0-9a-f]{6})'/.exec(categoryColors);
  assert.ok(goal, 'CATEGORY_COLORS 应登记 goal 色');
  assert.notEqual(front[1], goal[1], 'subgoal 与 goal 不得同色');

  const help = read('src/pages/Help.tsx');
  assert.ok(
    help.includes('help.objects.subgoal.what'),
    '子目标仍须在帮助页对象地图上被解释',
  );
});

test('子目标详情页的返回落回聚焦页，不再回列表（2026-11-13 Human 定案）', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const federationObjects = read('src/pages/FederationObjects.tsx');

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

test('Spark 卡片与列表支持 serves 呈现与筛选（Human 新决定），详情头/认知中心仍不回归 serves 徽章', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');
  const model = read('src/pages/object-detail/model.ts');

  for (const removed of [
    'src/components/ServesSgBadge.tsx',
    'src/components/ServesSgFilter.tsx',
    'src/hooks/useSubGoals.ts',
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(removed)),
      false,
      `${removed} 应已撤除——旧 serves 呈现形态不再使用`,
    );
  }

  assert.match(objectList, /ObjectServesFilter/, 'Spark 列表应有 serves 筛选控件');
  assert.match(objectList, /servesOrder/, 'Spark 卡片应有 serves 胶囊（按 SubGoal 次序数字呈现）');
  assert.match(objectList, /servesOptions/, 'Spark 列表应消费 serves 选项');
  assert.doesNotMatch(read('src/components/ObjectServesFilter.tsx'), /servesFilterLabel/,
    'serves 筛选项不得带「子目标」文字标签');
  assert.doesNotMatch(objectList, /removesRetiredServes/, '退役的 serves 参数清理逻辑应已撤销');
  assert.doesNotMatch(objectDetail, /ServesSgBadge/, '详情头不得回归 serves 徽章');
  assert.doesNotMatch(cognition, /ServesSgBadge/, '认知中心不得回归 serves 徽章');

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

  assert.doesNotMatch(objectList, /obj\.anchor/, '列表卡不得再读 anchor');
  assert.doesNotMatch(layouts, /obj\.anchor/, '详情阅读布局不得再读 anchor');
  assert.match(objectList, /obj\.order/, '列表卡应读 order');
  assert.match(detail, /objectType === 'subgoal' && <SubGoalOrderBadge value=\{source\.order\} \/>/,
    '详情身份头应经同一枚 SubGoalOrderBadge 读 order');
  assert.doesNotMatch(layouts, /obj\.order/,
    '阅读布局不得再读 order（次序在身份头，只留一处呈现）');
  assert.match(api, /order\?: number;/, 'ObjectItem 应声明 order');
  assert.doesNotMatch(api, /\n {2}anchor\?: string;/, 'ObjectItem 不得再声明 anchor');
  assert.match(model, /subgoal: \[\s*\n\s*'order'/, 'subgoal 字段序应以 order 起头');
  assert.match(contract, /order: field\('subgoal-order', 'number', false\)/, '契约里 order 应为可选数值');
  assert.doesNotMatch(contract, /order: field\('subgoal-order', 'number', true\)/,
    'order 不得改为必填（28 §8：可缺失）');
});

test('联邦对象列表不得让 subgoal 卡片落到空内容', () => {
  const federationObjects = read('src/pages/FederationObjects.tsx');

  assert.match(federationObjects, /if \(currentType === 'subgoal'\) return <SubGoalCardContent obj=\{item\} \/>;/,
    '联邦卡体应分派 SubGoalCardContent');
  assert.match(federationObjects, /SubGoalCardContent,[\s\S]*?\} from '@\/pages\/ObjectList';/,
    '应从 ObjectList 导入 SubGoalCardContent');
});

test('联邦列表的类型短名由路由补上（卡片类型 chip 不得空白）', () => {
  const federation = read('api/routes/federation.ts');

  const mapStart = federation.indexOf('return listing.items.map');
  assert.ok(mapStart > 0, '应能定位联邦列表的 map 回调');
  const mapBlock = federation.slice(mapStart, federation.indexOf('.flat()', mapStart));
  assert.match(mapBlock, /type: objectType,/, '联邦路由应在 map 回调里写回 type');
  assert.doesNotMatch(mapBlock, /type:\s*item\./, '联邦路由不得从载体字段反推类型');
});

test('次序呈现在卡头，与其余卡头 chip 同规格（Human 定案 2026-11-02）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const badge = read('src/components/SubGoalOrderBadge.tsx');

  const head = objectList.slice(
    objectList.indexOf('<PriorityIcon source={obj}'),
    objectList.indexOf("title={t('cognition.recent.activityCount'"),
  );
  assert.ok(head.length > 0, '应能定位到卡头 chip 区');
  assert.match(head, /obj\.type === 'subgoal' && <SubGoalOrderBadge value=\{obj\.order\} \/>/,
    '次序 chip 须在卡头，且在类型/优先级之后、修改次数之前');

  const parts = read('src/components/SubGoalCardParts.tsx');
  const body = parts.slice(
    parts.indexOf('export function SubGoalCriterionSurface'),
    parts.indexOf('export function SubGoalDisclosureButton'),
  );
  assert.ok(body.length > 0, '应能定位到判据框源码段');
  assert.doesNotMatch(body, /\bordery?:/, '判据框不得再读 order 字段');
  assert.doesNotMatch(body, /subGoalOrderLabel/, '判据框不得再渲染「次序」小标题');
  assert.doesNotMatch(body, /criterion_kind/, '判据框不得再读 criterion_kind');
  assert.doesNotMatch(body, /subgoal_criterion_kind/, '判据框不得再渲染「判据类型」标题');

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

  assert.match(badge, /ldvh-chip-sm shrink-0 gap-1 border-ldvh-accent\/25 bg-ldvh-accent\/5 text-ldvh-accent/,
    '次序 chip 须复刻卡头 chip 的规格');
  assert.match(badge, /<ListOrdered size=\{12\} aria-hidden="true" \/>/, '图标 12px，与 occurrence/修改次数同尺寸');
  assert.match(badge, /Number\.isInteger\(value\) && value > 0/, '闭集外取值按缺失处置');
  assert.match(badge, /'·'/, '缺失渲染为占位符而非隐藏');
});

test('详情身份头有次序 icon，阅读面只留判法（Human 定案 2026-11-02）', () => {
  const detail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const model = read('src/pages/object-detail/model.ts');
  const badge = read('src/components/SubGoalOrderBadge.tsx');

  assert.match(detail, /import SubGoalOrderBadge from '@\/components\/SubGoalOrderBadge'/,
    '详情页应引用共享的次序 chip');
  assert.match(detail, /objectType === 'subgoal' && <SubGoalOrderBadge value=\{source\.order\} \/>/,
    '详情身份头应挂次序 chip');
  const head = detail.slice(
    detail.indexOf('<PriorityIcon source={source}'),
    detail.indexOf('title={t(\'cognition.recent.activityCount\''),
  );
  assert.ok(head.length > 0, '应能定位详情身份头的 chip 区');
  assert.match(head, /SubGoalOrderBadge/, '次序 chip 应在修改次数之前');

  const layout = layouts.slice(
    layouts.indexOf('export function SubGoalReadingLayout'),
    layouts.indexOf('function SubGoalTerminalReadingNode'),
  );
  assert.ok(layout.length > 0, '应能定位 SubGoalReadingLayout 源码段');
  assert.doesNotMatch(layout, /DECISION_DETAIL_LIME_SHELL_CLASS/,
    '阅读面不得再用黄绿详情锚点块（该块已撤）');
  assert.doesNotMatch(layout, /obj\.order/, '阅读面不得再读 order');
  assert.doesNotMatch(layout, /obj\.parent_goal/, '阅读面不得再读 parent_goal（该字段已整行撤除呈现）');

  assert.match(layout, /title=\{getFieldLabel\('subgoal_kind_hint'/,
    '判法须自成阅读节点，标题取「判法」词条');
  assert.match(layout, /<ProseNode[\s\S]{0,200}?value=\{kindHint\}/,
    '判法须与达成条件同一正文节点承载（样式一致）');
  const hintIndex = layout.indexOf('value={kindHint}');
  const servingIndex = layout.indexOf("t('objectDetail.subGoalServingWork')");
  assert.ok(hintIndex > 0 && servingIndex > 0, '判法节点与名下工作区都应存在');
  assert.ok(hintIndex < servingIndex, '判法须排在名下的工作之前');

  assert.doesNotMatch(layout, /getFieldValueLabel\('criterion_kind'/,
    '阅读面不得再把判据类型的词拼上屏');
  assert.doesNotMatch(layout, /kindLabel/, '判据类型的 chip 已撤');

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
  assert.match(badge, /<ListOrdered size=\{12\}/, '次序 chip 图标规格不变');
});
