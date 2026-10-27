/**
 * LDVH 运行账的日志清理（`~/.dsh/ldvh/` 下的流水与环形记录）。
 *
 * ## 这个模块为什么存在
 *
 * 运行账会无界增长：待处置队列是 append-only（实测 341 条 / 125KB），运行痕迹是
 * 环形（50 条），经验观察与摩擦观察各自累积。它们**不是事实源**（11 §12「载体」
 * 段：位于 DSH home 之下、不进事实源），因此可以按时间清理——但**哪些能清、哪些
 * 绝不能清，是硬边界**，不能因为「都是 jsonl」就一视同仁。
 *
 * ## 三类不同的东西（读这一节再改代码）
 *
 * | 类别 | 能否按时间清理 | 为什么 |
 * |---|---|---|
 * | 流水/痕迹（待处置队列、运行痕迹） | ✅ 能 | 它们记录「过去发生了什么」，过期即失去诊断价值 |
 * | 观察材料（经验观察、摩擦观察） | ✅ 能（Human 决定 2026-10-26） | 是待审核素材，过期价值低；但删了就是丢了证据——故默认**不**选、须显式勾选 |
 * | **水位** | ❌ **绝不能** | 删水位 = 让机制重新观察已处理内容 → 重复计数、重复入账 |
 *
 * 水位（`friction-discovery-watermarks.json`）不在本模块的可清理清单里，且
 * `LOGGABLE_TARGETS` 里刻意**不列出**它——想删它必须改这个文件，那是一次显式的
 * 设计决定，不会被一次误操作带走。
 *
 * ## 清理前必须备份
 *
 * `dryRun` 与真删走**同一条**枚举路径（`planCleanup`），故界面上显示的「将删除
 * N 条」与真删的条数来自同一份计算——不会出现「提示 100 条、删了 300 条」。
 */
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dshHomeFromEnvironment } from './runtimeDiagnostics.js'

/** 可清理目标（**水位不在其中**，见文件头表格）。 */
export const LOGGABLE_TARGETS = [
  {
    id: 'pending-queue',
    label: '待处置队列',
    relativePath: ['ldvh', 'pending-queue.jsonl'],
    kind: 'jsonl' as const,
    /** 按哪一列的时间判定新旧：JSONL 的 `at`。 */
    timeField: 'at',
    note: '失败与缺口的登记流水（append-only）。清理后不再显示历史登记。',
  },
  {
    id: 'idle-runs',
    label: '运行痕迹',
    relativePath: ['ldvh', 'idle-checkpoint-runs.json'],
    kind: 'ring' as const,
    timeField: 'at',
    note: '每次检查点的结局（环形，本就只保留最近 50 条）。',
  },
  {
    id: 'experience-buffer',
    label: '经验观察',
    // **按项目分区的目录**（11 §12bis 载体段 2026-10 修订：`ldvh/experience-buffers/<projectId>.jsonl`）。
    // 旧填写的是 `ldvh/observation-buffer.jsonl`——那是**已废弃的全局载体**，现行
    // 生产路径根本不写它。后果不是报错而是**静默失效**：清理页显示 0 条、真删删 0 条，
    // 而真实的经验观察材料一条也没被清（反过来，如果谁把旧结构件捡回来写，反而会被清掉）。
    relativePath: ['ldvh', 'experience-buffers'],
    kind: 'jsonlDir' as const,
    // 载体是**追加事件日志**：两条路径缺一不可（见 `recordTime` 的说明）。
    timeField: ['record.at', 'at', 'settled_at'],
    note: '**待审核的经验素材**。清理后这些材料不可恢复（除备份），未审核过的将永久失去。',
  },
  {
    id: 'friction-observations',
    label: '摩擦观察',
    relativePath: ['ldvh', 'friction-observations'],
    kind: 'jsonlDir' as const,
    timeField: 'at',
    note: '**未达阈值的观察条目**。清理会重置「攒到几分」的进度——正在攒的组会归零。',
  },
  {
    id: 'queue-backups',
    label: '队列备份文件',
    relativePath: ['ldvh'],
    kind: 'backupGlob' as const,
    timeField: null,
    note: '`pending-queue.jsonl.bak-*` 这类清理前留的备份。按文件修改时间判定。',
  },
] as const

