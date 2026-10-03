import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * 结构单源契约（批次 C 的机械守卫）。
 *
 * 根因登记：三类渲染结构此前以手抄形式多处复制（左色条决策块跨 2 文件 4 站、
 * 读取注记同文件 3 站、联邦 issues 列表跨 2 文件）——「无文档、无守卫」的纯
 * 代码层约定，靠复制维持必然漂移。本契约锁三件事：
 * 1. decisionBlocks.ts / FieldReadNotes / ProjectIssuesNotice 存在且值精确；
 * 2. 收敛点确实被原消费方使用（防「常量在、没人用」的假单源）；
 * 3. 收敛掉的整串字面量不得回潮（回潮=绕开单源重新手抄）。
 *
 * 边界（与 decisionBlocks.ts 头注一致）：
 * - ~~左色条「状态通知」远亲（CognitionCenter 红 / ObjectDetail zinc）刻意不并入；~~
 *   **2026-10-05 已归正**：两处状态通知的左色条此前以「作用域不同」留在决策块单源之外，
 *   正是本仓「先以作用域为由各自留存、再逐处漂移」的典型路径。现按 `docs/01` §1.10
 *   第 7 条的新裁决移除左色条、改为四边同宽（决策块左色条与项目识别色条经 Human
 *   裁决保留）。本文件末尾新增守卫防其复发。
 * - Spark 紫块（WorkCaseCriteriaList awaiting_gate2 面，violet-400/25 档）
 *   与 WorkCaseExecFlow gate2 chip（violet-500/45 档）值域不同，不在禁令内；
 * - FieldReadNotes 的未解析注记 amber-600 档弱于 WARN_TITLE 700 档，保留既有值。
 *
 * 运行器纪律（踩过坑，勿改）：本仓库 API 契约用 `npm run test:web:api` =
 * `tsx --test tests/api/*.test.ts`（Node 内置 test runner，`node:test`）。
 * 仓库内**没有安装 vitest**——把测试改成 `import { test } from 'vitest'` 后，
 * `npx tsx --test` 会整文件 ERR_MODULE_NOT_FOUND 而不报单条失败，
 * 单用 `npx vitest run` 反而能跑绿，从而伪造出「验证通过」。改测试文件前先确认运行器。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '../..');
const srcRoot = path.join(webRoot, 'src');

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSourceFiles(p)));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 决策块**壳**的分段断言。**刻意不锁 `border-l-2`**。
 *
 *  左色条与 `specs/10-Web呈现与交互规范.md §5.5`（行 298）「语义块四边同为
 *  1px 细线」定案的关系是**未决争议**：该定案的操作句只点名判据面板
 *  （`WORKCASE_CRITERIA_SURFACE_CLASS`），但同段自述「本条是同类定案的
 *  **补齐**，不是新偏好」，其通用论理「块的身份由**背景色**与**标记**表达，
 *  不由边框粗细表达」不限于判据面板；决策块左色条（2026-09-12 引入）早于
 *  两次 Human 定案（09-13 终态说明框、09-24 判据面板），属**遗留未审**。
 *
 *  机械守卫只应守**已定**的规则，不得替 Human 判定未决争议。故此处按
 *  **无序分段**断言壳的已确证部分（四边 border 的色相 + 背景档 + 几何），
 *  左色条段不在其中。左色条的取舍由 Human 裁决——无论裁决为「移除」还是
 *  「保留」，本测试都**不需要改动**。
 *
 *  （两则修订动机，都来自本测试 v1 的实际翻车：
 *   ① v1 把 `border-l-2` 写进期望值，等于用测试单方面判定了该争议，并使
 *      「按定案移除左色条」反而被测试挡住；
 *   ② 期望值若写成跨过左色条的一整串（`border-amber-400/20 bg-amber-...`），
 *      则移除左色条的**唯一正确改法**（只删 `border-l-2 border-l-amber-400/70`
 *      两段）会令断言失配而报错——即断言本身在禁止正确的修法。
 *   故此处必须分段、且不假定段间顺序。）
 *
 *  声明形态：`DECISION_CARD_SHELL_CLASS` 是 `Record<'amber'|'violet', string>`
 *  （两个 hue 各一行），`DECISION_DETAIL_NEUTRAL_SHELL_CLASS` 是单串。 */
const DECISION_SHELL_SEGMENTS: Array<[string, string[]]> = [
  ['DECISION_CARD_SHELL_CLASS.amber', ['border-amber-400/20', 'bg-amber-500/[0.025]', 'px-3.5 py-3']],
  ['DECISION_CARD_SHELL_CLASS.violet', ['border-violet-400/20', 'bg-violet-500/[0.025]', 'px-3.5 py-3']],
  ['DECISION_DETAIL_NEUTRAL_SHELL_CLASS', ['border-ldvh-border/80', 'bg-ldvh-bg/65', 'px-3.5 py-3']],
];

