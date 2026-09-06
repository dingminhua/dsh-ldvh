import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import CommitSignatureMeta from '../../src/components/CommitSignatureMeta';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '../..');

test('compact signature metadata shows model and product, with field fallbacks', () => {
  const complete = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'Cindy', modelName: 'gpt-5.6-luna',
  } }));
  assert.match(complete, /gpt-5\.6-luna/);
  assert.match(complete, /Cindy/);

  const deepSeekHarness = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'deepseek harness', modelName: 'deepseek-v4-flash',
  } }));
  assert.match(deepSeekHarness, /DeepSeek Harness/);

  const hyphenatedDeepSeekHarness = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'deepseek-harness', modelName: 'deepseek-v4-flash',
  } }));
  assert.match(hyphenatedDeepSeekHarness, /DeepSeek Harness/);
  assert.doesNotMatch(hyphenatedDeepSeekHarness, /deepseek-harness/);

  const codexDesktop = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'codex-desktop',
  } }));
  assert.match(codexDesktop, /Codex/);
  assert.doesNotMatch(codexDesktop, /codex-desktop/);

  const trae = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'Trae Code',
  } }));
  assert.match(trae, /Trae/);
  assert.doesNotMatch(trae, /Trae Code/);

  const hostedModel = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    modelName: 'chatgpt/gpt-5.6-terra',
    productName: 'cindy',
  } }));
  assert.match(hostedModel, /gpt-5\.6-terra/);
  assert.doesNotMatch(hostedModel, /chatgpt\//);
  assert.match(hostedModel, /Cindy/);
  assert.doesNotMatch(hostedModel, /cindy/);

  const duplicateIdentity = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'Cindy', modelName: 'gpt-5.6-luna',
  } }));
  assert.match(duplicateIdentity, /Cindy/);

  const claudeCodeIdentity = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: {
    productName: 'Claude Code', modelName: 'gl m-5.2',
  } }));
  assert.match(claudeCodeIdentity, /Claude Code/);

  const productOnly = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: { productName: 'Cindy' } }));
  assert.match(productOnly, /Cindy/);
  assert.doesNotMatch(productOnly, /undefined|null|\\(\\)/);

  const modelOnly = renderToStaticMarkup(createElement(CommitSignatureMeta, { signature: { modelName: 'gpt-5.6-luna' } }));
  assert.match(modelOnly, /gpt-5\.6-luna/);
  assert.doesNotMatch(modelOnly, /Cindy|Codex/);
});

test('breaking and push-state badges use one presentation in list and detail identities', async () => {
  const [badge, pushBadge, signatureMeta, list, panel, locales] = await Promise.all([
    readFile(path.join(webRoot, 'src/components/CommitBreakingBadge.tsx'), 'utf8'),
    readFile(path.join(webRoot, 'src/components/CommitPushStatusBadge.tsx'), 'utf8'),
    readFile(path.join(webRoot, 'src/components/CommitSignatureMeta.tsx'), 'utf8'),
    readFile(path.join(webRoot, 'src/pages/Changelog.tsx'), 'utf8'),
    readFile(path.join(webRoot, 'src/components/reading-panel/PanelContent.tsx'), 'utf8'),
    readFile(path.join(webRoot, 'src/i18n/locales.ts'), 'utf8'),
  ]);

  assert.match(badge, /<Unplug size=\{10\}/);
  assert.match(badge, /text-\[10px\]/);
  assert.doesNotMatch(badge, /className="ml-1\.5/);
  assert.match(badge, /t\('changelog\.breakingChange'\)/);
  assert.match(list, /entry\.isBreaking && \(\s*<CommitBreakingBadge className="ml-1\.5" \/>/);
  assert.match(list, /getOptionColor=\{\(value\) => CATEGORY_COLORS\[value\] \|\| CATEGORY_COLORS\.other\}/);
  assert.match(list, /style=\{getOptionColor \? \{ color: getOptionColor\(option\) \} : undefined\}/);
  assert.match(list, /className="ldvh-meta flex min-w-0 flex-wrap items-center gap-1 text-current"/);
  assert.match(list, /style=\{\{ color: typeColor \}\}/);
  assert.match(panel, /entry\?\.isBreaking && \(\s*<CommitBreakingBadge \/>/);
  assert.match(panel, /const commitColor = entry\?\.category/);
  assert.match(panel, /const categoryMeta = headerMetaItems\.length > 0/);
  assert.match(panel, /<span>\{headerMetaItems\[0\]\}<\/span>/);
  assert.match(panel, /showTypeBadge=\{false\}/);
  assert.match(panel, /showActivityCount=\{false\}/);
  assert.doesNotMatch(list, /entry\.isBreaking[\s\S]{0,200}>\s*!\s*</);
  assert.doesNotMatch(panel, /entry\?\.isBreaking[\s\S]{0,200}>\s*!\s*</);
  assert.match(locales, /'changelog\.breakingChange': '不兼容变更'/);
  assert.match(locales, /'changelog\.breakingChange': 'Breaking change'/);
  assert.match(pushBadge, /status === 'unknown'\) return null/);
  assert.match(pushBadge, /import \{ CloudDownload \} from 'lucide-react'/);
  assert.match(pushBadge, /status === 'incoming' \? 'changelog\.incoming'/);
  assert.match(pushBadge, /<CloudDownload aria-hidden="true" size=\{17\}/);
  assert.match(pushBadge, /d="M17\.5 20H9a7 7 0 1 1 6\.71-9h1\.79a4\.5 4\.5 0 1 1 0 9Z"/);
  assert.match(pushBadge, /d="M12 14V3m-3\.5 3\.5L12 3l3\.5 3\.5"/);
  assert.match(list, /<CommitPushStatusBadge status=\{entry\.pushStatus\} \/>/);
  assert.match(panel, /actionBadges=\{entry\?\.pushStatus \? <CommitPushStatusBadge status=\{entry\.pushStatus\} \/> : undefined\}/);
  assert.match(signatureMeta, /normalizeSignature\(signature \?\? \{\}\)/);
  assert.doesNotMatch(signatureMeta, /signature\?\.agentId|signature\?\.hostEnvironment|signature\?\.modelId|signature\?\.agentWorkbench/);
  assert.match(list, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{entry\.date\} signature=\{entry\.signature\} \/>/);
  assert.match(panel, /<CommitSignatureMeta signature=\{entry\.signature\} \/>/);
  assert.match(panel, /stripCommitSignatureTrailers\(commitBody\)/);
  assert.match(panel, /<CommitSignatureSection signature=\{entry\.signature\} labels=\{labels\} \/>/);
  assert.match(panel, /<dd className="ldvh-detail-semantic-body mt-1 break-words rounded-md border border-ldvh-border bg-ldvh-bg\/40 px-3 py-2 font-mono">/);
  assert.doesNotMatch(panel, /labels\.sessionId|signature\.sessionId|signature\.agentId|signature\.hostEnvironment/);
  assert.match(locales, /'changelog\.pushed': '已推送'/);
  assert.match(locales, /'changelog\.unpushed': 'Not pushed'/);
  assert.match(locales, /'changelog\.incoming': '待同步'/);
  assert.match(locales, /'changelog\.incoming': 'Sync pending'/);
});
