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
