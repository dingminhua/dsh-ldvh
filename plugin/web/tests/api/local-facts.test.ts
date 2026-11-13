import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';

test('all current fact types remain available to the local reader', () => {
  // 27 号 §7：norm（事实规范）与既有六类同路径；28 号 §7：subgoal（子目标）
  // 同路径；29 号 §7：devlog（开发日志）落 ldvh-base/devlogs/——九类事实对象
  // 全部可经 Web 字段级直读（/api/objects/:type 与 :type/:id）。
  //
  // 本数组的顺序是**类型值域**，不是呈现次序：devlog 在侧栏排在对象族末位
  //（``Sidebar.tsx`` 的 NAV_ITEMS 承担），两处不互相推演。
  assert.deepEqual(ACTIVE_OBJECT_TYPES, ['adr', 'pitfall', 'spark', 'research', 'friction', 'norm', 'subgoal', 'devlog']);
});
