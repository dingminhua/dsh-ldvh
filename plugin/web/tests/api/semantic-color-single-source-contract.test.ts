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
