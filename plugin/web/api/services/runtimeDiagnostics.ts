import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

const execFileAsync = promisify(execFile)

export function sessionDirNameFor(workspaceRoot: string): string {
  const absolute = path.resolve(workspaceRoot)
  return `--${absolute.replace(/[\\/]/g, '-').replace(/:/g, '')}--`.replace(/-{3,}/g, '--')
}

export function dshHomeFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME
  if (configured) return path.resolve(configured)
  const home = env.HOME || env.USERPROFILE || ''
  return path.join(home, '.dsh')
}

export type ToolCallOutcome = {
  tool: string
  status: string
  codes: string[]
  detail: string
  sessionId: string
  at: string | null
}

export type DiagnosticsScope = {
  workspaceRoot: string
  sessionDir: string
  sessionDirExists: boolean
  sessionsScanned: number
  sessionsLimited: boolean
  zstdAvailable: boolean
  limits: string[]
  cachedAt?: string
}

export type GateReport = {
  generatedAt: string
  scope: DiagnosticsScope
  totals: {
    calls: number
    completed: number
    failed: number
  }
  byTool: { tool: string; calls: number; completed: number; failed: number }[]
  byStatus: { status: string; count: number }[]
  byCategory: { category: string; count: number }[]
  byCode: { code: string; count: number }[]
  recentFailures: ToolCallOutcome[]
}

