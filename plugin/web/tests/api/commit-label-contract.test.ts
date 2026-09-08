import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_COMMIT_SCOPES,
  CURRENT_COMMIT_TYPES,
  getCommitScopeLabel,
  getCommitTypeLabel,
} from '../../src/utils/commitLabels.ts';

// v5 规范载体迁移：commit type/scope 闭集由 `src/utils/commitLabels.ts`（唯一强来源）
// 与其 locale 映射共同承载，不再依赖 v4 归档的 `specs/attachments/03.Att.01-来源参考枚举闭集.md`。
// 以下断言改为从代码模块自洽，验证闭集完整性与 locale 映射的一致性。

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
  // 闭集必须非空且覆盖 v5 核心动作（feat/fix/docs），无重复。
  const types = [...CURRENT_COMMIT_TYPES];
  assert.ok(types.length >= 10, 'commit types 闭集应覆盖核心动作集');
  assert.equal(new Set(types).size, types.length, 'commit types 不应有重复');
  assert.ok(types.includes('feat') && types.includes('fix') && types.includes('docs'));

  const scopes = [...CURRENT_COMMIT_SCOPES];
  assert.ok(scopes.length >= 8, 'commit scopes 闭集应覆盖核心范围集');
  assert.equal(new Set(scopes).size, scopes.length, 'commit scopes 不应有重复');
  // v5 类型系统：research 取代 v4 的 study，作为提交范围承载。
  assert.ok(scopes.includes('research'));
  assert.ok(!scopes.includes('study'), 'v5 不应再保留 study 范围');

  // 每个闭集成员都有中英文标签，且闭集与 locales 提供的标签对照一致。
  for (const type of types) assertEveryTypeHasLabel(type);
  for (const scope of scopes) assertEveryScopeHasLabel(scope);

  // 合并按钮等指令型动作必备标签。
  assert.equal(getCommitTypeLabel('merge', 'zh'), '合并提交');
});

test('historical or unknown tokens use raw fallback without becoming current tokens', () => {
  assert.equal(getCommitTypeLabel('spec', 'zh'), 'spec');
  assert.equal(getCommitScopeLabel('researches', 'zh'), 'researches');
  assert.ok(!CURRENT_COMMIT_TYPES.includes('spec' as never));
  assert.ok(!CURRENT_COMMIT_SCOPES.includes('researches' as never));
});
