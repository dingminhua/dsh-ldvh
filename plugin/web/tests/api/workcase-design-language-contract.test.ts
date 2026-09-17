// WorkCase 呈现设计语言契约——把「引用的 ldvh-* 类必须在 index.css 中定义」
// 做成机械守卫。
//
// 背景（2026-09-16，WC-D 99957f65）：WorkCaseReadingLayout 曾引用 6 个
// index.css 中不存在的类（ldvh-reading-grid / ldvh-reading-main /
// ldvh-fact-section / ldvh-fact-fields / ldvh-fact-field-key /
// ldvh-fact-field-value），详情正文段因此全程无样式；而当时的详情契约测试
// 只断言「哪些字段出现」，对设计语言类零断言，缺陷一路绿灯通过 241 项测试。
//
// 本文件补的正是那道缺口：
//   1. 通用守卫——扫描 WorkCase 各呈现面源码，凡出现的 ldvh-* 工具类必须能在
//      index.css 中找到定义（主题色 token 除外，它们是 Tailwind 颜色名）；
//   2. 详情外壳与其余六类阅读布局同款（10 §5.3 语义详情：单一阅读面）；
//   3. 正文段走 ReadingNodeSection（10 §12.7 长文须有折叠入口）；
//   4. result.satisfied 为布尔且按可读文本呈现（10 §12.8 不得用颜色或图标
//      单独承载状态）；result.residual 为数组且按列表呈现；
//   5. 不留零消费者导出与拼写错误类。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

/** WorkCase 的全部呈现面源码（列表卡在 ObjectList，详情在 ReadingLayout）。 */
const WORKCASE_SURFACES = [
  'web/src/pages/object-detail/WorkCaseReadingLayout.tsx',
  'web/src/pages/ObjectList.tsx',
  'web/src/components/WorkCaseCriteriaList.tsx',
  'web/src/components/WorkCaseProgressFilter.tsx',
  'web/src/components/WorkCaseCapabilityStatusBadge.tsx',
] as const;
/** index.css 里定义的工具类集合。 */
function definedUtilityClasses(): Set<string> {
  const css = readSource('web/src/index.css');
  return new Set(Array.from(css.matchAll(/\.(ldvh-[a-z0-9-]+)/g), (match) => match[1]));
}

/**
 * Tailwind 的 `ldvh-*` 主题色 token（`text-ldvh-text-secondary`、
 * `border-ldvh-accent/25`、`bg-ldvh-panel` …）由 theme 定义，不是 index.css
 * 里的独立类；必须在类名里剥掉工具前缀与不透明度修饰符后才能判定。
 * 只有像 `ldvh-card-decision-body` 这样自带 `ldvh-` 前缀的才是自建工具类。
 */
const TAILWIND_UTILITY_PREFIXES = [
  'text', 'bg', 'border', 'divide', 'ring', 'from', 'to', 'via',
  'outline', 'fill', 'stroke', 'shadow', 'accent', 'caret', 'decoration', 'placeholder',
];

function stripTailwindPrefix(cls: string): string | null {
  for (const prefix of TAILWIND_UTILITY_PREFIXES) {
    const head = `${prefix}-`;
    if (cls.startsWith(head)) return cls.slice(head.length);
  }
  return null;
}

