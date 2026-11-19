import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeTimestamp } from '../../api/services/git.ts'
import { compareTimestamps, getRelativeTime, parseTimestamp } from '../../api/services/time.ts'
import { formatDateTime } from '../../src/utils/dateFormat.ts'

test('legacy offset and canonical UTC timestamps represent the same instant', () => {
  const legacy = '2026-08-09T13:45:09.272+08:00'
  const canonical = '2026-08-09T05:45:09.272Z'

  assert.equal(parseTimestamp(legacy), parseTimestamp(canonical))
  assert.equal(formatDateTime(legacy), formatDateTime(canonical))
  assert.equal(normalizeTimestamp(legacy), '2026-08-09T05:45:09.272Z')
  assert.equal(normalizeTimestamp('2026-08-09 13:45:09 +0800'), '2026-08-09T05:45:09Z')
  assert.equal(
    normalizeTimestamp('2026-08-09T13:45:09.2721234+08:00'),
    '2026-08-09T05:45:09.2721234Z',
  )
})

test('Git offset timestamps display as local time without the offset suffix', () => {
  const value = '2026-08-09 17:11:30 +0800'
  const instant = new Date('2026-08-09T17:11:30+08:00')
  const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')} ${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`

  assert.equal(formatDateTime(value), expected)
  assert.doesNotMatch(formatDateTime(value), /[+-]\d{4}$/)
})

test('date-only values remain date-only while complete instants use local display fields', () => {
  assert.equal(formatDateTime('2026-08-09'), '2026-08-09')

  const instant = new Date('2026-08-09T05:45:09.272Z')
  const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')} ${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
  assert.equal(formatDateTime('2026-08-09T05:45:09.272Z'), expected)
})

test('future timestamps are explicitly shown as future', () => {
  const resultZh = getRelativeTime('2099-01-01T00:00:00Z', 'zh')
  const resultEn = getRelativeTime('2099-01-01T00:00:00Z', 'en')

  assert.match(resultZh, /后$/)
  assert.match(resultEn, /^in /)
  assert.doesNotMatch(resultZh, /前/)
  assert.doesNotMatch(resultEn, /ago$/)
})

test('relative time exposes invalid values instead of rendering NaN', () => {
  assert.equal(getRelativeTime('not-a-time', 'zh'), '未知时间')
  assert.equal(getRelativeTime('not-a-time', 'en'), 'unknown time')
})

test('sorting preserves instant order beyond JavaScript millisecond precision', () => {
  assert.equal(compareTimestamps('2026-08-09T05:45:09.0000001Z', '2026-08-09T05:45:09.0000002Z'), -1)
  assert.equal(compareTimestamps('2026-08-09T13:45:09.272+08:00', '2026-08-09T05:45:09.272Z'), 0)
})
