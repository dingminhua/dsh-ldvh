import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';

test('all current fact types remain available to the local reader', () => {
  // 27 号 §7：norm（事实规范）与既有六类同路径——七类事实对象全部可经
  // Web 字段级直读（/api/objects/:type 与 :type/:id）。
  assert.deepEqual(ACTIVE_OBJECT_TYPES, ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm']);
});