test('every ldvh-* utility class used by WorkCase surfaces is defined in index.css', () => {
  const defined = definedUtilityClasses();
  const missing: string[] = [];

  for (const surface of WORKCASE_SURFACES) {
    const source = readSource(surface);
    // 只取 className 文本里的类名，避免把注释、import 路径当成类名。
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classText = `${match[1] ?? ''} ${match[2] ?? ''}`;
      // 先按空白切成完整类 token（含工具前缀与 /不透明度 修饰符），再判定——
      // 直接在整段文本里搜 `ldvh-` 会把 `border-ldvh-accent/25` 的内层
      // 片段误认成自建类。
      for (const token of classText.split(/\s+/)) {
        // 剥掉不透明度修饰符与负值前缀。
        const bare = token.replace(/^-/, '').split('/')[0];
        if (!bare.includes('ldvh-')) continue;
        // Tailwind 主题色 token：剥掉工具前缀后整段即为 `ldvh-<颜色名>`。
        if (stripTailwindPrefix(bare) !== null) continue;
        // 自建工具类：必须以 ldvh- 起头。
        if (!bare.startsWith('ldvh-')) continue;
        if (!defined.has(bare)) missing.push(`${surface}: ${bare}`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `以下 ldvh-* 类在 index.css 中没有定义（会渲染成无样式标记）：\n${missing.join('\n')}`,
  );
});

test('WorkCase detail shell matches the other six reading layouts', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const factLayouts = readSource('web/src/pages/object-detail/FactReadingLayouts.tsx');

  // 其余六类阅读布局的统一外壳（ADR/Pitfall/Spark/Friction/Norm/Goal 共 6 处）。
  assert.match(layout, /<div className="mb-6 flex flex-col gap-5">/);
  assert.equal(
    (factLayouts.match(/<div className="mb-6 flex flex-col gap-5">/g) ?? []).length,
    6,
    '六类阅读布局的外壳数量变化时需同步复核本断言',
  );
  // 曾导致无样式的自造网格壳已清除。
  assert.doesNotMatch(layout, /ldvh-reading-grid|ldvh-reading-main/);
});

test('WorkCase detail renders prose blocks through ReadingNodeSection', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  // 10 §12.7：长文本须有折叠入口——正文段与计划/判据节点一律走可折叠节点。
  assert.match(layout, /import \{[\s\S]*?ReadingNodeSection[\s\S]*?\} from '@\/pages\/ObjectDetail'/);
  assert.match(layout, /getReadingNodeNextState/);
  // 字段键值走既有 DetailInlineField。
  assert.match(layout, /DetailInlineField/);
  // 判定依据（plan/criteria_checks）用同一判据组件承载。
  assert.match(layout, /WORKCASE_CRITERIA_SURFACE_CLASS/);
});

