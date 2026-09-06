/**
 * 相对时间计算工具
 */

import { compareRfc3339Timestamps, parseRfc3339Timestamp } from '../../shared/timestamp.ts'

/** 纯日期格式 YYYY-MM-DD */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Compare RFC 3339 instants without losing sub-millisecond precision. */
export function compareTimestamps(left?: string | null, right?: string | null): number {
  return compareRfc3339Timestamps(left, right)
}

export function parseTimestamp(value: string): number {
  const parsed = parseRfc3339Timestamp(value)
  if (!parsed) return Number.NaN
  const milliseconds = `${parsed.fraction}000`.slice(0, 3)
  return Number(parsed.utcSecond) * 1000 + Number(milliseconds || '0')
}

export function getRelativeTime(dateStr: string, locale: string = 'zh'): string {
  // 纯日期字符串（如 "2026-06-05"）追加 T00:00:00 强制按本地时区解析，
  // 避免 ECMAScript 规范将纯日期解析为 UTC 午夜导致跨时区偏差
  const normalized = DATE_ONLY_RE.test(dateStr) ? `${dateStr}T00:00:00` : dateStr
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return locale === 'en' ? 'unknown time' : '未知时间'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  // Never disguise future source data as a recent past event.  Keep the
  // instant intact and make the clock/data anomaly visible to the reader.
  if (diffMs < 0) {
    const futureSec = Math.ceil(-diffMs / 1000)
    const futureMin = Math.ceil(futureSec / 60)
    const futureHour = Math.ceil(futureMin / 60)
    const futureDay = Math.ceil(futureHour / 24)
    if (locale === 'en') {
      if (futureDay > 0) return `in ${futureDay}d`
      if (futureHour > 0) return `in ${futureHour}h`
      return `in ${Math.max(1, futureMin)}m`
    }
    if (futureDay > 0) return `${futureDay}天后`
    if (futureHour > 0) return `${futureHour}小时后`
    return `${Math.max(1, futureMin)}分钟后`
  }

  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  const isEn = locale === 'en'

  if (diffYear > 0) {
    return isEn ? `${diffYear}y ago` : `${diffYear}年前`
  }
  if (diffMonth > 0) {
    return isEn ? `${diffMonth}mo ago` : `${diffMonth}个月前`
  }
  if (diffWeek > 0) {
    return isEn ? `${diffWeek}w ago` : `${diffWeek}周前`
  }
  if (diffDay > 0) {
    return isEn ? `${diffDay}d ago` : `${diffDay}天前`
  }
  if (diffHour > 0) {
    return isEn ? `${diffHour}h ago` : `${diffHour}小时前`
  }
  // 小于1小时也显示为分钟，最小1分钟前
  const min = Math.max(1, diffMin)
  return isEn ? `${min}m ago` : `${min}分钟前`
}
