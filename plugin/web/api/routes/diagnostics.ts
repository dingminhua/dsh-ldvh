/**
 * 运行时诊断 API（只读）。
 *
 * 两页数据形态不同、来源也不同：
 * - `/gate`：受控写入关卡的调用实况，来自宿主会话日志（见 runtimeDiagnostics.ts）；
 * - `/queue`：待处置队列与检查点运行记录，来自 `~/.dsh/ldvh/` 下插件自己落的账；
 * - `/observations`：摩擦观察缓冲（11 §12bis.1）的只读现状——**非事实对象**，与本页
 *   其余部分同理属本机运行状态（故不放在事实对象列表页）。
 *
 * 两者都**只读**：本模块不写任何载体，也不改事实源。`scope` 字段如实说明覆盖范围，
 * 页面据此把「本页看不到」与「确实没有」区分开——这正是这个页面存在的意义。
 */
import { Router, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildFrictionObservationReport,
  buildGateReport,
  dshHomeFromEnvironment,
  invalidateGateReportCache,
} from '../services/runtimeDiagnostics.js'
import { LOGGABLE_TARGETS, RETENTION_CHOICES, planCleanup } from '../services/logsCleanup.js'
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

/** 待处置队列的未处置登记按其**原因性质**归类——比照抄原始 reason 更能回答「卡在哪」。 */
// 2026-11-17：QUEUE_SIGNATURES / classifyQueueEntry / QueueEntry 已随待处置队列删除。

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
  /** 历史字段（队列时代的共同键）；队列已删除（2026-11-17），存量记录仍带它。 */
  pending_entry_id?: string | null
  /** 2026-11-03 起由 lifecycle 在失败分支填入（此前该字段定义多年、无生产者）。 */
  note?: string
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}


/** `/queue` —— 运行痕迹（11 §12 失败留痕的持久承载）。
 *
 * 2026-11-17：待处置队列已删除（Human 决定，11 §12）。本路由原为「队列 + 运行
 * 记录」双数据源，现只报运行记录——失败可见性由当次回执 + 本载体承载。路由键
 * 保留 `queue` 是为不改前端契约面；语义已是「运行痕迹」。存量队列文件不再被读。
 */
router.get('/queue', async (_req: Request, res: Response) => {
  try {
    const home = ldvhHome()
    const runsFile = path.join(home, 'idle-checkpoint-runs.json')
    const runsFileContent = await readJsonFile<{ runs?: RunRecord[] }>(runsFile, {})
    const runs = Array.isArray(runsFileContent.runs) ? runsFileContent.runs : []

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
        runsFileExists: existsSync(runsFile),
        limits: [
          '运行记录在 ~/.dsh/ldvh 下，属本机当前用户的运行账，不随仓库分发。',
          '运行记录是环形缓冲（保留最近 50 条），更早的轮次已被覆盖。',
          'ActivityLog 只在内存，进程退出即消失——但失败轮次的 stop_reason 与 residual 首项自 2026-11-03 起写入运行记录的 note 字段，故「为什么 stopped」在保留窗口内可回看。',
        ],
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
          note: (run.note ?? '').slice(0, 300) || null,
          pending_entry_id: run.pending_entry_id ?? null,
        })),
      },
    })
  } catch (error) {
    if (error instanceof ProjectScopeError) {
      fail(res, 400, 'PROJECT_SCOPE_INVALID', error.message)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'QUEUE_REPORT_FAILED', message)
  }
})

/**
 * `/observations` —— 摩擦观察缓冲的只读现状（11 §12bis.1）。
 *
 * 为什么在诊断页而不是对象列表：缓冲条目**不是事实对象**（非事实、无对象身份），
 * 混进事实列表会造成「它们是账目」的误读。这里与待处置队列、运行记录同层——
 * 都是本机运行状态。
 *
 * 呈现口径由 11 §12bis.1 第 2 条钉死：只可展示存在与数量、以及现象/时间/来源/状态
 * 四项，不得展示 evidence 全文、不得可点击进入事实对象。故服务层投影刻意不含
 * evidence/session/promoted_to —— 这是规范要求的最小面，不是遗漏。
 */
