import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

test('Spark 列表提供按处置次序排序（20 §8/§12「或时间排序」的另一半）', () => {
  const list = read('src/pages/ObjectList.tsx');

  assert.match(list, /type ObjectListSort = 'updated_desc' \| 'created_desc' \| 'priority_asc'/);
  assert.match(list, /if \(sort === 'priority_asc'\) \{/);
  assert.match(list, /sparkPrioritySortRank\(a\.priority\) - sparkPrioritySortRank\(b\.priority\)/);
  assert.match(list, /const SPARK_PRIORITY_SORT_ORDER: readonly string\[\] = \['P0', 'P1', 'P2', 'P3'\]/);

  const route = read('api/routes/objects.ts');
  assert.match(route, /const SPARK_PRIORITY_ORDER = \['P0', 'P1', 'P2', 'P3'\] as const/);
});

test('未分档的 Spark 排在已分档之后，不被推定为任何档位（20 §8）', () => {
  const list = read('src/pages/ObjectList.tsx');
  assert.match(list, /return index === -1 \? SPARK_PRIORITY_SORT_ORDER\.length : index/);
  assert.match(list, /const SPARK_PRIORITY_SORT_ORDER: readonly string\[\] = \['P0', 'P1', 'P2', 'P3'\]/);
});

test('priority 排序只在 spark 提供', () => {
  const list = read('src/pages/ObjectList.tsx');
  assert.match(list, /const supportsPrioritySort = currentType === 'spark'/);
  assert.match(list, /supportsPrioritySort && sortParam === 'priority_asc'/);
  assert.match(list, /\.\.\.supportsPrioritySort\s*\n?\s*\? \[\{ value: 'priority_asc' as const/);
});

test('spark 三行筛选按其余维度联动：每行分项与“全部”用 faceted 池子', () => {
  const route = read('api/routes/objects.ts');
  const list = read('src/pages/ObjectList.tsx');
  const api = read('src/utils/api.ts');

  // 服务端：三行各自按“其它维度已选、本维度未选”的池子计算
  assert.match(route, /const statusPool = unfilteredItems\.filter\(/);
  assert.match(route, /const priorityPool = allItems\.filter\(\(item\) => !serves \|\| sparkServesUid\(item\) === serves\)/);
  assert.match(route, /const servesPool = allItems\.filter\(\(item\) => !priority \|\| item\.priority === priority\)/);
  assert.match(route, /result\.data\.statusDisplayTotal = statusPool\.length/);
  assert.match(route, /result\.data\.priorityTotal = priorityPool\.length/);
  assert.match(route, /result\.data\.servesTotal = servesPool\.length/);
  assert.match(route, /result\.data\.statusTotal = statusItems\.length/, 'statusTotal 仍按未应用状态筛选的池子，供空态判定');

  // 前端：三行分别消费联动 total，状态行 spark 用 statusDisplayTotal
  assert.match(api, /priorityTotal\?: number;/);
  assert.match(api, /servesTotal\?: number;/);
  assert.match(api, /statusDisplayTotal\?: number;/);
  assert.match(list, /setPriorityTotal\(result\.data\?\.priorityTotal \?\? nextItems\.length\)/);
  assert.match(list, /setServesTotal\(result\.data\?\.servesTotal \?\? nextItems\.length\)/);
  assert.match(list, /setStatusDisplayTotal\(result\.data\?\.statusDisplayTotal \?\? nextItems\.length\)/);
  const priorityTag = list.match(/<ObjectPriorityFilter\b[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(priorityTag, /totalCount=\{priorityTotal\}/);
  const servesTag = list.match(/<ObjectServesFilter\b[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(servesTag, /totalCount=\{servesTotal\}/);
  const statusTag = list.match(/<ObjectStatusFilter\b[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(statusTag, /total=\{currentType === 'spark' \? statusDisplayTotal : statusTotal\}/);
});
