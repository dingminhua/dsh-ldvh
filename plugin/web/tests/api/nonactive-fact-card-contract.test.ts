import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('non-active Spark, ADR, Pitfall, and Study cards share the terminal card grammar', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve('src/index.css'), 'utf8');

  assert.match(source, /function TerminalFactPanel/);
  // Human 定案 2026-09-13：终态说明框去掉左侧加粗竖线——四边同为 1px 细线，
  // 语义分色（implemented=emerald / retired=zinc）。
  assert.match(source, /cursor-default rounded-md border px-3\.5 py-3/);
  assert.match(source, /border-emerald-400\/25 bg-emerald-500\/5/);
  assert.match(source, /border-zinc-400\/25 bg-zinc-500\/5/);
  assert.match(source, /<SummaryText value={content} collapseThreshold={Number.MAX_SAFE_INTEGER}/);
  assert.match(source, /ldvh-terminal-fact-content/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul, ol\)/);
  assert.match(styles, /\.ldvh-terminal-fact-content \.ldvh-inline-markdown :where\(ul > li, ol > li\)::before/);
  assert.match(styles, /border-radius: 999px/);
  assert.match(source, /function SparkTerminalCardContent/);
  assert.match(source, /function AdrTerminalCardContent/);
  assert.match(source, /function PitfallTerminalCardContent/);
  assert.match(source, /function ResearchTerminalCardContent/);
  assert.doesNotMatch(source, /<TerminalFactPanel[^>]*title=/);
  // 2026-09-30 修订：WorkCase 已关闭卡改用合并徽标后，status 表达式变成三元
  // （命中合并徽标时传空），故断言改为「status 的取值仍**来自 presentedStatus**」——
  // 意图不变（呈现状态须由卡框供给，不得硬编码别的来源），且不绑死其表达式形状。
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,400}status=\{[^}]*presentedStatus[^}]*\}/);
  assert.doesNotMatch(source, /showStatusBadge/);
  assert.doesNotMatch(source, /<CopyPathButton path={obj\.path}/);
  // 2026-09-30 修订：窗口 260 → 700——卡框新增 `statusBadge` 一段后，`target` 落在原窗口外。
  // 意图不变：身份簇须收到**完整对象 id**（复制动作的入参）。
  assert.match(source, /<ObjectIdentityActions[\s\S]{0,700}target={obj\.id}/);
  assert.match(source, /copyLabel={t\('common\.copyObjectId'\)}/);
  assert.match(source, /currentType === 'research'[\s\S]*showNonActiveReason={false}[\s\S]*ResearchCardContent/);
});
