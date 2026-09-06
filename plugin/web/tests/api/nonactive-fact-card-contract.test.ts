import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('non-active Spark, ADR, Pitfall, and Study cards share the terminal card grammar', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve('src/index.css'), 'utf8');

  assert.match(source, /function TerminalFactPanel/);
  assert.match(source, /rounded-md border border-l-2 px-3.5 py-3/);
  assert.match(source, /<SummaryText value={content} collapseThreshold={Number.MAX_SAFE_INTEGER}/);
  assert.match(source, /ldvh-terminal-fact-content/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul, ol\)/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul > li, ol > li\)::before/);
  assert.match(styles, /border-radius: 999px/);
  assert.match(source, /function SparkTerminalCardContent/);
  assert.match(source, /function AdrTerminalCardContent/);
  assert.match(source, /function PitfallTerminalCardContent/);
  assert.match(source, /function StudyTerminalCardContent/);
  assert.doesNotMatch(source, /<TerminalFactPanel[^>]*title=/);
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,160}status={presentedStatus}/);
  assert.doesNotMatch(source, /showStatusBadge/);
  assert.doesNotMatch(source, /<CopyPathButton path={obj\.path}/);
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,260}target={obj\.id}/);
  assert.match(source, /copyLabel={t\('common\.copyObjectId'\)}/);
  assert.match(source, /currentType === 'study'[\s\S]*showNonActiveReason={false}[\s\S]*StudyCardContent/);
});