export type LogTargetId = (typeof LOGGABLE_TARGETS)[number]['id']

/** 保留窗口（天）。1 / 3 / 7 由 Human 指定（2026-10-26）。 */
export const RETENTION_CHOICES = [1, 3, 7] as const
export type RetentionDays = (typeof RETENTION_CHOICES)[number]

export type TargetPreview = {
  id: string
  label: string
  note: string
  /** 文件是否存在（不存在时删除数为 0，且不是错误——合法初态）。 */
  exists: boolean
  /** 将被删除的记录数（dryRun 与真删同源）。 */
  removing: number
  /** 将被保留的记录数。 */
  keeping: number
  /** 无法解析的行数（原样保留，不擅自丢）。 */
  unparsable: number
  /** 文件字节数（展示用）。 */
  bytes: number
  /** 该目标的硬边界说明（如「水位不在可清理范围」）。 */
  caution?: string
}

export type CleanupPlan = {
  cutoff: string
  retentionDays: number
  targets: TargetPreview[]
  /** 备份目录（真删时才有；dryRun 时为 null）。 */
  backupDir: string | null
}

export type CleanupResult = CleanupPlan & {
  ok: boolean
  /** 每个目标的实际删除结果。 */
  applied: { id: string; removed: number; kept: number; error?: string }[]
  /** 备份路径（若本次产生了备份）。 */
  backupPath: string | null
}

function ldvhRoot(dshHome: string): string {
  return path.join(dshHome, 'ldvh')
}

function targetPath(dshHome: string, target: (typeof LOGGABLE_TARGETS)[number]): string {
  return path.join(dshHome, ...target.relativePath)
}

/** 计算截止时刻：早于它的记录被删。 */
export function cutoffFor(retentionDays: number, now: Date = new Date()): Date {
  const ms = retentionDays * 24 * 60 * 60 * 1000
  return new Date(now.getTime() - ms)
}

/**
 * 解析一条记录的时间戳。
 *
 * 返回 null 表示**判定不了**——此时该条**原样保留**并在 `unparsable` 里计数。
 * 为什么不当作「很旧」删掉：删掉一条读不懂的记录，等于用一个解析失败换来一次
 * 静默的数据损失；保留它至少还能事后人工看。
 *
 * `field` 支持**嵌套路径**（`a.b`）与**候选路径数组**，后者按序取第一个可解析者。
 * 两条都是必需的，不是便利：
 *
 * - 经验观察的载体是追加事件日志，条目时间是 `{kind:"entry", record:{at}}`——顶层
 *   没有 `at`。只认顶层会让每一条都「判定不了」，清理于是在不报错的情况下变成
 *   空操作（实测形态：显示 0 条、真删删 0 条，而材料一条没少）。
 * - 同一载体的 `settle`／`remove` 事件没有 `record`（它们带着 `settled_at`／`at`），
 *   若只给 `record.at`，这些行会被算作「解析失败」——把可清理流水报成不可解析，
 *   读数时像坏了。
 *
 * **按行判定对折叠账本是否安全**：安全，且方向是确定的——`settle`／`remove` 事件
 * 必然**晚于或同时于**其 `entry` 事件（载体只追加）。故要么两者同侧（同时保留或
 * 同时删除），要么只剩 `entry` 被保留、`settle` 被删——后者绝不会发生（settle 更
 * 晚 ⇒ 更新 ⇒ 只可能它被保留）。因此不存在「条目被删、其结算留下」导致**条目复活**
 * 的路径。
 */
