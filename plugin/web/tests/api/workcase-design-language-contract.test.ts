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
  //
  // Human 2026-09-24 统一词表：三态映射取 `21 §8` 登记的核对词（达成／部分达成／
  // 未达成／未记录），不再另造「已满足／未满足」。此前详情说「已满足」、卡片说
  // 「达成」，同一状态跨面显示为不同词。故断言的是**列表词条**。
  for (const key of ['workcaseCheck.achieved', 'workcaseCheck.partial', 'workcaseCheck.not-achieved', 'workcaseCheck.unrecorded']) {
    assert.match(stateModule, new RegExp(`objectList\\.${key}`), `三态映射必须登记 ${key} 词条`);
    assert.match(locales, new RegExp(`'objectList\\.${key}'`), `词条 ${key} 必须已登记`);
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
  // ResponsibilityNodes，故 summary/scope 在 closed 详情同样在场。
  // （`serves` 不在本节点内：它是身份锚点，由四个分组共用的详情头
  //  ServesSgBadge 承载，同样满足「不因分组消失」。）
  assert.match(layout, /function ResponsibilityNodes\(/);
  assert.equal(
    (layout.match(/<ResponsibilityNodes obj=\{obj\} locale=\{locale\} \/>/g) ?? []).length,
    4,
    '四个派生主体（draft/executing/awaiting_gate2/closed）都必须渲染共有字段节',
  );
});

