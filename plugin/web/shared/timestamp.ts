const RFC3339_RE = /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])T(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d)(?:\.(?<fraction>\d+))?(?<offset>Z|(?<offsetSign>[+-])(?<offsetHour>[01]\d|2[0-3]):(?<offsetMinute>[0-5]\d))$/
const GIT_OFFSET_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*([+-]\d{2})(\d{2})$/

export interface Rfc3339Timestamp {
  utcSecond: bigint
  fraction: string
}

/** Convert Git's offset-bearing display form to an RFC 3339 input. */
export function normalizeGitTimestampInput(value: string): string {
  const match = GIT_OFFSET_TIMESTAMP_RE.exec(value.trim())
  if (!match) return value
  return `${match[1]}T${match[2]}${match[3]}:${match[4]}`
}

/** Parse LDVH's complete RFC 3339 instant form without truncating fractions. */
export function parseRfc3339Timestamp(value: string): Rfc3339Timestamp | null {
  const match = RFC3339_RE.exec(value)
  if (!match?.groups || match.groups.offset === '-00:00') return null
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  const second = Number(match.groups.second)
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, 0)
  if (
    local.getUTCFullYear() !== year
    || local.getUTCMonth() !== month - 1
    || local.getUTCDate() !== day
  ) return null
  let offsetSecond = 0
  if (match.groups.offset !== 'Z') {
    offsetSecond = Number(match.groups.offsetHour) * 3600 + Number(match.groups.offsetMinute) * 60
    if (match.groups.offsetSign === '-') offsetSecond = -offsetSecond
  }
  return {
    utcSecond: BigInt(local.getTime() / 1000) - BigInt(offsetSecond),
    fraction: (match.groups.fraction ?? '').replace(/0+$/, ''),
  }
}

/** Render a complete RFC 3339 instant in canonical UTC form without dropping fractions. */
export function canonicalizeRfc3339Timestamp(value: string): string | null {
  const parsed = parseRfc3339Timestamp(value)
  if (!parsed) return null
  const date = new Date(Number(parsed.utcSecond) * 1000)
  const rendered = [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
  const time = [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ].join(':')
  return `${rendered}T${time}${parsed.fraction ? `.${parsed.fraction}` : ''}Z`
}

/** Compare complete RFC 3339 instants without losing sub-millisecond precision. */
export function compareRfc3339Timestamps(left?: string | null, right?: string | null): number {
  const a = typeof left === 'string' ? parseRfc3339Timestamp(left) : null
  const b = typeof right === 'string' ? parseRfc3339Timestamp(right) : null
  if (a && b) {
    if (a.utcSecond !== b.utcSecond) return a.utcSecond < b.utcSecond ? -1 : 1
    const width = Math.max(a.fraction.length, b.fraction.length)
    const aFraction = a.fraction.padEnd(width, '0')
    const bFraction = b.fraction.padEnd(width, '0')
    if (aFraction !== bFraction) return aFraction < bFraction ? -1 : 1
    return 0
  }
  if (a) return -1
  if (b) return 1
  return 0
}
