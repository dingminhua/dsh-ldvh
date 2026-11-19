
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const REGISTRY = 'web/docs/13-呈现收窄登记表.md';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

const COLUMNS = [
  '收窄',
  '规范锚句（逐字，无 Markdown 强调）',
  '规范来源',
  '实现判据入口',
  '守卫测试',
  '须反向断言的例外',
  '例外所在实现',
] as const;

interface NarrowingRow {
  readonly text: string;
  readonly cells: readonly string[];
}

function parseRows(source: string): NarrowingRow[] {
  const section3 = source.split(/^## 3\. /m)[1]?.split(/^## /m)[0] ?? '';
  const scoped = section3.length > 0 ? section3 : source;
  const rows: NarrowingRow[] = [];
  for (const line of scoped.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] === COLUMNS[0]) continue;
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push({ text: trimmed, cells });
  }
  return rows;
}

function splitSite(cell: string): { file: string; identifier: string } {
  const parts = cell.split('→').map((part) => part.trim());
  assert.equal(parts.length, 2, `站点单元格须为「路径 → 标识符」形态：${cell}`);
  const [file, identifier] = parts as [string, string];
  assert.ok(file.length > 0 && identifier.length > 0, `站点的路径与标识符都不得为空：${cell}`);
  return { file, identifier };
}

function pathOnly(cell: string): string {
  assert.ok(!cell.includes('→'), `该列只写路径，不写标识符：${cell}`);
  assert.ok(cell.length > 0, '路径不得为空');
  return cell;
}

function hasIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w\u4e00-\\u9fff])${escaped}(?![\\w\u4e00-\\u9fff])`, 'u').test(source);
}

function stripEmphasis(text: string): string {
  return text.replace(/\*\*|__/g, '');
}

const registry = readSource(REGISTRY);
const rows = parseRows(registry);

test('登记表结构：§3 表的列齐备且列序未漂移', () => {
  assert.ok(rows.length > 0, '登记表 §3 须至少有一条收窄');
  for (const row of rows) {
    assert.equal(
      row.cells.length,
      COLUMNS.length,
      `列数须与固定列一致（${COLUMNS.length}）——少一列即三腿中的一条被静默删除：${row.text}`,
    );
  }
});

test('第一腿：每条收窄的规范锚句在所述规范原文中逐字存在', () => {
  for (const row of rows) {
    const [, anchor, sourceFile] = row.cells as [string, string, string];
    const source = readSource(sourceFile);
    assert.ok(
      stripEmphasis(source).includes(stripEmphasis(anchor)),
      `锚句在 ${sourceFile} 中找不到——契约改写了这句话，登记与实现已静默脱钩：「${anchor}」`,
    );
  }
});

test('第二腿：每条收窄的实现判据入口存在', () => {
  for (const row of rows) {
    const site = splitSite((row.cells as string[])[3]!);
    const implementation = readSource(site.file);
    assert.ok(
      hasIdentifier(implementation, site.identifier),
      `实现判据入口 ${site.file} 中找不到 ${site.identifier}——判据被删或被改名`,
    );
  }
});

test('第三腿：每条收窄的守卫测试存在', () => {
  for (const row of rows) {
    const site = splitSite((row.cells as string[])[4]!);
    const guard = readSource(site.file);
    assert.ok(
      hasIdentifier(guard, site.identifier),
      `守卫测试 ${site.file} 中找不到「${site.identifier}」——该收窄的守卫被删或被改名`,
    );
  }
});

test('第四腿：声明了例外的收窄，其例外在实现与守卫两侧都留有字面', () => {
  for (const row of rows) {
    const cells = row.cells as string[];
    const exception = cells[5]!;
    if (exception === '无') continue;
    const exceptionSite = pathOnly(cells[6]!);
    const implementation = readSource(exceptionSite);
    const guard = readSource(splitSite(cells[4]!).file);
    assert.ok(
      implementation.includes(exception),
      `例外施加点 ${exceptionSite} 未留下该例外的字面（「${exception}」）——下一轮「顺手统一」会再次过度收窄`,
    );
    assert.ok(
      guard.includes(exception),
      `守卫侧未反向断言该例外（「${exception}」）——例外只写在契约里时无人守`,
    );
  }
});
