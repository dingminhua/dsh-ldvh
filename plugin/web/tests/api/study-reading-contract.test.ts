import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('Study keeps the V3-style three-field overview and one Markdown reading entry', () => {
  const detail = source('src/pages/ObjectDetail.tsx');
  const nodes = detail.match(/const STUDY_READING_NODES:[\s\S]*?\n\];/)?.[0] ?? '';

  assert.match(nodes, /research_intent/);
  assert.match(nodes, /abstract/);
  assert.match(nodes, /recommendation_summary/);
  assert.match(nodes, /report_body/);
  assert.doesNotMatch(nodes, /research_question/);
  assert.doesNotMatch(detail, /parseStudyReportSections/);
  assert.match(detail, /docVariant: 'study-report'/);
  assert.match(detail, /\(carrier === 'yaml' \|\| objType === 'study'\) && \(/);
  assert.match(detail, /StudyReportMetadata/);
  assert.match(detail, /report_kind/);
  assert.match(detail, /input_refs/);
  assert.match(detail, /function getStudyReportMetadataTitle/);
  assert.match(detail, /\$\{getStudyReportMetadataTitle\(locale\)\} · \$\{getFieldValueLabel/);
  assert.match(detail, /title=\{title\}/);
  assert.match(detail, /const meta = \[/);
  assert.match(detail, /h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary\/55/);
  assert.match(detail, /function StudyReportMetadata[\s\S]*useState<ReadingNodeState>\('collapsed'\)/);
  assert.doesNotMatch(detail, /compactMetadata/);
  assert.doesNotMatch(detail, /overflow-hidden rounded-lg border border-ldvh-border bg-ldvh-bg\/35/);
  assert.doesNotMatch(detail, /sm:grid-cols-2/);
  assert.match(detail, /<ChangeLogReadingNode value=\{obj\.change_log\}/);
  assert.match(detail, /<FactAssociationsSection obj=\{obj\} locale=\{locale\} \/>[\s\S]*<StudyReportMetadata obj=\{obj\} locale=\{locale\} \/>[\s\S]*<ChangeLogReadingNode/);
  assert.match(detail, /\(carrier === 'yaml' \|\| objType === 'study'\)[\s\S]*<YamlDataNode/);
  assert.match(detail, /'report_kind', 'input_refs', 'change_log'/);
  assert.doesNotMatch(detail, /report_signature/);
  const model = source('src/pages/object-detail/model.ts');
  assert.match(model, /'carrier'/);
  assert.match(model, /'fact_read_failure'/);
});

test('known Study Markdown uses its declared carrier and source paths never fall back to navigation targets', () => {
  const panel = source('src/components/reading-panel/PanelContent.tsx');
  const detail = source('src/pages/ObjectDetail.tsx');
  const reference = source('src/components/ReferenceCard.tsx');
  const associations = source('src/pages/object-detail/FactAssociationsSection.tsx');

  assert.match(panel, /carrier === 'markdown'/);
  assert.match(panel, /ldvh-study-report-preview/);
  assert.doesNotMatch(detail, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(reference, /obj\.path\s*\|\|\s*detail\.target/);
  assert.doesNotMatch(associations, /detail\?\.target/);
});
