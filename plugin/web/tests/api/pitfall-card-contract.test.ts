import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('discarded Pitfall cards use the terminal disposition presentation', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const statusBadge = fs.readFileSync(path.resolve('src/components/StatusBadge.tsx'), 'utf8');

  assert.match(source, /function PitfallTerminalCardContent/);
  assert.match(source, /obj\.status === 'discarded'/);
  assert.match(source, /function isDeprecatedListCard[\s\S]*obj\.status === 'retired' \|\| obj\.status === 'discarded' \|\| obj\.status === 'deprecated'/);
  assert.match(source, /\.filter\(\(item\) => !isDeprecatedListCard\(item\) \|\| searchParams\.get\('status'\) === ALL_STATUS_PARAM \|\| activeStatus === item\.status\)/);
  assert.match(source, /obj\.disposition_summary\?\.trim\(\) \|\| t\('objectList\.dispositionMissing'\)/);
  assert.match(source, /<TerminalFactPanel tone="retired" content=\{formatReasonText\(disposition\)\}/);
  assert.match(source, /tone: 'implemented' \| 'retired';/);
  assert.doesNotMatch(source, /tone: 'implemented' \| 'discarded'/);
  assert.match(statusBadge, /objectType === 'pitfall' && status === 'discarded'/);
  assert.match(source, /currentType === 'pitfall'[\s\S]*showNonActiveReason=\{false\}[\s\S]*PitfallCardContent/);
});

test('active Pitfall cards retain only the shared identity and title frame', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function PitfallCardContent[\s\S]*?obj\.status === 'active'\) return null/);
});
