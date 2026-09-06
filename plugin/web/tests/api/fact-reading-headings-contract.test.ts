import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * ADR/Pitfall 详情区段标题的唯一语义来源是 22 §5.3 与 23 §5.3 定义的两个汉字投影标题。
 * 本测试从两份规范原文解析投影标题，并断言 locales.ts 的中文标题逐项一致，
 * Web 侧不再维护第二份标题词表。任何改标题都必须先改规范，再同步 locales。
 */
function parseProjectionHeadings(spec: string, window: number): Record<string, string> {
  const start = spec.indexOf('当 Web 或其它 Human 阅读面');
  assert.ok(start >= 0, '规范投影段落应可定位');
  const section = spec.slice(start, start + window);
  const headings: Record<string, string> = {};
  /* 匹配 `标题`（`字段名`）模式 */
  const pairRe = /`([^`]+)`（`([^`]+)`）/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(section)) !== null) {
    headings[m[2]] = m[1];
  }
  /* 匹配 `字段名` 另以 `标题` 呈现（终态处置） */
  const tailRe = /`([^`]+)` 另以 `([^`]+)` 呈现/g;
  while ((m = tailRe.exec(section)) !== null) {
    headings[m[1]] = m[2];
  }
  return headings;
}

test('ADR/Pitfall detail headings follow 22 §5.3 / 23 §5.3 and locales.ts carries exactly those titles', () => {
  // v4 迁移适配：specs 根可用 LDVH_SPEC_ROOT 覆盖（默认保持 v4 布局的相对推算）。
  const specRoot = process.env.LDVH_SPEC_ROOT || '..';
  const adrSpec = fs.readFileSync(path.resolve(specRoot, 'specs/22-ADR-决策.md'), 'utf8');
  const pitfallSpec = fs.readFileSync(path.resolve(specRoot, 'specs/23-Pitfall-踩坑经验.md'), 'utf8');

  const adr = parseProjectionHeadings(adrSpec, 900);
  const pitfall = parseProjectionHeadings(pitfallSpec, 900);
  assert.ok(Object.keys(adr).length >= 5, '22 投影标题应至少覆盖 5 个字段');
  assert.ok(Object.keys(pitfall).length >= 8, '23 投影标题应至少覆盖 8 个字段');
  const expected = { ...adr, ...pitfall };

  const locales = fs.readFileSync(path.resolve('src/i18n/locales.ts'), 'utf8');
  const layout = fs.readFileSync(path.resolve('src/pages/object-detail/FactReadingLayouts.tsx'), 'utf8');

  for (const [field, zh] of Object.entries(expected)) {
    assert.match(
      locales,
      new RegExp(`${field}: \\{ zh: '${zh}'`),
      `locales.ts 应为字段 ${field} 提供规范标题「${zh}」`,
    );
  }

  assert.match(layout, /title={getFieldLabel\(node\.field, locale\)}/);
  assert.match(layout, /getObjectStatusLocale\('spark'/);
  assert.doesNotMatch(layout, /locale === 'en'/);
});