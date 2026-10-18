/**
 * 运行时诊断的数据聚合（只读）。
 *
 * ## 为什么读会话日志
 *
 * 「哪条规则最常拦人」这类问题，答案只存在于**工具调用的结果**里——而 LDVH 工具
 * 的每次调用结果都由宿主写进会话日志（`<dshHome>/sessions/<按 cwd 编码的目录>/
 * <sessionId>/session.v4.jsonl.zstd`）。插件自身不落这份账，别处也没有。
 *
 * 这是**有意跨出 LDVH 自身载体**的读取：会话日志属宿主，不属 LDVH 的事实源。
 * 因此本模块只读、只派生、不写回，且在响应里如实带上 `scope`（覆盖了什么、
 * 覆盖不到什么），让页面能把边界说清楚，而不是把局部数据呈现为全局结论。
 *
 * ## 为什么不用 zstd 依赖
 *
 * 会话日志以 zstd 压缩。Web API 子进程跑在宿主的 Node 里，引入原生压缩依赖会
 * 增加安装面与平台差异。这里改为**调用系统 zstd 可执行文件**；找不到时如实降级
 * （`available: false` + 原因），不假装没有数据。
 *
 * ## 数据边界（写进响应的 scope 字段）
 *
 * - 只覆盖**当前管辖项目的工作目录**对应的会话目录；
 * - 只覆盖 `ldvh_*` 前缀的工具；
 * - 会话日志会被宿主按策略清理，历史并不完整。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 宿主会话目录名的编码规则：绝对路径的 `/` 与 `.` 各换成 `-`。
 *
 * 实测（2026-10-18，`~/.dsh/sessions/` 实目录名）：
 * `/Users/dmh2002/DshProject/dsh-ldvh` → `--Users-dmh2002-DshProject-dsh-ldvh--`。
 * 注意前导 `/` 换出的 `-` 与两侧包裹的 `--` **合并计数**，所以结果不是
 * `---...--`（按「包裹 + 替换」字面拼接会多出一个 `-`，`existsSync` 直接落空，
 * 页面表现为「没有数据」而不是「读不到」——这类静默落空正是本页要暴露的东西）。
 */
export function sessionDirNameFor(workspaceRoot: string): string {
  const absolute = path.resolve(workspaceRoot)
  return `--${absolute.replace(/[/.]/g, '-')}--`.replace(/-{3,}/g, '--')
}

/** dsh 用户配置根：插件与 Web 子进程共用 `~/.dsh` 约定。 */
export function dshHomeFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME
  if (configured) return path.resolve(configured)
  const home = env.HOME || env.USERPROFILE || ''
  return path.join(home, '.dsh')
}

export type ToolCallOutcome = {
  tool: string
  /** `completed` / `rejected` / `invalid_request` / `unknown`。 */
  status: string
  /** 命中的错误码（如 `workcase/frontmatter_invalid`），无则为空数组。 */
  codes: string[]
  /** 报错首句（已截断），供逐条记录展示。 */
  detail: string
  /** 调用发生的工作目录，用于说明该条来自哪个项目。 */
  sessionId: string
  at: string | null
}

export type DiagnosticsScope = {
  workspaceRoot: string
  sessionDir: string
  sessionDirExists: boolean
  sessionsScanned: number
  /** 会话日志可读所依赖的 zstd 是否可用。 */
  zstdAvailable: boolean
  /** 覆盖不到的地方——如实列在响应里，避免局部数据被当成全局结论。 */
  limits: string[]
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
  byCategory: { category: string; count: number }[]
  byCode: { code: string; count: number }[]
  recentFailures: ToolCallOutcome[]
}

/** 失败按**性质**归类——比逐个错误码更能回答「该修哪一类」。 */
const FAILURE_CATEGORIES: { category: string; patterns: RegExp[] }[] = [
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
    ],
  },
  {
    category: 'shape_and_concurrency',
    patterns: [
      /missing a line holding exactly/i,
      /must be a valid UUID/i,
      /cas_conflict/,
      /c2_fingerprint_invalidated/,
    ],
  },
]

