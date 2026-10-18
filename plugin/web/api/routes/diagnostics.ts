/**
 * 运行时诊断 API（只读）。
 *
 * 两页数据形态不同、来源也不同：
 * - `/gate`：受控写入关卡的调用实况，来自宿主会话日志（见 runtimeDiagnostics.ts）；
 * - `/idle`：闲时辅助的运行记录与待处置登记，来自 `~/.dsh/ldvh/` 下插件自己落的账。
 *
 * 两者都**只读**：本模块不写任何载体，也不改事实源。`scope` 字段如实说明覆盖范围，
 * 页面据此把「本页看不到」与「确实没有」区分开——这正是这个页面存在的意义。
 */
import { Router, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildGateReport, dshHomeFromEnvironment } from '../services/runtimeDiagnostics.js'
import { LDVH_WORKSPACE_ROOT } from '../services/pytools.js'
import { ProjectScopeError, requestProject } from '../services/requestScope.js'

const router = Router()

function ldvhHome(): string {
  return path.join(dshHomeFromEnvironment(), 'ldvh')
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, error: { code, message } })
}

/** `/gate` —— 受控写入关卡的调用分布与逐条失败记录。 */
router.get('/gate', async (req: Request, res: Response) => {
  try {
    const project = await requestProject(req).catch(() => null)
    const workspaceRoot = project?.path ?? LDVH_WORKSPACE_ROOT
    const report = await buildGateReport({ workspaceRoot })
    res.json({ ok: true, ...report })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'GATE_REPORT_FAILED', message)
  }
})

/** 闲时辅助的未处置登记按其**原因性质**归类——比照抄原始 reason 更能回答「卡在哪」。 */
const QUEUE_SIGNATURES: { category: string; pattern: RegExp }[] = [
  { category: 'subagent_stopped', pattern: /stopReason|refusal|subagent run did not complete/i },
  { category: 'observation_gap', pattern: /观察区间存在未覆盖缺口|未被本进程观察到/ },
  { category: 'quote_not_in_window', pattern: /not present in this run/ },
  { category: 'quote_too_short', pattern: /below the \d+-char floor/ },
  { category: 'carrier_ineffective', pattern: /carrier coherence/i },
  { category: 'title_too_long', pattern: /title/i },
  { category: 'dispatch_unavailable', pattern: /is not a function|subagents\./ },
]

function classifyQueueEntry(reason: string, residual: string[]): string {
  const haystack = `${reason} ${residual.join(' ')}`
  for (const { category, pattern } of QUEUE_SIGNATURES) {
    if (pattern.test(haystack)) return category
  }
  return 'other'
}

type QueueEntry = {
  entry_id?: string
  at?: string
  task?: string
  reason?: string
  residual?: string[]
  resolved_at?: string
  resolution_note?: string
}

type RunRecord = {
  at?: string
  task?: string
  tasks?: string[]
  stage?: string
  code?: string
  action?: string
  object_uid?: string
  watermark?: unknown
  gap?: unknown
  per_task?: unknown
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return []
  const raw = await readFile(filePath, 'utf8')
  const rows: T[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      rows.push(JSON.parse(trimmed) as T)
    } catch {
      // 破损行跳过而不中断——队列是 append-only 的流水，一行坏掉不该让整页空白。
      continue
    }
  }
  return rows
}

/** `/idle` —— 闲时辅助：待处置登记的分类分布 + 运行记录。 */
router.get('/idle', async (_req: Request, res: Response) => {
  try {
    const home = ldvhHome()
    const queueFile = path.join(home, 'pending-queue.jsonl')
    const runsFile = path.join(home, 'idle-checkpoint-runs.json')
    const entries = await readJsonLines<QueueEntry>(queueFile)
    const runsFileContent = await readJsonFile<{ runs?: RunRecord[] }>(runsFile, {})
    const runs = Array.isArray(runsFileContent.runs) ? runsFileContent.runs : []

    const unresolved = entries.filter((entry) => !entry.resolved_at)
    const categoryCounts = new Map<string, number>()
    for (const entry of unresolved) {
      const category = classifyQueueEntry(entry.reason ?? '', entry.residual ?? [])
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    }

    // 超 24 小时仍未处置：说明这批登记事实上没有被处理过，值得单独说。
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const over24h = unresolved.filter((entry) => {
      const at = entry.at ? Date.parse(entry.at) : Number.NaN
      return Number.isFinite(at) && at < dayAgo
    }).length

    const stageCounts = new Map<string, number>()
    for (const run of runs) {
      const stage = typeof run.stage === 'string' ? run.stage : 'unknown'
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1)
    }

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      scope: {
        ldvhHome: home,
        queueFileExists: existsSync(queueFile),
        runsFileExists: existsSync(runsFile),
        limits: [
          '待处置登记与运行记录均在 ~/.dsh/ldvh 下，属本机当前用户的运行账，不随仓库分发。',
          '运行记录是环形缓冲（保留最近 50 条），更早的轮次已被覆盖。',
          'ActivityLog 只在内存，进程退出即消失——因此「为什么 stopped」的当场原因不可回溯。',
        ],
      },
      queue: {
        total: entries.length,
        unresolved: unresolved.length,
        over24h,
        byCategory: Array.from(categoryCounts, ([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
        recent: unresolved
          .slice()
          .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
          .slice(0, 40)
          .map((entry) => ({
            at: entry.at ?? null,
            task: entry.task ?? null,
            category: classifyQueueEntry(entry.reason ?? '', entry.residual ?? []),
            reason: (entry.reason ?? '').slice(0, 500),
          })),
      },
      runs: {
        total: runs.length,
        byStage: Array.from(stageCounts, ([stage, count]) => ({ stage, count }))
          .sort((a, b) => b.count - a.count),
        recent: runs.slice(-20).reverse().map((run) => ({
          at: run.at ?? null,
          stage: run.stage ?? 'unknown',
          code: run.code ?? null,
          action: run.action ?? null,
          task: run.task ?? null,
        })),
      },
    })
  } catch (error) {
    if (error instanceof ProjectScopeError) {
      fail(res, 400, 'PROJECT_SCOPE_INVALID', error.message)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'IDLE_REPORT_FAILED', message)
  }
})

export default router
