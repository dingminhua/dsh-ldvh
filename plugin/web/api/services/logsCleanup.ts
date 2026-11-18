import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dshHomeFromEnvironment } from './runtimeDiagnostics.js'

export const LOGGABLE_TARGETS = [
  {
    id: 'checkpoint-runs',
    label: '运行痕迹',
    relativePath: ['ldvh', 'idle-checkpoint-runs.json'],
    kind: 'ring' as const,
    timeField: 'at',
    note: '每次检查点的结局（环形，本就只保留最近 50 条）。',
  },
  {
    id: 'friction-observations',
    label: '摩擦观察',
    relativePath: ['ldvh', 'friction-observations'],
    kind: 'jsonlDir' as const,
    timeField: 'at',
    note: '**未达阈值的观察条目**。清理会重置「攒到几分」的进度——正在攒的组会归零。',
  },
] as const

export type LogTargetId = (typeof LOGGABLE_TARGETS)[number]['id']

export const RETENTION_CHOICES = [1, 3, 7] as const
export type RetentionDays = (typeof RETENTION_CHOICES)[number]

export type TargetPreview = {
  id: string
  label: string
  note: string
  exists: boolean
  removing: number
  keeping: number
  unparsable: number
  bytes: number
  caution?: string
}

export type CleanupPlan = {
  cutoff: string
  retentionDays: number
  targets: TargetPreview[]
  backupDir: string | null
}

export type CleanupResult = CleanupPlan & {
  ok: boolean
  applied: { id: string; removed: number; kept: number; error?: string }[]
  backupPath: string | null
}

function ldvhRoot(dshHome: string): string {
  return path.join(dshHome, 'ldvh')
}

function targetPath(dshHome: string, target: (typeof LOGGABLE_TARGETS)[number]): string {
  return path.join(dshHome, ...target.relativePath)
}

export function cutoffFor(retentionDays: number, now: Date = new Date()): Date {
  const ms = retentionDays * 24 * 60 * 60 * 1000
  return new Date(now.getTime() - ms)
}

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

type JsonlRow = { line: string; value: unknown | null }

async function readJsonlLines(file: string): Promise<{ parsed: JsonlRow[]; bytes: number }> {
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

async function backupFile(file: string, backupDir: string): Promise<string> {
  await mkdir(backupDir, { recursive: true })
  const target = path.join(backupDir, path.basename(file))
  await copyFile(file, target)
  return target
}

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
      const perFile: { file: string; keep: JsonlRow[] }[] = []
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
            }
          }
          removing = runs.length - keep.length
          keeping = keep.length
        } catch {
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
