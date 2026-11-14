import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';

test('all current fact types remain available to the local reader', () => {
  // 27 号 §7：norm（事实规范）与既有六类同路径；28 号 §7：subgoal（子目标）
  // 同路径。29 号 DevLog 已于 2026-11-14 撤除（原九类，现八类）。
  // 全部可经 Web 字段级直读（/api/objects/:type 与 :type/:id）。
  //
  // 本数组的顺序是**类型值域**，不是呈现次序
  //（``Sidebar.tsx`` 的 NAV_ITEMS 承担），两处不互相推演。
  assert.deepEqual(ACTIVE_OBJECT_TYPES, ['adr', 'pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal']);
});
