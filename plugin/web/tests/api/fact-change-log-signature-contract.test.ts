import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLatestFactChangeAt, getLatestFactChangeSignature, getObjectUpdatedAt } from '../../src/utils/factChangeLog';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

test('object header attribution reads the newest complete signature from change_log only', () => {
  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { model_id: 'legacy', agent_workbench: 'legacy-runtime' } },
    { signature: { agent_id: 'partial' } },
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna', agent_runtime_name: 'codex-cli' } },
  ]), { productName: 'Cindy', modelName: 'gpt-5.6-luna' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'chatGPT', model_name: 'chatgpt/gpt-5.6-terra', agent_runtime_name: 'codex' } },
  ]), { productName: 'ChatGPT', modelName: 'gpt-5.6-terra' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'C i n d y', agent_runtime_name: 'CINDY' } },
  ]), { productName: 'C i n d y' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Claude Code', model_name: 'glm-5.2', agent_runtime_name: 'claude-code' } },
  ]), { productName: 'Claude Code', modelName: 'glm-5.2' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Cindy', model_name: 'deepseek/deepseek-v4-flash[1m]', agent_runtime_name: 'claude-code' } },
  ]), { productName: 'Cindy', modelName: 'deepseek-v4-flash' });

  assert.equal(getLatestFactChangeSignature([
    { signature: { agent_id: 'legacy', host_environment: 'old-host' } },
    { signature: { model_id: 'gpt-5', agent_workbench: 'Cindy' } },
  ]), undefined);

  assert.equal(getLatestFactChangeSignature([
    { signature: { model_id: 'gpt-5', host_name: 'Cindy' } },
  ]), undefined);

  assert.equal(getLatestFactChangeSignature([
    { signature: { agent_id: 'partial' } },
    { signature: { host_environment: 'missing-agent' } },
  ]), undefined);
  assert.equal(getLatestFactChangeSignature(undefined), undefined);
});

test('object header attribution reads the v5 flat provider/model change_log shape (specs/09)', () => {
  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-06T07:48:23.255Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
    { at: '2026-09-07T18:53:00.235Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '更新' },
  ]), { provider: 'zzztoken-glm', model: 'glm-5.3' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna' }, at: '2026-08-01T00:00:00Z' },
    { at: '2026-09-01T00:00:00Z', provider: 'modlens-zzztoken-glm', model: 'glm-5.3', summary: '受控更新' },
  ]), { provider: 'modlens-zzztoken-glm', model: 'glm-5.3' });

  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna' }, at: '2026-09-02T00:00:00Z', summary: '归档迁移' },
  ]), { productName: 'Cindy', modelName: 'gpt-5.6-luna' });

  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'workbuddy', summary: '受控创建' },
  ]), { provider: 'workbuddy' });
  assert.equal(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: '  ', model: '', summary: '受控创建' },
  ]), undefined);
});

test('provider renders verbatim through normalizeSignature while v4 product_name keeps normalization', async () => {
  const { normalizeSignature } = await import('../../shared/signature.ts');

  assert.deepEqual(normalizeSignature({ provider: 'zzztoken-glm', model: 'glm-5.3' }), {
    productName: 'zzztoken-glm', modelName: 'glm-5.3',
  });
  assert.deepEqual(normalizeSignature({ provider: 'modlens-zzztoken-glm' }), {
    productName: 'modlens-zzztoken-glm', modelName: '',
  });
  assert.deepEqual(normalizeSignature({ productName: 'cindy' }), { productName: 'Cindy', modelName: '' });
  assert.deepEqual(normalizeSignature({ productName: 'deepseek-harness' }), { productName: 'DeepSeek Harness', modelName: '' });
  const fromRead = getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
  ]);
  assert.deepEqual(normalizeSignature(fromRead ?? {}), { productName: 'zzztoken-glm', modelName: 'glm-5.3' });
});

test('latest change-log at tolerates Date instances and requires complete RFC 3339 strings', () => {
  assert.equal(getLatestFactChangeAt([
    { at: new Date('2026-09-06T07:48:23.255Z'), summary: '受控创建' },
    { at: new Date('2026-09-07T18:53:00.235Z'), summary: '更新' },
  ]), '2026-09-07T18:53:00.235Z');
  assert.equal(getLatestFactChangeAt([
    { at: '2026-09-07T18:53:00.235Z', summary: '更新' },
  ]), '2026-09-07T18:53:00.235Z');
  assert.equal(getLatestFactChangeAt([
    { at: '2026-09-07 18:53:00', summary: '非 RFC3339' },
    { at: '2026-09-06T07:48:23.255Z', summary: '受控创建' },
  ]), '2026-09-06T07:48:23.255Z');
  assert.equal(getLatestFactChangeAt([]), undefined);
  assert.equal(getLatestFactChangeAt(undefined), undefined);
  assert.equal(getLatestFactChangeAt([{ summary: 'no at' }]), undefined);
});

