import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';

test('all current fact types remain available to the local reader', () => {
  assert.deepEqual(ACTIVE_OBJECT_TYPES, ['workcase', 'adr', 'pitfall', 'spark', 'study']);
});
