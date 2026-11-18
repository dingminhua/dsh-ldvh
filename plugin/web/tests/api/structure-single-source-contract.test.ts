import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';


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

const DECISION_SHELL_SEGMENTS: Array<[string, string[]]> = [
  ['DECISION_CARD_SHELL_CLASS.amber', ['border-amber-400/20', 'bg-amber-500/[0.025]', 'px-3.5 py-3']],
];

const BARE_BORDER = /(?:^|[\s:'"])border(?:[\s'"]|$)/;

const DECISION_ATOMS: Array<[string, string]> = [
  ['DECISION_TITLE_HUE_CLASS.amber', 'text-amber-700/85 dark:text-amber-200/85'],
  ['DECISION_AMBER_BODY_HUE_CLASS', 'text-amber-950/70 dark:text-amber-100/75'],
];

test('decisionBlocks 导出决策块壳与色相原子，且值为 canonical 定案', async () => {
  const source = await readFile(path.join(srcRoot, 'utils', 'decisionBlocks.ts'), 'utf8');
  const lines = source.split('\n');

  for (const [name, segments] of DECISION_SHELL_SEGMENTS) {
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
  assert.ok(objectList.includes('DECISION_CARD_SHELL_CLASS.amber'), 'ObjectList 应引用 DECISION_CARD_SHELL_CLASS.amber（Pitfall/Friction 卡面）');
  assert.ok(objectList.includes('DECISION_AMBER_BODY_HUE_CLASS'), 'ObjectList 应引用 DECISION_AMBER_BODY_HUE_CLASS');
  assert.doesNotMatch(
    factLayouts,
    /from '@\/utils\/decisionBlocks'/,
    'FactReadingLayouts 已无 decisionBlocks 消费方，不得保留导入',
  );
});

test('批次 C 收敛掉的决策块整串字面量不得回潮（src 内禁写，decisionBlocks.ts 自身豁免）', async () => {
  const files = await collectSourceFiles(srcRoot);
  const banned = [
    'bg-amber-500/[0.025]',
    'bg-violet-500/[0.025]',
    'text-amber-950/70',
    'border-violet-400/35',
    'text-amber-700/85 dark:text-amber-200/85',
    'text-violet-700/85 dark:text-violet-200/85',
  ];
  for (const f of files) {
    if (f.includes('decisionBlocks')) continue;
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

test('border-l-* 只允许语义左条两族：领域归属决策块与项目识别色条', async () => {
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const LEFT_BORDER = /border-l-(?!0\b)[a-z0-9[/\]%.-]+/g;

  const allowed = new Map<string, number>([
    ['utils/decisionBlocks.ts', 2],
    ['components/ProjectSwitcher.tsx', 1],
    ['pages/Federation.tsx', 1],
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