test('result.satisfied is boolean and presented as readable text, not a bare value', () => {
  const api = readSource('web/src/utils/api.ts');
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const locales = readSource('web/src/i18n/locales.ts');
  // 三态词条的**唯一实现**落在共享模块（详情/列表卡/收件箱共用，防口径漂移）。
  const stateModule = readSource('web/src/utils/workcaseCheckState.ts');

  // 21 §9.3：satisfied 是布尔判定（真实对象为 true）。
  assert.match(api, /interface WorkCaseResultCheck \{[\s\S]*?satisfied\?: boolean/);
  // 10 §12.8：状态须有可读文本，不得只用颜色/图标承载。
  for (const key of ['workcaseCheckSatisfied', 'workcaseCheckUnsatisfied', 'workcaseCheckUnknown']) {
    assert.match(stateModule, new RegExp(`objectDetail\\.${key}`), `三态映射必须登记 ${key} 词条`);
    assert.match(locales, new RegExp(`'objectDetail\\.${key}'`), `词条 ${key} 必须已登记`);
  }
  // 详情消费共享映射（不自行实现第二份三态判断）。
  assert.match(layout, /workCaseCheckStateLabel/);
  assert.match(layout, /workCaseCheckChipClass/);
  // 不再把布尔 join 进字符串（旧的裸 `true · evidence` 形态）。
  assert.doesNotMatch(layout, /c\.satisfied[^\n]*filter\(Boolean\)/);
});

test('result.residual is an array and rendered as a list', () => {
  const api = readSource('web/src/utils/api.ts');
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // 21 §9.3：residual 是字符串数组。
  assert.match(api, /interface WorkCaseResult \{[\s\S]*?residual\?: string\[\]/);
  // 数组按列表呈现（判据组件），而非当段落。
  assert.match(layout, /Array\.isArray\(obj\.result\?\.residual\)/);
  assert.match(layout, /function ResidualNode/);
});

test('no zero-consumer WorkCase exports and no typo utility classes remain', () => {
  const criteriaList = readSource('web/src/components/WorkCaseCriteriaList.tsx');
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // WORKCASE_CRITERIA_SURFACE_CLASS 必须有消费者（曾零消费者）。
  assert.match(criteriaList, /export const WORKCASE_CRITERIA_SURFACE_CLASS/);
  assert.match(layout, /WORKCASE_CRITERIA_SURFACE_CLASS/, '导出必须在详情中有消费者');

  // 零消费者且带拼写错误类的 WorkCaseProgressTrack 已删除。
  assert.equal(
    fs.existsSync(path.join(repositoryRoot, 'web/src/components/WorkCaseProgressTrack.tsx')),
    false,
    'WorkCaseProgressTrack 是零消费者死代码，已随本单删除',
  );

  // 拼写错误类（漏 v 的 `ldh-card-decision-body`）不得复活。
  for (const surface of WORKCASE_SURFACES) {
    assert.doesNotMatch(readSource(surface), /ldh-card-decision-body/, `${surface} 含拼写错误类`);
  }
});

// ── 2026-09-17 补充（WC 364df30e）：本轮收敛新增的不变量守卫 ─────────────────

test('detail does not re-render an identity block that ObjectIdentityHeader owns', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // docs/01 §1.8.1 身份头部契约：类型标签+状态标签+object-id、标题、更新时间、
  // 右上复制入口由共享 ObjectIdentityHeader 承载；详情与右侧扩展阅读同源。
  // 布局自渲染第二套头部（曾为 group chip + 裸 `status:` + 复制按钮）即违约。
  assert.doesNotMatch(
    layout,
    /status:\s*\{obj\.status\}/,
    '详情不得裸露 `status:` 原值——状态由共享身份头部的语义徽标承载',
  );
  assert.doesNotMatch(
    layout,
    /ObjectReferenceCopyButton/,
    '复制入口归共享身份头部（ObjectIdentityHeader），布局内不重复提供',
  );
});

test('detail prose uses the detail reading level, not the 12px card scan level', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // docs/01 §1.4 第 4 条：卡片判断项正文只用于 Card 的有限行数扫描窗口；
  // 详情页和阅读面板仍使用各自正文层级，不得随之缩小。
  // 只判 className 使用（注释中作为「已移除的旧做法」被提及不算违规）。
  const classNames = Array.from(layout.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g))
    .map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`)
    .join(' ');
  assert.doesNotMatch(
    classNames,
    /ldvh-card-decision-body/,
    '详情正文不得复用 12px 卡片扫描层级——须用详情阅读层级',
  );
  // 正文段与六类样板一致，经 ResearchTextNodeContent（Markdown + 14px 基准）。
  assert.match(layout, /ResearchTextNodeContent/);
});

test('all four lifecycle bodies render the shared responsibility nodes (field presence is group-independent)', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // docs/10 §4.2：条件字段可随事实是否形成而省略，但**已存在字段不能因对象处于
  // 某个派生分组而消失**；分组只改变强调，不改变在场字段集。四个主体共用
  // ResponsibilityNodes，故 summary/serves/scope 在 closed 详情同样在场。
  assert.match(layout, /function ResponsibilityNodes\(/);
  assert.equal(
    (layout.match(/<ResponsibilityNodes obj=\{obj\} locale=\{locale\} \/>/g) ?? []).length,
    4,
    '四个派生主体（draft/executing/awaiting_gate2/closed）都必须渲染共有字段节',
  );
});

test('derived groups are localized and colour-mapped — no raw snake_case reaches the badge', () => {
  const locales = readSource('web/src/i18n/locales.ts');
  const statusColors = readSource('web/src/utils/statusColors.ts');

  // docs/01 §1.3：枚举值必须通过语义映射本地化（徽标经 getObjectStatusLocale
  // 取词条）。此前 OBJECT_STATUS_LOCALES.workcase 缺这四条，pending_gate1 /
  // awaiting_gate2 原值直出。
  const workcaseBlock = locales.slice(
    locales.indexOf('const OBJECT_STATUS_LOCALES'),
    locales.indexOf('export function getObjectStatusLocale'),
  );
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'unknown']) {
    assert.match(workcaseBlock, new RegExp(`\\b${group}: \\{ zh:`), `派生分组 ${group} 必须有类型专属展示词条`);
  }

  // docs/01 §1.10.2：Human 待确认用紫色系、推进中用天蓝色系——两个 Gate 待办组
  // 与 executing 必须各有语义色条目（缺条目会落中性灰，无法区分）。
  for (const group of ['pending_gate1', 'awaiting_gate2', 'executing']) {
    assert.match(statusColors, new RegExp(`\\b${group}: \\{ light: '#`), `派生分组 ${group} 必须有语义色`);
  }
  // 推进中是天蓝而非绿：executing 不得与 active 同色。
  assert.doesNotMatch(
    statusColors,
    /executing: \{ light: '#059669'/,
    'executing（推进中）按 docs/01 §1.10.2 用天蓝色系，不得复用 active 的绿色',
  );
});

test('criteria check state never reaches the UI as a bare boolean', () => {
  const surfaces = ['web/src/pages/ObjectList.tsx', 'web/src/pages/CognitionCenter.tsx'] as const;
  const stateModule = readSource('web/src/utils/workcaseCheckState.ts');

  // 10 §12.8：状态须有可读文本与可区分形态。列表卡与收件箱此前把布尔插值进
  // 字符串（`` `${c.satisfied} · ${c.evidence}` ``），页面显示裸 true/false。
  for (const surface of surfaces) {
    const source = readSource(surface);
    assert.doesNotMatch(
      source,
      /\$\{c\.satisfied/,
      `${surface} 不得把布尔插值进判据文本——须经共享三态映射取可读词条`,
    );
    assert.match(source, /workCaseCheckStatement/, `${surface} 必须消费共享三态映射`);
  }
  // 三态映射与详情共用同一实现（单一实现，防口径漂移）。
  assert.match(stateModule, /export function workCaseCheckStateLabel/);
  assert.match(stateModule, /export function workCaseCheckStatement/);
  assert.match(readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx'), /workCaseCheckStateLabel/);
});

test('v4 residue stays out of the WorkCase presentation chain', () => {
  // 零消费者 v4 详情投影（含 v4 字段词汇）已删除。
  assert.equal(
    fs.existsSync(path.join(repositoryRoot, 'web/src/../shared/workcaseDetailProjection.ts')),
    false,
    'shared/workcaseDetailProjection.ts 是零消费者 v4 残留，已随本单删除',
  );
  // 零消费的 v4 展示耦合字段不得复活。
  const facts = readSource('web/api/services/facts.ts');
  const factsCode = facts.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(factsCode, /has_execution_section/, 'has_execution_section 零消费且非 21 §8 字段');
  // model.ts 的 WorkCase 字段序为 21 §8 闭集，不含 v4 词汇。
  const model = readSource('web/src/pages/object-detail/model.ts');
  const workcaseOrder = model.slice(model.indexOf('  workcase: ['), model.indexOf('  adr: ['));
  for (const v4Field of ['phase', 'work_items', 'closure_proposal', 'success_criterion_definitions', 'execution_approval', 'result_version']) {
    assert.doesNotMatch(workcaseOrder, new RegExp(`'${v4Field}'`), `model.ts 的 WorkCase 字段序不得含 v4 字段 ${v4Field}`);
  }
});
