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
 * - 左色条「状态通知」远亲（CognitionCenter 红 / ObjectDetail zinc）刻意不并入；
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

const DECISION_ATOMS: Array<[string, string]> = [
  ['DECISION_CARD_SHELL_CLASS.amber', 'border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3'],
  ['DECISION_CARD_SHELL_CLASS.violet', 'border-violet-400/20 border-l-2 border-l-violet-400/70 bg-violet-500/[0.025] px-3.5 py-3'],
  ['DECISION_DETAIL_NEUTRAL_SHELL_CLASS', 'border-ldvh-border/80 border-l-2 border-l-violet-400/70 bg-ldvh-bg/65 px-3.5 py-3'],
  ['DECISION_TITLE_HUE_CLASS.amber', 'text-amber-700/85 dark:text-amber-200/85'],
  ['DECISION_TITLE_HUE_CLASS.violet', 'text-violet-700/85 dark:text-violet-200/85'],
  ['DECISION_AMBER_BODY_HUE_CLASS', 'text-amber-950/70 dark:text-amber-100/75'],
  ['DECISION_VIOLET_CODE_CHIP_HUE_CLASS', 'border-violet-400/35 bg-violet-500/10 font-mono text-violet-700 dark:text-violet-300'],
];

  test('decisionBlocks 导出全部左色条决策块原子，且值为 canonical 定案', async () => {
  const source = await readFile(path.join(srcRoot, 'utils', 'decisionBlocks.ts'), 'utf8');
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
  const banned = [
    'border-l-amber-400/70',
    'border-l-violet-400/70',
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
