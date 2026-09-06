import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { helperExecutable } from '../../api/services/governanceScope.ts';

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

test('a configured Helper must resolve to a regular executable before Web invokes it', async () => {
  if (process.platform === 'win32') return;
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-helper-executable-'));
  const candidate = path.join(root, 'not-executable');
  const previous = process.env.LDVH_HELPER_EXECUTABLE;
  await writeFile(candidate, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(candidate, 0o600);
  process.env.LDVH_HELPER_EXECUTABLE = candidate;
  try {
    assert.throws(() => helperExecutable(), /Configured Helper executable is unavailable/);
  } finally {
    if (previous === undefined) delete process.env.LDVH_HELPER_EXECUTABLE;
    else process.env.LDVH_HELPER_EXECUTABLE = previous;
    await rm(root, { recursive: true, force: true });
  }
});
