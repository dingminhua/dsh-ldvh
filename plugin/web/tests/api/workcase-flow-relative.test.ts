import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relativeDayLabel } from '../../shared/workcaseLifecycle.ts'

const NOW = new Date('2026-09-23T12:00:00Z')

test('相对时间：当天为「今天」，跨天给「N天前」', () => {
  assert.equal(relativeDayLabel(new Date('2026-09-23T01:00:00Z'), NOW), '今天')
  assert.equal(relativeDayLabel(new Date('2026-09-22T12:00:00Z'), NOW), '1天前')
  assert.equal(relativeDayLabel(new Date('2026-09-18T12:00:00Z'), NOW), '5天前')
})

test('相对时间：未来时间不报负数（按「今天」兜底）', () => {
  assert.equal(relativeDayLabel(new Date('2026-09-25T12:00:00Z'), NOW), '今天')
})
