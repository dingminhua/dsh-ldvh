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

  // 有 object_uid 才可点——legacy 行没有可下钻的对象，点进去是 404。
  assert.match(goalSection, /sg\.object_uid \? 'cursor-pointer/, '仅带 object_uid 的行可点');
  // 详情路由的 id 段是 `subgoal-<uid>`（带类型前缀，与列表 obj.id 同形）；
  // 只给裸 uid 会 404，故断言前缀在位。
  assert.match(
    goalSection,
    /navigate\(`\/objects\/subgoal\/subgoal-\$\{sg\.object_uid\}`\)/,
    '应下钻到 subgoal 详情路由（带类型前缀）',
  );
  assert.match(goalSection, /sg\.legacy &&/, 'legacy 行仍须显式标出');
});

test('导航与图标：subgoal 有项目态与联邦态入口，图标色相独立', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const icons = read('src/components/SemanticIcon.tsx');
  const categoryColors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  assert.match(sidebar, /'\/objects\/subgoal'/, '项目态导航应有 subgoal 入口');
  assert.match(sidebar, /'\/federation\/objects\/subgoal'/, '联邦态导航应有 subgoal 入口');

  // 位置：紧接「聚焦」（Human 定案 2026-11-01「子目标放在聚焦后」）。
  // 项目态与联邦态两个数组都要满足，否则两处导航次序会分叉。
  const navBlock = sidebar.slice(sidebar.indexOf('const NAV_ITEMS'), sidebar.indexOf('const FEDERATION_NAV_ITEMS'));
  const fedBlock = sidebar.slice(sidebar.indexOf('const FEDERATION_NAV_ITEMS'));
  for (const [name, block, prefix] of [['项目态', navBlock, '/objects/subgoal'], ['联邦态', fedBlock, '/federation/objects/subgoal']] as const) {
    const first = block.indexOf("labelKey: 'nav.cognition'");
    const at = block.indexOf(prefix);
    assert.ok(first >= 0 && at > first, `${name}导航应有 subgoal 且排在聚焦之后`);
    // 聚焦与子目标之间除空白与注释外不得夹其它入口。
    const between = block.slice(first, at);
    const otherEntries = between.match(/\{ to:/g) ?? [];
    assert.equal(otherEntries.length, 1, `${name}导航中 subgoal 应紧接聚焦（中间不得夹其它入口）`);
  }
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

test('serves 的 object_uid 在呈现前被解析成子目标标题', () => {
  const badge = read('src/components/ServesSgBadge.tsx');
  const filter = read('src/components/ServesSgFilter.tsx');
  const hook = read('src/hooks/useSubGoals.ts');

  // 28 §12.3：serves 存 object_uid。直接把值当 chip 文案就是把身份当标签——
  // 读者会看到一串十六进制。解析表来自 /cognition/goal 的 sub_goals 投影
  // （本身由 subgoals/*.md 反查派生，不是第二权威）。
  assert.match(hook, /export function useSubGoalIndex/, '应提供 uid → 子目标标题的解析入口');
  assert.match(hook, /data\.goal\?\.sub_goals/, '解析表应取自 goal 的子目标投影');
  assert.match(badge, /useSubGoalIndex\(\)/, 'chip 应经解析表取标题');
  assert.match(badge, /const ref = index\.get\(uid\)/, 'chip 应按 uid 查标题');
  // 解析不到时如实回落 uid：显示空白或「未知」会让一条真实引用看起来像坏了。
  assert.match(badge, /if \(!ref\) return \{ text: uid, title: uid, resolved: false \}/,
    '解析不到应回落原值，不得伪造标题');
  // 卡头 chip 显示 `order` 而不是完整标题：标题最长 40 字（28 §8），塞进卡头
  // 会挤掉同一行的状态徽标与修改次数。`order` 正是为显示而设的字段，语义也
  // 与它接手的 SG-n 一致——第几条子目标。完整标题留在 title 悬停里。
  assert.match(badge, /if \(typeof ref\.order === 'number'\) return \{ text: String\(ref\.order\), title: ref\.title \|\| uid, resolved: true \}/,
    'order 存在时应显示 order');
  assert.match(badge, /if \(ref\.title\) return \{ text: ref\.title, title: ref\.title, resolved: true \}/,
    'order 缺失时才回落标题（28 §8：order 可缺失）');

  // 筛选 tab 的标签同样是标题；uid 只作 key 与查询参数（onChange(option.id)）。
  assert.match(filter, /onChange\(option\.id\)/, '筛选值仍应是 uid（查询参数与匹配依据）');
  assert.doesNotMatch(filter, /<span className="font-mono">\{option\.id\}<\/span>/,
    'uid 不得作为可见 tab 标签');
  assert.match(filter, /option\.text \|\| option\.id/, '标题缺失时回落 uid，不显示空按钮');
});

test('order 取代 anchor：呈现面不得再读 anchor 字段', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const model = read('src/pages/object-detail/model.ts');
  const api = read('src/utils/api.ts');
  const contract = read('api/services/factFieldContract.ts');

  // 28 §7（2026-11-01）：anchor（SG-n）已废止——身份由 object_uid 承担、
  // 显示次序由可选 `order` 承担。呈现面若仍读 anchor，读到的是 undefined。
  assert.doesNotMatch(objectList, /obj\.anchor/, '列表卡不得再读 anchor');
  assert.doesNotMatch(layouts, /obj\.anchor/, '详情阅读布局不得再读 anchor');
  assert.match(objectList, /obj\.order/, '列表卡应读 order');
  assert.match(layouts, /obj\.order/, '详情阅读布局应读 order');
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
  assert.match(federationObjects, /SubGoalCardContent,?\n\} from '@\/pages\/ObjectList';/,
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
