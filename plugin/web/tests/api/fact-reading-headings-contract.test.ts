import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * ADR/Pitfall 详情区段标题的唯一语义来源是 `src/i18n/locales.ts` 的字段标签映射
 * （经 getFieldLabel 消费）。v4 归档由 specs/22、23 号规范的投影标题承载，v5 已把
 * 权威载体收敛到 locales.ts（见 docs/11-v5Web开发增量）：任何改标题都必须先改
 * locales.ts，详情布局经 getFieldLabel 原样消费，不维护第二份标题词表。
 */
const LOCALES_PATH = path.resolve('src/i18n/locales.ts');
const LOCALES = fs.readFileSync(LOCALES_PATH, 'utf8');
const LAYOUT_PATH = path.resolve('src/pages/object-detail/FactReadingLayouts.tsx');
const LAYOUT = fs.readFileSync(LAYOUT_PATH, 'utf8');

/** 从 layout 的 READING_NODES 数组提取全部字段名。 */
function extractNodeFields(nodeArrayName: string): string[] {
  const block = LAYOUT.match(new RegExp(`const ${nodeArrayName}[\\s\\S]*?\\]`));
  assert.ok(block, `${nodeArrayName} 数组应可定位`);
  return (block[0].match(/field: '([^']+)'/g) ?? []).map((token) => token.match(/field: '([^']+)'/)![1]);
}

/** locales.ts 必须为某字段提供中文/英文标题，且与 raw 字段名不同。 */
function assertFieldLocalized(field: string): void {
  // getFieldLabel 返回的标题必须以字段登记形式存在：`{ FIELD_NAME }: { zh: '..', en: '..' }`。
  const m = LOCALES.match(new RegExp(`\\b${field}: \\{ zh: '([^']+)', en: '([^']+)' \\}`));
  assert.ok(m, `locales.ts 应为字段 ${field} 提供中文/英文标题登记`);
  assert.ok(m[1].length > 0, `字段 ${field} 中文标题不能为空`);
  assert.ok(m[2].length > 0, `字段 ${field} 英文标题不能为空`);
}

test('ADR and Pitfall detail headings all resolve through locales.ts field labels', () => {
  const adrFields = extractNodeFields('ADR_READING_NODES');
  const pitfallFields = extractNodeFields('PITFALL_READING_NODES');

  // 覆盖两大核心段落集，防止详情标题漂移。
  assert.ok(adrFields.length >= 6, 'ADR 阅读节点应覆盖核心决策字段');
  assert.ok(pitfallFields.length >= 8, 'Pitfall 阅读节点应覆盖核心经验字段');

  for (const field of adrFields) assertFieldLocalized(field);
  for (const field of pitfallFields) assertFieldLocalized(field);
});

test('detail layouts consume field labels through the shared resolver, not hardcoded copy', () => {
  // 标题统一经 getFieldLabel / getObjectStatusLocale 解析。
  assert.match(LAYOUT, /title=\{getFieldLabel\(node\.field, locale\)\}/);
  assert.match(LAYOUT, /getObjectStatusLocale\('spark'/);
  // 不允许详情布局内按语言就地拼写标题。
  assert.doesNotMatch(LAYOUT, /locale === 'en'/);
  assert.doesNotMatch(LAYOUT, /zh: '/);
});

test('change_log reading node stays shared across fact detail layouts', () => {
  assert.match(LAYOUT, /export function ChangeLogReadingNode/);
  assert.match(LAYOUT, /getFieldLabel\('change_log', locale\)/);
});