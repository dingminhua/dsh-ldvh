import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listLocalFacts, readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts';
import { listObjects } from '../../api/services/facts.ts';


async function withScope(run: (scope: LocalFactScope, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-empty-type-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    await run(scope, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('目录缺失按零对象处理：不再报 type_not_integrated', async () => {
  await withScope(async (scope) => {
    const listed = await listLocalFacts('subgoal', scope);
    assert.equal(listed.status, 'complete', '目录缺失应报 complete（零对象），不是 type_not_integrated');
    assert.deepEqual(listed.items, []);
    assert.deepEqual(listed.issues, [], '零对象不是覆盖问题，不得带 issue');
  });
});

test('目录缺失与空目录给出同一结果（判据不是目录是否存在）', async () => {
  await withScope(async (scope, root) => {
    const missing = await listLocalFacts('subgoal', scope);
    await mkdir(path.join(root, 'ldvh-base', 'subgoals'), { recursive: true });
    const empty = await listLocalFacts('subgoal', scope);
    assert.deepEqual(empty, missing);
  });
});

test('精确读取缺失目录中的 id 返回 not_found 且带回 canonical_path', async () => {
  await withScope(async (scope) => {
    const detail = await readLocalFact('subgoal', 'subgoal-11111111-2222-4333-8444-555555555555', scope);
    assert.equal(detail.status, 'not_found', '目录缺失时的精确读取是「没有这个对象」，不是「类型未接入」');
    assert.equal(detail.metadata.canonical_path, 'ldvh-base/subgoals/subgoal-11111111-2222-4333-8444-555555555555.md');
  });
});

test('列表投影：目录缺失的类型返回 complete + 空列表 + 无覆盖问题', async () => {
  await withScope(async (scope) => {
    const listed = await listObjects('subgoal', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    assert.equal(listed.data.coverage_status, 'complete');
    assert.deepEqual(listed.data.items, []);
    assert.deepEqual(listed.data.collection_issues, []);
    assert.deepEqual(listed.issues, [], '零对象不得产出任何 issue（否则列表页会挂覆盖警示条）');
    assert.equal(listed.summary.count, 0);
  });
});

test('空态文案分两句，且类型名经 getTypeLabel 本地化（不露原始类型键）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh;
  const en = UI_LOCALES.en;

  const noObjectsZh: string = zh['objectList.noObjects'];
  const noObjectsUnderFilterZh: string = zh['objectList.noObjectsUnderFilter'];
  const noObjectsEn: string = en['objectList.noObjects'];
  const noObjectsUnderFilterEn: string = en['objectList.noObjectsUnderFilter'];
  assert.ok(noObjectsZh, 'noObjects 必须存在');
  assert.ok(noObjectsUnderFilterZh, 'noObjectsUnderFilter 必须存在');
  assert.notEqual(
    noObjectsZh,
    noObjectsUnderFilterZh,
    '两句必须可区分——相同就退回了原来那一句',
  );
  assert.notEqual(
    noObjectsEn,
    noObjectsUnderFilterEn,
    '两句必须可区分（en）——相同就退回了原来那一句',
  );
  assert.match(zh['objectList.noObjects'], /\{type\}/);
  assert.match(zh['objectList.noObjectsUnderFilter'], /\{type\}/);
});

test('空态分支用 statusTotal 区分「本来没有」与「筛选没命中」，且类型名走本地化', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const emptyState = source.slice(
    source.indexOf('filteredItems.length === 0 ? ('),
    source.indexOf('<div className="ldvh-section-grid">'),
  );
  assert.ok(emptyState.length > 0, '空态分支应可定位');
  assert.match(emptyState, /statusTotal === 0/, '「本来就没有」必须由 statusTotal 判定');
  assert.match(emptyState, /objectList\.noObjects'/, '零对象走 noObjects');
  assert.match(emptyState, /objectList\.noObjectsUnderFilter'/, '筛选为空走 noObjectsUnderFilter');
  assert.match(emptyState, /getTypeLabel\(currentType, locale\)/);
  assert.doesNotMatch(emptyState, /type: currentType\s*\}\)/, '不得再把原始类型键当类型名传入');
});
