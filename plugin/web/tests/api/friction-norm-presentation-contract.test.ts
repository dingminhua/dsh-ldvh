import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Friction（26 号）/ Norm（27 号）Web 呈现契约。
 *
 * 两个类型在后端字段契约（factFieldContract.ts）与本地读取器
 * （localFactReader.ts）已登记；本测试锁定它们的前端呈现面与后端类型面
 * 不再回退：导航入口、类型词表/状态闭集、列表卡片分支、详情阅读布局、
 * 默认状态过滤与状态徽章终态收敛色。
 */

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('friction and norm stay in the active backend type list and detail id pattern', async () => {
  const facts = read('api/services/facts.ts');
  const reader = read('api/services/localFactReader.ts');

  assert.match(facts, /ACTIVE_OBJECT_TYPES = \['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm'\]/);
  // 详情路由的 id 前缀模式覆盖七类（norm 可经 /api/objects/norm/:id 读取）。
  assert.match(facts, /OBJECT_ID_PATTERN = \/\^\(workcase\|adr\|pitfall\|spark\|research\|friction\|norm\)-/);
  // norm 是 markdown 载体（frontmatter + 正文）且文件名编码 UUID（同 friction）。
  assert.match(reader, /type === 'pitfall' \|\| type === 'friction' \|\| type === 'norm'\s*\n\s*\? '\(\?:\[0-9a-f\]\{8\}-/);
  assert.match(reader, /FACT_OBJECT_ID_PATTERN = \/\^\(workcase\|adr\|pitfall\|spark\|research\|friction\|norm\)-/);
});

test('norm carries its markdown body as report_body like every v5 markdown type', async () => {
  const { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES } = await import('../../api/services/factFieldContract.ts');

  // 读取层对 markdown 载体统一注入 report_body（localFactReader projectFields）；
  // norm 契约必须登记 report_body（而非 body），否则正文被判 unconsumed_field。
  assert.ok('report_body' in FACT_FIELD_CONTRACT.norm, 'norm 必须登记 report_body');
  assert.ok(!('body' in FACT_FIELD_CONTRACT.norm), 'norm 不应登记 body（读取层投影名是 report_body）');
  // 列表投影不携带正文（同其余 markdown 类型纪律）。
  assert.ok(!FACT_LIST_FIELD_NAMES.norm.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.norm.includes('direction_key'));
});

test('sidebar navigation exposes both fact types in project and federation scope', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const locales = read('src/i18n/locales.ts');

  assert.match(sidebar, /to: '\/objects\/friction', labelKey: 'nav\.frictions', icon: OBJECT_TYPE_ICONS\.friction/);
  assert.match(sidebar, /to: '\/objects\/norm', labelKey: 'nav\.norms', icon: OBJECT_TYPE_ICONS\.norm/);
  assert.match(sidebar, /to: '\/federation\/objects\/friction', labelKey: 'nav\.frictions', icon: OBJECT_TYPE_ICONS\.friction/);
  assert.match(sidebar, /to: '\/federation\/objects\/norm', labelKey: 'nav\.norms', icon: OBJECT_TYPE_ICONS\.norm/);
  assert.match(locales, /'nav\.frictions': '摩擦'/);
  assert.match(locales, /'nav\.norms': '规范'/);
});

