import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeTimestamp } from '../../api/services/git.ts'
import { formatDateTime } from '../../src/utils/dateFormat.ts'

test('Git offset timestamps normalize to UTC without losing their instant', () => {
  assert.equal(normalizeTimestamp('2026-08-09 13:45:09 +0800'), '2026-08-09T05:45:09Z')
})

test('Git offset timestamps display as local time without the offset suffix', () => {
  const value = '2026-08-09 17:11:30 +0800'
  const instant = new Date('2026-08-09T17:11:30+08:00')
  const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')} ${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`

  assert.equal(formatDateTime(value), expected)
  assert.doesNotMatch(formatDateTime(value), /[+-]\d{4}$/)
})
