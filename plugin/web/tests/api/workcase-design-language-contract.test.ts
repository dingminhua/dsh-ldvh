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

  // 21 §9.3：satisfied 是布尔判定（真实对象为 true）。
  assert.match(api, /interface WorkCaseResultCheck \{[\s\S]*?satisfied\?: boolean/);
  // 10 §12.8：状态须有可读文本，不得只用颜色/图标承载。
  for (const key of ['workcaseCheckSatisfied', 'workcaseCheckUnsatisfied', 'workcaseCheckUnknown']) {
    assert.match(layout, new RegExp(`objectDetail\\.${key}`), `详情必须呈现 ${key} 词条`);
    assert.match(locales, new RegExp(`'objectDetail\\.${key}'`), `词条 ${key} 必须已登记`);
  }
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