test('both types carry icons, colors, type labels, and status closures', () => {
  const icons = read('src/components/SemanticIcon.tsx');
  const colors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');
  const locales = read('src/i18n/locales.ts');

  // friction=Snail（Human 定案 2026-09-12：蜗牛=摩擦的体感结果——系统性
  // 阻碍拖慢每一次工作；取代首版的 Flame）。
  assert.match(icons, /friction: Snail,/);
  // norm=Ruler（Human 定案 2026-09-12：尺=约束与度量的直观物；取代首版
  // 的 ScrollText）。
  assert.match(icons, /norm: Ruler,/);
  assert.match(colors, /friction: '#f97316'/);
  assert.match(colors, /norm: '#8b5cf6'/);
  assert.match(typeColors, /friction: '#f97316'/);
  assert.match(typeColors, /norm: '#8b5cf6'/);
  // 类型词表（中英）与状态闭集词表（26 §9 / 27 §9）。
  assert.match(locales, /friction: \{ zh: '摩擦', en: 'Friction' \}/);
  assert.match(locales, /norm: \{ zh: '规范', en: 'Norm' \}/);
  assert.match(locales, /friction: \{\s*\n\s*\/\/ 26 §9 状态闭集四值[\s\S]*?open: \{ zh: '待修', en: 'Open' \},[\s\S]*?resolved: \{ zh: '已销账', en: 'Resolved' \},[\s\S]*?voided: \{ zh: '已废弃', en: 'Voided' \},[\s\S]*?accepted: \{ zh: '已接受', en: 'Accepted' \},/);
  // 26 §9（2026-10 修订，Human 决定：观察不进事实源）：闭集由四值收缩为三值，
  // `observing`（留观）已退出——观察材料改由 11 §12bis.1 的摩擦观察缓冲承载，
  // 非事实对象。故状态词表里不得再有留观词条。
  assert.doesNotMatch(locales, /observing: \{ zh: '留观', en: 'Observing' \}/,
    '留观词条随闭集收缩一并退出');
  assert.match(locales, /norm: \{\s*\n\s*\/\/ 27 号 §9 状态闭集[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?retired: \{ zh: '已退役', en: 'Retired' \},/);
});

test('list defaults filter friction to open and norm to active', () => {
  const listStatus = read('src/utils/listStatus.ts');
  // 26 §12：friction 默认候选只含 open（闭集收缩后已无「攒够待修的候选源」状态）——单选 tab 默认 open。
  assert.match(listStatus, /if \(type === 'friction'\) return 'open';/);
  // 27 §10：norm 默认候选只含 active。
  assert.match(listStatus, /new Set\(\['adr', 'pitfall', 'research', 'norm'\]\)/);
});

test('friction list cards defer reading content to the detail page (Human 裁定 2026-11)', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  // Human 裁定 2026-11：「card 只显示标题，在标签区域把轻中重写入」。
  // 非终态卡体不再复述现象全文与归因——它们是**阅读**内容，住详情页；
  // 这与 Spark 活跃卡的克制同例（SparkCardContent 在 open 时返回 null）。
  assert.match(objectList, /export function FrictionCardContent/);
  const cardBody = objectList.slice(
    objectList.indexOf('export function FrictionCardContent'),
    objectList.indexOf('/** 27 号 §10 F1 投影要素的列表承载'),
  );
  assert.match(cardBody, /if \(obj\.status === 'voided' \|\| obj\.status === 'accepted'\) return <FrictionTerminalCardContent/, '终态走说明框');
  assert.match(cardBody, /return null;/, '非终态卡体留空——只由卡头与标题托承载');
  assert.doesNotMatch(cardBody, /obj\.phenomenon/, '现象全文不再上卡面');
  assert.doesNotMatch(cardBody, /obj\.attribution/, '归因不再上卡面');

  // 26 §8 impact（轻/中/重）的三处同形呈现由下方独立测试覆盖；此处只断言
  // serves 不再被 26 §8 引用（该字段 2026-10 已删除，残留引用属闭集收缩后漂移）。
  const detailModel = read('src/pages/object-detail/model.ts');
  assert.doesNotMatch(detailModel, /friction: \['serves'\]/, 'serves 已从 26 §8 删除，不得残留引用');

  // impact 不在正文布局重复呈现（同页两次属重复而非信息）。
  const readingLayouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const frictionLayout = readingLayouts.slice(
    readingLayouts.indexOf('export function FrictionReadingLayout'),
    readingLayouts.indexOf('export function NormReadingLayout'),
  );
  assert.doesNotMatch(frictionLayout, /getFieldLabel\('impact'/, '正文布局不再列 impact');

  // voided 的废弃理由读 disposition（26 §8 条件必填）——不再从正文解析。
  const terminal = objectList.slice(
    objectList.indexOf('function FrictionTerminalCardContent'),
    objectList.indexOf('export function FrictionCardContent'),
  );
  assert.match(terminal, /obj\.disposition/, '废弃理由读 disposition 字段');
  assert.match(terminal, /TerminalFactPanel/, '终态框与 Spark/Pitfall/Norm 同款形态');

  // 列表分支接入（showNonActiveReason=false：三态都不走 disposition_summary 通用位）。
  assert.match(objectList, /currentType === 'friction'[\s\S]*?showNonActiveReason=\{false\}[\s\S]*?FrictionCardContent/);
});

test('norm list cards carry direction_key and retired terminal reason', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(objectList, /export function NormCardContent/);
  // 27 §8：direction_key 是机器方向标识（唯一性公式的作用域）。
  assert.match(objectList, /obj\.direction_key/);
  // 27 §11：retired 终态原因由 retirement_reason 承载（闭集同 22 号形态）。
  assert.match(objectList, /function NormTerminalCardContent[\s\S]*?obj\.retirement_reason/);
  assert.match(objectList, /<TerminalFactPanel tone="retired" content=\{formatReasonText\(reason\)\}/);
  assert.match(objectList, /currentType === 'norm'[\s\S]*?showNonActiveReason=\{false\}[\s\S]*?NormCardContent/);
});

test('object detail routes norm through a dedicated reading layout', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const model = read('src/pages/object-detail/model.ts');

  // norm 详情走 NormReadingLayout（friction 已有 FrictionReadingLayout）。
  assert.match(objectDetail, /objType === 'norm' \? \(\s*\n\s*<NormReadingLayout obj=\{obj\} locale=\{locale\} \/>/);
  // 27 号 §8：正文固定 H2 四段骨架按序解析呈现。
  assert.match(layouts, /NORM_BODY_SECTION_ORDER = \['方向定位与适用范围', '核心规则体系', '约束与反模式', '验证与遵从性检查'\]/);
  // 终态去向节点：retired 的 reason + 时间（27 §9 终态不重开）。
  assert.match(layouts, /function NormTerminalReadingNode/);
  assert.match(layouts, /getObjectStatusLocale\('norm', 'retired', locale\)/);
  // 兜底排序：norm 的 ContentField 顺序注册（direction_key → 正文 → 终态 → change_log）。
  assert.match(model, /norm: \[\s*\n\s*'direction_key', 'report_body',\s*\n\s*'retirement_reason', 'retired_at', 'change_log',/);
});

test('identity copy and association rows treat both types as first-class facts', () => {
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  const objectList = read('src/pages/ObjectList.tsx');

  // 复制走对象引用（@对象 引用），不是路径复制。
  assert.match(identityActions, /objectType === 'friction' \|\| objectType === 'norm'/);
  // 关联行状态映射：friction open 是活账（pending），resolved/voided 属终态（closed）。
  assert.match(objectList, /targetType === 'friction'[\s\S]*?association\.status === 'open'\) return 'pending';[\s\S]*?association\.status === 'resolved' \|\| association\.status === 'voided' \|\| association\.status === 'accepted'\) return 'closed';/);
  // 26 §9（2026-10 修订）：闭集三值后，observing 不再是任何合法状态，关联行
  // 映射里也不得保留它（否则闭集外的值会被映射成活账）。
  assert.doesNotMatch(objectList, /association\.status === 'observing'/,
    'observing 已退出 26 §9 闭集，不得参与关联行状态映射');
});

test('resolved 走达成绿而 voided 走收敛灰（Human 定案 2026-11）', () => {
  const statusBadge = read('src/components/StatusBadge.tsx');
  const statusColors = read('src/utils/statusColors.ts');
  const statusFilter = read('src/components/ObjectStatusFilter.tsx');

  // Human 定案 2026-11：「已消账的icon应该是绿色的」——销账是**达成**而非收敛，
  // 故 resolved 走正向达成绿（与 spark 的 implemented 同值、同例），
  // **不**出现在 StatusBadge 的终态收敛分支里。
  assert.doesNotMatch(statusBadge, /objectType === 'friction' && status === 'resolved'/,
    '已销账不得走进中性收敛色分支');
  assert.match(statusColors, /resolved: \{ light: '#059669', dark: '#00d4aa' \}/, '已销账＝达成绿');
  // 收敛类终态仍是中性灰：已废弃（记错了的账）与已退役。
  assert.match(statusBadge, /objectType === 'friction' && status === 'voided'/);
  assert.match(statusBadge, /objectType === 'norm' && status === 'retired'/);
  assert.match(statusColors, /voided: \{ light: '#9ca3af', dark: '#6b7280' \}/);
  // 26 §9（2026-10 修订）：闭集三值后不留观状态色，过滤项只列三值。
  assert.doesNotMatch(statusColors, /observing:/, '留观状态色随闭集收缩一并退出');
  assert.doesNotMatch(statusFilter, /'observing'/, '过滤项不再列留观');
  assert.match(statusFilter, /friction: \['open', 'resolved', 'voided', 'accepted'\],/);
  assert.match(statusFilter, /norm: \['active', 'retired'\],/);
});

test('friction impact 在三处同形呈现（Human 裁定 2026-11）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');
  const detailModel = read('src/pages/object-detail/model.ts');
  const badge = read('src/components/FrictionImpactBadge.tsx');
  const semanticColors = read('src/utils/semanticColors.ts');

  // 共享组件是 impact 呈现的**单一来源**——三处都引用它，不得各自手写 chip。
  // Human 2026-11 指出「详情里表现的方式要和 card 一致」：此前详情页错放在
  // footer 元信息行（「字段名: 值」形态），与 card 的裸 chip 不同形。
  assert.match(badge, /export default function FrictionImpactBadge/);
  assert.match(badge, /ldvh-chip-sm/, '与邻居 chip 同尺寸类');
  assert.match(badge, /FRICTION_IMPACT_CHIP_CLASS/, '取共享配色表');
  assert.doesNotMatch(badge, /Target|History/, '无图标——与 SG/活动数两枚 chip 的形态一致');
  assert.match(semanticColors, /FRICTION_IMPACT_CHIP_CLASS: Record<string, string> = \{\s*light:/);

  // ① 列表卡卡头：类型 → 优先级 → SG → 影响 → 修改次数
  assert.match(objectList, /ServesSgBadge value=\{obj\.serves\}[\s\S]{0,400}?FrictionImpactBadge value=\{obj\.impact\}/,
    '① 影响紧跟 SG，在活动数之前');
  // ② 详情页身份头部：同位置同序
  assert.match(objectDetail, /ServesSgBadge value=\{source\.serves\}[\s\S]{0,400}?FrictionImpactBadge value=\{source\.impact\}/,
    '② 详情头与卡头同序');
  // 三处都不自行拼 chip：ObjectList 与 ObjectDetail 不再直接引用配色常量。
  assert.doesNotMatch(objectList, /FRICTION_IMPACT_CHIP_CLASS/, '① 不手写 chip');
  assert.doesNotMatch(objectDetail, /FRICTION_IMPACT_CHIP_CLASS/, '② 不手写 chip');
  // 聚焦页复用 ObjectCardFrame，故自动获得同一枚 chip。
  assert.match(cognition, /<ObjectCardFrame/, '③ 聚焦页复用卡片框架');

  // 元信息行不再承载 impact（那是 footer 的「字段名: 值」形态，与 card 不同形）。
  assert.match(detailModel, /friction: \[\]/, 'impact 不在元信息行');

  // 26 §8 闭集值本地化：轻/中/重（不是 light/medium/heavy 直出）。
  const locales = read('src/i18n/locales.ts');
  assert.match(locales, /light: \{ zh: '轻', en: 'Light' \}/);
  assert.match(locales, /medium: \{ zh: '中', en: 'Medium' \}/);
  assert.match(locales, /heavy: \{ zh: '重', en: 'Heavy' \}/);
});

