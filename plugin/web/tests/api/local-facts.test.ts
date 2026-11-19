import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';

test('all current fact types remain available to the local reader', () => {
  assert.deepEqual(ACTIVE_OBJECT_TYPES, ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal']);
});
