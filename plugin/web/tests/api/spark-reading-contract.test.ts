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
  assert.match(source, /semanticRelationLabels=\{factTypeKey === 'report'\}/);
  assert.match(source, /getFieldLabel\(`relation_\$\{key\.replace/);
  // refs 不定义 relation key：RefGroup/RefTarget 渲染分支不得出现 relation key chip。
  const refGroupSource = source.slice(source.indexOf('function RefGroup'), source.indexOf('function RelationGroup'));
  assert.match(refGroupSource, /function RefTarget/);
  assert.doesNotMatch(refGroupSource, /RelationKeyChip/);
});

test('every fact list card shows exact-read formal associations in a minimal secondary-reading row', () => {
  // 2026-11-03：关联行组件移至 `components/FactAssociationRows.tsx`；关联区
  // 内容（FactAssociationsCardContent）仍在 ObjectList。两处都要读——断言分别
  // 钉住「关联区在卡上」与「行式单点」。
  const listSource = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const source = listSource
    + fs.readFileSync(path.resolve('src/components/FactAssociationRows.tsx'), 'utf8');

  assert.match(source, /function FactAssociationsCardContent/);
  assert.match(source, /associations=\{obj\.factAssociations\}/);
  // Human 裁定 2026-09-16：卡片网格恢复关联对象
  // 呈现——refs 与 relations 走同一组件路径并列呈现（10 §5.2 卡片网格承载
  // 「关联计数」）。原 2026-09-13「关联对象只在详情呈现」的裁定已对 refs
  // 解除，但解除的是**呈现位置**、不是分工纪律：refs 仍不得并入 relations。
  assert.match(source, /refs=\{obj\.factRefs\}/);
  assert.match(source, /function FactAssociationsCardContent\(\{ associations, refs \}/);
  assert.match(source, /source: 'refs' as const/);
  assert.match(source, /source: 'relations' as const/);
  // Human 复定 2026-09-16：列表卡头就是「类型 → 优先级 → 修改次数」，关联对象
  // 不进卡头（呈现取舍），只在卡体关联段呈现。该断言同时钉住：卡头不得以任何
  // 形式的关联 chip 回归。
  //
  // 2026-11-01（Human 定案）：`serves` 子目标 chip 已从卡头撤除（原在
  // PriorityIcon 之后），故顺序判据收缩为「类型 → 优先级」，并反向钉住它
  // 不得回归——撤除的理由是方向（子目标才是承载体），不是临时取舍。
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
  // 去重按来源分组隔离，且该隔离由 source 显式承载——不得依赖「refs 投影
  // 恰好没有 target 字段」这一偶然事实（独立复核 2026-09-16 发现 1）。
  //
  // 2026-11-04：该实现已自 `components/FactAssociationRows.tsx` 迁至
  // `utils/factAssociations.ts`（修 spark-b0e805d1 缺陷②：把纯逻辑抽出以便
  // 用行为用例断言，而不是只靠源码正则）。故这两条形态断言改读新文件；
  // **行为**本身由 `fact-association-dedupe.test.ts` 直接断言。
  const dedupeSource = fs.readFileSync(path.resolve('src/utils/factAssociations.ts'), 'utf8');
  assert.match(dedupeSource, /const scopedKey = `\$\{row\.source\}\\u0000\$\{associationTargetKey\(target\)\}`/);
  assert.match(dedupeSource, /seenTargets\.add\(scopedKey\)/);
  assert.match(dedupeSource, /source: string \}/);
  assert.match(source, /whitespace-normal break-words/);
  assert.match(source, /openPanel\(\{ type: 'object', title, objectType: legacyTarget\.factTypeKey, objectId: legacyTarget\.objectId \}\)/);
  assert.doesNotMatch(source, /StatusBadge status=\{association\.status\}/);
  // v5：cancelled 不再映射 discarded——该映射函数已删除。
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
  // 待确认族用**带圈问号 CircleHelp**（Human 2026-11-02：「待确认应该用问号图标」；
  // 2026-11-03 再定案：「问号图标改回待圆圈的问号」）——此前是自绘的四分填充圆，
  // 读起来像进度环：未开始的条目被画成已完成 25%，隐喻是错的。2026-11-02 曾二次定案
  // 撤掉外圈改用本地裸问号 QuestionMarkIcon，2026-11-03 Human 判「改回带圈的」，
  // 该本地图形已随之删除：裸问号与同排其余四族的圆形图标不成族，一眼看不出这是
  // 「状态」而不是正文里的问号。故现在断言指向 lucide 原生 CircleHelp。
  assert.match(source, /pending: \{ Icon: CircleHelp, className: 'text-amber-500 dark:text-amber-400' \}/);
  assert.doesNotMatch(source, /M12 12V3a9 9 0 0 1 9 9/);
  // 撤除形态不得回到**代码**里（只查 import 行与 Icon 引用——注释里说明「为什么曾撤掉
  // 外圈」时必须点名旧图形，全文断言会把正当的历史记述判成失败，同 §4octodecies 的坑）。
  // 两条：自绘四分圆 path 不得复活；已删除的 QuestionMarkIcon 不得再被引用。
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