/**
 * `/experience-observations` —— **经验**留观缓冲的只读现状（11 §12bis）。
 *
 * 与 `/observations`（摩擦，§12bis.1）**并列而分立**：两类载体各有唯一消费者
 * （02 §6.1 第 2 条），故各占一个路由、各显示一块。呈现口径同源——§12bis 与
 * §12bis.1 的读取纪律给的都是「存在与数量 + 现象/时间/来源/状态四项」。
 *
 * 为什么在诊断页：缓冲条目**不是事实对象**（非事实、无对象身份），混进事实列表会造成
 * 「它们是候选」的误读。这里与待处置队列、运行记录同层——都是本机运行状态。
 */
// **2026-11-16**：`/diagnostics/experience-observations` 路由已删除——经验留观缓冲随
// 审核层整层取消。摩擦观察路由（`/diagnostics/observations`）不受影响。

router.get('/observations', async (_req: Request, res: Response) => {
  try {
    const report = await buildFrictionObservationReport()
    res.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'OBSERVATION_REPORT_FAILED', message)
  }
})

/**
 * `GET /diagnostics/logs/preview?days=N&targets=a,b` —— 清理预览（**只算不删**）。
 *
 * 与真删走同一条 `planCleanup`（`apply=false`），故界面显示的「将删除 N 条」
 * 就是真删会删掉的条数——不存在「提示与实际不符」。
 */
router.get('/logs/preview', async (req: Request, res: Response) => {
  try {
    const days = Number.parseInt(String(req.query.days ?? '7'), 10)
    if (!Number.isInteger(days) || days <= 0) {
      fail(res, 400, 'INVALID_RETENTION', 'days must be a positive integer')
      return
    }
    const raw = req.query.targets
    const targets = typeof raw === 'string' && raw.length > 0
      ? raw.split(',').map((x) => x.trim()).filter(Boolean)
      : LOGGABLE_TARGETS.map((t) => t.id)
    const plan = await planCleanup({ retentionDays: days, targetIds: targets, apply: false })
    res.json(plan)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'LOG_PREVIEW_FAILED', message)
  }
})

/**
 * `POST /diagnostics/logs/clean` —— 执行清理（**会写文件，且不可逆**）。
 *
 * 前置：`days` 必须是给定选项之一（1/3/7），`targets` 非空。
 * 每次真删都在 `ldvh/cleanup-backups/<时间戳>/` 下留一份备份。
 *
 * **历史水位文件不在可清理清单里**：`LOGGABLE_TARGETS` 刻意不包含它。原护栏防的是
 * 「删活水位让机制重新观察已处理内容并重复入账」；水位机制已随闲时触发删除
 * （2026-11-17），存量文件只是历史材料——清它须是显式决定（见 logsCleanup.ts 文件头）。
 */
router.post('/logs/clean', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { days?: unknown; targets?: unknown }
    const days = Number.parseInt(String(body.days ?? ''), 10)
    if (!Number.isInteger(days) || !RETENTION_CHOICES.includes(days as 1 | 3 | 7)) {
      fail(res, 400, 'INVALID_RETENTION', `days must be one of ${RETENTION_CHOICES.join(', ')}`)
      return
    }
    const targets = Array.isArray(body.targets)
      ? body.targets.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
    if (targets.length === 0) {
      fail(res, 400, 'NO_TARGETS', 'at least one target must be selected')
      return
    }
    const unknown = targets.filter((id) => !LOGGABLE_TARGETS.some((t) => t.id === id))
    if (unknown.length > 0) {
      fail(res, 400, 'UNKNOWN_TARGET', `unknown target(s): ${unknown.join(', ')}`)
      return
    }
    const result = await planCleanup({ retentionDays: days, targetIds: targets, apply: true })
    // 清理后 /gate 的缓存必须失效，否则页面还显示清理前的数字。
    invalidateGateReportCache()
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(res, 500, 'LOG_CLEAN_FAILED', message)
  }
})

export default router