test('object updated time falls back to change_log at when updated_at/updated are absent (03 §6.1)', () => {
  assert.equal(getObjectUpdatedAt({
    updated_at: '2026-08-24T10:56:13Z', updated: '2026-08-01T00:00:00Z',
    change_log: [{ at: '2026-08-24T10:56:13Z', summary: '创建' }],
  }), '2026-08-24T10:56:13Z');
  assert.equal(getObjectUpdatedAt({
    created_at: '2026-09-06T07:48:23.255Z',
    change_log: [{ at: '2026-09-06T07:48:23.255Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' }],
  }), '2026-09-06T07:48:23.255Z');
  assert.equal(getObjectUpdatedAt({
    change_log: [{ at: new Date('2026-09-07T18:53:00.235Z'), provider: 'x', model: 'y', summary: '更新' }],
  }), '2026-09-07T18:53:00.235Z');
  assert.equal(getObjectUpdatedAt({ created_at: '2026-09-06T07:48:23.255Z' }), undefined);
  assert.equal(getObjectUpdatedAt(null), undefined);
  assert.equal(getObjectUpdatedAt(undefined), undefined);
});

test('all fact Cards reuse the shared update and update-log attribution surface', () => {
  const list = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectList.tsx'), 'utf8');
  const facts = readFileSync(path.join(repositoryRoot, 'web/api/services/facts.ts'), 'utf8');

  assert.match(list, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(list, /<ObjectUpdatedMeta source=\{obj\} updatedAt=\{obj\.updated\} \/>/);
  assert.match(list, /flex min-w-0 items-center justify-end pt-0\.5 text-right/);
  assert.doesNotMatch(list, /formatDateTime\(obj\.updated\)/);
  assert.match(facts, /copyPresentFields\(source, \['change_log'\]\)/);
});

test('detail page and reading panel derive the updated time via getObjectUpdatedAt (03 §6.1 fallback)', () => {
  const detail = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectDetail.tsx'), 'utf8');
  const panel = readFileSync(
    path.join(repositoryRoot, 'web/src/components/reading-panel/PanelContent.tsx'),
    'utf8',
  );

  assert.match(detail, /import \{ getObjectUpdatedAt \} from '@\/utils\/factChangeLog'/);
  assert.match(detail, /<ObjectUpdatedMeta source=\{obj\} updatedAt=\{getObjectUpdatedAt\(obj\)\} \/>/);
  assert.match(panel, /import \{ getObjectUpdatedAt \} from '@\/utils\/factChangeLog'/);
  assert.match(panel, /<ObjectUpdatedMeta source=\{obj \|\| \{\}\} updatedAt=\{getObjectUpdatedAt\(obj\)\} \/>/);
  assert.doesNotMatch(detail, /obj\.updated_at \?\? obj\.updated/);
  assert.doesNotMatch(panel, /obj\?\.updated_at \?\? obj\?\.updated/);
});

test('object list route derives item updated time with the change_log fallback (03 §6.1)', () => {
  const objectsRoute = readFileSync(path.join(repositoryRoot, 'web/api/routes/objects.ts'), 'utf8');

  assert.match(objectsRoute, /import \{ getLatestChangeLogAt \} from '\.\.\/\.\.\/shared\/factChangeLog\.js'/);
  assert.match(objectsRoute, /updated: resolveListItemUpdated\(value\)/);
  assert.match(objectsRoute, /toStringValue\(value\.updated_at\)[\s\S]*?\|\| toStringValue\(value\.updated\)[\s\S]*?\|\| getLatestChangeLogAt\(value\.change_log\)/);
});

test('change-log reading node reads the v5 flat provider/model entries', () => {
  const layouts = readFileSync(
    path.join(repositoryRoot, 'web/src/pages/object-detail/FactReadingLayouts.tsx'),
    'utf8',
  );

  assert.match(layouts, /provider: record\.provider/);
  assert.match(layouts, /model: record\.model/);
  assert.doesNotMatch(layouts, /productName: signatureRecord\?\.product_name \?\? record\.provider/);
});

test('provider surfaces are labelled 供应商/Provider and display values verbatim', () => {
  const locales = readFileSync(path.join(repositoryRoot, 'web/src/i18n/locales.ts'), 'utf8');

  assert.match(locales, /environmentName: '供应商'/);
  assert.match(locales, /environmentName: 'Provider'/);
  assert.match(locales, /'cognition\.recent\.environmentUsage': '供应商'/);
  assert.match(locales, /'cognition\.recent\.environmentUsage': 'Provider'/);
  assert.doesNotMatch(locales, /署名环境/);
  assert.doesNotMatch(locales, /'Signing environment'/);
  assert.match(locales, /modelName: '模型'/);
  assert.match(locales, /modelName: 'Model'/);
  assert.match(locales, /'cognition\.recent\.modelUsage': '模型'/);
  assert.match(locales, /'cognition\.recent\.modelUsage': 'Model'/);
  assert.doesNotMatch(locales, /署名 AI/);
  assert.doesNotMatch(locales, /'Signing AI'/);
});

test('cognition recent activity row drops the research question display; research type carries teal color', async () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'web/src/pages/CognitionCenter.tsx'), 'utf8');

  assert.doesNotMatch(cognition, /item\.research_question/);
  assert.doesNotMatch(cognition, /getFieldLabel\('research_question'/);

  const { getTypeColor } = await import('../../api/services/typeColors.ts');
  assert.equal(getTypeColor('research'), '#14b8a6');
  assert.equal(getTypeColor('no-such-type'), '#6b7280');
});

test('Cognition Spark health and recent activity reuse the fact Card attribution surface', () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'web/src/pages/CognitionCenter.tsx'), 'utf8');

  assert.match(cognition, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.occurredAt\} signature=\{item\.signature\} \/>/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.updatedAt\} signature=\{item\.signature\} \/>/);
});