/** 报错文本里出现的错误码。只认带命名空间的形态，避免把普通单词当错误码。 */
const ERROR_CODE_PATTERN = /\b(validation\/[a-z_]+|workcase\/[a-z0-9_]+|research\/[a-z_]+|pitfall\/[a-z_]+|friction\/[a-z_]+|discovery\/[a-z_]+|pending_queue\/[a-z_]+|watermark\/[a-z_]+|session\/[a-z_]+)\b/g

function classifyFailure(text: string): string {
  for (const { category, patterns } of FAILURE_CATEGORIES) {
    if (patterns.some((pattern) => pattern.test(text))) return category
  }
  return 'other'
}

/** 从 `LDVH <name>: <status>` 头里取状态；取不到记 `unknown`（不假装成功）。 */
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

/** 从一条会话日志里抽出 LDVH 工具的成对 (调用, 结果)。 */
function extractToolOutcomes(raw: string, sessionId: string): ToolCallOutcome[] {
  const pending = new Map<string, ToolCallEvent>()
  const outcomes: ToolCallOutcome[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
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
    // 真实结构（2026-10-18 实测）：callId 在 `data.message.source.callId`，
    // `data.message.toolCallId` 通常同值；`data.toolCallId` 是旧形态的兼容位。
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
    // 报错首句：优先 `gap:` 之后那段（各工具的报错都以此承载原因），否则取开头。
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
  try {
    await execFileAsync('zstd', ['--version'], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

async function decompress(filePath: string): Promise<string> {
  // `-dc` 解压到 stdout；`--no-progress` 避免把进度写进 stderr 干扰诊断。
  const { stdout } = await execFileAsync('zstd', ['-dc', '--no-progress', filePath], {
    timeout: 60_000,
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'buffer',
  })
  return stdout.toString('utf8')
}

/**
 * 会话日志的文件名。宿主用 v4 命名；其余候选只为版本迁移后不静默读不到。
 *
 * 注意顺序与判定：`.zstd` 必须先于同名 `.jsonl`，且是否解压只看**选中的那一个**
 * 文件后缀——按「候选名」判定会让明文分支拿到 `.zstd` 路径（读成二进制垃圾），
 * 按目录探针顺序写反则会让压缩日志整份被跳过。两种写法都表现为「本页没有数据」，
 * 而本页存在的意义正是消灭这类静默落空。
 */
const SESSION_LOG_CANDIDATES = [
  'session.v4.jsonl.zstd',
  'session.v5.jsonl.zstd',
  'session.jsonl.zstd',
  'session.v4.jsonl',
  'session.v5.jsonl',
  'session.jsonl',
]

/** 判定候选是否压缩态（只看实际选中的文件名）。 */
function isCompressedLog(fileName: string): boolean {
  return fileName.endsWith('.zstd')
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
}): Promise<GateReport> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const sessionDir = path.join(dshHome, 'sessions', sessionDirNameFor(options.workspaceRoot))
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
  if (hasZstd && sessionDirExists) {
    for (const session of sessions) {
      try {
        const raw = await readSessionLog(path.join(sessionDir, session))
        if (raw) outcomes.push(...extractToolOutcomes(raw, session))
      } catch {
        // 单个会话读不动不影响其余：降级为「少统计一个会话」，并在 scope 里如实计数。
        continue
      }
    }
  }

  const completed = outcomes.filter((item) => item.status === 'completed')
  const failed = outcomes.filter((item) => item.status !== 'completed')

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

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      workspaceRoot: path.resolve(options.workspaceRoot),
      sessionDir,
      sessionDirExists,
      sessionsScanned: sessions.length,
      zstdAvailable: hasZstd,
      limits,
    },
    totals: { calls: outcomes.length, completed: completed.length, failed: failed.length },
    byTool: Array.from(toolCounts, ([tool, counts]) => ({ tool, ...counts }))
      .sort((a, b) => b.failed - a.failed || b.calls - a.calls),
    byCategory: Array.from(categoryCounts, ([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byCode: Array.from(codeCounts, ([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    recentFailures,
  }
}
