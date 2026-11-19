import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDefaultSparkHealthAgeFilter } from '../../src/utils/cognitionSparkHealth.ts';

test('Spark health defaults to seven days when a seven-day item exists', () => {
  assert.equal(getDefaultSparkHealthAgeFilter([{ silentDays: 7 }]), '7d');
  assert.equal(getDefaultSparkHealthAgeFilter([{ silentDays: 12 }, { silentDays: 3 }]), '7d');
});

test('Spark health falls back to three days when no seven-day item exists', () => {
  assert.equal(getDefaultSparkHealthAgeFilter([{ silentDays: 3 }]), '3d');
  assert.equal(getDefaultSparkHealthAgeFilter([{ silentDays: 6 }, { silentDays: 2 }]), '3d');
});

test('Spark health falls back to all when no item reaches three days', () => {
  assert.equal(getDefaultSparkHealthAgeFilter([{ silentDays: 2 }]), 'all');
  assert.equal(getDefaultSparkHealthAgeFilter([]), 'all');
});
