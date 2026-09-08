import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('Research detail keeps the v5 reading layout: overview inline + fixed H2 body sections + finding units', () => {
  const detail = source('src/pages/ObjectDetail.tsx');

  // v5 阅读布局承载 24 号规范薄索引结构，替代 v4 三字段概览 + 单 Markdown 入口。
  assert.match(detail, /export function ResearchReadingLayout/);
  assert.match(detail, /objType === 'research' \? \(\s*\n\s*<ResearchReadingLayout/);
  assert.doesNotMatch(detail, /StudyReadingLayout/);
  assert.doesNotMatch(detail, /StudyReportMetadata/);
  assert.doesNotMatch(detail, /StudyInputRefsNode/);
  assert.doesNotMatch(detail, /STUDY_READING_NODES/);

  // 概览内联：frontmatter 薄索引字段进入阅读节点集，正文缺失时以 frontmatter 兜底。
  assert.match(detail, /const RESEARCH_READING_NODE_FIELDS = new Set\(\[\s*\n\s*'research_question', 'research_purpose', 'stopping_reason',/);
  assert.match(detail, /'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',/);
  assert.match(detail, /obj\.research_question\.trim\(\)/);
  assert.match(detail, /obj\.research_purpose\.trim\(\)/);

  // 正文固定 H2 分节（24 §7）：前端解析 report_body，未知 H2 兜底呈现。
  assert.match(detail, /const RESEARCH_BODY_SECTION_ORDER = \[\s*\n\s*'研究问题', '输入与边界', '调查阶段', '关键发现', '未证实与缺口', '建议', '后续分流',\s*\n\s*\] as const;/);
  assert.match(detail, /export function parseResearchBodySections\(body: string\)/);
  assert.match(detail, /export function isKnownResearchBodySection\(title: string\): boolean/);
  assert.match(detail, /parseResearchBodySections\(typeof obj\.report_body === 'string' \? obj\.report_body : ''\)/);

  // 调查阶段（探索型专属 H2）默认折叠——过程性内容。
  assert.match(detail, /ResearchBodyNode title=\{t\('objectDetail\.researchBody\.investigation'\)\} initial="collapsed"/);

  // 未证实与缺口：frontmatter 三态结构化（uncertain issue/reason、gaps description/priority）。
  assert.match(detail, /export function ResearchUncertainGapsNode/);
  assert.match(detail, /entry\.issue/);
  assert.match(detail, /entry\.reason/);
  assert.match(detail, /entry\.description/);
  assert.match(detail, /entry\.priority/);
  assert.match(detail, /RESEARCH_GAP_PRIORITY_CLASS/);

  // 澄清记录节点保留；启发节点（frontmatter implications 的解释性呈现）已移除——
  // Human 2026-09-09 三次定案（截图红框标注）：机器索引不在 web 解析呈现。
  assert.doesNotMatch(detail, /ResearchImplicationsNode/);
  assert.match(detail, /export function ResearchClarificationLogNode/);
  assert.match(detail, /entry\.question/);
  assert.match(detail, /entry\.answer/);
  assert.match(detail, /entry\.answered_by/);
});

test('Research finding units render as structured cards with provenance anchor lines', () => {
  const detail = source('src/pages/ObjectDetail.tsx');

  // 发现单元：H3 切分 + 溯源锚点行提取（24 §10：溯源：<ref>（<锚点>））。
  assert.match(detail, /export function parseResearchFindingUnits\(sectionBody: string\)/);
  assert.match(detail, /export function extractResearchProvenance\(unitBody: string\)/);
  assert.ok(detail.includes(String.raw`(https?:\/\/\S+?)（(.+?)）[。]?\s*$`), 'provenance anchor pattern missing');

  // 溯源回指：ref 匹配 urls 条目展示 title，可点击回查原文（F4 展开入口）。
  assert.match(detail, /export function ResearchProvenanceLine/);
  assert.match(detail, /function findResearchUrlTitle\(urls: unknown, ref: string\)/);
  assert.match(detail, /<a\s*\n\s*href=\{provenanceRef\}/);
  assert.match(detail, /target="_blank"/);
  assert.match(detail, /unit\.provenanceRef !== undefined/);

  // 缺锚点行的发现单元用警示色呈现（不静默）。
  assert.match(detail, /objectDetail\.researchBody\.noProvenance/);

  // 停止原因元数据行：stopping_reason 闭集本地化 + 三态计数。
  assert.match(detail, /export function ResearchStoppingMetaRow/);
  assert.match(detail, /getFieldValueLabel\('stopping_reason', stoppingReason, locale\)/);
  assert.match(detail, /Array\.isArray\(obj\.confirmed_statements\) \? obj\.confirmed_statements\.length : 0/);

  // 尾部固定序列：FactAssociations → RelatedContent → ChangeLog（v4 设计语言保留）。
  assert.match(detail, /<FactAssociationsSection obj=\{obj\} locale=\{locale\} \/>\s*\n\s*<RelatedContentSection entries=\{relatedEntries\} locale=\{locale\} \/>\s*\n\s*<ChangeLogReadingNode/);
});

test('Research keeps the YAML source node with display-time ordering; the implications node stays removed; research-report panel variant stays', () => {
  const panel = source('src/components/reading-panel/PanelContent.tsx');
  const panelContext = source('src/utils/panelContext.tsx');
  const detail = source('src/pages/ObjectDetail.tsx');
  const factReadMeta = source('src/utils/factReadMeta.ts');
  const reference = source('src/components/ReferenceCard.tsx');
  const associations = source('src/pages/object-detail/FactAssociationsSection.tsx');

  // Human 2026-09-09 三次定案（截图红框澄清）：YAML 源节点保留——展示时按
  // 24 §7 规范阅读序排序（yaml_source 原文解析后重排，不注入不过滤）；
  // 被移除的是「启发」节点（frontmatter implications 的解释性呈现）——机器
  // 索引不在 web 解析呈现，机器索引原文只在 YAML 源节点以原文形式出现。
  assert.match(detail, /\(carrier === 'yaml' \|\| objType === 'research'\) && \(/);
  assert.match(detail, /<YamlDataNode/);
  assert.match(detail, /sortedResearchFrontmatterYaml/);
  assert.match(factReadMeta, /RESEARCH_FRONTMATTER_DISPLAY_ORDER/);
  assert.doesNotMatch(detail, /ResearchImplicationsNode/);
  assert.match(panel, /carrier === 'markdown'/);
  assert.match(panel, /ldvh-research-report-preview/);
  assert.match(panelContext, /docVariant\?: 'research-report'/);
  assert.match(panel, /docVariant === 'research-report'/);

  // source paths never fall back to navigation targets.
  assert.doesNotMatch(detail, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(reference, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(associations, /detail\?\.target/);
});

test('Research projection order and i18n labels cover the v5 thin-index fields', () => {
  const model = source('src/pages/object-detail/model.ts');
  const locales = source('src/i18n/locales.ts');
  const list = source('src/pages/ObjectList.tsx');

  // 字段顺序：research 条目受控排序，v4 study 条目移除。
  assert.match(model, /research: \[\s*\n\s*'research_question', 'research_purpose', 'stopping_reason',/);
  assert.match(model, /'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',/);
  assert.doesNotMatch(model, /study: \[/);

  // i18n：v5 专属字段标签齐备。
  for (const key of [
    'research_purpose', 'stopping_reason', 'confirmed_statements', 'uncertain', 'gaps',
    'implications', 'clarification_log', 'finding_ref', 'issue', 'answered_by',
    'retirement_reason', 'retired_at',
  ]) {
    assert.match(locales, new RegExp(`${key}: \\{ zh: '[^']+', en: '[^']+' \\}`), `missing i18n label: ${key}`);
  }

  // stopping_reason 闭集与 gaps priority 的值本地化。
  assert.match(locales, /stopping_reason: \{\s*\n\s*sufficient: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'no-gain': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'round-cap': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*\},/);
  assert.match(locales, /high: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*medium: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*low: \{ zh: '[^']+', en: '[^']+' \},/);

  // 正文节标题 i18n（zh/en）。
  assert.match(locales, /'objectDetail\.researchBody\.question': '研究问题'/);
  assert.match(locales, /'objectDetail\.researchBody\.investigation': '调查阶段'/);
  assert.match(locales, /'objectDetail\.researchBody\.findings': '关键发现'/);
  assert.match(locales, /'objectDetail\.researchBody\.question': 'Research Question'/);
  assert.match(locales, /'objectDetail\.researchBody\.findings': 'Key Findings'/);

  // 列表卡片：活跃调研不渲染内容块（Human 2026-09-09 定——研究问题/目的/
  // 停止原因在详情页呈现，卡片保持克制）；v4 report_kind chip 移除。
  assert.match(locales, /retirement_reason: \{\s*\n\s*outdated: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*superseded: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'out-of-scope': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*rejected: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*\},/);
  assert.match(list, /export function StudyCardContent/);
  assert.doesNotMatch(list, /obj\.research_question\?\.trim\(\)/);
  assert.doesNotMatch(list, /obj\.report_kind/);
});

test('Research API contract carries the v5 thin-index and lifecycle fields', () => {
  const contract = source('api/services/factFieldContract.ts');
  const reader = source('api/services/localFactReader.ts');

  // 契约字段面：三态 + 澄清 + 退出语义（24 §8 字段闭集）。
  assert.match(contract, /clarification_log: field\('research-clarification-log', 'array', false\)/);
  assert.match(contract, /retirement_reason: field\('retirement-reason', 'string', false\)/);
  assert.match(contract, /retired_at: field\('retired-at', 'string', false\)/);
  assert.match(contract, /research: \['retired'\]/);

  // 数组成员消费检查：对象数组的字段登记（confirmed_statements 是字符串索引，不登记）。
  assert.match(reader, /research: new Set\(\['uncertain', 'gaps', 'implications', 'clarification_log', 'change_log'\]\)/);

  // markdown 正文仍以整体投影进入 report_body，分节解析由前端呈现层承担。
  assert.match(reader, /projectFields\(type, objectId, parsed\.metadata, \{ report_body: parsed\.body \}\)/);
});
