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
  assert.match(locales, /friction: \{\s*\n\s*\/\/ 26 §9 状态闭集四值[\s\S]*?observing: \{ zh: '留观', en: 'Observing' \},[\s\S]*?open: \{ zh: '待修', en: 'Open' \},[\s\S]*?resolved: \{ zh: '已销账', en: 'Resolved' \},[\s\S]*?voided: \{ zh: '已废弃', en: 'Voided' \},/);
  assert.match(locales, /norm: \{\s*\n\s*\/\/ 27 号 §9 状态闭集[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?retired: \{ zh: '已退役', en: 'Retired' \},/);
});

test('list defaults filter friction to open and norm to active', () => {
  const listStatus = read('src/utils/listStatus.ts');
  // 26 §12：friction 默认候选含 open 与 observing——单选 tab 默认 open。
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
  assert.match(cardBody, /if \(obj\.status === 'voided'\) return <FrictionTerminalCardContent/, '终态走说明框');
  assert.match(cardBody, /return null;/, '非终态卡体留空——只由卡头与标题托承载');
  assert.doesNotMatch(cardBody, /obj\.phenomenon/, '现象全文不再上卡面');
  assert.doesNotMatch(cardBody, /obj\.attribution/, '归因不再上卡面');

  // 26 §8 impact（轻/中/重）：移入卡头标签区（人类裁定：影响评级是扫读要素）。
  assert.match(objectList, /FRICTION_IMPACT_CHIP_CLASS: Record<string, string> = \{\s*light:/);
  assert.match(objectList, /obj\.type === 'friction' && obj\.impact/, '影响标签在卡头按类型分派');

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
  // 关联行状态映射：friction observing/open 是活账（pending），resolved/voided 属终态（closed）。
  assert.match(objectList, /targetType === 'friction'[\s\S]*?association\.status === 'observing' \|\| association\.status === 'open'\) return 'pending';[\s\S]*?association\.status === 'resolved' \|\| association\.status === 'voided'\) return 'closed';/);
});

test('terminal badges converge to neutral color and observing/voided keep their own status colors', () => {
  const statusBadge = read('src/components/StatusBadge.tsx');
  const statusColors = read('src/utils/statusColors.ts');
  const statusFilter = read('src/components/ObjectStatusFilter.tsx');

  // 26 §9 / 27 号 §9 终态收敛色（已销账/已退役）。
  assert.match(statusBadge, /objectType === 'friction' && status === 'resolved'/);
  assert.match(statusBadge, /objectType === 'friction' && status === 'voided'/);
  assert.match(statusBadge, /objectType === 'norm' && status === 'retired'/);
  // observing（留观）与 voided（作废）各有独立状态色与过滤项。
  assert.match(statusColors, /observing: \{ light: '#d4a017', dark: '#f0c040' \}/);
  assert.match(statusColors, /voided: \{ light: '#9ca3af', dark: '#6b7280' \}/);
  assert.match(statusFilter, /friction: \['observing', 'open', 'resolved', 'voided'\],/);
  assert.match(statusFilter, /norm: \['active', 'retired'\],/);
});
