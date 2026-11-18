import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('non-active Spark, Pitfall, and Study cards share the terminal card grammar', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve('src/index.css'), 'utf8');

  assert.match(source, /function TerminalFactPanel/);
  assert.match(source, /cursor-default rounded-md border px-3\.5 py-3/);
  assert.match(source, /border-emerald-400\/25 bg-emerald-500\/5/);
  assert.match(source, /border-zinc-400\/25 bg-zinc-500\/5/);
  assert.match(source, /<SummaryText value={content} collapseThreshold={Number.MAX_SAFE_INTEGER}/);
  assert.match(source, /ldvh-terminal-fact-content/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul, ol\)/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul > li, ol > li\)::before/);
  assert.match(styles, /border-radius: 999px/);
  assert.match(source, /function SparkTerminalCardContent/);
  assert.match(source, /function PitfallTerminalCardContent/);
  assert.match(source, /function ResearchTerminalCardContent/);
  assert.doesNotMatch(source, /<TerminalFactPanel[^>]*title=/);
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,400}status=\{[^}]*presentedStatus[^}]*\}/);
  assert.doesNotMatch(source, /showStatusBadge/);
  assert.doesNotMatch(source, /<CopyPathButton path={obj\.path}/);
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,700}target={obj\.id}/);
  assert.match(source, /copyLabel={t\('common\.copyObjectId'\)}/);
  assert.match(source, /currentType === 'report'[\s\S]*showNonActiveReason={false}[\s\S]*ResearchCardContent/);
});
