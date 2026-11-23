import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const REPORT_FORMS = ['research', 'summary', 'audit', 'action', 'reference'] as const;

test('report form filter accepts all five forms from 24 §5', () => {
  const route = read('api/routes/objects.ts');

  assert.match(
    route,
    /const REPORT_FORMS = \['research', 'summary', 'audit', 'action', 'reference'\] as const/,
  );
});

test('backend form order matches the frontend palette order', () => {
  const palette = read('src/utils/reportFormPalette.ts');
  const expected = `export const FORM_ORDER: ReportForm[] = [${REPORT_FORMS.map((f) => `'${f}'`).join(', ')}];`;

  assert.ok(palette.includes(expected), 'FORM_ORDER in reportFormPalette.ts must match REPORT_FORMS');
});

test('选中状态后形态计数按状态池计算，形态行的“全部”用独立 formTotal', () => {
  const route = read('api/routes/objects.ts');
  const list = read('src/pages/ObjectList.tsx');
  const api = read('src/utils/api.ts');

  // formOptions 用 allItems（已按 status 过滤），不是全库的 statusItems
  assert.match(route, /result\.data\.formOptions = type === 'report' \? getFormOptions\(allItems\) : \[\]/);
  assert.match(route, /result\.data\.statusOptions = getStatusOptions\(statusItems\)/,
    '状态行仍按全库计数保持不变');
  assert.match(route, /result\.data\.formTotal = allItems\.length/);
  // 前端把 formTotal 传给形态行的 total，而不是 statusTotal
  assert.match(api, /formTotal\?: number;/);
  assert.match(list, /setFormTotal\(result\.data\?\.formTotal \?\? nextItems\.length\)/);
  const formTag = list.match(/<ReportFormFilter\b[^>]*\/>/)?.[0] ?? '';
  assert.match(formTag, /total=\{formTotal\}/, '形态行的“全部”须用 formTotal');
  assert.doesNotMatch(formTag, /statusTotal/, '形态行不得复用状态行的 statusTotal');
  // 报告页状态行仍用 statusTotal（spark 另走 statusDisplayTotal，见 spark-priority-sort-contract）
  const statusTag = list.match(/<ObjectStatusFilter\b[^>]*\/>/)?.[0] ?? '';
  assert.match(statusTag, /total=\{currentType === 'spark' \? statusDisplayTotal : statusTotal\}/);
});
