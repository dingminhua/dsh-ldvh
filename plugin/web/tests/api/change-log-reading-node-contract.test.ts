import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

test('every specialised fact layout gives the consumed change_log field a Human reading node', () => {
  const layouts = readFileSync(
    path.join(repositoryRoot, 'web/src/pages/object-detail/FactReadingLayouts.tsx'),
    'utf8',
  );
  const workcase = readFileSync(
    path.join(repositoryRoot, 'web/src/pages/object-detail/WorkCaseReadingLayout.tsx'),
    'utf8',
  );

  assert.match(layouts, /export function ChangeLogReadingNode/);
  assert.match(layouts, /function parseChangeLogEntries/);
  assert.match(layouts, /title=\{getFieldLabel\('change_log', locale\)\}/);
  assert.match(layouts, /ldvh-meta flex min-w-0 flex-wrap items-center gap-x-1\.5 gap-y-0\.5 font-medium text-ldvh-text-primary\/80/);
  assert.match(layouts, /h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary\/55/);
  assert.match(layouts, /mt-1 ldvh-meta text-ldvh-text-secondary\/80/);
  for (const layoutName of ['AdrReadingLayout', 'PitfallReadingLayout', 'SparkReadingLayout']) {
    const start = layouts.indexOf(`export function ${layoutName}`);
    assert.ok(start >= 0, `missing ${layoutName}`);
    const next = layouts.indexOf('\nexport function ', start + 1);
    assert.match(layouts.slice(start, next === -1 ? undefined : next), /<ChangeLogReadingNode/);
  }
  assert.match(workcase, /<ChangeLogReadingNode[\s\S]*?value=\{obj\.change_log\}/);
});
