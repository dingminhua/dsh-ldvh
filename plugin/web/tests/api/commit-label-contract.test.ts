import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import {
  CURRENT_COMMIT_SCOPES,
  CURRENT_COMMIT_TYPES,
  getCommitScopeLabel,
  getCommitTypeLabel,
} from '../../src/utils/commitLabels.ts';

// v4 迁移适配：specs 根可用 LDVH_SPEC_ROOT 覆盖（默认保持 v4 布局的相对推算）。
const projectRoot = process.env.LDVH_SPEC_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(
  path.join(projectRoot, 'specs/attachments/03.Att.01-来源参考枚举闭集.md'),
  'utf8',
);

function tableTokens(header: 'type' | 'scope'): string[] {
  const pattern = new RegExp(
    `\\| ${header} \\| 语义 \\|\\n\\|---\\|---\\|\\n((?:\\|.*\\|\\n)+)`,
  );
  const match = source.match(pattern);
  assert.ok(match, `${header} table must exist in 03.Att.01`);
  return match[1]
    .trim()
    .split('\n')
    .map((line) => line.split('|')[1].trim().replace(/`/g, ''));
}

test('current Web commit labels stay synchronized with 03.Att.01 tables modulo the v5 research rename', () => {
  // v5 类型系统（24 号）：study → research。03.Att.01 仍是 v4 归档原文（study），
  // Web 枚举按 v5 演进——同步断言改为「除该更名外逐项一致」。
  const expectedTypes = tableTokens('type').map((token) => (token === 'study' ? 'research' : token));
  const expectedScopes = tableTokens('scope').map((token) => (token === 'study' ? 'research' : token));
  assert.deepEqual([...CURRENT_COMMIT_TYPES], expectedTypes);
  assert.deepEqual([...CURRENT_COMMIT_SCOPES], expectedScopes);
  assert.equal(getCommitTypeLabel('merge', 'zh'), '合并提交');
});

test('historical or unknown tokens use raw fallback without becoming current tokens', () => {
  assert.equal(getCommitTypeLabel('spec', 'zh'), 'spec');
  assert.equal(getCommitScopeLabel('researches', 'zh'), 'researches');
  assert.ok(!CURRENT_COMMIT_TYPES.includes('spec' as never));
  assert.ok(!CURRENT_COMMIT_SCOPES.includes('researches' as never));
});
