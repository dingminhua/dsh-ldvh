import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLatestFactChangeSignature } from '../../src/utils/factChangeLog';
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

test('all fact Cards reuse the shared update and update-log attribution surface', () => {
  const list = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectList.tsx'), 'utf8');
  const facts = readFileSync(path.join(repositoryRoot, 'web/api/services/facts.ts'), 'utf8');

  assert.match(list, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(list, /<ObjectUpdatedMeta source=\{obj\} updatedAt=\{obj\.updated\} \/>/);
  assert.match(list, /flex min-w-0 items-center justify-end pt-0\.5 text-right/);
  assert.doesNotMatch(list, /formatDateTime\(obj\.updated\)/);
  assert.match(facts, /copyPresentFields\(source, \['change_log'\]\)/);
});

test('Cognition Spark health and recent activity reuse the fact Card attribution surface', () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'web/src/pages/CognitionCenter.tsx'), 'utf8');

  assert.match(cognition, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.occurredAt\} signature=\{item\.signature\} \/>/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.updatedAt\} signature=\{item\.signature\} \/>/);
});