test('serves is presented once — in the detail head, never repeated in the body', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const detail = readSource('web/src/pages/ObjectDetail.tsx');

  // Human 定案 2026-09-13：详情头标签序为 类型 → 优先级 → SG → 修改次数，
  // 故 `serves` 的身份锚点由头部 ServesSgBadge 承载（四个派生分组共用同一头，
  // 「不因分组消失」对它成立）。
  assert.match(
    detail,
    /<PriorityIcon[\s\S]*?<ServesSgBadge value=\{source\.serves\}/,
    '详情头必须承载 serves 徽章——正文不再重复它是以此为前提的',
  );

  // 正文段不得再渲染第二处 serves：同一信息两处出现会让 Human 无法判断
  // 哪个是权威呈现面，且新增字段时容易只更新一处。
  assert.doesNotMatch(
    layout,
    /workcaseServes/,
    'serves 不得在 WorkCase 正文段重复呈现（它在详情头已呈现；若确需改回正文，先撤本守卫并说明理由）',
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
  // 四个呈现面**全部**经共享三态映射取词条（09 §6 单一实现）。
  //
  // Human 2026-09-24 统一词表后，列表卡的 closed 分支改由 `WorkCaseClosedSummary`
  // 呈现（只给 `[状态] 步骤标题`，证据归详情），故「消费方」不再只有页面文件——
  // 断言按**组件**取，比按页面文件取更贴近真实消费点（页面文件不再直接拼判据文本）。
  const surfaces = [
    'web/src/pages/ObjectList.tsx',
    'web/src/pages/CognitionCenter.tsx',
    'web/src/components/WorkCaseClosedSummary.tsx',
    'web/src/components/WorkCaseResultDraft.tsx',
  ] as const;
  // 实际渲染判据状态的三个面：它们必须引用共享模块的导出。
  // `ObjectList.tsx` 不在其列——closed 分支的判据渲染已下沉到
  // `WorkCaseClosedSummary`，页面本身不再直接拼判据文本（故对它只断言「不插值布尔」
  // 与「不自造词条」两条负向不变量，不断言引用）。
  const renderingSurfaces = surfaces.filter((s) => !s.endsWith('ObjectList.tsx'));
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
  }
  for (const surface of renderingSurfaces) {
    assert.match(
      readSource(surface),
      /workCaseCheckState|workCaseCheckStateFromWord|workCaseCheckLabelFor|workCaseCheckStatement/,
      `${surface} 必须消费共享三态映射`,
    );
  }
  // 三态映射与详情共用同一实现（单一实现，防口径漂移）。
  assert.match(stateModule, /export function workCaseCheckStateLabel/);
  assert.match(stateModule, /export function workCaseCheckLabelFor/);
  assert.match(stateModule, /export function workCaseCheckStateFromWord/);
  assert.match(stateModule, /export function workCaseCheckStatement/);
  // 词表只有一处定义：三个呈现面不得各自登记核对状态词条。
  for (const surface of surfaces) {
    assert.doesNotMatch(
      readSource(surface),
      /'objectList\.workcaseCheck\./,
      `${surface} 不得自造核对状态词条——词表只在 workcaseCheckState 单点给出`,
    );
  }
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

// ── 2026-09-17 补充（WC 52314cf8）：两个 Gate 待办组配色区分 ─────────────────
//
// Human 指令（2026-09-17）：「待批准执行与待批准关闭，标签需要使用显著的不同颜色」。
// 二者语义相反——pending_gate1 是「工单还没开始」（status=draft，等 Gate 1 放行）、
// awaiting_gate2 是「工单已做完，等 Human 验收」（status=open ∧ 正文含结果节）——
// 同色会使 Human 无法一眼分辨。此前两者同为紫 #8b5cf6，且同一卡片内徽标与卡内
// 提示还走两条互不相通的着色路径（徽标经 STATUS_COLORS、提示硬编码 Tailwind 类），
// 造成 pending_gate1 的徽标是紫、提示却是琥珀的自相矛盾。

/**
 * 剥掉 `//`、`*`、`/*` 起始的行——注释里的同形文本不得参与断言。
 *
 * 这不是洁癖：`statusColors.ts` 的注释里**真的**出现过同形的历史色值行
 * （本单修复前后都留有解释性注释）。若断言直接跑原文，一条注释形式的历史条目
 * 就会抢先命中，使「真实条目已改回同色」的回归完全逃逸——该逃逸已实测复现
 * （16/16 全绿）。同一文件下文的提示行守卫早已采用同样的剥注释做法，此处补齐。
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

/**
 * 从 statusColors.ts 取出某键的浅色/暗色色值（不硬编码 hex，色值可演进）。
 *
 * 只接受**恰好一条**声明：多于一条说明存在重复定义（如注释假命中或并列条目），
 * 此时断言失败而不是取「第一个」——取首个正是上面所述逃逸的成因。
 */
function statusColorPair(source: string, key: string): { light: string; dark: string } {
  const code = stripCommentLines(source);
  const matches = [...code.matchAll(new RegExp(`\\b${key}: \\{ light: '(#[0-9a-fA-F]{6})', dark: '(#[0-9a-fA-F]{6})' \\}`, 'g'))];
  assert.equal(
    matches.length,
    1,
    `statusColors.ts 必须为 ${key} 恰好声明一条 light/dark 色值（实际 ${matches.length} 条）——` +
    '多条即重复定义或注释假命中，不得取首个',
  );
  return { light: matches[0][1], dark: matches[0][2] };
}

/** 色相角（0–360）。 */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** 两色的最短色相距离（0–180）。 */
function hueDistance(a: string, b: string): number {
  const raw = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(raw, 360 - raw);
}

/** WCAG 相对亮度与对比度。 */
function relativeLuminance(hex: string): number {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('the two Gate groups never share a colour, in either theme mode', () => {
  const statusColors = readSource('web/src/utils/statusColors.ts');
  const gate1 = statusColorPair(statusColors, 'pending_gate1');
  const gate2 = statusColorPair(statusColors, 'awaiting_gate2');

  // 两条断言分别覆盖浅色与暗色：任一模态同色即失败——只查浅色会漏掉暗色回归。
  assert.notEqual(gate1.light, gate2.light, '浅色模式下两个 Gate 组不得同色');
  assert.notEqual(gate1.dark, gate2.dark, '暗色模式下两个 Gate 组不得同色');
});

test('the two Gate groups are far enough apart in hue to be told apart at a glance', () => {
  const statusColors = readSource('web/src/utils/statusColors.ts');
  const gate1 = statusColorPair(statusColors, 'pending_gate1');
  const gate2 = statusColorPair(statusColors, 'awaiting_gate2');

  // 阈值 60°：Human 指令要求「显著」。60° 是相邻色相族的边界——低于它，
  // 两色会落进同一色族（如紫 258° 与品红 292° 仅差 34°），扫读时不可靠。
  for (const [mode, a, b] of [['浅色', gate1.light, gate2.light], ['暗色', gate1.dark, gate2.dark]] as const) {
    const distance = hueDistance(a, b);
    assert.ok(
      distance >= 60,
      `${mode}模式下两个 Gate 组色相距离须 ≥60°（实际 ${distance.toFixed(0)}°：${a} vs ${b}）——Human 要求「显著的不同颜色」`,
    );
  }
});

test('both Gate group colours stay readable against their own background, in both modes', () => {
  const statusColors = readSource('web/src/utils/statusColors.ts');
  const gate1 = statusColorPair(statusColors, 'pending_gate1');
  const gate2 = statusColorPair(statusColors, 'awaiting_gate2');

  // 背景取**本仓库真实的** --ldvh-bg 两档（浅色与暗色各一条）。
  // 不得用「白底/某个深色」这类仓库外假设：模式只测一半，或基准不是本仓库的底色，
  // 都会让不可读的色值静默通过（该缺口已实测复现：暗值改成深底不可读仍 16/16 全绿）。
  const pageBg = readSource('web/src/index.css');
  const backgrounds = [...pageBg.matchAll(/--ldvh-bg:\s*(\d+)\s+(\d+)\s+(\d+)/g)];
  assert.equal(
    backgrounds.length,
    2,
    `index.css 的 --ldvh-bg 必须有浅/暗两档（实际 ${backgrounds.length} 条）`,
  );
  const toHex = (r: string, g: string, b: string) =>
    `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  const [lightBackground, darkBackground] = backgrounds.map((m) => toHex(m[1], m[2], m[3]));

  // 3:1 —— 大字号/非正文文本的最低可读线（两组提示用 caption/body-muted 层级）。
  // 四种组合逐一断言：任一模态不可读即失败。
  const cases = [
    ['pending_gate1 / 浅色', gate1.light, lightBackground],
    ['pending_gate1 / 暗色', gate1.dark, darkBackground],
    ['awaiting_gate2 / 浅色', gate2.light, lightBackground],
    ['awaiting_gate2 / 暗色', gate2.dark, darkBackground],
  ] as const;
  for (const [label, hex, background] of cases) {
    const ratio = contrastRatio(hex, background);
    assert.ok(
      ratio >= 3,
      `${label} 对比度须 ≥3:1（${hex} vs ${background}，实际 ${ratio.toFixed(2)}:1）`,
    );
  }
});

test('derived-group hint line is gone from every surface — group semantics live in the header badge', () => {
  // Human 2026-09-19 定案：卡体/详情底部的派生分组提示行与卡头徽标同义
  // （徽标 statusLabel = getObjectStatusLocale('workcase', group)），属同一张
  // 卡片上说两遍，故六个落点全部移除、组件与词条一并删除。
  //
  // 本守卫防的是「再加回来」：任何呈现面重新出现该提示行或它的词条键即失败。
  // 之所以按「组件不存在 + 词条键不存在 + 落点不存在」三重断言，是因为三者
  // 可被分别绕过——只删落点留下组件与词条，或只删词条留下组件，都会让
  // 「已移除」这句话失真。
  const componentPath = path.join(repositoryRoot, 'web/src/components/WorkCaseGroupHint.tsx');
  assert.equal(
    fs.existsSync(componentPath),
    false,
    'WorkCaseGroupHint 组件已无消费者，必须删除（不得留零消费者导出，10 §12 反过度设计）',
  );

  const locales = readSource('web/src/i18n/locales.ts');
  assert.doesNotMatch(
    locales,
    /workcaseAwaitingGate[12]'/,
    '派生分组提示行的 i18n 词条已无消费者，必须删除',
  );

  for (const surface of ['web/src/pages/ObjectList.tsx', 'web/src/pages/CognitionCenter.tsx', 'web/src/pages/object-detail/WorkCaseReadingLayout.tsx'] as const) {
    assert.doesNotMatch(
      readSource(surface),
      /WorkCaseGroupHint|workcaseAwaitingGate/,
      `${surface} 不得再渲染派生分组提示行——分组语义由头部徽标承载`,
    );
  }
});

test('the closure-window hint never lives in the executing branch (mutually exclusive with its group)', () => {
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const lifecycle = readSource('web/shared/workcaseLifecycle.ts');

  // 派生不变量：has_result_draft 为真 ⇔ 正文含「## 结果」节 ⇔ group=awaiting_gate2。
  // 同一次派生同时给出 group 与该标记，故 executing 组内该标记恒为假。
  assert.match(
    lifecycle,
    /group: hasResultDraft \? 'awaiting_gate2' : 'executing'/,
    '派生规则必须保持 executing 与 awaiting_gate2 互斥',
  );
  assert.match(lifecycle, /has_result_draft: hasResultDraft/);

  // 因此 executing 分支不得渲染关闭准备窗口提示（那是不可达代码，且着色入参
  // 与所在分组不一致——2026-09-17 已由独立复核发现并移除）。
  const executingBody = layout.slice(
    layout.indexOf('function ExecutingBody('),
    layout.indexOf('function AwaitingGate2Body('),
  );
  assert.ok(executingBody.length > 0, '必须能定位 ExecutingBody');
  assert.doesNotMatch(
    executingBody,
    /workcaseResultDraftPresent/,
    'executing 分支不得承载关闭准备窗口提示——该分支不可达',
  );
  assert.doesNotMatch(
    executingBody,
    /group="awaiting_gate2"/,
    'executing 分支内的提示不得标为 awaiting_gate2 组——着色入参须等于所在分组',
  );
});

test('授权范围的标签行与条目须有视觉层级，且列表与相邻段落有间距 (Human 裁定 2026-09-22)', () => {
  const detail = readSource('web/src/pages/ObjectDetail.tsx');
  const styles = readSource('web/src/index.css');

  // 背景：21 §8 的 `scope` 由「`做什么：`／`明确不做什么：` 两标签行 + 各自条目」构成，
  // 但标签行在 Markdown 里是**普通段落**（`<p>`），与正文段落同标签——CSS 选择器无法
  // 只选中它。故呈现层必须在渲染时识别并加类，否则「标签行须可区分」无法实现
  // （Human 实测：标签行与正文同色同重，读者看不出授权范围的骨架）。
  assert.match(
    detail,
    /className=\{label \? 'ldvh-label-line' : undefined\}/,
    'ResearchTextNodeContent 须为标签行附加 ldvh-label-line 类（否则 CSS 无法选中它）',
  );
  assert.match(detail, /function isLabelLine\(/, '须有标签行判定函数');
  assert.match(
    detail,
    /function reactNodeText\(/,
    '须安全提取 children 纯文本——String(children) 对数组/元素会得到 [object Object]，使判定忽真忽假',
  );

  // CSS：标签行呈现为小标题（加粗 + 更重的取色），与 li 条目形成层级。
  const labelRule = /\.ldvh-label-line\s*\{([^}]*)\}/.exec(styles);
  assert.ok(labelRule, 'index.css 须有 .ldvh-label-line 规则');
  assert.match(labelRule![1], /font-weight:\s*600/, '标签行须加粗（与条目区分）');
  assert.match(
    labelRule![1],
    /color:\s*rgb\(var\(--ldvh-text-primary\)\)/,
    '标签行取色须用 text-primary——与正文 text-secondary 区分',
  );

  // 列表与相邻段落的间距：`做什么：` → 列表 → `明确不做什么：` 结构中，若列表
  // margin-bottom 为 0，后一标签行会紧贴最后一个条目，两段骨架挤在一起。
  // 这一项**必须在呈现层解决**：实测 Markdown 已把空行渲染为两个兄弟节点
  // （`<ul>` 与 `<p>`），是 CSS 零间距让它们视觉相贴——数据侧加空行不产生效果。
  //
  // 断言取**规则体内的取值**而非整条规则的书写形式：该取值现与 `display:flex` 等既有
  // 声明同处一条规则（初版另写一条覆盖规则，会在同一处留下两个同选择器规则，已改为直接
  // 改原规则）。按取值断言，两种写法都能通过；若有人把下间距改回 0 则必然失败。
  const listRuleBody =
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(ul, ol\)\s*\{([^}]*)\}/.exec(styles);
  assert.ok(listRuleBody, '阅读节点须有列表规则');
  const listMarginBottom = /margin-bottom:\s*([^;]+);/.exec(listRuleBody![1]);
  assert.ok(listMarginBottom, '列表规则须显式给出 margin-bottom');
  assert.notEqual(
    listMarginBottom![1].trim(),
    '0',
    '阅读节点的列表须有非零下间距，否则后一标签行紧贴条目（数据侧空行不产生效果）',
  );
  assert.match(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(ul, ol\) \+ :where\(p, h2, h3, h4, h5, h6\)\s*\{\s*margin-top:\s*0\.625rem;\s*\}/,
    '列表之后的段落须有上间距（与上一条共同解决「明确不做什么」紧贴问题）',
  );
});

test('阅读节点的列表圆点不得带外发光 (Human 裁定 2026-09-22)', () => {
  const styles = readSource('web/src/index.css');

  // 圆点标记由 `ul > li::before` 自绘。原值带一圈外发光
  // （`box-shadow: 0 0 0 3px …／0.08`）——v4 平移时继承（6bf5e4f），
  // Human 实测认为浅色壳底上圆点因此发虚、边界不清，要求去掉。
  //
  // 只去光晕、保留圆点：圆点是行首结构标记，不是装饰；发光才是多余的视觉层。
  const markRule =
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(ul > li\)::before\s*\{([^}]*)\}/.exec(styles);
  assert.ok(markRule, '阅读节点须有自绘的列表圆点规则');
  assert.doesNotMatch(
    markRule![1].replace(/\/\*[\s\S]*?\*\//g, ''),
    /box-shadow/,
    '列表圆点不得带外发光（box-shadow）——注释中记录原值不算违规，实际声明不得存在',
  );
  assert.match(markRule![1], /border-radius:\s*999px/, '圆点须保留（只去光晕，不去标记本身）');
  assert.match(markRule![1], /background:\s*rgb\(var\(--ldvh-text-secondary\)/, '圆点取色不变');

  // 提交信息面（.ldvh-commit-body-markdown）是另一处呈现面，不在本项范围内——
  // 本项只针对阅读节点（Human 看到的是「授权范围」字段）。
  assert.doesNotMatch(
    styles.slice(0, styles.indexOf('.ldvh-commit-body-markdown') + 1),
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(ul > li\)::before[\s\S]*box-shadow/,
    '阅读节点圆点规则内不得残留 box-shadow',
  );
});

test('阅读节点内纯文本与 Markdown 两种正文须同层级 (统一设计语言, 2026-09-22)', () => {
  const styles = readSource('web/src/index.css');
  const design = readSource('web/docs/01-全局设计约束.md');

  // 统一设计语言：阅读区正文基准 14px（docs/01 §1.4 第 9 条；第 4 条另禁「详情页与
  // 阅读面板随卡片扫描窗口缩小」）。全仓 14 处阅读字段都经 ResearchTextNodeContent
  // （→ .ldvh-inline-markdown，14px/24px），唯一例外是 gist——21 §8 定义它纯文本、
  // 不得经 Markdown（由 gist 呈现契约钉住），故由裸 <p class="ldvh-detail-semantic-body">
  // 渲染后会落到 13px/22px，同页出现两种字号与两种取色。
  assert.match(design, /Markdown 阅读区[\s\S]{0,80}正文基准为 14px/, '设计语言须登记阅读区 14px 基准');
  assert.match(design, /详情页和阅读面板仍使用各自正文层级，不得随之缩小/, '设计语言须禁止详情页缩小正文');

  // 壳内的纯文本正文须被对齐到同一基准（14px/24px + 同一取色）。
  const rule = /\.ldvh-research-node-content \.ldvh-detail-semantic-body\s*\{([^}]*)\}/.exec(styles);
  assert.ok(rule, '须有「壳内纯文本正文」的对齐规则——否则 gist 与相邻节点字号不一致');
  assert.match(rule![1], /font-size:\s*0\.875rem/, '壳内纯文本正文须取 14px（阅读基准）');
  assert.match(rule![1], /line-height:\s*1\.5rem/, '壳内纯文本正文行高须取 24px');
  assert.match(
    rule![1],
    /color:\s*rgb\(var\(--ldvh-text-secondary\)\)/,
    '壳内纯文本正文取色须与 .ldvh-inline-markdown 一致',
  );

  // 边界：不得改全局 `.ldvh-detail-semantic-body` 的取值——它另用于阅读面板的 mono
  // 元信息 `dd`（元信息语义，13px 恰当），改全局会波及那一处。
  const globalRule = /^ {2}\.ldvh-detail-semantic-body\s*\{([^}]*)\}/m.exec(styles);
  assert.ok(globalRule, '全局 .ldvh-detail-semantic-body 须保留');
  assert.match(
    globalRule![1],
    /font-size:\s*0\.8125rem/,
    '全局取值须保持 13px——本项只对齐「阅读节点壳内」这一处，不波及阅读面板的 mono 元信息',
  );
});

// 建议去向的四色区分（Human 2026-09-24）：四个去向各用一种颜色，扫读可分辨。
//
// 为什么需要守卫：设计语言有「着色必须单一来源，不得在业务组件里硬编码颜色类」
// 的纪律（本文件上方已有同类断言）。四去向色是**分类色**，按同一纪律办——色表只在
// `workcaseCheckState` 单点，组件只消费。故此处断言三件事：
//   ① 色表在共享模块，且四词各有一个色类；
//   ② 四个色类**两两不同**（否则「四色区分」名存实亡）；
//   ③ 组件不自行硬编码建议标记的颜色（只经共享函数取色）。
test('建议去向四词各有一色，且四色互不相同（Human 2026-09-24）', () => {
  const stateModule = readSource('web/src/utils/workcaseCheckState.ts');
  const draft = readSource('web/src/components/WorkCaseResultDraft.tsx');

  // ① 四词齐全（与 21 §8 闭集四词一致）
  for (const kind of ['另立工单', '接受现状', '转入 Spark', '直接行动']) {
    assert.match(
      stateModule,
      new RegExp(`'${kind}':\\s*'[^']+'`),
      `色表必须为去向「${kind}」登记色类`,
    );
  }
  // ② 四色两两不同：把色表里的四段 value 抽出来比对
  const pairs = [...stateModule.matchAll(/'(另立工单|接受现状|转入 Spark|直接行动)':\s*'([^']+)'/g)]
    .map((m) => [m[1], m[2]] as const);
  assert.equal(pairs.length, 4, `色表应恰好覆盖四词，实际 ${pairs.length}`);
  const values = pairs.map(([, v]) => v);
  assert.equal(new Set(values).size, 4, `四个去向的色类必须互不相同，实际：${JSON.stringify(values)}`);

  // ③ 组件只经共享函数取色，不自行硬编码建议标记的颜色
  assert.match(draft, /workCaseAdviceTagClass/, '组件必须经共享函数取去向色');
  // 判据取「组件源码里不得出现任何 tailwind 色类」——比按具体色名断言强：
  // 后者只挡住「改回同一个 indigo」，挡不住「换成另一个硬编码色」。
  const colorClass = /\b(?:border|bg|text)-(?:indigo|blue|lime|stone|fuchsia|emerald|amber|red|rose|violet|slate|gray|sky|teal|cyan|purple|orange|yellow|green|pink)-\d{2,3}(?:\/\d+)?/g;
  const hits = (draft.match(colorClass) ?? []).filter((cls) => !cls.includes('ldvh-'));
  assert.deepEqual(
    hits,
    [],
    `组件不得硬编码 tailwind 色类（须经共享色表），实际出现：${JSON.stringify(hits)}`,
  );
});

