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
