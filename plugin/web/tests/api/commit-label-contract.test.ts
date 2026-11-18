import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_COMMIT_SCOPES,
  CURRENT_COMMIT_TYPES,
  getCommitScopeLabel,
  getCommitTypeLabel,
} from '../../src/utils/commitLabels.ts';


function assertEveryTypeHasLabel(token: string): void {
  const typeLabel = getCommitTypeLabel(token, 'zh');
  assert.ok(typeLabel && typeLabel !== token, `每个 current commit type 都必须有中文标签：${token}`);
  assert.ok(getCommitTypeLabel(token, 'en'), `每个 current commit type 都必须有英文标签：${token}`);
}

function assertEveryScopeHasLabel(token: string): void {
  const scopeLabel = getCommitScopeLabel(token, 'zh');
  assert.ok(scopeLabel, `每个 current commit scope 都必须有中文标签：${token}`);
  assert.ok(getCommitScopeLabel(token, 'en'), `每个 current commit scope 都必须有英文标签：${token}`);
}

test('current Web commit labels are a complete closed set with full locale mappings', () => {
  const types = [...CURRENT_COMMIT_TYPES];
  assert.ok(types.length >= 10, 'commit types 闭集应覆盖核心动作集');
  assert.equal(new Set(types).size, types.length, 'commit types 不应有重复');
  assert.ok(types.includes('feat') && types.includes('fix') && types.includes('docs'));

  const scopes = [...CURRENT_COMMIT_SCOPES];
  assert.ok(scopes.length >= 8, 'commit scopes 闭集应覆盖核心范围集');
  assert.equal(new Set(scopes).size, scopes.length, 'commit scopes 不应有重复');
  assert.ok(scopes.includes('report'));
  assert.ok(!scopes.includes('study' as (typeof scopes)[number]), 'v5 不应再保留 study 范围');

  for (const type of types) assertEveryTypeHasLabel(type);
  for (const scope of scopes) assertEveryScopeHasLabel(scope);

  assert.equal(getCommitTypeLabel('merge', 'zh'), '合并提交');
});

test('historical or unknown tokens use raw fallback without becoming current tokens', () => {
  assert.equal(getCommitTypeLabel('spec', 'zh'), 'spec');
  assert.equal(getCommitScopeLabel('researches', 'zh'), 'researches');
  assert.ok(!CURRENT_COMMIT_TYPES.includes('spec' as never));
  assert.ok(!CURRENT_COMMIT_SCOPES.includes('researches' as never));
});
