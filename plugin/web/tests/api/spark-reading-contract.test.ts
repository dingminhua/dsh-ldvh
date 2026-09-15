import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('Spark association UI reads relations and refs as two separate sets', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactAssociationsSection.tsx'), 'utf8');
  assert.match(source, /projectFactReadingAssociations/);
  // 03 §7.2 分工纪律：refs 与 relations 并列呈现、互不并入（relations 承载
  // 生命周期关系、refs 承载普通内容关联，不参与关系闭集校验）。
  assert.match(source, /projectFactReadingRefs/);
  assert.match(source, /<RefGroup refs=\{refs\}/);
  assert.doesNotMatch(source, /projectMaterials|evidenceMaterials|externalInputs/);
  assert.doesNotMatch(source, /getTypeLabel\(factTypeKey, locale\)/);
  assert.match(source, /semanticRelationLabels=\{factTypeKey === 'research'\}/);
  assert.match(source, /getFieldLabel\(`relation_\$\{key\.replace/);
  // refs 不定义 relation key：RefGroup/RefTarget 渲染分支不得出现 relation key chip。
  const refGroupSource = source.slice(source.indexOf('function RefGroup'), source.indexOf('function RelationGroup'));
  assert.match(refGroupSource, /function RefTarget/);
  assert.doesNotMatch(refGroupSource, /RelationKeyChip/);
});

test('every fact list card shows exact-read formal associations in a minimal secondary-reading row', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function FactAssociationsCardContent/);
  assert.match(source, /associations=\{obj\.factAssociations\}/);
  // refs 关联对象 chip 已从卡头移除：只在详情「关联对象」阅读节点呈现
  // （10 §5.1 不渲染关联关系、10 §5.2 卡片网格不承载关联对象）。
  assert.doesNotMatch(source, /RefsBadge/);
  assert.doesNotMatch(source, /obj\.refs/);
  assert.match(source, /dedupeFactCardAssociations\(associations\)/);
  assert.match(source, /visibleAssociations\.map/);
  assert.match(source, /whitespace-normal break-words/);
  assert.match(source, /openPanel\(\{ type: 'object', title, objectType: legacyTarget\.factTypeKey, objectId: legacyTarget\.objectId \}\)/);
  assert.doesNotMatch(source, /StatusBadge status=\{association\.status\}/);
  // v5：cancelled 不再映射 discarded（21 号无此组）——isDiscardedWorkCaseAssociation 已删除。
  assert.doesNotMatch(source, /isDiscardedWorkCaseAssociation/);
  assert.match(source, /function getFactAssociationState/);
  assert.match(source, /targetType === 'spark'/);
  assert.match(source, /association\.status === 'open'\) return 'pending'/);
  assert.match(source, /association\.group === 'pending_gate1' \|\| association\.group === 'awaiting_gate2'/);
  assert.match(source, /<FactAssociationStateIcon state=\{associationState\} tooltip=\{associationStateTooltip\} \/>/);
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
  assert.match(list, /tone=\{obj\.status === 'implemented' \? 'implemented' : 'retired'\}/);
  assert.match(badge, /objectType === 'spark' && status === 'discarded'/);
  assert.match(badge, /objectType === 'adr' && status === 'retired'/);
});

test('Spark reading layout parses fixed H2 body sections with frontmatter fallback', () => {
  const source = fs.readFileSync(path.resolve('src/pages/object-detail/FactReadingLayouts.tsx'), 'utf8');

  // 20 §8 正文固定 H2：当前理解/调查问题/调查边界/演变（保留意图无正文节）。
  assert.match(source, /SPARK_BODY_SECTION_ORDER = \['当前理解', '调查问题', '调查边界', '演变'\]/);
  assert.match(source, /function parseSparkBodySections/);
  // 正文节优先、frontmatter 兜底（同 research「研究问题」的先例）。
  assert.match(source, /proseFrom\('调查问题', obj\.question\)/);
  assert.match(source, /proseFrom\('调查边界', obj\.scope_boundary\)/);
  assert.match(source, /proseFrom\('当前理解', obj\.summary\)/);
  // 节序跟随字段契约：question → scope_boundary → intent → summary。
  assert.match(source, /getFieldLabel\('question', locale\)[\s\S]*?getFieldLabel\('scope_boundary', locale\)[\s\S]*?getFieldLabel\('intent', locale\)[\s\S]*?getFieldLabel\('current_understanding', locale\)/);
  // 20 §8：终态去向由 disposition 承载（implemented/discarded 时必填，
  // 缺失时如实标注，不以空占位代替判断）。spark 阅读面不再读 v4 的
  // disposition_summary/updated_at（ADR/Pitfall 节点仍合法使用前者）。
  assert.match(source, /obj\.disposition/);
  assert.doesNotMatch(source, /obj\.disposition_summary/);
  assert.doesNotMatch(source, /obj\.updated_at/);
  // 演变：结构化流水优先，正文节兜底。
  assert.match(source, /SparkEvolutionReadingNode/);
});
