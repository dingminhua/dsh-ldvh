import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * 横切语义色单源契约（批次 B 的机械守卫）。
 *
 * 根因登记：docs/01「色彩和状态」（行 303-311）规则齐全，但错误/警告/信息/
 * 达成四族横切语义色此前在 16 个文件各写一份且带微漂移——「有文档、无守卫」。
 * 本契约锁三件事：
 * 1. semanticColors.ts 原子存在且值精确（canonical 不得静默漂移）；
 * 2. 每个原子确实被多处使用（否则不配叫「横切」）；
 * 3. 批次 B 收敛掉的漂移变体不得回潮。
 *
 * 豁免边界（与 semanticColors.ts 头注一致）：
 * - diff 语法高亮（project-files/model.ts 等）——代码高亮豁免；
 * - 域内单源表（workcaseCheckState / objectSignals / WorkCaseClosedStatusBadge
 *   / WorkCaseGistLine / WorkCaseCriteriaList）——WorkCase 域 600 系强 chip 档；
 * - 文件内一次性映射（状态图标 map、Friction 决策面板、布尔对偶等）。
 *
 * 范围外登记（2026-10-04 逐处实测后确认，非漏网——勿机械「清干净」）：
 * - 色相不在四族内：ServesSgBadge（violet chip）、CommitPushStatusBadge
 *   （violet/rose 状态图标）。四族横切色只覆盖错误/警告/信息/达成；violet、
 *   rose 属别的语义，硬并入会造出语义错误的单源。
 * - 装饰性图标取色：GoalDetail 的 `text-amber-500`、FactAssociationsSection 的
 *   `text-amber-400`（lucide icon 色，非面/非文字语义色）。
 * - 弱注记档：FieldReadNotes 的 `UNPARSED_NOTE_TEXT_CLASS`（600 档，刻意弱于
 *   WARN_TITLE 的 700 档；该文件注释已声明「是否并入待 Human 裁决」）。
 * - 域内自定档：WorkCaseCapabilityStatusBadge 的 `border-amber-400/35
 *   bg-amber-500/[0.07] text-amber-800 dark:text-amber-100`。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '../..');