function recordTime(record: unknown, field: string | readonly string[] | null): number | null {
  if (field === null || typeof record !== 'object' || record === null) return null
  const paths = typeof field === 'string' ? [field] : field
  for (const path of paths) {
    let current: unknown = record
    for (const segment of path.split('.')) {
      if (typeof current !== 'object' || current === null) {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[segment]
    }
    if (typeof current !== 'string') continue
    const at = Date.parse(current)
    if (Number.isFinite(at)) return at
  }
  return null
}

/** 读 JSONL 文件为行数组（保留无法解析的行原文）。 */
async function readJsonlLines(file: string): Promise<{ parsed: { line: string; value: unknown | null }[]; bytes: number }> {
  if (!existsSync(file)) return { parsed: [], bytes: 0 }
  const bytes = statSync(file).size
  const text = await readFile(file, 'utf8')
  const parsed = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return { line, value: JSON.parse(line) as unknown }
      } catch {
        return { line, value: null }
      }
    })
  return { parsed, bytes }
}

/** 备份一个文件（保留原文件名），返回备份路径。 */
async function backupFile(file: string, backupDir: string): Promise<string> {
  await mkdir(backupDir, { recursive: true })
  const target = path.join(backupDir, path.basename(file))
  await copyFile(file, target)
  return target
}

/**
 * 枚举清理计划（dryRun 与真删共用）。
 *
 * `apply=false` 时**不写任何文件**，只算数——界面据此显示「将删除 N 条」，
 * 用户确认后再以 `apply=true` 走同一条路径。
 */
