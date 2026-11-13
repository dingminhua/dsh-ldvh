import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listLocalFacts, readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts';
import { listObjects } from '../../api/services/facts.ts';

/**
 * 空事实类型的呈现契约（Human 定案 2026-11-02）。
 *
 * ## 立此契约的由来
 *
 * 2026-11-02 Human 同时看到两屏「都没有数据」的页面，却给出两套话：
 *
 * - 开发日志（本仓还没有任何一条 DevLog，`ldvh-base/devlogs/` 尚未被 writer 建出）
 *   → 琥珀警示「该事实类型尚未接入」+ 正文空态同一句；
 * - 规范 · 已退役筛选（2 条 active 规范在，但都不匹配该筛选）
 *   → 「未找到 norm 对象」。
 *
 * Human 的追问是「都是没有数据，为什么显示不一样」。查下来判据并不是「有没有数据」，
 * 而是**目录在不在**（`existsSync`）；实测反证：临时 `mkdir ldvh-base/devlogs` 后同一个
 * 请求立刻变成 `coverage_status: complete` + `items: []`。
 *
 * ## 本契约守什么
 *
 * 1. **目录缺失 = 零对象**，不是「类型未接入」。读取层不得再因此产出
 *    `status: 'type_not_integrated'`。
 * 2. **空目录与目录缺失给出同一结果**——区分它们只是把实现细节再泄漏一次。
 * 3. **精确读取缺失目录中的 id** 返回 `not_found`（不再是 `type_not_integrated`），
 *    并照样带回 `canonical_path`，读者据此能看出目录还没建过。
 * 4. **空态文案分两句且类型名已本地化**：`noObjects`（本来就没有）与
 *    `noObjectsUnderFilter`（筛选没命中）判据是 `statusTotal`，不是 `items.length`。
 *
 * ## 不保证什么（如实声明）
 *
 * - 这是**口径与形态断言**，不证明任何具体页面在真机上的视觉；实拍另见 docs/11。
 * - `coverage_status: 'type_not_integrated'` 这个投影值**仍在**前端契约里
 *   （`FactCoverageStatus`、三个筛选器的 `—` 计数、列表页的覆盖警示分支）。本契约只锁
 *   「后台不再因目录缺失产出它」，不锁「它永远不出现」——未来若真出现「有目录契约但无
 *   读取支持」的类型，它就是正确答案。
 */

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
    // subgoals 目录在临时根下根本没建（本契约对任何登记类型同形；2026-11-14
    // 原例 devlog 已随 29 号类型撤除，改用 subgoal 承载同一断言）。
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
    // 逐字段相等：若将来有人在其中一条路径上加「这条目录不存在」之类的说明，
    // 这个断言会立刻红——那正是本次要消除的分歧。
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

  // 两句都必须存在且语义不同，中英各一。
  //
  // 比较前收成 `string`：词表是 `as const` 的，两个字面量在类型层已确定互不相等，
  // 直接比较会被 TS 判成「无重叠因而很可能写错了」。这里要验的恰是**值**不同，
  // 而值一旦被改成同一句，类型也会跟着变——故对 `string` 断言才验得动。
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
  // 中文两句都必须带 {type} 占位（否则「还没有对象」不带类型，读者不知道在说哪类）。
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
  // 判据必须是 statusTotal（服务端按**未应用状态筛选**的池子计数）。
  // 用 items.length 会把「筛选后为空」误报成「本来没有」——那正是本次要修的两句话之一。
  assert.match(emptyState, /statusTotal === 0/, '「本来就没有」必须由 statusTotal 判定');
  assert.match(emptyState, /objectList\.noObjects'/, '零对象走 noObjects');
  assert.match(emptyState, /objectList\.noObjectsUnderFilter'/, '筛选为空走 noObjectsUnderFilter');
  // 类型名必须经 getTypeLabel 本地化：此前直接塞 currentType，中文界面里露出 norm/devlog。
  assert.match(emptyState, /getTypeLabel\(currentType, locale\)/);
  assert.doesNotMatch(emptyState, /type: currentType\s*\}\)/, '不得再把原始类型键当类型名传入');
});
