import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Spark association UI reads only relations', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactAssociationsSection.tsx'), 'utf8');
  assert.match(source, /projectFactReadingAssociations/);
  assert.doesNotMatch(source, /projectMaterials|evidenceMaterials|externalInputs/);
  assert.doesNotMatch(source, /getTypeLabel\(factTypeKey, locale\)/);
  assert.match(source, /semanticRelationLabels=\{factTypeKey === 'study'\}/);
  assert.match(source, /getFieldLabel\(`relation_\$\{key\.replace/);
});

test('every fact list card shows exact-read formal associations in a minimal secondary-reading row', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function FactAssociationsCardContent/);
  assert.match(source, /associations=\{obj\.factAssociations\}/);
  assert.match(source, /dedupeFactCardAssociations\(associations\)/);
  assert.match(source, /visibleAssociations\.map/);
  assert.match(source, /whitespace-normal break-words/);
  assert.match(source, /openPanel\(\{ type: 'object', title, objectType: legacyTarget\.factTypeKey, objectId: legacyTarget\.objectId \}\)/);
  assert.doesNotMatch(source, /StatusBadge status=\{association\.status\}/);
  assert.match(source, /function isDiscardedWorkCaseAssociation/);
  assert.match(source, /function getFactAssociationState/);
  assert.match(source, /targetType === 'spark'/);
  assert.match(source, /association\.status === 'open'\) return 'pending'/);
  assert.match(source, /association\.progressGroup === 'plan_confirmation' \|\| association\.progressGroup === 'closure_confirmation'/);
  assert.match(source, /<FactAssociationStateIcon state=\{associationState\} tooltip=\{associationStateTooltip\} \/>/);
  assert.match(source, /association\.closureOutcome === 'cancelled'/);
  assert.doesNotMatch(source, /isHiddenTerminalAssociation/);
  assert.match(source, /FACT_ASSOCIATION_STATE_RANK/);
  assert.match(source, /active: 0,[\s\S]*progressing: 1,[\s\S]*pending: 2,[\s\S]*closed: 3,[\s\S]*discarded: 4/);
  assert.match(source, /getFactAssociationStateRank\(left\.association\) - getFactAssociationStateRank\(right\.association\)/);
  assert.match(source, /association\.status === 'implemented'\) return 'closed'/);
  assert.match(source, /association\.status === 'discarded'\) return 'discarded'/);
  assert.match(source, /association\.status === 'retired'\) return 'discarded'/);
  assert.match(source, /discarded: \{ Icon: CircleMinus, className: 'text-slate-400\/70 dark:text-slate-500\/70' \}/);
  assert.match(source, /const isDiscarded = associationState === 'discarded'/);
  assert.match(source, /isDiscarded \? 'text-slate-400\/70 dark:text-slate-500\/70'/);
  assert.match(source, /isDiscarded \? 'text-slate-400\/65 dark:text-slate-500\/60'/);
  assert.match(source, /isDiscarded \? 'cursor-pointer hover:bg-slate-500\/5/);
  assert.doesNotMatch(source, /getFieldLabel\('fact_associations'/);
  assert.doesNotMatch(source, /ObjectReferenceCopyButton/);
  assert.doesNotMatch(source, /factAssociations[^\n]{0,120}\.slice\(/);
  const detailSource = fs.readFileSync(path.resolve('src/pages/object-detail/factReadingProjection.ts'), 'utf8');
  assert.match(detailSource, /dedupeRelationsByTarget/);
  assert.doesNotMatch(source, /ChevronLeft|ChevronRight|PanelIcon/);
});

test('Spark terminal headings distinguish implemented and discarded with a legacy fallback', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactReadingLayouts.tsx'), 'utf8');
  const list = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const badge = fs.readFileSync(path.resolve('src/components/StatusBadge.tsx'), 'utf8');

  assert.match(source, /obj\.status === 'implemented' \|\| obj\.status === 'discarded'/);
  assert.match(source, /getObjectStatusLocale\('spark', String\(obj\.status\), locale\)/);
  assert.match(source, /labelKey: 'routing'/);
  assert.match(list, /tone=\{obj\.status === 'implemented' \? 'implemented' : 'retired'\}/);
  assert.match(badge, /objectType === 'spark' && status === 'discarded'/);
  assert.match(badge, /objectType === 'adr' && status === 'retired'/);
});