const FAILURE_CATEGORIES: { category: string; patterns: RegExp[] }[] = [
  {
    category: 'spec_lookup_miss',
    patterns: [
      /heading_not_found/i,
      /no H[23] heading matches/i,
      /no member candidate carries/i,
      /no public operation declares operation_key/i,
    ],
  },
  {
    category: 'host_param_validation',
    patterns: [
      /^Error: invalid arguments/i,
      /^Error: unknown tool/i,
      /Error: tool call aborted/i,
      /is not a declared property/i,
      /additionalProperties: false/i,
    ],
  },
  {
    category: 'human_gate_pending',
    patterns: [
      /requires an explicit Human confirmation/i,
      /human did not confirm/i,
      /human did not choose an option/i,
      /未决策不是答复/i,
      /requires an explicit Human routing decision/i,
    ],
  },
  {
    category: 'partial_result',
    patterns: [
      /projection truncated at limit/i,
      /do not treat this page as the full set/i,
      /defect line\(s\) in the buffer carrier/i,
      /the read is partial and must not be treated as a complete inventory/i,
    ],
  },
  {
    category: 'business_precondition',
    patterns: [
      /goals_conflict/i,
      /checklist_form_invalid/i,
      /checklist form:/i,
      /failed form checks/i,
    ],
  },
  {
    category: 'missing_arguments',
    patterns: [
      /is required for action/i,
      /is required for CAS/i,
      /required for action=/i,
      /frontmatter_after \(object\)/,
      /frontmatter_draft \(object\)/,
      /result \(\{achieved_scope/,
      /change_summary/,
      /object_uid is required/,
      /summary: required non-empty/,
    ],
  },
  {
    category: 'audit_summary_shape',
    patterns: [/not a verbatim excerpt/i, /600-char/, /conclusion is longer/],
  },
  {
    category: 'carrier_validation',
    patterns: [
      /coherence/i,
      /has no verbatim finding unit/i,
      /section ".+" is missing/i,
      /body_invalid/,
      /frontmatter_invalid/,
      /stopping consistency/i,
      /must NOT carry the generated H1/i,
      /must open with a fixed head/i,
      /block #\d+ starts with/i,
    ],
  },
  {
    category: 'object_not_found',
    patterns: [
      /no member candidate/i,
      /no child record/i,
      /object_not_found/,
      /cannot read object file/,
      /not a subagent registered/i,
      /no candidate carries/i,
      /no carrier in this project matches/i,
      /not a registered fact_type_key/i,
    ],
  },
  {
    category: 'shape_and_concurrency',
    patterns: [
      /missing a line holding exactly/i,
      /must be a valid UUID/i,
      /canonical UUIDv4/i,
      /cas_conflict/,
      /c2_fingerprint_invalidated/,
    ],
  },
]

const ERROR_CODE_PATTERN = /\b(validation\/[a-z_]+|research\/[a-z_]+|pitfall\/[a-z_]+|friction\/[a-z_]+|discovery\/[a-z_]+|pending_queue\/[a-z_]+|watermark\/[a-z_]+|session\/[a-z_]+)\b/g

function classifyFailure(text: string): string {
  for (const { category, patterns } of FAILURE_CATEGORIES) {
    if (patterns.some((pattern) => pattern.test(text))) return category
  }
  return 'other'
}

function statusOf(resultText: string): string {
  const match = /^\s*LDVH [\w-]+: (\S+)/.exec(resultText)
  return match ? match[1] : 'unknown'
}

type RawEvent = { type?: string; time?: number | string; data?: Record<string, unknown> }

type ToolCallEvent = { callId: string; tool: string; at: string | null }

function eventTime(event: RawEvent): string | null {
  const raw = event.time
  if (typeof raw === 'number') return new Date(raw).toISOString()
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  return null
}

function extractToolOutcomes(raw: string, sessionId: string): ToolCallOutcome[] {
  const pending = new Map<string, ToolCallEvent>()
  const outcomes: ToolCallOutcome[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.indexOf('tool/call') === -1 && trimmed.indexOf('tool/result') === -1) continue
    let event: RawEvent
    try {
      event = JSON.parse(trimmed) as RawEvent
    } catch {
      continue
    }
    const data = event.data ?? {}
    const record = data as Record<string, unknown>
    if (event.type === 'tool/call') {
      const name = typeof record.name === 'string' ? record.name : ''
      const callId = typeof record.callId === 'string' ? record.callId : ''
      if (!callId) continue
      pending.set(callId, { callId, tool: name, at: eventTime(event) })
      continue
    }
    if (event.type !== 'tool/result') continue
    const message = (record.message ?? {}) as Record<string, unknown>
    const source = (message.source ?? {}) as Record<string, unknown>
    const callId = typeof record.toolCallId === 'string'
      ? record.toolCallId
      : (typeof message.toolCallId === 'string'
        ? message.toolCallId
        : (typeof source.callId === 'string' ? source.callId : ''))
    const call = callId ? pending.get(callId) : undefined
    if (!call || !call.tool.startsWith('ldvh_')) continue
    const blocks = Array.isArray(message.content) ? message.content : []
    const text = blocks
      .map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string')
        ? (block as { text: string }).text
        : '')
      .join('\n')
    const status = statusOf(text)
    const codes = Array.from(new Set(text.match(ERROR_CODE_PATTERN) ?? []))
    const gapIndex = text.indexOf('gap:')
    const detailSource = gapIndex >= 0 ? text.slice(gapIndex + 4) : text
    outcomes.push({
      tool: call.tool,
      status,
      codes,
      detail: detailSource.trim().slice(0, 400),
      sessionId,
      at: call.at,
    })
  }
  return outcomes
}

