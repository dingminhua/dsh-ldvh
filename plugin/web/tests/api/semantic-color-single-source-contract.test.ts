import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';


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
  assert.match(source, /LDVH_WARN_CHIP_HUE_CLASS = `\$\{LDVH_WARN_SURFACE_STRONG_CLASS\}[^`]*`/);
});

test('每个横切原子被足量文件使用（单源必须真的被共用）', async () => {
  const files = await collectSourceFiles(srcRoot);
  const consumers = files.filter((f) => !f.includes('semanticColors'));
  const bodies = await Promise.all(consumers.map((f) => readFile(f, 'utf8')));
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
    'border-red-500/20',
    'bg-red-500/[0.07]',
    'text-amber-700 dark:text-amber-300/90',
    'bg-green-500/10 text-green-400',
    'bg-emerald-500/10 text-emerald-400',
    'bg-red-500/10 text-red-400',
  ];
  for (const f of files) {
    if (f.includes('semanticColors')) continue;
    const body = await readFile(f, 'utf8');
    for (const variant of driftVariants) {
      assert.ok(
        !body.includes(variant),
        `${path.relative(webRoot, f)} 重新内联了漂移变体「${variant}」——请改用 utils/semanticColors.ts 的对应原子`,
      );
    }
  }
});

const DOMAIN_SINGLE_SOURCE_TABLES: Array<[string, string[]]> = [
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
          `${path.relative(webRoot, f)} 手抄了域内单源表 ${tableRel} 的值「${value}」——请 import 该表的原子（如该表导出的分量），不要复制字面量`,
        );
      }
    }
  }
});
