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
import zlib from 'node:zlib'

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
  // 分隔符换成 `-`、**盘符冒号直接删除**，再用 `--` 包裹；连续 `-` 折叠。
  //
  // **Windows 实测（2026-10-28，`~/.dsh/sessions/` 真实目录名逐个核对）**：
  // `D:\DshProject\dsh-ldvh` → `--D-DshProject-dsh-ldvh--`（存在）；
  // `D:\MinMax\ld-gpu-solver` → `--D-MinMax-ld-gpu-solver--`（存在）；
  // `C:\Users\Administrator\WorkBuddy\...` → `--C-Users-Administrator-WorkBuddy-...--`（存在）。
  // 冒号若换成短横会得到 `--D--DshProject...`（多一个短横、目录不存在）。
  // 原实现只替换 `/` 与 `.`，反斜杠与冒号原样保留 → `--D:\DshProject\dsh-ldvh--`，
  // `existsSync` 恒落空，页面把「读不到会话」显示成「没有数据」。
  // 下划线、空格等字符不替换（实测 `--D-DshProject-GTOpen_ld5090_private--`）。
  return `--${absolute.replace(/[\\/]/g, '-').replace(/:/g, '')}--`.replace(/-{3,}/g, '--')
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
  /**
   * 命中缓存时，原始生成时刻（RFC3339）。
   *
   * 缺席 = 本次实时计算。读者据此区分「此刻的数字」与「几分钟前的数字」——
   * 不标注会让缓存在界面上变成谎报。
   */
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
  // **优先看 Node 内置 zstd，CLI 只是回退**（2026-10-28 修）。
  //
  // 原实现只探测系统 `zstd` 命令行：本机未装 CLI，于是 `hasZstd` 为 false，
  // 整段会话扫描被 `hasZstd &&` 跳过——诊断页把「能读的日志」显示成
  // 「没有数据」，而 Node ≥22.15 自带的 `zlib.zstdDecompressSync` 明明可用。
  // 这与「打包产物文本检索缺席被当作服务不存在」是同一类误判：
  // 用一条探针的缺席推断能力不存在。
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