const srcRoot = path.join(webRoot, 'src');
const semanticColorsPath = path.join(srcRoot, 'utils', 'semanticColors.ts');

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSourceFiles(p)));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const EXPECTED_ATOMS: Record<string, string> = {
  LDVH_ERROR_TEXT_CLASS: 'text-red-400',
  LDVH_ERROR_SURFACE_CLASS: 'border-red-500/30 bg-red-500/10',
  LDVH_ERROR_TITLE_CLASS: 'text-red-700 dark:text-red-300',
  LDVH_ERROR_BODY_CLASS: 'text-red-700/80 dark:text-red-300/80',
  LDVH_WARN_SURFACE_CLASS: 'border-amber-500/25 bg-amber-500/5',
  LDVH_WARN_SURFACE_STRONG_CLASS: 'border-amber-500/30 bg-amber-500/10',
  LDVH_WARN_TITLE_CLASS: 'text-amber-700 dark:text-amber-300',
  LDVH_INFO_CHIP_HUE_CLASS: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  LDVH_SUCCESS_CHIP_HUE_CLASS: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

test('semanticColors 导出全部横切语义色原子，且值为 canonical 定案', async () => {
  const source = await readFile(semanticColorsPath, 'utf8');
  for (const [name, value] of Object.entries(EXPECTED_ATOMS)) {
    assert.match(
      source,
      new RegExp(`export const ${name} = [^;]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${name} 应存在且含 canonical 值「${value}」`,
    );
  }
  // WARN_CHIP 由 STRONG 面组合而来（同一色相对只写一次）。
  assert.match(source, /LDVH_WARN_CHIP_HUE_CLASS = `\$\{LDVH_WARN_SURFACE_STRONG_CLASS\}[^`]*`/);
});

test('每个横切原子被足量文件使用（单源必须真的被共用）', async () => {
  const files = await collectSourceFiles(srcRoot);
  const consumers = files.filter((f) => !f.includes('semanticColors'));
  const bodies = await Promise.all(consumers.map((f) => readFile(f, 'utf8')));
  // SUCCESS_CHIP 目前仅一处消费（详情徽标）；其余原子都应跨 ≥2 文件。
  const thresholds: Record<string, number> = { LDVH_SUCCESS_CHIP_HUE_CLASS: 1 };
  for (const name of Object.keys(EXPECTED_ATOMS)) {
    const count = bodies.filter((b) => b.includes(name)).length;
    const min = thresholds[name] ?? 2;
    assert.ok(
      count >= min,
      `${name} 应被 ≥${min} 个源文件引用，实际 ${count}——若跌回 1 处，它就不再是横切原子，请复核归属`,
    );
  }
});

test('批次 B 收敛掉的漂移变体不得回潮（src 内禁止再写）', async () => {
  const files = await collectSourceFiles(srcRoot);
  const driftVariants = [
    // error 面边框曾漂移为 /20（canonical /30）
    'border-red-500/20',
    // error 面底色曾漂移为 [0.07]（canonical /10）
    'bg-red-500/[0.07]',
    // 警示列表文字曾带 /90 降档后缀（canonical 无后缀）
    'text-amber-700 dark:text-amber-300/90',
    // 布尔达成曾用 green 家族（canonical emerald）
    'bg-green-500/10 text-green-400',
    // 达成 / 未达成 chip 曾漏写 dark: 档并降一级文字色
    // （canonical 为 LDVH_SUCCESS_CHIP_HUE_CLASS 的 text-emerald-600 dark:text-emerald-400）
    'bg-emerald-500/10 text-emerald-400',
    // 布尔未达成曾与之同构地漏写 dark: 档（canonical text-red-600 dark:text-red-400）
    'bg-red-500/10 text-red-400',
  ];
  for (const f of files) {
    if (f.includes('semanticColors')) continue; // 头注里的漂移史记载不算回潮
    const body = await readFile(f, 'utf8');
    for (const variant of driftVariants) {
      assert.ok(
        !body.includes(variant),
        `${path.relative(webRoot, f)} 重新内联了漂移变体「${variant}」——请改用 utils/semanticColors.ts 的对应原子`,
      );
    }
  }
});

/**
 * 域内单源表**自身的消费方守卫**。
 *
 * 本契约头注把若干「域内单源表」（workcaseCheckState / objectSignals /
 * WorkCaseClosedStatusBadge / …）列为豁免——它们不归横切原子管，这没问题。
 * 但**豁免不等于无人守卫**：表被豁免了，表的值却仍会被消费方手抄。
 * 实测缺口（2026-10-03）：`WORKCASE_CHECK_TAG_CLASS` 的 satisfied / partial /
 * unsatisfied 三个值在 `WorkCaseExecFlow.tsx` 与 `WorkCaseReadingLayout.tsx`
 * 共被手抄 4 处（其中一处是 4 分支 mark switch），**既不在豁免明示清单的
 * 「值级」禁令内、也不被任何守卫读取**——表在、没人用，正是「假单源」。
 *
 * 故此处对每个域内单源表做同一件事：取其 canonical 值，断言除载体自身外
 * **src 内无第二处逐字复现**。这是把「表被豁免」与「表的消费方无人管」
 * 区分开的最小守卫。
 */
const DOMAIN_SINGLE_SOURCE_TABLES: Array<[string, string[]]> = [
  [
    'utils/workcaseCheckState.ts',
    [
      'border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      'border-amber-600/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
      'border-red-600/45 bg-red-500/10 text-red-700 dark:text-red-300',
    ],
  ],
];

test('域内单源表的值不得被消费方手抄（表在、且真的只有一个源）', async () => {
  const files = await collectSourceFiles(srcRoot);
  for (const [tableRel, values] of DOMAIN_SINGLE_SOURCE_TABLES) {
    const carrier = path.join(srcRoot, tableRel);
    assert.ok(files.includes(carrier), `域内单源表 ${tableRel} 应存在`);
    const carrierBody = await readFile(carrier, 'utf8');
    for (const value of values) {
      assert.ok(
        carrierBody.includes(value),
        `${tableRel} 应含 canonical 值「${value}」——若该值已改档，请同步本清单`,
      );
    }
    for (const f of files) {
      if (f === carrier) continue;
      const body = await readFile(f, 'utf8');
      for (const value of values) {
        assert.ok(
          !body.includes(value),
          `${path.relative(webRoot, f)} 手抄了域内单源表 ${tableRel} 的值「${value}」——请 import 该表的原子（如 WORKCASE_CHECK_TAG_CLASS.partial），不要复制字面量`,
        );
      }
    }
  }
});
