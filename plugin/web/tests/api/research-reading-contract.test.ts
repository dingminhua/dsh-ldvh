import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('Research detail keeps the v5 reading layout: overview inline + fixed H2 body sections + finding units', () => {
  const detail = source('src/pages/ObjectDetail.tsx');

  assert.match(detail, /export function ResearchReadingLayout/);
  assert.match(detail, /objType === 'report' \? \(\s*\n\s*<ResearchReadingLayout/);
  assert.doesNotMatch(detail, /StudyReadingLayout/);
  assert.doesNotMatch(detail, /StudyReportMetadata/);
  assert.doesNotMatch(detail, /StudyInputRefsNode/);
  assert.doesNotMatch(detail, /STUDY_READING_NODES/);

  assert.match(detail, /const RESEARCH_READING_NODE_FIELDS = new Set\(\[\s*\n\s*'research_question', 'research_purpose', 'stopping_reason',/);
  assert.match(detail, /'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',/);
  assert.match(detail, /obj\.research_question\.trim\(\)/);
  assert.match(detail, /obj\.research_purpose\.trim\(\)/);

  assert.match(detail, /const RESEARCH_BODY_SECTION_ORDER = \[\s*\n\s*'研究问题', '输入与边界', '调查阶段', '关键发现', '未证实与缺口', '建议', '后续分流',\s*\n\s*\] as const;/);
  assert.match(detail, /export function parseResearchBodySections\(body: string\)/);
  assert.match(detail, /export function isKnownResearchBodySection\(title: string\): boolean/);
  assert.match(detail, /parseResearchBodySections\(typeof obj\.report_body === 'string' \? obj\.report_body : ''\)/);

  assert.match(detail, /ResearchBodyNode title=\{t\('objectDetail\.researchBody\.investigation'\)\} initial="collapsed"/);

  assert.match(detail, /export function ResearchUncertainGapsNode/);
  assert.match(detail, /entry\.issue/);
  assert.match(detail, /entry\.reason/);
  assert.match(detail, /entry\.description/);
  assert.match(detail, /entry\.priority/);
  assert.match(detail, /RESEARCH_GAP_PRIORITY_CLASS/);

  assert.doesNotMatch(detail, /ResearchImplicationsNode/);
  assert.match(detail, /export function ResearchClarificationLogNode/);
  assert.match(detail, /entry\.question/);
  assert.match(detail, /entry\.answer/);
  assert.match(detail, /entry\.answered_by/);
});

test('Research finding units render as structured cards with provenance anchor lines', () => {
  const detail = source('src/pages/ObjectDetail.tsx');

  assert.match(detail, /export function parseResearchFindingUnits\(sectionBody: string\)/);
  assert.match(detail, /export function extractResearchProvenance\(unitBody: string\)/);
  assert.ok(detail.includes(String.raw`(https?:\/\/\S+?)（(.+?)）[。]?\s*$`), 'provenance anchor pattern missing');

  assert.match(detail, /export function ResearchProvenanceLine/);
  assert.match(detail, /function findResearchUrlTitle\(urls: unknown, ref: string\)/);
  assert.match(detail, /<a\s*\n\s*href=\{provenanceRef\}/);
  assert.match(detail, /target="_blank"/);
  assert.match(detail, /unit\.provenanceRef !== undefined/);


  assert.match(detail, /<FactAssociationsSection obj=\{obj\} locale=\{locale\} \/>\s*\n\s*<RelatedContentSection entries=\{relatedEntries\} locale=\{locale\} \/>\s*\n\s*<ChangeLogReadingNode/);
});

test('Research keeps the YAML source node with display-time ordering; the implications node stays removed; research-report panel variant stays', () => {
  const panel = source('src/components/reading-panel/PanelContent.tsx');
  const panelContext = source('src/utils/panelContext.tsx');
  const detail = source('src/pages/ObjectDetail.tsx');
  const factReadMeta = source('src/utils/factReadMeta.ts');
  const reference = source('src/components/ReferenceCard.tsx');
  const associations = source('src/pages/object-detail/FactAssociationsSection.tsx');

  assert.match(detail, /<YamlDataNode/);
  assert.match(detail, /sortedResearchFrontmatterYaml/);
  assert.doesNotMatch(detail, /\{\s*\(?[^<>{}]*&&\s*\(\s*\n?\s*<YamlDataNode/);
  assert.doesNotMatch(detail, /\{[^{}]*&&[^{}]*<YamlDataNode/);
  assert.match(factReadMeta, /RESEARCH_FRONTMATTER_DISPLAY_ORDER/);
  assert.doesNotMatch(detail, /ResearchImplicationsNode/);
  assert.match(panel, /carrier === 'markdown'/);
  assert.match(panel, /ldvh-research-report-preview/);
  assert.match(panelContext, /docVariant\?: 'research-report'/);
  assert.match(panel, /docVariant === 'research-report'/);

  assert.doesNotMatch(detail, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(reference, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(associations, /detail\?\.target/);
});

test('Research projection order and i18n labels cover the v5 thin-index fields', () => {
  const model = source('src/pages/object-detail/model.ts');
  const locales = source('src/i18n/locales.ts');
  const list = source('src/pages/ObjectList.tsx');

  assert.match(model, /research: \[\s*\n\s*'research_question', 'research_purpose', 'stopping_reason',/);
  assert.match(model, /'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',/);
  assert.doesNotMatch(model, /study: \[/);

  for (const key of [
    'research_purpose', 'stopping_reason', 'confirmed_statements', 'uncertain', 'gaps',
    'implications', 'clarification_log', 'finding_ref', 'issue', 'answered_by',
    'retirement_reason', 'retired_at',
  ]) {
    assert.match(locales, new RegExp(`${key}: \\{ zh: '[^']+', en: '[^']+' \\}`), `missing i18n label: ${key}`);
  }

  assert.match(locales, /stopping_reason: \{\s*\n\s*sufficient: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'no-gain': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'round-cap': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*\},/);
  assert.match(locales, /high: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*medium: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*low: \{ zh: '[^']+', en: '[^']+' \},/);

  assert.match(locales, /'objectDetail\.researchBody\.question': '研究问题'/);
  assert.match(locales, /'objectDetail\.researchBody\.investigation': '调查阶段'/);
  assert.match(locales, /'objectDetail\.researchBody\.findings': '关键发现'/);
  assert.match(locales, /'objectDetail\.researchBody\.question': 'Research Question'/);
  assert.match(locales, /'objectDetail\.researchBody\.findings': 'Key Findings'/);

  assert.match(locales, /retirement_reason: \{\s*\n\s*outdated: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*superseded: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*'out-of-scope': \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*absorbed: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*abolished: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*rejected: \{ zh: '[^']+', en: '[^']+' \},\s*\n\s*\},/);
  assert.match(list, /export function ResearchCardContent/);
  assert.doesNotMatch(list, /obj\.research_question\?\.trim\(\)/);
  assert.doesNotMatch(list, /obj\.report_kind/);
});

test('Research API contract carries the v5 thin-index and lifecycle fields', () => {
  const contract = source('api/services/factFieldContract.ts');
  const reader = source('api/services/localFactReader.ts');

  assert.match(contract, /clarification_log: field\('report-clarification-log', 'array', false\)/);
  assert.match(contract, /retirement_reason: field\('retirement-reason', 'string', false\)/);
  assert.match(contract, /retired_at: field\('retired-at', 'string', false\)/);
  assert.match(contract, /report: \['retired'\]/);

  assert.match(reader, /report: new Set\(\['uncertain', 'gaps', 'implications', 'clarification_log', 'change_log'\]\)/);

  assert.match(reader, /projectFields\(type, objectId, parsed\.metadata, \{ report_body: parsed\.body \}\)/);
});