test('同名字段按类型分派词条：disposition 在 spark 与 friction 语义不同', () => {
  const locales = read('src/i18n/locales.ts');

  // 26 §8 的 disposition（废弃去向说明）与 20 §8 的 disposition（终态去向）同名
  // 不同义——不按类型分派会让摩擦界面显示 spark 的「去向」。
  assert.match(locales, /TYPE_FIELD_LABEL_LOCALES/, '存在类型专属字段词条表');
  assert.match(locales, /friction: \{\s*disposition: \{ zh: '去向说明'/, 'friction 的 disposition 取专属词条');
  assert.match(locales, /occurrence: \{ zh: '重复观察'/, 'occurrence 亦有词条');
  // getFieldLabel 接受可选类型参数（既有调用方不受影响）。
  assert.match(locales, /export function getFieldLabel\(fieldKey: string, locale: string, type\?: string\)/);
  // 详情页元信息行确实把类型传下去。
  assert.match(read('src/pages/ObjectDetail.tsx'), /getFieldLabel\(key, locale, objectType\)/);
});

/**
 * 26 §8 `occurrence`（重复观察次数 = **频次的机械权威源**）的呈现契约。
 *
 * ## 本测试的存在理由（补上一个真实漏掉的缺口）
 *
 * 此前本文件对 `occurrence` 只有一条断言——「词条存在」（见上方的
 * `occurrence: { zh: '重复观察' }`）。**词条存在 ≠ 被渲染**：该字段当时
 * 数据在（`FACT_LIST_FIELD_NAMES.friction` 含它、`copyPresentFields` 实际携带）、
 * 契约在（`factFieldContract` 登记为 object）、词条在，**唯独没有任何一处消费它**，
 * 而测试全绿。Human 在界面上读不到那个权威值才发现了这一点。
 *
 * 教训与 WorkCase D8 同形：**断言了「存在」，没断言「被走过」**。故本组断言
 * 一律落在**渲染调用点**上，不停留在词条与类型声明。
 *
 * ## 为什么要断言「与修改次数分开」
 *
 * 卡头另有一枚 `History` chip 承载 `change_log.length`（写入次数）。二者是不同的量：
 * 一条账目可以只被观察 1 次却改过 7 次。二者混同会让 Human 把「改过几次」误读成
 * 「出现过几次」——而后者才是 26 §8 认定的频次权威源。故断言二者**不同图标**。
 */
test('26 §8 occurrence 在**三处**卡头都被渲染（词条存在不等于被消费）', () => {
  const list = read('src/pages/ObjectList.tsx');
  const detail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');

  // 三处调用点（列表卡 / 详情身份头 / 聚焦页），与 FrictionImpactBadge 同规格。
  assert.match(list, /obj\.type === 'friction' && <FrictionOccurrenceBadge value=\{obj\.occurrence\} \/>/);
  assert.match(detail, /objectType === 'friction' && <FrictionOccurrenceBadge value=\{source\.occurrence\} \/>/);
  assert.match(cognition, /item\.type === 'friction' && <FrictionOccurrenceBadge value=\{item\.occurrence\} \/>/);

  // 单一来源：三处都经共享组件，不得各自手写 chip。
  for (const [name, src] of [['ObjectList', list], ['ObjectDetail', detail], ['CognitionCenter', cognition]] as const) {
    assert.match(src, /import FrictionOccurrenceBadge from '@\/components\/FrictionOccurrenceBadge'/, `${name} 须引用共享组件`);
  }
});

/**
 * 去掉注释后的源码——**判「代码里有没有 X」必须只看代码**。
 *
 * 直接扫原文会把注释里解释「为什么**不**用 X」误判成「用了 X」：本文件的
 * occurrence chip 注释恰好两次说明为何不复用 `History`、为何不印阈值 `1/3`，
 * 首次运行时两条断言都因此误报。与 D2 护栏曾把自述注释当缺陷是同一类坑。
 */
function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

test('26 §8 occurrence 与「修改次数」用**不同图标**（两个不同的量不得混同）', () => {
  const badgeCode = codeOnly(read('src/components/FrictionOccurrenceBadge.tsx'));

  // occurrence 用 Eye（被观察次数）。
  assert.match(badgeCode, /import \{ Eye \} from 'lucide-react'/);
  assert.match(badgeCode, /<Eye size=\{12\}/, 'occurrence chip 须用 Eye 图标');
  // 修改次数用 History——二者必须不同图标，否则读者无法分辨。
  assert.doesNotMatch(badgeCode, /History/, 'occurrence chip 不得复用 History（那是写入次数）');
  const list = read('src/pages/ObjectList.tsx');
  assert.match(list, /<History size=\{12\}/, '修改次数 chip 仍用 History');
});

test('26 §8 occurrence chip 只呈现事实值，不呈现阈值进度（N 的权威源是规范不是界面）', () => {
  const badge = read('src/components/FrictionOccurrenceBadge.tsx');

  // 不显示 `1/3` 这类进度——阈值 N=3 固定在摩擦观察缓冲侧（11 §12bis.1），
  // 印在卡面会让它看起来像可变的呈现选择。
  // 只看**代码**（见 codeOnly 的说明）：注释里解释「为何不呈现阈值」是正当的。
  const badgeCode = codeOnly(badge);
  // 判据要精确：不得写 `{count}/3` 这类进度，也不得引入阈值常量。
  // **不能**用宽泛的 `/\s*3`——那会命中色相类名里的 `border-sky-400/35`
  // （首次运行时即此误报）。
  assert.doesNotMatch(badgeCode, /\}\s*\/\s*N?\s*3/, '不得在卡面呈现 `{count}/3` 这类阈值进度');
  assert.doesNotMatch(badgeCode, /FRICTION_THRESHOLD|THRESHOLD_N|threshold/i, '不得在卡面引入阈值常量（N 的权威源是规范）');
  // 闭集外的取值不渲染（同 impact badge 对闭集外取值的处置）。
  assert.match(badge, /!Number\.isInteger\(count\) \|\| count < 1\) return null/);
});

test('26 §8 occurrence 在前端类型面有声明（此前缺失致消费方无从落地）', () => {
  const api = read('src/utils/api.ts');
  assert.match(api, /occurrence\?: \{/, 'ObjectItem 须声明 occurrence —— 此前 API 送而类型无');
  // 与 §8 字段形状一致：count/first_at/last_at。
  // 2026-10 修订（Human 决定：观察不进事实源）：`human_return_at` 随「放回留观」
  // 流转一并删除（26 §9.2 该流转已作废），故类型面不得再声明它。
  // 只看**代码**（见 codeOnly 的说明）：注释里说明「该字段为何被删除」是正当的。
  assert.match(api, /count\?: number;/);
  assert.match(api, /first_at\?: string;/);
  assert.match(api, /last_at\?: string;/);
  assert.doesNotMatch(codeOnly(api), /human_return_at/, 'human_return_at 已随放回留观流转删除');
});

test('26 §8 occurrence 的悬浮说明与「修改次数」措辞明确区分', () => {
  const locales = read('src/i18n/locales.ts');
  assert.match(locales, /'cognition\.recent\.occurrenceCount': '重复观察 \{count\} 次/, 'zh 须说明是重复观察次数');
  assert.match(locales, /'cognition\.recent\.occurrenceCount': 'Observed \{count\} time\(s\)/, 'en 亦须有');
  // 既有 activityCount 词条不受影响（那是写入次数）。
  assert.match(locales, /'cognition\.recent\.activityCount': '\{count\} 条动态'/);
});

/**
 * 26 §8 `occurrence` 在**聚焦页路由**的两段投影都必须携带它。
 *
 * ## 本测试的存在理由（第二次踩同一个坑）
 *
 * `/api/cognition` 里有两段投影，**两段都要带该字段才到得了客户端**：
 *   ① `buildRecentActivityItem`：raw（列表投影） → `RecentActivityBuildItem`
 *   ② `recentItems` 映射：`RecentActivityBuildItem` → 响应 JSON
 *
 * 我第一次只补了 ①，接口仍返回不了该字段——因为 ② 是**逐字段重建**（不是展开
 * `...build`），漏一个字段就静默丢掉一个。实测确认：补 ① 后 `/api/cognition`
 * 的 friction 条目里仍无 `occurrence` 键，补 ② 后才出现。
 *
 * 这与「词条在、数据在、唯独没有消费方」是同一类「两层之间掉了」的缺口，
 * 故断言**两段都查**，只查一段等于没查。
 */
test('26 §8 occurrence 在 /api/cognition 的两段投影里都携带（漏一段即静默丢失）', () => {
  const src = read('api/routes/cognition.ts');

  // ① raw → RecentActivityBuildItem
  assert.match(src, /raw\.occurrence/, '第一段投影（buildRecentActivityItem）须透传 occurrence');
  // ② RecentActivityBuildItem → 响应 JSON（逐字段重建，非展开）
  assert.match(src, /build\.occurrence !== undefined \? \{ occurrence: build\.occurrence \}/, '第二段投影（recentItems 映射）须携带 occurrence');

  // 两段都带上 build/raw 的类型声明，否则 TS 会拦下（证明类型面也在）。
  assert.match(src, /occurrence\?: \{ count\?: number; first_at\?: string; last_at\?: string \}/);
  // 只看**代码**（见 codeOnly 的说明）：注释里说明「该字段为何被删除」是正当的。
  assert.doesNotMatch(codeOnly(src), /human_return_at/, 'human_return_at 已随放回留观流转删除（26 §9.2）');

  // 对照：impact 是既有正确形态，两段都在——occurrence 须与之同规格。
  assert.match(src, /raw\.impact/, 'impact 第一段仍在');
  assert.match(src, /build\.impact !== undefined \? \{ impact: build\.impact \}/, 'impact 第二段仍在');
});