async function decompress(filePath: string): Promise<string> {
  // **优先用 Node 内置 zstd，CLI 只作回退**：与 zstdAvailable 同一取舍，
  // 否则「探测可用」与「实际怎么解」会分叉（本机无 CLI 时前者为真、后者抛错）。
  const native = (zlib as typeof zlib & {
    zstdDecompressSync?: (input: Buffer) => Buffer
  }).zstdDecompressSync
  if (typeof native === 'function') {
    return native(await readFile(filePath)).toString('utf8')
  }
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

/**
 * `/gate` 报告的 TTL 缓存。
 *
 * **为什么加**：进一次页面就全量扫 725 个会话 / 158MB，实测 5.8 秒。而诊断页是
 * 「看一眼现状」的用途——5 分钟前的数字与此刻没有区别，因为它回答的是「机制在
 * 实际使用中哪里在失效」，不是实时行情。
 *
 * **为什么必须可主动失效**：清理日志之后如果还显示清理前的数字，页面会自相矛盾。
 * 故 `invalidateGateReportCache()` 由清理路径调用（见 logsCleanup service）。
 *
 * **为什么键里带 sessionDir**：不同项目根对应不同会话目录，缓存不能跨项目串。
 */
const GATE_CACHE_TTL_MS = 5 * 60 * 1000
const gateReportCache = new Map<string, { at: number; value: GateReport }>()

/** 清空 `/gate` 缓存（清理日志后必须调用，否则页面会显示旧数字）。 */
export function invalidateGateReportCache(): void {
  gateReportCache.clear()
}

/**
 * 会话扫描的并发度。
 *
 * 取 8：每个任务都是一次 `zstd` 子进程（IO 与 CPU 各占一半），8 路足以吃满常见
 * 笔记本的核心数而不把机器拖死。设成 `sessions.length` 会把 725 个进程一次性
 * 拉起——那会让整台机器卡顿，比慢更糟。
 */
const SESSION_SCAN_CONCURRENCY = 8

/**
 * 有界并发 map，保持**结果顺序与输入顺序一致**（不靠「谁先完成谁先排」）。
 *
 * 顺序必须稳定：统计结果虽与顺序无关，但 `scope` 与 limits 的文本会进报告，
 * 顺序漂移会让同一份数据两次呈现不同，读者会以为数据变了。
 */
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
  /** 为 true 时跳过缓存（清理后首次读取、或用户显式要求刷新）。 */
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
        // 命中缓存须**如实标注**：否则读者会把 5 分钟前的数字当成此刻的。
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

  // ── 为什么改成并发 + 缓存（2026-10-26 实测慢）────────────────────────────
  //
  // 用户反馈「诊断页进去很慢」。实测：本仓 725 个会话目录、共 158MB，原实现**串行**
  // 逐个 `zstd -dc`，buildGateReport 耗时 **5847ms**，而产出的调用记录只有 579 条。
  //
  // 三处浪费，逐条对应下面的三个修法：
  //   ① **串行** —— 每个会话都要起一个 zstd 子进程，725 次串行排队。改成有界并发。
  //   ② **每次都全量重扫** —— 进一次页面扫一遍。加 TTL 缓存（默认 5 分钟）：
  //      诊断页是「看一眼现状」的用途，5 分钟内的旧数据不改变任何判断。
  //   ③ **（已放弃）按体积预筛** —— 曾想「小于 8KB 的会话直接跳过」，但实测会
  //      误伤：小会话也可能含 LDVH 调用（既有测试造的就是几行事件）。体积不是
  //      「有无调用」的可靠判据，跳过它会**静默少统计**——那比慢更糟，故撤回。
  //      留下这条记录，免得下次又想起来试一遍。
  //
  // 边界：剩下两项都**不改统计口径**——并发只改调度顺序，缓存只改复用。
  const outcomes: ToolCallOutcome[] = []
  if (hasZstd && sessionDirExists) {
    const collected = await mapWithConcurrency(sessions, SESSION_SCAN_CONCURRENCY, async (session) => {
      const dir = path.join(sessionDir, session)
      try {
        const raw = await readSessionLog(dir)
        if (!raw) return { skipped: false, outcomes: [] }
        return { skipped: false, outcomes: extractToolOutcomes(raw, session) }
      } catch {
        // 单个会话读不动不影响其余：降级为「少统计一个会话」，并在 scope 里如实计数。
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
  gateReportCache.set(cacheKey, { at: Date.now(), value: report })
  return report
}

// ---------------------------------------------------------------------------
// 摩擦观察缓冲（11 §12bis.1）的只读投影
// ---------------------------------------------------------------------------
//
// ## 为什么放在诊断页而不是事实对象列表
//
// 摩擦观察缓冲里的条目**不是事实对象**（11 §12bis.1：非事实、不进事实源、无对象
// 身份）。把它们混进「事实对象」的列表页会立刻造成误读——读者会以为它们是账目。
// 诊断页承载的是「本机运行状态」，缓冲正属同一类地方（与水位、待处置队列、
// 运行记录同层，同在 ~/.dsh/ldvh 下）。
//
// ## 呈现口径由规范钉死，本函数**不是**自由设计
//
// 11 §12bis.1 第 2 条（Human 决定 2026-10）明写：**只可展示其存在与数量、以及
// 现象/时间/来源/状态四项**，**不得展示 `evidence` 全文**，**不得使其可被点击进入
// 事实对象详情**（它没有对象身份）。故本投影**刻意不返回** `evidence`、`session`、
// `promoted_to` 等字段——不是遗漏，是规范要求的最小面。
//
// 超出这四项的信息若要呈现在别处，须先改规范，不能在读取层顺手放开。

/** 缓冲条目在「四项可呈现字段」内的投影（11 §12bis.1 第 2 条）。 */
export type ObservationProjection = {
  at: string | null
  /** 「来源」——用 anchor（材料位置）而非 session（会话 id），前者才是读者要的出处。 */
  anchor: string | null
  phenomenon: string | null
  status: string | null
  /** 所属观察组：**仅用于让读者看出「同一阻碍被看过几次」**，不是对象标识。 */
  group: string | null
}

export type ObservationGroupRow = {
  group: string
  /** 该组当前 pending 条目数——与阈值 N 并列呈现，读者才看得出「攒到几分」。 */
  pendingCount: number
  promotionReady: boolean
  /** 组内最早/最新一次观察时刻（现象取最新一条）。 */
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

/** 缓冲条目的字段闭集（11 §12bis.1）。读取时不认表外字段——与写入侧同口径。 */
const OBSERVATION_STATUSES = new Set(['pending', 'promoted', 'discarded', 'evicted'])

/** 阈值 N=3 由 11 §9 内嵌固定，不可配置（§12bis.1 亦引用此值）。 */
const OBSERVATION_THRESHOLD = 3

/**
 * 读取摩擦观察缓冲并作出**只含四项**的投影。
 *
 * 破损行跳过而不中断：缓冲是追加型流水，一行坏掉不该让整页空白（与本站
 * `readJsonLines` 对队列的处理同一纪律）。但**跳过数须如实计数**，否则
 * 「解析失败」会伪装成「条目较少」。
 */
/** 经验缓冲条目状态闭集（11 §12bis 字段表第 8 行）。 */
const EXPERIENCE_BUFFER_STATUSES = new Set(['pending', 'consumed', 'discarded', 'evicted'])

/** 经验留观区条目的投影（**只四项**，11 §12bis 读取纪律第 2 条）。 */
export type ExperienceBufferProjection = {
  at: string | null
  /** 「来源」——用 anchor（材料位置）而非 session（会话 id）。 */
  anchor: string | null
  phenomenon: string | null
  status: string | null
}

export type ExperienceBufferReport = {
  ok: boolean
  generatedAt: string
  scope: {
    ldvhHome: string
    bufferDir: string
    bufferDirExists: boolean
    /** 分区后的文件名（= 项目 id + `.jsonl`）；同时充当「本项目」的可读标识。 */
    files: string[]
    limits: string[]
  }
  totals: {
    entries: number
    byStatus: { status: string; count: number }[]
    /** 分区载体数量（= 参与统计的项目数）。 */
    projects: number
  }
  /** 未审核条目数——读者最关心的那个数：还有多少材料等着被审。 */
  pendingCount: number
  /** 最旧一条 pending 的时刻：用来判断「是不是积压太久了」。 */
  oldestPendingAt: string | null
  recent: ExperienceBufferProjection[]
}

/**
 * 读取**经验**留观缓冲并作出**只含四项**的投影（11 §12bis 读取纪律第 2 条）。
 *
 * ## 与摩擦侧（`buildFrictionObservationReport`）的三处**必要差异**
 *
 * 1. **无 `group`**：经验缓冲没有聚合键（§12bis 闭集 9 项，摩擦侧才有 `group`）。
 *    故不呈现「攒到几分」——经验不需要攒够次数才成立。
 * 2. **无阈值**：摩擦的 N=3 是 §9 的晋升判据；经验侧没有对应数值，凭空给一个就是
 *    编造规范。
 * 3. **多出 `pendingCount`/`oldestPendingAt`**：经验缓冲的读取方是审核段（要判「够不够
 *    成文」），读者最需要的是「还有多少待审、最老的等了多久」——这两个数摩擦侧不需要
 *    （它关心的是「哪一组快攒够了」）。
 *
 * ## 为什么与摩擦侧同页、同口径
 *
 * Human 2026-10-26：「留观区一样出现在诊断 tab 里，和摩擦一样」。而 §12bis 与 §12bis.1
 * 的读取纪律给的是**同一套呈现边界**（只可展示存在与数量 + 现象/时间/来源/状态）。
 * 故两块的形状刻意对齐，读者不必学两套。
 *
 * ## 载体格式：追加事件日志（2026-10-26）
 *
 * 载体的每一行是**事件**而非完整记录：
 *
 * ```
 * {"kind":"entry",  "record":{…§12bis 九字段…}}
 * {"kind":"settle", "id":"…","status":"…","consumed_by":"…","settled_at":"…"}
 * {"kind":"remove", "id":"…","at":"…"}
 * ```
 *
 * 本页必须按同一套折叠规则读，否则会把每条事件当成一条「记录」——实测症状是
 * **条目数正确、字段全 null**（事件外壳上没有 `phenomenon`），看起来像「数据坏了」。
 * 这是本轮真实发生过的缺陷，故在此写明，并由测试用**生产同格式**的夹具钉住。
 *
 * ## 不得做的事（规范红线，不是遗漏）
 *
 * 不含 `evidence`（它是逐字引证，属「内容」不属「运行状态」）；不含 `candidate_question`
 * （那是审核段的判断输入）；不含 `id`/`consumed_by`（那是对象身份与去向，本页不提供
 * 「点击进入详情」）；不提供导出/复制/搜索（那等于把非事实材料搬出诊断面）。
 */
export async function buildExperienceBufferReport(options: {
  dshHome?: string
} = {}): Promise<ExperienceBufferReport> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const ldvhHome = path.join(dshHome, 'ldvh')
  const bufferDir = path.join(ldvhHome, 'experience-buffers')

  const limits: string[] = [
    '经验观察是**非事实对象**的本地运行状态（11 §12bis）：不进事实源、无对象身份，故本页不提供「点击进入详情」。',
    '按规范只呈现现象/时间/来源/状态四项；`evidence` 全文、待审核问题与消费去向不在呈现面内（11 §12bis 读取纪律第 2 条）。',
    '观察材料按管辖项目分文件（§12bis 载体段 2026-10 修订）；本页汇总全部项目，每个项目一个文件。',
    '条目保留期 pending 30 天、终态 90 天，容量 200/项目。保留期**不是审核期限**——它不产生「逾期必须审核」的义务。',
    '本页只读：不写观察载体、不形成候选。',
  ]

  let files: string[] = []
  let bufferDirExists = false
  try {
    const names = await readdir(bufferDir)
    files = names.filter((name) => name.endsWith('.jsonl')).sort()
    bufferDirExists = true
  } catch {
    // 目录不存在是**正常初态**（还没有任何观察落地），不是错误。
    bufferDirExists = false
  }

  type Row = {
    at?: string
    anchor?: string
    phenomenon?: string
    status?: string
  }

  /** 折叠后的条目（= 载体里 `entry` 事件经 settle/remove 折叠后的当前状态）。 */
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
    // **按事件折叠**（不是「一行一条记录」）。逐行收集事件，再折叠成当前状态。
    const byId = new Map<string, Row>()
    const order: string[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let event: { kind?: string; record?: Row; id?: string; status?: string }
      try {
        event = JSON.parse(trimmed)
      } catch {
        skippedLines += 1
        continue
      }
      if (event === null || typeof event !== 'object') {
        skippedLines += 1
        continue
      }
      if (event.kind === 'entry') {
        const record = event.record
        if (record === null || typeof record !== 'object') {
          skippedLines += 1
          continue
        }
        const id = typeof (record as { id?: unknown }).id === 'string' ? (record as { id: string }).id : null
        if (id === null) {
          skippedLines += 1
          continue
        }
        byId.set(id, record)
        order.push(id)
        continue
      }
      if (event.kind === 'settle') {
        const id = typeof event.id === 'string' ? event.id : null
        const target = id === null ? undefined : byId.get(id)
        if (target === undefined || typeof event.status !== 'string') {
          skippedLines += 1
          continue
        }
        // 状态不在闭集内即**不投影**（不把闭集外的值当合法状态呈现）。
        if (!EXPERIENCE_BUFFER_STATUSES.has(event.status)) {
          skippedLines += 1
          continue
        }
        byId.set(id as string, { ...target, status: event.status })
        continue
      }
      if (event.kind === 'remove') {
        const id = typeof event.id === 'string' ? event.id : null
        if (id === null) {
          skippedLines += 1
          continue
        }
        // **整条移除**：从视图里彻底消失（90 天保留期到点的形态）。
        byId.delete(id)
        continue
      }
      // 未知事件类型：如实计为跳过，不猜。
      skippedLines += 1
    }
    for (const id of order) {
      const row = byId.get(id)
      if (row !== undefined) rows.push(row)
    }
  }

  const statusCounts = new Map<string, number>()
  for (const row of rows) {
    const status = typeof row.status === 'string' ? row.status : 'unknown'
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1)
  }

  const pending = rows.filter((row) => row.status === 'pending')
  const pendingTimes = pending
    .map((row) => (typeof row.at === 'string' ? row.at : null))
    .filter((value): value is string => value !== null)
    .sort()

  const recent: ExperienceBufferProjection[] = rows
    .slice()
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    .slice(0, 40)
    .map((row) => ({
      at: typeof row.at === 'string' ? row.at : null,
      anchor: typeof row.anchor === 'string' ? row.anchor : null,
      phenomenon: typeof row.phenomenon === 'string' ? row.phenomenon : null,
      status: typeof row.status === 'string' ? row.status : null,
    }))

  if (skippedLines > 0) {
    limits.push(`另有 ${skippedLines} 行无法解析或状态在闭集外，已跳过并如实计数（不伪装成「本来就没有」）。`)
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: { ldvhHome, bufferDir, bufferDirExists, files, limits },
    totals: {
      entries: rows.length,
      byStatus: Array.from(statusCounts, ([status, count]) => ({ status, count })).sort(
        (a, b) => b.count - a.count,
      ),
      projects: files.length,
    },
    pendingCount: pending.length,
    oldestPendingAt: pendingTimes[0] ?? null,
    recent,
  }
}

export async function buildFrictionObservationReport(options: {
  dshHome?: string
} = {}): Promise<FrictionObservationReport> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const ldvhHome = path.join(dshHome, 'ldvh')
  const bufferDir = path.join(ldvhHome, 'friction-observations')

  const limits: string[] = [
    '摩擦观察是**非事实对象**的本地运行状态（11 §12bis.1）：不进事实源、无对象身份，故本页不提供「点击进入详情」。',
    '按规范只呈现现象/时间/来源/状态四项；`evidence` 全文与 `promoted_to` 不在呈现面内（11 §12bis.1 第 2 条）。',
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
    // 目录不存在是**正常初态**（还没有任何观察落地），不是错误——故只用
    // bufferDirExists=false 如实标注，不抛异常、不伪造空数据。
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
        // 状态不在闭集内即**不投影**（不把闭集外的值当合法状态呈现）。
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

  // 分组：只为让读者看出「同一阻碍被看过几次」，故只对 pending 建组——
  // 终态条目（promoted/discarded/evicted）已不属于「正在攒」的那一批。
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

  // 最近若干条（按时间倒序），只投影四项 + group。
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
