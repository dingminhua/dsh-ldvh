import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// These checks guard the wiring between the grouping function and the card.
// The grouping behavior is tested separately; this is not a browser layout test.
const source = (path: string) => readFileSync(resolve(import.meta.dirname, '../../', path), 'utf8');

test('只有已关闭的工单卡停止重复挂载通用关联区', () => {
  const list = source('src/pages/ObjectList.tsx');
  assert.match(list, /showAssociations=\{obj\.group !== 'closed'\}/);
  assert.match(list, /showAssociations\s*=\s*true/);
  assert.match(list, /\{showAssociations && <FactAssociationsCardContent\b/);
});

test('已关闭卡分别呈现就地候选和未就地关联，标注方向并披露不确定配对', () => {
  const closed = source('src/components/WorkCaseClosedSummary.tsx');
  assert.match(closed, /associationGroups\.inline\[index\]/);
  assert.match(closed, /associationGroups\.other\.map\(/);
  assert.match(closed, /contextLabels=\{associationLabels\(target\)\}/);
  assert.match(closed, /contextLabels=\{associationLabels\(associationGroup\)\}/);
  assert.match(closed, /disableOpen=\{target\.identityConflict\}/);
  assert.match(closed, /disableOpen=\{associationGroup\.identityConflict\}/);
  assert.match(closed, /associationGroups\.pairingMismatch/);
  assert.match(closed, /className="mt-0\.5 grid min-w-0 gap-0\.5"\s+onClick=\{\(event\) => event\.stopPropagation\(\)\}\s+onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/, '去向关联不能同时触发父工单卡');
  assert.match(closed, /data-workcase-associations\s+className=\{FACT_ASSOCIATION_ROWS_ZONE_CLASS\}\s+onClick=\{\(event\) => event\.stopPropagation\(\)\}\s+onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/, '合并关联不能同时触发父工单卡');
  assert.match(closed, /workCaseAssociationLabels\(group, t\)/);
  const row = source('src/components/FactAssociationRows.tsx');
  assert.match(row, /const canOpen = !disableOpen && Boolean\(/);
  assert.match(row, /const associationState = disableOpen \? null : getFactAssociationState\(association\)/);
});
