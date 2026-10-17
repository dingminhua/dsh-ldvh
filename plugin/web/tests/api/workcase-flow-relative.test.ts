import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relativeDayLabel } from '../../shared/workcaseLifecycle.ts'

const NOW = new Date('2026-09-23T12:00:00Z')

test('相对时间：当天为「今天」，前一天为「昨天」，更早给「N天前」', () => {
  assert.equal(relativeDayLabel(new Date('2026-09-23T01:00:00Z'), NOW), '今天')
  assert.equal(relativeDayLabel(new Date('2026-09-22T12:00:00Z'), NOW), '昨天')
  assert.equal(relativeDayLabel(new Date('2026-09-18T12:00:00Z'), NOW), '5天前')
})

test('相对时间：未来时间不报负数（按「今天」兜底）', () => {
  assert.equal(relativeDayLabel(new Date('2026-09-25T12:00:00Z'), NOW), '今天')
})

// ---------------------------------------------------------------------------
// 跨天但不足 24 小时 —— 2026-10-17 修复的回归钉
//
// 原实现按「经过的完整 24 小时」算（floor(ms/86400000)），故「昨天傍晚 → 今天上午」
// 这种最常见的查看时刻会被判成「今天」，且**每个上午都会必然出现**。
// Human 2026-10-17 以截图指出：2026-10-16 21:54 的条目在 2026-10-17 10:21 显示「今天」。
//
// 判据：标签必须与「按天分组」同口径——两个时刻落在同一本地日历日才是「今天」。
// ---------------------------------------------------------------------------

test('相对时间：跨天但不足 24 小时，必须判为「昨天」（不是「今天」）', () => {
  const viewedAt = new Date('2026-10-17T10:21:00+08:00')
  const entryAt = new Date('2026-10-16T21:54:00+08:00')
  // 前置：两者确实不足 24 小时（只差约 12.5 小时）——这正是原实现出错的条件
  assert.ok(viewedAt.getTime() - entryAt.getTime() < 86_400_000)
  assert.equal(relativeDayLabel(entryAt, viewedAt), '昨天')
})

test('相对时间：同日但相隔近 24 小时仍是「今天」', () => {
  // 00:10 与 23:50 相差 23.7 小时，但同属一个日历日
  const early = new Date('2026-10-17T00:10:00+08:00')
  const late = new Date('2026-10-17T23:50:00+08:00')
  assert.equal(relativeDayLabel(early, late), '今天')
})

test('相对时间：相差 2 天但不足 48 小时，判为「2天前」而非「1天前」', () => {
  const viewedAt = new Date('2026-10-17T10:00:00+08:00')
  const entryAt = new Date('2026-10-15T23:00:00+08:00') // 日历日差 = 2，毫秒差 = 35 小时
  assert.ok(viewedAt.getTime() - entryAt.getTime() < 2 * 86_400_000)
  assert.equal(relativeDayLabel(entryAt, viewedAt), '2天前')
})
