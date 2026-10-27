import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

/**
 * `20 §8`/§12：「`priority` + `serves` + `status` 三条件筛选；**按 `priority`
 * 或时间排序**」。筛选侧早已实现（三联过滤），排序侧此前只有时间两档——
 * 规范要求的一半没有落点。以下用例钉住排序侧的实现与其三条边界。
 */
test('Spark 列表提供按处置次序排序（20 §8/§12「或时间排序」的另一半）', () => {
  const list = read('src/pages/ObjectList.tsx');

  // 1) 排序闭集含 priority 档。
  assert.match(list, /type ObjectListSort = 'updated_desc' \| 'created_desc' \| 'priority_asc'/);
  // 2) 比较器有该分支，且先比 priority 再比时间（同档内仍给出稳定次序）。
  assert.match(list, /if \(sort === 'priority_asc'\) \{/);
  assert.match(list, /sparkPrioritySortRank\(a\.priority\) - sparkPrioritySortRank\(b\.priority\)/);
  // 3) 闭集取值与 API 的筛选口径同源（P0–P3，顺序一致）。
  assert.match(list, /const SPARK_PRIORITY_SORT_ORDER: readonly string\[\] = \['P0', 'P1', 'P2', 'P3'\]/);

  const route = read('api/routes/objects.ts');
  assert.match(route, /const SPARK_PRIORITY_ORDER = \['P0', 'P1', 'P2', 'P3'\] as const/);
});

test('未分档的 Spark 排在已分档之后，不被推定为任何档位（20 §8）', () => {
  const list = read('src/pages/ObjectList.tsx');
  // 20 §8 原文：「未分档的 Spark 与已分档的同等合法……缺失或非法时，排序与筛选
  // 按其缺失处理，**不得代为推定档位**」。故缺失/非法取越界值，与合法档位分开。
  assert.match(list, /return index === -1 \? SPARK_PRIORITY_SORT_ORDER\.length : index/);
  // 注释须写明该纪律（防止后续把缺失默认成 P2 之类的「整齐」做法）。
  assert.match(list, /不得代为推定档位/);
});

test('priority 排序只在 spark 提供（21 §8 WorkCase 闭集无 priority）', () => {
  const list = read('src/pages/ObjectList.tsx');
  // 对无 priority 字段的类型提供「按优先级排序」会让名称与实际不符。
  assert.match(list, /const supportsPrioritySort = currentType === 'spark'/);
  assert.match(list, /supportsPrioritySort && sortParam === 'priority_asc'/);
  // 排序选项按该判据条件渲染，不得无条件加入。
  assert.match(list, /\.\.\.supportsPrioritySort\s*\n?\s*\? \[\{ value: 'priority_asc' as const/);
});
