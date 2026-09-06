import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('retired ADR cards use the terminal disposition presentation', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function AdrTerminalCardContent/);
  assert.match(source, /obj\.status === 'retired'/);
  assert.match(source, /obj\.disposition_summary\?\.trim\(\) \|\| t\('objectList\.dispositionMissing'\)/);
  assert.match(source, /currentType === 'adr'[\s\S]*showNonActiveReason=\{false\}[\s\S]*AdrCardContent/);
});