async function zstdAvailable(): Promise<boolean> {
  if (typeof (zlib as typeof zlib & { zstdDecompressSync?: unknown }).zstdDecompressSync === 'function') {
    return true
  }
  try {
    await execFileAsync('zstd', ['--version'], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function zstdFrameOffsets(buffer: Buffer): number[] {
  const offsets: number[] = []
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer[i] === 0x28 && buffer[i + 1] === 0xb5 && buffer[i + 2] === 0x2f && buffer[i + 3] === 0xfd) {
      offsets.push(i)
    }
  }
  return offsets
}

async function decompress(filePath: string): Promise<string> {
  const native = (zlib as typeof zlib & {
    zstdDecompressSync?: (input: Buffer) => Buffer
  }).zstdDecompressSync
  if (typeof native === 'function') {
    const buffer = await readFile(filePath)
    const offsets = zstdFrameOffsets(buffer)
    if (offsets.length <= 1) {
      return native(buffer).toString('utf8')
    }
    const chunks: Buffer[] = []
    for (let k = 0; k < offsets.length; k += 1) {
      const start = offsets[k]
      const end = k + 1 < offsets.length ? offsets[k + 1] : buffer.length
      try {
        chunks.push(native(buffer.subarray(start, end)))
      } catch {
        void 0;
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  const { stdout } = await execFileAsync('zstd', ['-dc', '--no-progress', filePath], {
    timeout: 60_000,
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'buffer',
  })
  return stdout.toString('utf8')
}

const SESSION_LOG_CANDIDATES = [
  'session.v4.jsonl.zstd',
  'session.v5.jsonl.zstd',
  'session.jsonl.zstd',
  'session.v4.jsonl',
  'session.v5.jsonl',
  'session.jsonl',
]

function isCompressedLog(fileName: string): boolean {
  return fileName.endsWith('.zstd')
}

const GATE_CACHE_TTL_MS = 30 * 60 * 1000
const gateReportCache = new Map<string, { at: number; value: GateReport }>()

export function invalidateGateReportCache(): void {
  gateReportCache.clear()
}

const SESSION_SCAN_CONCURRENCY = 8
const SESSION_SCAN_LIMIT = 100

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

async function readSessionLog(sessionDir: string): Promise<string | null> {
  for (const name of SESSION_LOG_CANDIDATES) {
    const candidate = path.join(sessionDir, name)
    if (!existsSync(candidate)) continue
    if (isCompressedLog(candidate)) return decompress(candidate)
    return readFile(candidate, 'utf8')
  }
  return null
}

export async function buildGateReport(options: {
  workspaceRoot: string
  dshHome?: string
  noCache?: boolean
}): Promise<GateReport> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const sessionDir = path.join(dshHome, 'sessions', sessionDirNameFor(options.workspaceRoot))

  const cacheKey = sessionDir
  if (options.noCache !== true) {
    const cached = gateReportCache.get(cacheKey)
    if (cached && Date.now() - cached.at < GATE_CACHE_TTL_MS) {
      return {
        ...cached.value,
        scope: { ...cached.value.scope, cachedAt: new Date(cached.at).toISOString() },
      }
    }
  }
  const hasZstd = await zstdAvailable()
  const limits = [
    '只覆盖当前管辖项目工作目录下的会话；其他项目的 LDVH 调用不在本页。',
    '只覆盖会话日志仍保留的时间范围——宿主会按策略清理旧会话。',
    '数据来自宿主会话日志，不是 LDVH 自己落的事实账；它反映调用实况，不构成事实源。',
  ]

  let sessions: string[] = []
  let sessionDirExists = false
  if (existsSync(sessionDir)) {
    sessionDirExists = true
    sessions = (await readdir(sessionDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  }
  if (!hasZstd) limits.push('未找到 zstd 可执行文件，压缩的会话日志无法读取——本页数据为空不代表没有调用。')

  const outcomes: ToolCallOutcome[] = []
  let scannedCount = 0
  if (hasZstd && sessionDirExists) {
    const withLog: { session: string; mtime: number }[] = []
    for (const session of sessions) {
      const dir = path.join(sessionDir, session)
      for (const name of SESSION_LOG_CANDIDATES) {
        const candidate = path.join(dir, name)
        if (!existsSync(candidate)) continue
        try {
          withLog.push({ session, mtime: statSync(candidate).mtimeMs })
        } catch {
          withLog.push({ session, mtime: 0 })
        }
        break
      }
    }
    withLog.sort((a, b) => b.mtime - a.mtime)
    const scanned = withLog.slice(0, SESSION_SCAN_LIMIT)
    if (withLog.length > scanned.length) {
      limits.push(
        `会话数超过 ${SESSION_SCAN_LIMIT}：只扫描最近 ${SESSION_SCAN_LIMIT} 个会话（按日志修改时间取最新），更早的调用不在本页。`,
      )
    }
    const sessionsWithLog = scanned.map((entry) => entry.session)
    scannedCount = sessionsWithLog.length
    const collected = await mapWithConcurrency(sessionsWithLog, SESSION_SCAN_CONCURRENCY, async (session) => {
      const dir = path.join(sessionDir, session)
      try {
        const raw = await readSessionLog(dir)
        if (!raw) return { skipped: false, outcomes: [] }
        return { skipped: false, outcomes: extractToolOutcomes(raw, session) }
      } catch {
        return { skipped: false, outcomes: [] }
      }
    })
    for (const item of collected) {
      if (!item) continue
      outcomes.push(...item.outcomes)
    }
  }

  const completed = outcomes.filter((item) => item.status === 'completed')
  const failed = outcomes.filter((item) => item.status !== 'completed')

  const statusCounts = new Map<string, number>()
  for (const item of outcomes) {
    statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1)
  }

  const toolCounts = new Map<string, { calls: number; completed: number; failed: number }>()
  for (const item of outcomes) {
    const bucket = toolCounts.get(item.tool) ?? { calls: 0, completed: 0, failed: 0 }
    bucket.calls += 1
    if (item.status === 'completed') bucket.completed += 1
    else bucket.failed += 1
    toolCounts.set(item.tool, bucket)
  }

  const categoryCounts = new Map<string, number>()
  const codeCounts = new Map<string, number>()
  for (const item of failed) {
    const category = classifyFailure(item.detail)
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    for (const code of item.codes) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
  }

  const recentFailures = failed
    .slice()
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 60)

  const report: GateReport = {
    generatedAt: new Date().toISOString(),
    scope: {
      workspaceRoot: path.resolve(options.workspaceRoot),
      sessionDir,
      sessionDirExists,
      sessionsScanned: sessions.length,
      sessionsLimited: scannedCount < sessions.length,
      zstdAvailable: hasZstd,
      limits,
    },
    totals: { calls: outcomes.length, completed: completed.length, failed: failed.length },
    byStatus: Array.from(statusCounts, ([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    byTool: Array.from(toolCounts, ([tool, counts]) => ({ tool, ...counts }))
      .sort((a, b) => b.failed - a.failed || b.calls - a.calls),
    byCategory: Array.from(categoryCounts, ([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byCode: Array.from(codeCounts, ([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    recentFailures,
  }
  gateReportCache.set(cacheKey, { at: Date.now(), value: report })
  return report
}


export type ObservationProjection = {
  at: string | null
  anchor: string | null
  phenomenon: string | null
  status: string | null
  group: string | null
}

export type ObservationGroupRow = {
  group: string
  pendingCount: number
  promotionReady: boolean
  firstAt: string | null
  lastAt: string | null
  latestPhenomenon: string | null
}

export type FrictionObservationReport = {
  ok: boolean
  generatedAt: string
  scope: {
    ldvhHome: string
    bufferDir: string
    bufferDirExists: boolean
    files: string[]
    threshold: number
    limits: string[]
  }
  totals: {
    entries: number
    byStatus: { status: string; count: number }[]
    projects: number
  }
  groups: ObservationGroupRow[]
  recent: ObservationProjection[]
}

const OBSERVATION_STATUSES = new Set(['pending', 'promoted', 'discarded', 'evicted'])

const OBSERVATION_THRESHOLD = 3


export type ExperienceBufferProjection = {
  at: string | null
  anchor: string | null
  phenomenon: string | null
  status: string | null
}


export async function buildFrictionObservationReport(options: {
  dshHome?: string
} = {}): Promise<FrictionObservationReport> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const ldvhHome = path.join(dshHome, 'ldvh')
  const bufferDir = path.join(ldvhHome, 'friction-observations')

  const limits: string[] = [
    '摩擦观察是**非事实对象**的本地运行状态（36 §8.8）：不进事实源、无对象身份，故本页不提供「点击进入详情」。',
    '按规范只呈现现象/时间/来源/状态四项；`evidence` 全文与 `promoted_to` 不在呈现面内（36 §8.8 第 2 条）。',
    `阈值 N=${OBSERVATION_THRESHOLD} 固定不可配置；「攒到几分」= 同组 pending 条目数。`,
    '观察材料按管辖项目分文件；本页汇总全部项目。条目保留期 pending 90 天、终态 90 天，容量 200/项目。',
    '本页只读：不写观察载体、不改账本。',
  ]

  let files: string[] = []
  let bufferDirExists = false
  try {
    const names = await readdir(bufferDir)
    files = names.filter((name) => name.endsWith('.jsonl')).sort()
    bufferDirExists = true
  } catch {
    bufferDirExists = false
  }

  type Row = {
    at?: string
    anchor?: string
    phenomenon?: string
    status?: string
    group?: string
  }

  const rows: Row[] = []
  let skippedLines = 0
  for (const name of files) {
    let text = ''
    try {
      text = await readFile(path.join(bufferDir, name), 'utf8')
    } catch {
      skippedLines += 1
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const parsed = JSON.parse(trimmed) as Row
        if (typeof parsed.status === 'string' && !OBSERVATION_STATUSES.has(parsed.status)) {
          skippedLines += 1
          continue
        }
        rows.push(parsed)
      } catch {
        skippedLines += 1
      }
    }
  }

  const statusCounts = new Map<string, number>()
  for (const row of rows) {
    const status = typeof row.status === 'string' ? row.status : 'unknown'
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1)
  }

  const groupMap = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.status !== 'pending') continue
    const group = typeof row.group === 'string' && row.group !== '' ? row.group : '(无组)'
    if (!groupMap.has(group)) groupMap.set(group, [])
    groupMap.get(group)!.push(row)
  }

  const groups: ObservationGroupRow[] = Array.from(groupMap, ([group, entries]) => {
    const times = entries
      .map((entry) => (typeof entry.at === 'string' ? entry.at : null))
      .filter((value): value is string => value !== null)
      .sort()
    const latest = entries
      .slice()
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))[0]
    return {
      group,
      pendingCount: entries.length,
      promotionReady: entries.length >= OBSERVATION_THRESHOLD,
      firstAt: times[0] ?? null,
      lastAt: times[times.length - 1] ?? null,
      latestPhenomenon: typeof latest?.phenomenon === 'string' ? latest.phenomenon : null,
    }
  }).sort((a, b) => b.pendingCount - a.pendingCount || a.group.localeCompare(b.group))

  const recent: ObservationProjection[] = rows
    .slice()
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    .slice(0, 40)
    .map((row) => ({
      at: typeof row.at === 'string' ? row.at : null,
      anchor: typeof row.anchor === 'string' ? row.anchor : null,
      phenomenon: typeof row.phenomenon === 'string' ? row.phenomenon : null,
      status: typeof row.status === 'string' ? row.status : null,
      group: typeof row.group === 'string' ? row.group : null,
    }))

  if (skippedLines > 0) {
    limits.push(`另有 ${skippedLines} 行无法解析或状态在闭集外，已跳过并如实计数（不伪装成「本来就没有」）。`)
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: {
      ldvhHome,
      bufferDir,
      bufferDirExists,
      files,
      threshold: OBSERVATION_THRESHOLD,
      limits,
    },
    totals: {
      entries: rows.length,
      byStatus: Array.from(statusCounts, ([status, count]) => ({ status, count })).sort(
        (a, b) => b.count - a.count,
      ),
      projects: files.length,
    },
    groups,
    recent,
  }
}
