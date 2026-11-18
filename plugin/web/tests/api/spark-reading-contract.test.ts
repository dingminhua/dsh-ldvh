import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Spark association UI reads relations and refs as two separate sets', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactAssociationsSection.tsx'), 'utf8');
  assert.match(source, /projectFactReadingAssociations/);
  assert.match(source, /projectFactReadingRefs/);
  assert.match(source, /<RefGroup refs=\{refs\}/);
  assert.doesNotMatch(source, /projectMaterials|evidenceMaterials|externalInputs/);
  assert.doesNotMatch(source, /getTypeLabel\(factTypeKey, locale\)/);
  assert.match(source, /semanticRelationLabels=\{factTypeKey === 'report'\}/);
  assert.match(source, /getFieldLabel\(`relation_\$\{key\.replace/);
  const refGroupSource = source.slice(source.indexOf('function RefGroup'), source.indexOf('function RelationGroup'));
  assert.match(refGroupSource, /function RefTarget/);
  assert.doesNotMatch(refGroupSource, /RelationKeyChip/);
});

test('every fact list card shows exact-read formal associations in a minimal secondary-reading row', () => {
  const listSource = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const source = listSource
    + fs.readFileSync(path.resolve('src/components/FactAssociationRows.tsx'), 'utf8');

  assert.match(source, /function FactAssociationsCardContent/);
  assert.match(source, /associations=\{obj\.factAssociations\}/);
  assert.match(source, /refs=\{obj\.factRefs\}/);
  assert.match(source, /function FactAssociationsCardContent\(\{ associations, refs \}/);
  assert.match(source, /source: 'refs' as const/);
  assert.match(source, /source: 'relations' as const/);
  assert.doesNotMatch(source, /RefsBadge/);
  assert.doesNotMatch(source, /关联 chip[\s\S]{0,40}(随之|紧随)/);
  const cardHead = source.slice(
    source.indexOf('getTypeLabel(obj.type, locale)'),
    source.indexOf('ObjectIdentityActions', source.indexOf('getTypeLabel(obj.type, locale)')),
  );
  assert.match(cardHead, /getTypeLabel\(obj\.type, locale\)[\s\S]*<PriorityIcon/);
  assert.doesNotMatch(cardHead, /<ServesSgBadge/,
    'serves chip 不得回到列表卡头——2026-11-01 已撤除其 Web 呈现（`serves` 字段本身保留）');
  assert.doesNotMatch(cardHead, /factRefs|factAssociations|RefsBadge/);
  assert.match(source, /dedupeFactCardAssociations\(rows\)/);
  assert.match(source, /visibleRows\.map/);
  const dedupeSource = fs.readFileSync(path.resolve('src/utils/factAssociations.ts'), 'utf8');
  assert.match(dedupeSource, /const scopedKey = `\$\{row\.source\}\\u0000\$\{associationTargetKey\(target\)\}`/);
  assert.match(dedupeSource, /seenTargets\.add\(scopedKey\)/);
  assert.match(dedupeSource, /source: string \}/);
  assert.match(source, /whitespace-normal break-words/);
  assert.match(source, /openPanel\(\{ type: 'object', title, objectType: legacyTarget\.factTypeKey, objectId: legacyTarget\.objectId \}\)/);
  assert.doesNotMatch(source, /StatusBadge status=\{association\.status\}/);
  assert.doesNotMatch(source, /isDiscarded\\w*Association/);
  assert.match(source, /function getFactAssociationState/);
  assert.match(source, /targetType === 'spark'/);
  assert.match(source, /association\.status === 'open'\) return 'pending'/);
  assert.match(source, /<FactAssociationStateIcon state=\{associationState\} tooltip=\{associationStateTooltip\} \/>/);
  assert.doesNotMatch(source, /isHiddenTerminalAssociation/);
  assert.match(source, /FACT_ASSOCIATION_STATE_RANK/);
  assert.match(source, /active: 0,[\s\S]*progressing: 1,[\s\S]*pending: 2,[\s\S]*closed: 3,[\s\S]*discarded: 4/);
  assert.match(source, /getFactAssociationStateRank\(left\.row\.association\) - getFactAssociationStateRank\(right\.row\.association\)/);
  assert.match(source, /association\.status === 'implemented'\) return 'closed'/);
  assert.match(source, /association\.status === 'discarded'\) return 'discarded'/);
  assert.match(source, /association\.status === 'retired'\) return 'discarded'/);
  assert.match(source, /discarded: \{ Icon: CircleMinus, className: 'text-slate-400\/70 dark:text-slate-500\/70' \}/);
  assert.match(source, /pending: \{ Icon: CircleHelp, className: 'text-amber-500 dark:text-amber-400' \}/);
  assert.doesNotMatch(source, /M12 12V3a9 9 0 0 1 9 9/);
  assert.match(
    fs.readFileSync(path.resolve('src/components/FactAssociationRows.tsx'), 'utf8')
      .split('\n').find(l => l.startsWith('import') && l.includes('lucide-react')) ?? '',
    /CircleHelp/,
    '关联行实现须从 lucide 引入 CircleHelp',
  );
  assert.doesNotMatch(source, /Icon: QuestionMarkIcon/);
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
  assert.match(list, /tone=\{obj\.status === 'implemented' \? 'implemented' : 'retired'\}/);
  assert.match(badge, /objectType === 'spark' && status === 'discarded'/);
  assert.match(badge, /objectType === 'norm' && status === 'retired'/);
});

test('Spark reading layout parses fixed H2 body sections with frontmatter fallback', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactReadingLayouts.tsx'), 'utf8');

  assert.match(source, /SPARK_BODY_SECTION_ORDER = \['当前理解', '调查问题', '调查边界', '演变'\]/);
  assert.match(source, /function parseSparkBodySections/);
  assert.match(source, /proseFrom\('调查问题', obj\.question\)/);
  assert.match(source, /proseFrom\('调查边界', obj\.scope_boundary\)/);
  assert.match(source, /proseFrom\('当前理解', obj\.summary\)/);
  assert.match(source, /getFieldLabel\('question', locale\)[\s\S]*?getFieldLabel\('scope_boundary', locale\)[\s\S]*?getFieldLabel\('intent', locale\)[\s\S]*?getFieldLabel\('current_understanding', locale\)/);
  assert.match(source, /obj\.disposition/);
  assert.doesNotMatch(source, /obj\.disposition_summary/);
  assert.doesNotMatch(source, /obj\.updated_at/);
  assert.match(source, /SparkEvolutionReadingNode/);
});
