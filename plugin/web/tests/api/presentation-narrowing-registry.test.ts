// 呈现收窄登记表的三腿校验（`web/docs/13-呈现收窄登记表.md` §3 表）。
//
// **本组是源码/文档文本断言，不是行为断言**（`web/docs/12` §3）：
//   只证明「登记表列出的三腿当前都在」，**不证明**「该期真的没有呈现该内容」。
//   不得据本组全绿声称某收窄已获机械保障，也不得声称「呈现收窄不会漏」——
//   「新收窄是否已被登记」是语义判断（`docs/13` §2 第 1 项），由 `docs/12` §7 的
//   复核清单承担，属软约束。本组买到的是：**已知的那几条收窄不会被静默拆掉**。
//
// 变异三连结果（`docs/12` §2）见 `docs/13` 与本文件的注释末段——三连第 3 项
// （语义等价改名逃逸）**成立**，已如实登记为本组的保证边界。
//
// 立表缘由：2026-10-15「待批准关闭卡呈现与契约不一致」一案——契约 `web/docs/10`
// §5 早在 2026-09-29 就写明该期只给去向标记，而实现照旧渲染去向正文，且无任何测试
// 钉住；同日主控修复时又因只读 `specs/21 §8`、未读该契约而**过度收窄**（误伤契约
// 登记的存量特例）。三腿脱钩与例外无反向断言，正是本表要接住的两条失效路径。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/** 源码根（`tests/api` → `web/tests/api` → `web/tests` → `web` → `plugin`）。 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const REGISTRY = 'web/docs/13-呈现收窄登记表.md';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

/** 登记表的列序（与 `docs/13` §3 的固定列一一对应；改列序即须同步改此处与校验）。 */
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

/**
 * 解析 **§3 那一节**的表体（跳过表头与分隔行）；返回的每条都已是「原始单元格」文本。
 *
 * **必须限定在 §3 之内**：本文档其余小节也有表格（如 §6 的变异三连记录），
 * 全文扫描会把它们当作登记行解析（实测踩到：新增 §6 后结构断言按 3 列判失败）。
 */
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
    if (cells[0] === COLUMNS[0]) continue; // 表头
    if (cells.every((cell) => /^-+$/.test(cell))) continue; // 分隔行
    rows.push({ text: trimmed, cells });
  }
  return rows;
}

/** `path → 标识符` 形态的单元格拆成两截；无 `→` 即形态错。 */
function splitSite(cell: string): { file: string; identifier: string } {
  const parts = cell.split('→').map((part) => part.trim());
  assert.equal(parts.length, 2, `站点单元格须为「路径 → 标识符」形态：${cell}`);
  const [file, identifier] = parts as [string, string];
  assert.ok(file.length > 0 && identifier.length > 0, `站点的路径与标识符都不得为空：${cell}`);
  return { file, identifier };
}

/** 纯路径单元格（无标识符）：须为仓库内相对路径，不得带「→」。 */
function pathOnly(cell: string): string {
  assert.ok(!cell.includes('→'), `该列只写路径，不写标识符：${cell}`);
  assert.ok(cell.length > 0, '路径不得为空');
  return cell;
}

/**
 * 标识符匹配须带**词边界**——裸子串会让「改名」逃逸：把 `workCaseDirectionTextVisible`
 * 改成 `workCaseDirectionTextVisibleRENAMED` 后，`includes` 仍成立（实测踩到，2026-10-15
 * 变异三连第 1 项）。判据入口与守卫测试名走的都是这条。
 */
function hasIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w\u4e00-\\u9fff])${escaped}(?![\\w\u4e00-\\u9fff])`, 'u').test(source);
}

/** 剥掉 Markdown 强调标记（`**`、`__`）后比对文本。 */
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
    // **两侧都剥掉 Markdown 强调**后比对：照抄契约原文（含 `**`）是最自然的写法，
    // 若因含标记而被拒，惩罚的就是**诚实输入**（`docs/12` §4 的反向激励）；而把强调
    // 标记从比对中排除，又顺带使「契约只调整了加粗」不再让登记无谓脱钩。
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
    // 例外的**施加点**未必等于判据入口（本次即如此：判据在共享模块，施加点在卡组件）
    // ——故第 7 列单独记，第 4 列的判据入口不承担例子检查。
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
