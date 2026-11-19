import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';


function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('friction and norm stay in the active backend type list and detail id pattern', async () => {
  const facts = read('api/services/facts.ts');
  const reader = read('api/services/localFactReader.ts');

  const activeTypes = /ACTIVE_OBJECT_TYPES = \[([^\]]+)\]/.exec(facts);
  assert.ok(activeTypes, 'facts.ts 应导出 ACTIVE_OBJECT_TYPES');
  const activeMembers = [...activeTypes[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  for (const type of ['pitfall', 'spark', 'report', 'friction', 'norm']) {
    assert.ok(activeMembers.includes(type), `ACTIVE_OBJECT_TYPES 应含 ${type}（当前：${activeMembers.join(', ')}）`);
  }
  const idPattern = /OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(facts);
  assert.ok(idPattern, 'facts.ts 应定义 OBJECT_ID_PATTERN');
  for (const type of ['friction', 'norm']) {
    assert.ok(idPattern[1].split('|').includes(type), `OBJECT_ID_PATTERN 应覆盖 ${type}`);
  }
  const carrierSet = /MARKDOWN_CARRIER_TYPES[^=]*= new Set<[^>]+>\(\[([^\]]+)\]\)/.exec(reader);
  assert.ok(carrierSet, 'localFactReader 应定义 MARKDOWN_CARRIER_TYPES');
  const carrierMembers = [...carrierSet[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  for (const type of ['friction', 'norm']) {
    assert.ok(carrierMembers.includes(type), `MARKDOWN_CARRIER_TYPES 应含 ${type}`);
  }
  const readerIdPattern = /FACT_OBJECT_ID_PATTERN = \/\^\(([^)]+)\)-/.exec(reader);
  assert.ok(readerIdPattern, 'localFactReader 应定义 FACT_OBJECT_ID_PATTERN');
  for (const type of ['friction', 'norm']) {
    assert.ok(readerIdPattern[1].split('|').includes(type), `FACT_OBJECT_ID_PATTERN 应覆盖 ${type}`);
  }
});

test('norm carries its markdown body as report_body like every v5 markdown type', async () => {
  const { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES } = await import('../../api/services/factFieldContract.ts');

  assert.ok('report_body' in FACT_FIELD_CONTRACT.norm, 'norm 必须登记 report_body');
  assert.ok(!('body' in FACT_FIELD_CONTRACT.norm), 'norm 不应登记 body（读取层投影名是 report_body）');
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

  assert.match(icons, /friction: Snail,/);
  assert.match(icons, /norm: Ruler,/);
  assert.match(colors, /friction: '#f97316'/);
  assert.match(colors, /norm: '#8b5cf6'/);
  assert.match(typeColors, /friction: '#f97316'/);
  assert.match(typeColors, /norm: '#8b5cf6'/);
  assert.match(locales, /friction: \{ zh: '摩擦', en: 'Friction' \}/);
  assert.match(locales, /norm: \{ zh: '规范', en: 'Norm' \}/);
  assert.match(locales, /friction: \{[\s\S]*?open: \{ zh: '待修', en: 'Open' \},[\s\S]*?resolved: \{ zh: '已销账', en: 'Resolved' \},[\s\S]*?voided: \{ zh: '已废弃', en: 'Voided' \},[\s\S]*?accepted: \{ zh: '已接受', en: 'Accepted' \},/);
  assert.doesNotMatch(locales, /observing: \{ zh: '留观', en: 'Observing' \}/,
    '留观词条随闭集收缩一并退出');
  assert.match(locales, /norm: \{[\s\S]*?active: \{ zh: '生效中', en: 'Active' \},[\s\S]*?retired: \{ zh: '已退役', en: 'Retired' \},/);
});

test('list defaults filter friction to open and norm to active', () => {
  const listStatus = read('src/utils/listStatus.ts');
  assert.match(listStatus, /if \(type === 'friction'\) return 'open';/);
  const activeDefaults = /DEFAULT_ACTIVE_TYPES = new Set\(\[([^\]]+)\]\)/.exec(listStatus);
  assert.ok(activeDefaults, 'listStatus 应定义 DEFAULT_ACTIVE_TYPES');
  const defaultMembers = [...activeDefaults[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  for (const type of ['pitfall', 'report', 'norm']) {
    assert.ok(defaultMembers.includes(type), `DEFAULT_ACTIVE_TYPES 应含 ${type}`);
  }
});

test('friction list cards defer reading content to the detail page (Human 裁定 2026-11)', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(objectList, /export function FrictionCardContent/);
  const cardBody = objectList.slice(
    objectList.indexOf('export function FrictionCardContent'),
    objectList.indexOf('/** 27 号 §10 F1 投影要素的列表承载'),
  );
  assert.match(cardBody, /if \(obj\.status === 'voided' \|\| obj\.status === 'accepted'\) return <FrictionTerminalCardContent/, '终态走说明框');
  assert.match(cardBody, /return null;/, '非终态卡体留空——只由卡头与标题托承载');
  assert.doesNotMatch(cardBody, /obj\.phenomenon/, '现象全文不再上卡面');
  assert.doesNotMatch(cardBody, /obj\.attribution/, '归因不再上卡面');

  const detailModel = read('src/pages/object-detail/model.ts');
  assert.doesNotMatch(detailModel, /friction: \['serves'\]/, 'serves 已从 26 §8 删除，不得残留引用');

  const readingLayouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const frictionLayout = readingLayouts.slice(
    readingLayouts.indexOf('export function FrictionReadingLayout'),
    readingLayouts.indexOf('export function NormReadingLayout'),
  );
  assert.doesNotMatch(frictionLayout, /getFieldLabel\('impact'/, '正文布局不再列 impact');

  const terminal = objectList.slice(
    objectList.indexOf('function FrictionTerminalCardContent'),
    objectList.indexOf('export function FrictionCardContent'),
  );
  assert.match(terminal, /obj\.disposition/, '废弃理由读 disposition 字段');
  assert.match(terminal, /TerminalFactPanel/, '终态框与 Spark/Pitfall/Norm 同款形态');

  assert.match(objectList, /currentType === 'friction'[\s\S]*?showNonActiveReason=\{false\}[\s\S]*?FrictionCardContent/);
});

test('norm list cards carry direction_key and retired terminal reason', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(objectList, /export function NormCardContent/);
  assert.match(objectList, /function NormTerminalCardContent[\s\S]*?obj\.retirement_reason/);
  assert.match(objectList, /<TerminalFactPanel tone="retired" content=\{formatReasonText\(reason\)\}/);
  assert.match(objectList, /currentType === 'norm'[\s\S]*?showNonActiveReason=\{false\}[\s\S]*?NormCardContent/);

  const normCard = objectList.slice(
    objectList.indexOf('export function NormCardContent'),
    objectList.indexOf('/**\n * 28 号 §12 F1 投影的列表承载'),
  );
  assert.ok(normCard.length > 0, 'NormCardContent 段应可定位');
  assert.doesNotMatch(normCard, /direction_key/, '活跃规范卡体不得再读 direction_key');
  assert.doesNotMatch(normCard, /DECISION_CARD_SHELL_CLASS/, '活跃规范卡体不再使用决策块壳');
  assert.doesNotMatch(normCard, /TYPE_DESCRIPTION|getTypeDescription/, '类型说明行已撤，不得回归');
  assert.match(normCard, /if \(obj\.status === 'retired'\) return <NormTerminalCardContent obj=\{obj\} \/>;\s*\n\s*return null;/);
});

test('object detail routes norm through a dedicated reading layout', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const model = read('src/pages/object-detail/model.ts');

  assert.match(objectDetail, /objType === 'norm' \? \(\s*\n\s*<NormReadingLayout obj=\{obj\} locale=\{locale\} \/>/);
  assert.match(layouts, /NORM_BODY_SECTION_ORDER = \['方向定位与适用范围', '核心规则体系', '约束与反模式', '验证与遵从性检查'\]/);
  assert.match(layouts, /function NormTerminalReadingNode/);
  assert.match(layouts, /getObjectStatusLocale\('norm', 'retired', locale\)/);
  assert.match(model, /norm: \[\s*\n\s*'direction_key', 'report_body',\s*\n\s*'retirement_reason', 'retired_at', 'change_log',/);

  const normLayout = layouts.slice(
    layouts.indexOf('export function NormReadingLayout'),
    layouts.indexOf('function NormTerminalReadingNode'),
  );
  assert.ok(normLayout.length > 0, 'NormReadingLayout 段应可定位');
  assert.doesNotMatch(normLayout, /direction_key/, 'NormReadingLayout 不得再读 direction_key');
  assert.doesNotMatch(normLayout, /normDirectionKeyMissing/, '方向键缺失提示已撤，不得回归');
  assert.doesNotMatch(normLayout, /DECISION_DETAIL_NEUTRAL_SHELL_CLASS/, '方向键节点壳已撤，布局不再使用详情面决策壳');
  assert.doesNotMatch(normLayout, /DECISION_TITLE_HUE_CLASS\.violet/, 'violet 标题色相已随方向键退场，不得在 norm 布局回归');
  assert.match(normLayout, /return \(\s*\n\s*<div className="mb-6 flex flex-col gap-5">\s*\n\s*<ProseNode title=\{getFieldLabel\('norm_positioning'/);
});

test('identity copy and association rows treat both types as first-class facts', () => {
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  const objectList = read('src/components/FactAssociationRows.tsx');

  assert.match(identityActions, /objectType === 'friction' \|\| objectType === 'norm'/);
  assert.match(objectList, /targetType === 'friction'[\s\S]*?association\.status === 'open'\) return 'pending';[\s\S]*?association\.status === 'resolved' \|\| association\.status === 'voided' \|\| association\.status === 'accepted'\) return 'closed';/);
  assert.doesNotMatch(objectList, /association\.status === 'observing'/,
    'observing 已退出 26 §9 闭集，不得参与关联行状态映射');
});

test('resolved 走达成绿而 voided 走收敛灰（Human 定案 2026-11）', () => {
  const statusBadge = read('src/components/StatusBadge.tsx');
  const statusColors = read('src/utils/statusColors.ts');
  const statusFilter = read('src/components/ObjectStatusFilter.tsx');

  assert.doesNotMatch(statusBadge, /objectType === 'friction' && status === 'resolved'/,
    '已销账不得走进中性收敛色分支');
  assert.match(statusColors, /resolved: \{ light: '#059669', dark: '#00d4aa' \}/, '已销账＝达成绿');
  assert.match(statusBadge, /objectType === 'friction' && status === 'voided'/);
  assert.match(statusBadge, /objectType === 'norm' && status === 'retired'/);
  assert.match(statusColors, /voided: \{ light: '#9ca3af', dark: '#6b7280' \}/);
  assert.doesNotMatch(statusColors, /observing:/, '留观状态色随闭集收缩一并退出');
  assert.doesNotMatch(statusFilter, /'observing'/, '过滤项不再列留观');
  assert.match(statusFilter, /friction: \['open', 'resolved', 'voided', 'accepted'\],/);
  assert.match(statusFilter, /norm: \['active', 'retired'\],/);
});

test('26 §8 impact 分级已整体退役：呈现面不得再有其消费方（Human 定案 2026-11-02）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');
  const detailModel = read('src/pages/object-detail/model.ts');
  const semanticColors = read('src/utils/semanticColors.ts');
  const locales = read('src/i18n/locales.ts');
  const api = read('src/utils/api.ts');
  const route = read('api/routes/cognition.ts');
  const contract = read('api/services/factFieldContract.ts');

  assert.ok(!fs.existsSync(path.resolve('src/components/FrictionImpactBadge.tsx')),
    'FrictionImpactBadge.tsx 须随分级制度一并删除');
  for (const [name, src] of [['ObjectList', objectList], ['ObjectDetail', objectDetail], ['CognitionCenter', cognition]] as const) {
    assert.doesNotMatch(codeOnly(src), /FrictionImpactBadge/, `${name} 不得再引用 impact 徽标组件`);
  }
  assert.doesNotMatch(codeOnly(semanticColors), /FRICTION_IMPACT_CHIP_CLASS/, '配色表不得留 impact 色相表');

  assert.doesNotMatch(codeOnly(api), /\bimpact\?: string/, '前端类型不得再声明 impact');
  assert.doesNotMatch(codeOnly(route), /projectFrictionImpact|build\.impact|raw\.impact/, '路由不得再投影 impact');
  assert.doesNotMatch(codeOnly(contract), /friction-impact/, '字段契约不得再登记 friction-impact');

  assert.doesNotMatch(codeOnly(locales), /impact: \{\s*light:/, 'FIELD_VALUE_LOCALES 的轻/中/重闭集须删');
  assert.doesNotMatch(codeOnly(locales), /^ {2}impact: \{/, 'FIELD_LABEL_LOCALES 的 impact 词条须删');

  assert.match(detailModel, /friction: \[\]/, '元信息行不含任何 friction 字段');
});

test('同名字段按类型分派词条：disposition 在 spark 与 friction 语义不同', () => {
  const locales = read('src/i18n/locales.ts');

  assert.match(locales, /TYPE_FIELD_LABEL_LOCALES/, '存在类型专属字段词条表');
  assert.match(locales, /friction: \{\s*disposition: \{ zh: '去向说明'/, 'friction 的 disposition 取专属词条');
  assert.match(locales, /occurrence: \{ zh: '重复观察'/, 'occurrence 亦有词条');
  assert.match(locales, /export function getFieldLabel\(fieldKey: string, locale: string, type\?: string\)/);
  assert.match(read('src/pages/ObjectDetail.tsx'), /getFieldLabel\(key, locale, objectType\)/);
});

test('26 §8 occurrence 在**三处**卡头都被渲染（词条存在不等于被消费）', () => {
  const list = read('src/pages/ObjectList.tsx');
  const detail = read('src/pages/ObjectDetail.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');

  assert.match(list, /obj\.type === 'friction' && <FrictionOccurrenceBadge value=\{obj\.occurrence\} \/>/);
  assert.match(detail, /objectType === 'friction' && <FrictionOccurrenceBadge value=\{source\.occurrence\} \/>/);
  assert.match(cognition, /item\.type === 'friction' && <FrictionOccurrenceBadge value=\{item\.occurrence\} \/>/);

  for (const [name, src] of [['ObjectList', list], ['ObjectDetail', detail], ['CognitionCenter', cognition]] as const) {
    assert.match(src, /import FrictionOccurrenceBadge from '@\/components\/FrictionOccurrenceBadge'/, `${name} 须引用共享组件`);
  }
});

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

test('26 §8 occurrence 与「修改次数」用**不同图标**（两个不同的量不得混同）', () => {
  const badgeCode = codeOnly(read('src/components/FrictionOccurrenceBadge.tsx'));

  assert.match(badgeCode, /import \{ Eye \} from 'lucide-react'/);
  assert.match(badgeCode, /<Eye size=\{12\}/, 'occurrence chip 须用 Eye 图标');
  assert.doesNotMatch(badgeCode, /History/, 'occurrence chip 不得复用 History（那是写入次数）');
  const list = read('src/pages/ObjectList.tsx');
  assert.match(list, /<History size=\{12\}/, '修改次数 chip 仍用 History');
});

test('26 §8 occurrence chip 只呈现事实值，不呈现阈值进度（N 的权威源是规范不是界面）', () => {
  const badge = read('src/components/FrictionOccurrenceBadge.tsx');

  const badgeCode = codeOnly(badge);
  assert.doesNotMatch(badgeCode, /\}\s*\/\s*N?\s*3/, '不得在卡面呈现 `{count}/3` 这类阈值进度');
  assert.doesNotMatch(badgeCode, /FRICTION_THRESHOLD|THRESHOLD_N|threshold/i, '不得在卡面引入阈值常量（N 的权威源是规范）');
  assert.match(badge, /!Number\.isInteger\(count\) \|\| count < 1\) return null/);
});

test('26 §8 occurrence 在前端类型面有声明（此前缺失致消费方无从落地）', () => {
  const api = read('src/utils/api.ts');
  assert.match(api, /occurrence\?: \{/, 'ObjectItem 须声明 occurrence —— 此前 API 送而类型无');
  assert.match(api, /count\?: number;/);
  assert.match(api, /first_at\?: string;/);
  assert.match(api, /last_at\?: string;/);
  assert.doesNotMatch(codeOnly(api), /human_return_at/, 'human_return_at 已随放回留观流转删除');
});

test('26 §8 occurrence 的悬浮说明与「修改次数」措辞明确区分', () => {
  const locales = read('src/i18n/locales.ts');
  assert.match(locales, /'cognition\.recent\.occurrenceCount': '重复观察 \{count\} 次/, 'zh 须说明是重复观察次数');
  assert.match(locales, /'cognition\.recent\.occurrenceCount': 'Observed \{count\} time\(s\)/, 'en 亦须有');
  assert.match(locales, /'cognition\.recent\.activityCount': '\{count\} 条动态'/);
});

test('26 §8 occurrence 在 /api/cognition 的两段投影里都携带（漏一段即静默丢失）', () => {
  const src = read('api/routes/cognition.ts');

  assert.match(src, /raw\.occurrence/, '第一段投影（buildRecentActivityItem）须透传 occurrence');
  assert.match(src, /build\.occurrence !== undefined \? \{ occurrence: build\.occurrence \}/, '第二段投影（recentItems 映射）须携带 occurrence');

  assert.match(src, /occurrence\?: \{ count\?: number; first_at\?: string; last_at\?: string \}/);
  assert.doesNotMatch(codeOnly(src), /human_return_at/, 'human_return_at 已随放回留观流转删除（26 §9.2）');

  assert.doesNotMatch(src, /raw\.impact|build\.impact/, 'impact 不得回到任一段投影');
});