// 卡面剥 Markdown 标记（`docs/10` §5.5，2026-09-24 补充）。
//
// 为什么需要：「不解析 Markdown」不等于「不显示标记」——卡面是纯文本插值，源文本里的
// `**加粗**`、` 标识符 ` 会把**标记本身**显示给读者。实测正文残留 27 条中 19 条含标记。
// 故渲染前须剥标记；且剥离函数须**单一实现**（不得每处各写一份正则）。
test('卡面渲染残留与去向正文前须剥 Markdown 标记，且实现单一来源', () => {
  const cardText = readSource('web/src/utils/cardText.ts');
  const closed = readSource('web/src/components/WorkCaseClosedSummary.tsx');
  const draft = readSource('web/src/components/WorkCaseResultDraft.tsx');
  const objectList = readSource('web/src/pages/ObjectList.tsx');

  // ① 剥离函数存在且导出（单一实现处）
  assert.match(cardText, /export function stripCardMarkdown/, '剥标记函数须在 @/utils/cardText 导出');

  // ② 三处卡面渲染点都经它——**逐个渲染点断言，不是「文件里出现过」**。
  //
  // 本条首版写成「文件里出现过 stripCardMarkdown 即通过」，结果残留块改回直接插值时
  // **逃逸**（同文件里去向块仍在用，文件级断言照样通过）。故改为：把每个渲染原始文本
  // 的插值点找出来，逐个要求它被剥标记函数包裹。
  for (const [name, src] of [['WorkCaseClosedSummary', closed], ['WorkCaseResultDraft', draft]] as const) {
    // 找所有「渲染文本」的插值：{...item.text...} 或 {item} 一类
    const rawSpans = [
      ...src.matchAll(/\{(?!stripCardMarkdown)([^{}]*\b(?:item\.text|item)\b[^{}]*)\}/g),
    ]
      .map((m) => m[1].trim())
      // 排除非渲染用途（key、data-*、className 里的表达式、事件处理等）
      .filter((expr) => !/^(?:key|index|i)$/.test(expr))
      .filter((expr) => !/typeof|String\(|stripCardMarkdown/.test(expr) === false || true)
      .filter((expr) => /^(?:item|item\.text)$/.test(expr));
    assert.deepEqual(
      rawSpans,
      [],
      `${name} 有未经剥标记的原始文本插值：${JSON.stringify(rawSpans)}`,
    );
  }
  // 正向：两处确实各自调用了剥标记函数（覆盖上一条的「一个都没有」的空转风险）
  assert.ok(
    (closed.match(/stripCardMarkdown\(/g) ?? []).length >= 2,
    'WorkCaseClosedSummary 的残留块与去向块**各自**都须经剥标记',
  );
  assert.match(draft, /stripCardMarkdown\(item\.text\)/, 'WorkCaseResultDraft 的建议正文须经剥标记');

  // ③ 实现单一来源：ObjectList 的同类处理已收敛到该共享函数，不得再自行定义一份
  assert.match(objectList, /from '@\/utils\/cardText'/, 'ObjectList 须复用共享剥标记函数');
  assert.doesNotMatch(
    objectList,
    /\.replace\(\/\\\*\\\*\(\[\^\*\]\+\)\\\*\\\*\/g/,
    'ObjectList 不得再保留自己那份加粗剥离正则（应已收敛到共享实现）',
  );
});

// 残留块的「[标记] 正文」行结构与块序（Human 2026-09-24 裁定）。
//
// 为什么需要：核对块与去向块的行结构都是「[标记] 正文」，而残留块此前只有正文——
// 三块行结构不一致，条目边界靠换行区分。Human 要求逐条加「残留」标记，并把残留块
// **排在去向之上**（残留是「还剩什么」、去向是「打算怎么办」，先陈述事实再给去向）。
test('残留块逐条加标记，且排在去向之上（两块卡一致）', () => {
  const stateModule = readSource('web/src/utils/workcaseCheckState.ts');
  const closed = readSource('web/src/components/WorkCaseClosedSummary.tsx');
  const draft = readSource('web/src/components/WorkCaseResultDraft.tsx');

  // ① 标记色类在共享模块登记（着色单一来源）
  assert.match(
    stateModule,
    /export const WORKCASE_RESIDUAL_TAG_CLASS/,
    '残留标记色类须在共享模块登记',
  );

  // ② 两块卡的残留块**逐条**都带标记——不是块首标一次
  for (const [name, src] of [['WorkCaseClosedSummary', closed], ['WorkCaseResultDraft', draft]] as const) {
    assert.match(
      src,
      /WORKCASE_RESIDUAL_TAG_CLASS/,
      `${name} 的残留条目须带标记`,
    );
    assert.match(
      src,
      /workcaseResidualTag/,
      `${name} 的残留标记须取 i18n 词条（不得写死文字）`,
    );
  }

  // ③ 块序：残留块的位置必须在去向块**之前**（两块卡一致）。
  //
  // 判据取 **JSX 使用点**（`className={...}` / `${...}` 插值），不取 `indexOf(常量名)`
  // ——后者会命中文件顶部的 **import 语句**（其位置恒定），故「顺序颠倒」时会**逃逸**
  // （本条首版就如此，实测变异未被捕获）。
  for (const [name, src] of [['WorkCaseClosedSummary', closed], ['WorkCaseResultDraft', draft]] as const) {
    const residualAt = src.indexOf('className={WORKCASE_RESIDUAL_BLOCK_CLASS}');
    const adviceAt = src.search(/\$\{workCaseAdviceTagClass\(/);
    assert.ok(
      residualAt >= 0,
      `${name}: 未找到残留块的使用点（判据须匹配 JSX 使用，而非 import）`,
    );
    assert.ok(adviceAt >= 0, `${name}: 未找到去向标记的使用点`);
    assert.ok(
      residualAt < adviceAt,
      `${name}: 残留块须排在去向块之上（残留使用点 ${residualAt} / 去向使用点 ${adviceAt}）`,
    );
  }
});

// 计划清单的容器（Human 2026-09-24 裁定，方案 ③）。
//
// 为什么需要：计划清单此前**无容器**（只有蓝点 + 蓝字），是四组卡体里唯一的无框块，
// 表现偏弱。现包一层 `WORKCASE_CRITERIA_SURFACE_CLASS`——**与详情页判据面板同源**
// （两处渲染的是同一份 `plan` 数据）。
test('计划/判据清单在列表卡、收件箱、详情三处共用同一个容器常量', () => {
  const list = readSource('web/src/components/WorkCaseCriteriaList.tsx');
  const objectList = readSource('web/src/pages/ObjectList.tsx');
  const inbox = readSource('web/src/pages/CognitionCenter.tsx');
  const layout = readSource('web/src/pages/object-detail/WorkCaseReadingLayout.tsx');

  // ① 容器类登记在判据组件（单一来源），不在各页各写一份
  assert.match(
    list,
    /export const WORKCASE_CRITERIA_SURFACE_CLASS/,
    '容器类须在 WorkCaseCriteriaList 单点导出',
  );

  // ② 三处消费点都 import 它（而不是自定义一个框）
  for (const [name, src] of [
    ['ObjectList', objectList],
    ['CognitionCenter', inbox],
    ['WorkCaseReadingLayout', layout],
  ] as const) {
    assert.match(
      src,
      /import \{[\s\S]*?WORKCASE_CRITERIA_SURFACE_CLASS[\s\S]*?\} from '@\/components\/WorkCaseCriteriaList'/,
      `${name} 须从 WorkCaseCriteriaList import 该常量（不得另定一份）`,
    );
  }

  // ②' **每一个** `<WorkCaseCriteriaList` 使用点都须被容器包住——逐个断言，
  //     不是「文件里出现过该常量」。本条首版只做了后者，结果「收件箱改回无容器」
  //     时**逃逸**（同文件其它使用点仍在用该常量，文件级断言照样通过）。
  for (const [name, src] of [
    ['ObjectList', objectList],
    ['CognitionCenter', inbox],
    ['WorkCaseReadingLayout', layout],
  ] as const) {
    // 判据取「**未被容器包住的裸使用点**」：容器开标签的类名后紧跟 `}`（`className={X}`
    // 或 `className={`${X} …`}`）。**只切一次**——首版同时切 `X}` 与 `className={X}`，
    // 而后者包含前者的子串，每个容器被**数了两次**、容器数虚高，变异因此逃逸。
    // import 语句里的 `WORKCASE_CRITERIA_SURFACE_CLASS }`（带空格）不会被切中。
    //
    // 判据是「容器数 ≥ 使用点数」而非相等：`WorkCaseReadingLayout` 的 PlanNode 自建
    // `<ol>`（不走本组件）、只借容器类，故容器数会多于使用点数——那是合法形态。
    const uses = src.split('<WorkCaseCriteriaList').length - 1;
    const wrapped = src.split('WORKCASE_CRITERIA_SURFACE_CLASS}').length - 1;
    assert.ok(uses > 0, `${name}: 未找到 WorkCaseCriteriaList 使用点`);
    assert.ok(
      wrapped >= uses,
      `${name}: 有未包容器的判据清单（使用点 ${uses} 个，容器 ${wrapped} 个）`,
    );
  }

  // ③ 反向：`pending_gate1` 分支的计划清单**必须**被容器包住
  //    （判据取 JSX 使用点，不取 import 语句位置）
  const planBlock = objectList.slice(
    objectList.indexOf("if (group === 'pending_gate1')"),
    objectList.indexOf("if (group === 'executing')"),
  );
  assert.match(planBlock, /WORKCASE_CRITERIA_SURFACE_CLASS/, '待批准执行的计划清单须有容器');
  assert.doesNotMatch(
    planBlock,
    /<WorkCaseCriteriaList className="mt-1\.5"/,
    '计划清单不得再以无容器的裸形态渲染（此前形态，表现偏弱）',
  );
});

// 卡体条目行的统一（Human 2026-09-24：「希望有分割线」）。
//
// 背景：核对/去向/残留三块的条目都有分割线，而计划清单另写了一份行样式
// （`flex … gap-2.5`，无分割线），四块里唯一不一致。根因是同一串行样式被抄了 5 份。
// 本守卫要求：① 行样式单一来源；② 卡面的判据/计划清单用带分割线的卡面行。
test('卡体条目行样式单一来源，且卡面清单带分割线', () => {
  const state = readSource('web/src/utils/workcaseCheckState.ts');
  const criteria = readSource('web/src/components/WorkCaseCriteriaList.tsx');
  const closed = readSource('web/src/components/WorkCaseClosedSummary.tsx');
  const draft = readSource('web/src/components/WorkCaseResultDraft.tsx');
  const objectList = readSource('web/src/pages/ObjectList.tsx');
  const inbox = readSource('web/src/pages/CognitionCenter.tsx');

  // ① 行样式单一来源：含分割线的行类只在共享模块定义一次
  assert.match(state, /export const WORKCASE_ITEM_ROW_CLASS\s*=\s*\n?\s*'border-t /, '行样式须在共享模块登记（含 border-t）');
  const literal = 'border-t border-ldvh-border/60 py-1.5';
  for (const [name, src] of [
    ['WorkCaseClosedSummary', closed],
    ['WorkCaseResultDraft', draft],
    ['WorkCaseCriteriaList', criteria],
  ] as const) {
    assert.equal(
      (src.match(new RegExp(literal.replace(/[/.]/g, '\\$&'), 'g')) ?? []).length,
      0,
      `${name} 不得再抄一份行样式字面量（须经 WORKCASE_ITEM_ROW_CLASS）`,
    );
  }
  // 两个卡组件确实在用共享常量
  assert.match(closed, /WORKCASE_ITEM_ROW_CLASS/, '已关闭卡的条目行须用共享常量');
  assert.match(draft, /WORKCASE_ITEM_ROW_CLASS/, '待批准关闭卡的条目行须用共享常量');

  // ② 计划清单在卡面用带分割线的卡面行（density="card"），详情面保持宽松行
  assert.match(criteria, /density\??:\s*WorkCaseCriteriaRowDensity/, '组件须支持密度参数');
  assert.match(criteria, /density === 'card'[\s\S]{0,120}WORKCASE_ITEM_ROW_CLASS/, '卡面密度须用带分割线的行');
  assert.equal((objectList.match(/density="card"/g) ?? []).length, 1, '列表卡计划清单须用卡面密度');
  assert.equal((inbox.match(/density="card"/g) ?? []).length, 3, '收件箱三处须用卡面密度');
});