/** 壳的四边 border：须有裸 `border` 类（不被 `border-l-`/`border-r-` 等单边类冒充）。 */
const BARE_BORDER = /(?:^|[\s:'"])border(?:[\s'"]|$)/;

const DECISION_ATOMS: Array<[string, string]> = [
  ['DECISION_TITLE_HUE_CLASS.amber', 'text-amber-700/85 dark:text-amber-200/85'],
  ['DECISION_TITLE_HUE_CLASS.violet', 'text-violet-700/85 dark:text-violet-200/85'],
  ['DECISION_AMBER_BODY_HUE_CLASS', 'text-amber-950/70 dark:text-amber-100/75'],
  ['DECISION_VIOLET_CODE_CHIP_HUE_CLASS', 'border-violet-400/35 bg-violet-500/10 font-mono text-violet-700 dark:text-violet-300'],
];

test('decisionBlocks 导出决策块壳与色相原子，且值为 canonical 定案', async () => {
  const source = await readFile(path.join(srcRoot, 'utils', 'decisionBlocks.ts'), 'utf8');
  const lines = source.split('\n');

  for (const [name, segments] of DECISION_SHELL_SEGMENTS) {
    // 定位到含该壳首个分段的声明行（Record 的 hue 行或单串行）。
    const line = lines.find((l) => l.includes(segments[0]) && l.includes('amber') === name.includes('amber'));
    assert.ok(line, `${name} 应有一条含「${segments[0]}」的声明行`);
    for (const segment of segments) {
      assert.ok(
        line.includes(segment),
        `${name} 的声明行应含分段「${segment}」（当前行「${line.trim()}」）`,
      );
    }
    assert.ok(
      BARE_BORDER.test(line),
      `${name} 的四边应有裸 border 类（当前行「${line.trim()}」）`,
    );
  }

  for (const [name, value] of DECISION_ATOMS) {
    assert.ok(
      source.includes(value),
      `${name} 应存在且含 canonical 值「${value}」`,
    );
  }
});

test('决策块常量被原消费方使用（防假单源）', async () => {
  const objectList = await readFile(path.join(srcRoot, 'pages', 'ObjectList.tsx'), 'utf8');
  const factLayouts = await readFile(path.join(srcRoot, 'pages', 'object-detail', 'FactReadingLayouts.tsx'), 'utf8');
  // ObjectList：琥珀卡面（Pitfall 决策字段 + Friction 现象）与紫卡面（Norm 方向键）。
  assert.ok(objectList.includes('DECISION_CARD_SHELL_CLASS.amber'), 'ObjectList 应引用 DECISION_CARD_SHELL_CLASS.amber（Pitfall/Friction 卡面）');
  assert.ok(objectList.includes('DECISION_CARD_SHELL_CLASS.violet'), 'ObjectList 应引用 DECISION_CARD_SHELL_CLASS.violet（Norm 卡面）');
  assert.ok(objectList.includes('DECISION_AMBER_BODY_HUE_CLASS'), 'ObjectList 应引用 DECISION_AMBER_BODY_HUE_CLASS');
  // FactReadingLayouts：紫详情面（Norm 方向键）。
  assert.ok(factLayouts.includes('DECISION_DETAIL_NEUTRAL_SHELL_CLASS'), 'FactReadingLayouts 应引用 DECISION_DETAIL_NEUTRAL_SHELL_CLASS（Norm 详情面）');
});

test('批次 C 收敛掉的决策块整串字面量不得回潮（src 内禁写，decisionBlocks.ts 自身豁免）', async () => {
  const files = await collectSourceFiles(srcRoot);
  // 禁的是**壳的识别特征**（背景档 + 几何、标题色相整串）——它们已定案且
  // 无争议。**刻意不含 `border-l-amber-400/70` / `border-l-violet-400/70`**：
  // 左色条去留是未决争议（见 DECISION_SHELL_ATOMS 上方注），禁其回潮即等于
  // 替 Human 裁决「保留」。裁决为「移除」后，此处至多被追加为禁令，而非现在。
  const banned = [
    'bg-amber-500/[0.025]',
    'bg-violet-500/[0.025]',
    'text-amber-950/70',
    'border-violet-400/35',
    // 标题色相整串（全串匹配：SparkHealthRow 的 amber-300/85 变体不在其列）
    'text-amber-700/85 dark:text-amber-200/85',
    'text-violet-700/85 dark:text-violet-200/85',
  ];
  for (const f of files) {
    if (f.includes('decisionBlocks')) continue; // 单源载体自身
    const body = await readFile(f, 'utf8');
    for (const variant of banned) {
      assert.ok(
        !body.includes(variant),
        `${path.relative(webRoot, f)} 重新内联了决策块字面量「${variant}」——请改用 utils/decisionBlocks.ts 的对应原子`,
      );
    }
  }
});

test('读取注记渲染器单源：FieldReadNotes 存在、CognitionCenter 消费、三连抄形态禁回潮', async () => {
  const component = await readFile(path.join(srcRoot, 'components', 'FieldReadNotes.tsx'), 'utf8');
  assert.match(component, /export default function FieldReadNotes/, 'FieldReadNotes 组件应存在');
  assert.ok(component.includes("from '@/i18n/locales'"), 'FieldReadNotes 应承接 i18n 标签拼接');

  const cognition = await readFile(path.join(srcRoot, 'pages', 'CognitionCenter.tsx'), 'utf8');
  assert.ok(cognition.includes('FieldReadNotes'), 'CognitionCenter 应消费 FieldReadNotes');
  // 三连抄收敛前形态：同一渲染串在文件里出现 3 次；收敛后标签拼接只应在组件里出现。
  const fieldIssueRenders = (cognition.match(/getFieldValueLabel\('field_issue_reason'/g) ?? []).length;
  assert.equal(fieldIssueRenders, 0, `CognitionCenter 内不应再手抄 field_issue_reason 渲染（实际 ${fieldIssueRenders} 处）——改用 FieldReadNotes`);
  assert.ok(!cognition.includes('text-amber-600 dark:text-amber-300'), 'CognitionCenter 不应再内联未解析注记色（迁入 FieldReadNotes）');
});

test('联邦 issues 列表单源：ProjectIssuesNotice 存在且双消费方接线', async () => {
  const component = await readFile(path.join(srcRoot, 'components', 'ProjectIssuesNotice.tsx'), 'utf8');
  assert.match(component, /export default function ProjectIssuesNotice/, 'ProjectIssuesNotice 组件应存在');
  assert.ok(component.includes("t('federation.projectIssues')"), '组件应承接 issues 标题文案');

  for (const rel of ['pages/Federation.tsx', 'pages/FederationObjects.tsx'] as const) {
    const body = await readFile(path.join(srcRoot, rel), 'utf8');
    assert.ok(body.includes('ProjectIssuesNotice'), `${rel} 应消费 ProjectIssuesNotice`);
    assert.ok(
      !body.includes('federation.projectIssues'),
      `${rel} 不应再内联 issues 标题键——文案归组件`,
    );
  }
});

/**
 * `border-l-*` 的允许域（`docs/01` §1.10 第 7 条，Human 裁决 2026-10-05）。
 *
 * 单侧加粗边框**不是通用表义手段**。全站只允许两族保留左色条：
 *   1. **领域归属决策块**（`utils/decisionBlocks.ts`）——左色条承载「这是哪个领域的
 *      决定」（琥珀＝踩坑经验、紫＝决策），是语义而非装饰；
 *   2. **项目识别色条**（`ProjectSwitcher` 项目行、`Federation` 项目卡）——左 3px
 *      色条承载「这是哪个项目」，是 `docs/11` §1 项目色彩第三正交维度的既定组成。
 *
 * 其余一律四边同宽：警示条、导航选中态、任何普通提示块都不得用 `border-l-*` 表达强调。
 *
 * 为什么需要这条守卫：裁决前实测已扩散为 **4 族 3 种粗度（2px / 3px / 4px）、6 个文件**，
 * 且与 `specs/10` §5.5「判据面板四边 1px」定案同页并存。它不是「有人写错了一处」，
 * 而是「每族都以为自己那处是例外」的累积结果——无守卫则必然复发。
 *
 * **保证边界（如实登记，勿宣称强于实际）**：
 * - 形态级防护：只识别 Tailwind 类名。以 inline style（`borderLeftWidth`）表达的
 *   左粗线**不在覆盖内**，改名或换表达手段即可逃逸；
 * - 注释已剥离（`stripComments`），故各处裁决沿革的**如实记载**不会触发误报；
 * - `border-l-0` 是显式清零（语义为「不要左边框」），豁免。
 */
test('border-l-* 只允许语义左条两族：领域归属决策块与项目识别色条', async () => {
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // 任意**非零**左单边边框类；`border-l-0` 经负向前瞻豁免。
  const LEFT_BORDER = /border-l-(?!0\b)[a-z0-9[/\]%.-]+/g;

  // 白名单按「允许出现的类名处数」而非「文件是否存在」断言：同文件内再插入一条
  // 非语义左色条（例如让导航选中态的 `border-l-4` 复活）同样会红。
  //
  // decisionBlocks 的 6 处 = 3 个壳 × 2 段（`border-l-2` 定粗度 + `border-l-{色相}` 定色）。
  // 此处刻意用「处数」而非「含 border-l-2 即可」——后者漏掉左色相段，
  // 而左色相段本身也是左侧边框的表达，须一并纳管。
  const allowed = new Map<string, number>([
    ['utils/decisionBlocks.ts', 6], // amber / violet / neutral 三个壳各两段
    ['components/ProjectSwitcher.tsx', 1], // 项目行色条（色值走 inline style，无左色相类）
    ['pages/Federation.tsx', 1], // 项目卡色条（同上）
  ]);

  const violations: string[] = [];
  for (const file of await collectSourceFiles(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    const hits = stripComments(await readFile(file, 'utf8')).match(LEFT_BORDER) ?? [];
    const cap = allowed.get(rel) ?? 0;
    if (hits.length > cap) {
      violations.push(`${rel}：${hits.length} 处（允许 ${cap}）—— ${[...new Set(hits)].join('、')}`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `非语义左色条回潮。docs/01 §1.10 第 7 条只允许「领域归属决策块」与「项目识别色条」` +
      `两族；其余一律四边同宽（强调由背景档与块首标记承担）：\n${violations.join('\n')}`,
  );
});
