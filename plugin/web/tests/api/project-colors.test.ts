/**
 * 项目色彩标识体系契约测试（全部管辖计划 Step 2）。
 *
 * 覆盖：色板键名闭集、哈希兜底的确定性（同 ID 永远同色、无环境依赖）、
 * 显式选择优先于哈希、CSS 变量名推导——「项目色是第三正交维度」的机械边界。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROJECT_COLOR_KEYS,
  hashProjectColorKey,
  isProjectColorKey,
  projectColorVar,
  resolvedProjectColorKey,
} from '../../shared/projectColors.ts';

test('palette is a closed, non-empty, unique set of keys', () => {
  assert.ok(PROJECT_COLOR_KEYS.length >= 8, 'palette should have at least 8 colors');
  assert.equal(new Set(PROJECT_COLOR_KEYS).size, PROJECT_COLOR_KEYS.length, 'palette keys must be unique');
  for (const key of PROJECT_COLOR_KEYS) {
    assert.match(key, /^[a-z]+$/, `palette key must be a plain lowercase word: ${key}`);
  }
});

test('isProjectColorKey accepts only closed-set members', () => {
  assert.equal(isProjectColorKey('emerald'), true);
  assert.equal(isProjectColorKey('hot-pink'), false);
  assert.equal(isProjectColorKey(''), false);
  assert.equal(isProjectColorKey(undefined), false);
  assert.equal(isProjectColorKey(42), false);
});

test('hash fallback is deterministic per project id and covers the palette', () => {
  // 同一 ID 永远同色
  assert.equal(hashProjectColorKey('dsh-ldvh'), hashProjectColorKey('dsh-ldvh'));
  assert.equal(hashProjectColorKey('poker-train-card'), hashProjectColorKey('poker-train-card'));
  // 不同 ID 分布到闭集内的多个键（覆盖率抽查）
  const keys = new Set(['dsh-ldvh', 'poker-train-card', 'poker-train-video', 'a', 'b', 'c', 'd', 'e'].map((id) => hashProjectColorKey(id)));
  assert.ok(keys.size >= 3, 'hash should spread across the palette');
  for (const key of keys) assert.ok((PROJECT_COLOR_KEYS as readonly string[]).includes(key));
  // 空串也稳定（不抛异常）
  assert.ok((PROJECT_COLOR_KEYS as readonly string[]).includes(hashProjectColorKey('')));
});

test('resolvedProjectColorKey prefers explicit choice and falls back to hash', () => {
  assert.equal(resolvedProjectColorKey('rose', 'dsh-ldvh'), 'rose');
  assert.equal(resolvedProjectColorKey(undefined, 'dsh-ldvh'), hashProjectColorKey('dsh-ldvh'));
  assert.equal(resolvedProjectColorKey('hot-pink', 'dsh-ldvh'), hashProjectColorKey('dsh-ldvh'), 'invalid explicit value falls back to hash');
});

test('projectColorVar maps to the ldvh-pj CSS custom property namespace', () => {
  assert.equal(projectColorVar('emerald'), 'var(--ldvh-pj-emerald)');
  assert.equal(projectColorVar('fuchsia'), 'var(--ldvh-pj-fuchsia)');
});
