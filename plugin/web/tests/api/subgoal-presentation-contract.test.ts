import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * SubGoal（28 号）Web 呈现契约。
 *
 * 该类型在 28 号规范里是独立的第 8 类事实对象。本测试锁定它的呈现面与后端
 * 类型面不再回退：类型注册、状态闭集、判据类型闭集的本地化、列表卡片分支、
 * 详情阅读布局、导航入口、以及**最重要的两条语义边界**——
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
  for (const required of ['anchor', 'parent_goal', 'criterion', 'criterion_kind', 'alignment']) {
    assert.equal(contract[required]?.required, true, `${required} 必须是必填字段（28 §8）`);
  }
  // disposition 只在 retired 出现——条件字段，不得登记为必填。
  assert.equal(contract.disposition?.required, false, 'disposition 是条件字段');

  // 28 §11：不采用 urls（判据与对齐住正文）与 relations（层级由 anchor+serves
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

  // 有 object_uid 才可点——legacy 行没有可下钻的对象，点进去是 404。
  assert.match(goalSection, /sg\.object_uid \? 'cursor-pointer/, '仅带 object_uid 的行可点');
  assert.match(goalSection, /navigate\(`\/objects\/subgoal\/\$\{sg\.object_uid\}`\)/, '应下钻到 subgoal 详情路由');
  assert.match(goalSection, /sg\.legacy &&/, 'legacy 行仍须显式标出');
});

test('导航与图标：subgoal 有项目态与联邦态入口，图标色相独立', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const icons = read('src/components/SemanticIcon.tsx');
  const categoryColors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.match(sidebar, /'\/objects\/subgoal'/, '项目态导航应有 subgoal 入口');
  assert.match(sidebar, /'\/federation\/objects\/subgoal'/, '联邦态导航应有 subgoal 入口');
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
});

test('近期动态覆盖 subgoal（加入 OBJECT_TYPES 时不得遗漏）', () => {
  const cognition = read('api/routes/cognition.ts');

  assert.match(cognition, /listObjects\('subgoal'/, '应拉取 subgoal 列表供近期动态');
  assert.match(cognition, /\['subgoal', subGoalResult\]/, '近期动态取数范围应含 subgoal');
});
