import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function source(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('Web direct projections do not manufacture object status, title, association title, or Spark terminal state', () => {
  const objects = source('api/routes/objects.ts');
  const associations = source('src/pages/object-detail/FactAssociationsSection.tsx');
  const layouts = source('src/pages/object-detail/FactReadingLayouts.tsx');
  const reader = source('api/services/localFactReader.ts');

  assert.doesNotMatch(objects, /toStringValue\(value\.status, 'unknown'\)/);
  assert.doesNotMatch(objects, /toStringValue\(value\.title, id\)/);
  assert.match(associations, /if \(!detail \|\| !isReadableFact\(readMeta\)\) return '—';/);
  assert.match(associations, /getLocalizedObjectTitle\(source, locale\)/);
  assert.doesNotMatch(layouts, /obj\.status \?\? 'open'/);
  assert.doesNotMatch(reader.match(/pitfall:\s*\{[\s\S]*?\n {2}\},/)?.[0] ?? '', /tags:/);
});
