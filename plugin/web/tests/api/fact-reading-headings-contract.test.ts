import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const LOCALES_PATH = path.resolve('src/i18n/locales.ts');
const LOCALES = fs.readFileSync(LOCALES_PATH, 'utf8');
const LAYOUT_PATH = path.resolve('src/pages/object-detail/FactReadingLayouts.tsx');
const LAYOUT = fs.readFileSync(LAYOUT_PATH, 'utf8');

function assertFieldLocalized(field: string): void {
  const m = LOCALES.match(new RegExp(`\\b${field}: \\{ zh: '([^']+)', en: '([^']+)' \\}`));
  assert.ok(m, `locales.ts 应为字段 ${field} 提供中文/英文标题登记`);
  assert.ok(m[1].length > 0, `字段 ${field} 中文标题不能为空`);
  assert.ok(m[2].length > 0, `字段 ${field} 英文标题不能为空`);
}

test('Pitfall detail headings all resolve through locales.ts field labels', () => {
  const pitfallSectionOrder = LAYOUT.match(/const PITFALL_BODY_SECTION_ORDER = \[([^\]]+)\]/);
  assert.ok(pitfallSectionOrder, 'Pitfall 正文固定节序应可定位');
  const pitfallTitles = (pitfallSectionOrder[1].match(/'([^']+)'/g) ?? []).map((token) => token.slice(1, -1));
  assert.deepEqual(pitfallTitles, ['症状', '触发条件', '根因', '解决', '规避', '验证', '影响与适用范围', '证据']);

  const pitfallLabelFields = ['pitfall_symptoms', 'pitfall_triggers', 'root_cause', 'pitfall_resolution', 'avoidance', 'validation_summary', 'pitfall_scope_section', 'evidence', 'trigger_signal'];
  for (const field of pitfallLabelFields) {
    assert.ok(
      LAYOUT.includes(`getFieldLabel('${field}', locale)`),
      `Pitfall 布局必须经 getFieldLabel 消费 ${field}`,
    );
    assertFieldLocalized(field);
  }
});

test('detail layouts consume field labels through the shared resolver, not hardcoded copy', () => {
  assert.match(LAYOUT, /title=\{getFieldLabel\('[^']+', locale\)\}/);
  assert.match(LAYOUT, /getObjectStatusLocale\('spark'/);
  assert.doesNotMatch(LAYOUT, /locale === 'en'/);
  assert.doesNotMatch(LAYOUT, /zh: '/);
});

test('change_log reading node stays shared across fact detail layouts', () => {
  assert.match(LAYOUT, /export function ChangeLogReadingNode/);
  assert.match(LAYOUT, /getFieldLabel\('change_log', locale\)/);
});