export async function planCleanup(options: {
  dshHome?: string
  retentionDays: number
  targetIds: string[]
  apply?: boolean
}): Promise<CleanupResult> {
  const dshHome = options.dshHome ?? dshHomeFromEnvironment()
  const retentionDays = options.retentionDays
  const apply = options.apply === true
  const now = new Date()
  const cutoff = cutoffFor(retentionDays, now)
  const cutoffMs = cutoff.getTime()
  const backupDir = apply
    ? path.join(ldvhRoot(dshHome), 'cleanup-backups', now.toISOString().replace(/[:.]/g, '-'))
    : null

  const selected = LOGGABLE_TARGETS.filter((t) => options.targetIds.includes(t.id))
  const targets: TargetPreview[] = []
  const applied: CleanupResult['applied'] = []

  for (const target of selected) {
    const abs = targetPath(dshHome, target)

    // ── backupGlob：按文件修改时间删备份文件 ──────────────────────────────
    if (target.kind === 'backupGlob') {
      const { readdir } = await import('node:fs/promises')
      let names: string[] = []
      try {
        names = (await readdir(abs)).filter((n) => n.includes('.bak-'))
      } catch {
        names = []
      }
      let removing = 0
      let keeping = 0
      let bytes = 0
      for (const name of names) {
        const file = path.join(abs, name)
        try {
          const info = statSync(file)
          bytes += info.size
          if (info.mtimeMs < cutoffMs) removing += 1
          else keeping += 1
        } catch {
          keeping += 1
        }
      }
      targets.push({
        id: target.id, label: target.label, note: target.note,
        exists: names.length > 0, removing, keeping, unparsable: 0, bytes,
      })
      if (apply) {
        let removed = 0
        for (const name of names) {
          const file = path.join(abs, name)
          try {
            if (statSync(file).mtimeMs < cutoffMs) {
              await rename(file, `${file}.deleting-${now.getTime()}`)
              const { unlink } = await import('node:fs/promises')
              await unlink(`${file}.deleting-${now.getTime()}`)
              removed += 1
            }
          } catch {
            /* 单个删不掉不影响其余 */
          }
        }
        applied.push({ id: target.id, removed, kept: names.length - removed })
      }
      continue
    }

    // ── jsonlDir：目录下每个 *.jsonl 各自按时间清 ─────────────────────────
    if (target.kind === 'jsonlDir') {
      const { readdir } = await import('node:fs/promises')
      let files: string[] = []
      try {
        files = (await readdir(abs)).filter((n) => n.endsWith('.jsonl'))
      } catch {
        files = []
      }
      let removing = 0
      let keeping = 0
      let unparsable = 0
      let bytes = 0
      const perFile: { file: string; keep: typeof parsed }[] = []
      for (const name of files) {
        const file = path.join(abs, name)
        const { parsed, bytes: size } = await readJsonlLines(file)
        bytes += size
        const keep: typeof parsed = []
        for (const row of parsed) {
          const at = recordTime(row.value, target.timeField)
          if (at === null) {
            keep.push(row)
            unparsable += 1
          } else if (at >= cutoffMs) {
            keep.push(row)
          } else {
            // 早于截止 → 删除
          }
        }
        removing += parsed.length - keep.length
        keeping += keep.length
        perFile.push({ file, keep })
      }
      targets.push({
        id: target.id, label: target.label, note: target.note,
        exists: files.length > 0, removing, keeping, unparsable, bytes,
      })
      if (apply && backupDir) {
        let kept = 0
        let failed: string | null = null
        for (const { file, keep } of perFile) {
          try {
            await backupFile(file, backupDir)
            await writeFile(file, keep.map((r) => r.line).join('\n') + (keep.length > 0 ? '\n' : ''), 'utf8')
            kept += keep.length
          } catch (error) {
            // 单个文件写失败：记下原因，并把它标记为「本目标部分失败」——不得
            // 谎报成功（声称删了 N 条却有一个文件没动，是最坏的失真）。
            failed = String((error as Error)?.message ?? error)
            break
          }
        }
        if (failed === null) {
          applied.push({ id: target.id, removed: removing, kept })
        } else {
          applied.push({ id: target.id, removed: 0, kept: 0, error: failed })
        }
      }
      continue
    }

    // ── ring：{ runs: [...] } 形式的环形记录 ─────────────────────────────
    if (target.kind === 'ring') {
      let removing = 0
      let keeping = 0
      let unparsable = 0
      let bytes = 0
      let keep: unknown[] = []
      const exists = existsSync(abs)
      if (exists) {
        bytes = statSync(abs).size
        try {
          const doc = JSON.parse(await readFile(abs, 'utf8')) as { runs?: unknown[] }
          const runs = Array.isArray(doc.runs) ? doc.runs : []
          for (const run of runs) {
            const at = recordTime(run, target.timeField)
            if (at === null) {
              keep.push(run)
              unparsable += 1
            } else if (at >= cutoffMs) {
              keep.push(run)
            } else {
              /* 过期 */
            }
          }
          removing = runs.length - keep.length
          keeping = keep.length
        } catch {
          // 整个文件读不了：不删（保留原样），如实标注。
          unparsable += 1
          keep = []
        }
      }
      targets.push({
        id: target.id, label: target.label, note: target.note,
        exists, removing, keeping, unparsable, bytes,
      })
      if (apply && exists && backupDir) {
        try {
          await backupFile(abs, backupDir)
          await writeFile(abs, JSON.stringify({ runs: keep }, null, 2) + '\n', 'utf8')
          applied.push({ id: target.id, removed: removing, kept: keeping })
        } catch (error) {
          applied.push({ id: target.id, removed: 0, kept: 0, error: String((error as Error)?.message ?? error) })
        }
      }
      continue
    }

    // ── jsonl：单个文件 ──────────────────────────────────────────────────
    const { parsed, bytes } = await readJsonlLines(abs)
    const keep: typeof parsed = []
    let unparsable = 0
    for (const row of parsed) {
      const at = recordTime(row.value, target.timeField)
      if (at === null) {
        keep.push(row)
        unparsable += 1
      } else if (at >= cutoffMs) {
        keep.push(row)
      } else {
        /* 过期 */
      }
    }
    const removing = parsed.length - keep.length
    targets.push({
      id: target.id, label: target.label, note: target.note,
      exists: existsSync(abs), removing, keeping: keep.length, unparsable, bytes,
    })
    if (apply && existsSync(abs) && backupDir) {
      try {
        await backupFile(abs, backupDir)
        await writeFile(abs, keep.map((r) => r.line).join('\n') + (keep.length > 0 ? '\n' : ''), 'utf8')
        applied.push({ id: target.id, removed: removing, kept: keep.length })
      } catch (error) {
        applied.push({ id: target.id, removed: 0, kept: 0, error: String((error as Error)?.message ?? error) })
      }
    }
  }

  return {
    ok: true,
    cutoff: cutoff.toISOString(),
    retentionDays,
    targets,
    backupDir,
    applied,
    backupPath: backupDir,
  }
}
