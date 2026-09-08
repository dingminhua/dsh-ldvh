/**
 * Objects API 路由：按类型列表和按 ID 查看详情
 */

import { Router, type Request, type Response } from 'express'
import { listObjects, showObject, OBJECT_TYPES, type ObjectType } from '../services/facts.js'
import { ProjectScopeError, requestFactScope } from '../services/requestScope.js'
import { compareTimestamps } from '../services/time.js'
import type { LocalFactScope } from '../services/localFactReader.js'
import {
  WORKCASE_PROGRESS_GROUP_ORDER,
  isResolvedWorkCasePresentationProjection,
  isWorkCaseProgressGroup,
} from '../../shared/workcaseStatus.ts'
import {
  getSparkImplementedPresentationStatus,
  isSparkPresentationStatus,
} from '../../shared/sparkImplementationStatus.ts'
import { getLatestChangeLogAt } from '../../shared/factChangeLog.js'

const router = Router()

export interface ListedObject {
  id: string
  type: string
  status: string
  title: string
  title_en?: string
  title_zh?: string
  path: string
  created?: string
  updated: string
  [key: string]: unknown
}

interface StatusOption {
  status: string
  count: number
}

interface ProgressOption {
  group: string
  count: number
}

type WorkCaseListGroup = (typeof WORKCASE_PROGRESS_GROUP_ORDER)[number] | 'discarded'

function getWorkCaseListGroup(item: ListedObject): WorkCaseListGroup | undefined {
  if (item.progress_group === 'closed' && item.closure_outcome === 'cancelled') return 'discarded'
  if (typeof item.progress_group !== 'string') return undefined
  return item.progress_group === 'termination_cleanup' ? 'closed' : item.progress_group as WorkCaseListGroup
}

const SPARK_PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3']

const STATUS_PRIORITY: Record<string, number> = {
  draft: 8,
  active: 9,
  needs_human_gate: 10,
  open: 11,
  limited: 12,
  input_issue: 13,
  capability_gap: 14,
  evidence_gap: 15,
  fact_conflict: 16,
  // A limited status remains a non-terminal display state for implemented object types.
  degraded: 17,
  suspended: 18,
  proposed: 19,
  pending: 20,
  resolved: 21,
  accepted: 22,
  archived: 23,
  discarded: 24,
  rejected: 25,
  deprecated: 26,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeItem(value: unknown): ListedObject | null {
  if (!isRecord(value)) return null
  const v4Object = typeof value.object_id === 'string' && typeof value.fact_type_key === 'string'
  const id = toStringValue(value.object_id) || toStringValue(value.id)
  if (!id) return null
  const type = toStringValue(value.fact_type_key) || toStringValue(value.type)
  const status = toStringValue(value.status)
  const progressProjection = type === 'workcase' && isResolvedWorkCasePresentationProjection(value.current_snapshot_projection)
    ? value.current_snapshot_projection
    : null

  return {
    ...value,
    id,
    type,
    status,
    progress_group: progressProjection?.progress_group,
    progress_step: progressProjection?.progress_step ?? undefined,
    title: toStringValue(value.title),
    title_en: toStringValue(value.title_en) || undefined,
    title_zh: toStringValue(value.title_zh) || undefined,
    path: v4Object ? toStringValue(value.canonical_path) : toStringValue(value.path),
    created: v4Object ? toStringValue(value.created_at) || undefined : toStringValue(value.created) || undefined,
    // 03 §6.1 不保留公共 updated_at：v4 归档对象优先自身 updated_at/updated，
    // v5 对象回退 change_log 末条流水 at（列表排序与卡片落款共用此值）。
    updated: resolveListItemUpdated(value),
  }
}

/**
 * 列表项的最近更新时刻：updated_at → updated → change_log 末条有效流水 at。
 * 无任何可用时刻时返回空串（既有排序兜底按 id 比较）。
 */
function resolveListItemUpdated(value: Record<string, unknown>): string {
  return toStringValue(value.updated_at)
    || toStringValue(value.updated)
    || getLatestChangeLogAt(value.change_log)
    || ''
}

function getResultItems(result: unknown): ListedObject[] {
  if (!isRecord(result) || !isRecord(result.data) || !Array.isArray(result.data.items)) return []
  return result.data.items
    .map(normalizeItem)
    .filter((item): item is ListedObject => Boolean(item))
}

function getRawItems(result: unknown): Array<Record<string, unknown>> {
  if (!isRecord(result) || !isRecord(result.data) || !Array.isArray(result.data.items)) return []
  return result.data.items.filter(isRecord)
}

function countByStatus(items: Array<{ status: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1
    return counts
  }, {})
}

function compareByUpdatedDesc<T extends { updated?: string; id: string }>(a: T, b: T): number {
  const timeDelta = compareTimestamps(b.updated, a.updated)
  if (timeDelta !== 0) return timeDelta
  return a.id.localeCompare(b.id)
}

function sortByUpdatedDesc<T extends { updated?: string; id: string }>(items: T[]): T[] {
  return [...items].sort(compareByUpdatedDesc)
}

function getStatusOptions(items: ListedObject[]): StatusOption[] {
  return Object.entries(countByStatus(items))
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const statusDelta = (STATUS_PRIORITY[a.status] ?? 50) - (STATUS_PRIORITY[b.status] ?? 50)
      if (statusDelta !== 0) return statusDelta
      if (a.count !== b.count) return b.count - a.count
      return a.status.localeCompare(b.status)
    })
}

/** For Spark lists, replace the single `implemented` bucket with two
 *  presentation-level buckets (`settled` / `unclosed`) derived from each
 *  item's factAssociations. The raw status remains `implemented`. */
function getSparkStatusOptions(items: ListedObject[]): StatusOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    let key = item.status
    if (item.status === 'implemented') {
      key = getSparkImplementedPresentationStatus(
        item.factAssociations as Parameters<typeof getSparkImplementedPresentationStatus>[0],
      )
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const priority: Record<string, number> = { open: 11, settled: 22, unclosed: 23, discarded: 24 }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const statusDelta = (priority[a.status] ?? 50) - (priority[b.status] ?? 50)
      if (statusDelta !== 0) return statusDelta
      if (a.count !== b.count) return b.count - a.count
      return a.status.localeCompare(b.status)
    })
}

function getPriorityOptions(items: ListedObject[]): StatusOption[] {
  const counts = countByStatus(
    items
      .filter((item) => typeof item.priority === 'string')
      .map((item) => ({ status: item.priority as string })),
  )
  return SPARK_PRIORITY_ORDER.map((status) => ({ status, count: counts[status] ?? 0 }))
}

function getWorkCaseProgressOptions(items: ListedObject[]): ProgressOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const group = getWorkCaseListGroup(item)
    if (!group) continue
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...WORKCASE_PROGRESS_GROUP_ORDER.filter((group) => group !== 'termination_cleanup'), 'discarded']
    .map((group) => ({ group, count: counts.get(group) ?? 0 }))
}

function matchesSparkListFilter(item: ListedObject, status?: string, priority?: string): boolean {
  let statusMatch: boolean
  if (!status) {
    statusMatch = true
  } else if (isSparkPresentationStatus(status)) {
    if (item.status !== 'implemented') {
      statusMatch = false
    } else {
      const presentation = getSparkImplementedPresentationStatus(
        item.factAssociations as Parameters<typeof getSparkImplementedPresentationStatus>[0],
      )
      statusMatch = presentation === status
    }
  } else {
    statusMatch = item.status === status
  }
  return statusMatch && (!priority || item.priority === priority)
}

async function listObjectSummaries(type: ObjectType, scope: LocalFactScope): Promise<ListedObject[]> {
  const result = await listObjects(type, undefined, undefined, scope)
  if (!result.ok) return []
  return getResultItems(result)
}


/**
 * GET /api/objects/:type - 列出指定类型的对象
 */
router.get('/:type', async (req: Request, res: Response): Promise<void> => {
  const type = req.params.type as ObjectType

  if (!OBJECT_TYPES.includes(type)) {
    res.status(400).json({
      ok: false,
      error: `Invalid object type: ${type}. Valid types: ${OBJECT_TYPES.join(', ')}`,
    })
    return
  }

  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const progress = type === 'workcase' && typeof req.query.progress === 'string'
    ? req.query.progress
    : undefined
  if (progress && !isWorkCaseProgressGroup(progress) && progress !== 'discarded') {
    res.status(400).json({ ok: false, error: `Invalid WorkCase progress group: ${progress}` })
    return
  }
  const priority = (type === 'spark' || type === 'workcase') && typeof req.query.priority === 'string'
    ? req.query.priority
    : undefined
  let factScope
  try {
    factScope = await requestFactScope(req)
  } catch (scopeError) {
    if (scopeError instanceof ProjectScopeError) {
      res.status(400).json({ ok: false, error: scopeError.message })
      return
    }
    throw scopeError
  }
  const result = await listObjects(type, undefined, type === 'workcase' || type === 'spark' ? undefined : status, factScope)

  if (!result.ok) {
    res.status(typeof result.exitCode === 'string' ? 503 : 500).json(result)
    return
  }

  const rawItems = getRawItems(result)
  const allItems = getResultItems(result)
  const items = type === 'workcase'
    ? allItems.filter((item) => (
      !progress || getWorkCaseListGroup(item) === progress
    ) && (!priority || item.priority === priority))
    : type === 'spark'
      ? allItems.filter((item) => matchesSparkListFilter(item, status, priority))
      : allItems
  if (isRecord(result.data)) {
    const statusItems = type === 'workcase' || type === 'spark'
      ? allItems
      : status ? await listObjectSummaries(type, factScope) : items
    if (type === 'workcase') {
      result.data.progressOptions = getWorkCaseProgressOptions(allItems)
    } else if (type === 'spark') {
      result.data.statusOptions = getSparkStatusOptions(statusItems)
    } else {
      result.data.statusOptions = getStatusOptions(statusItems)
    }
    result.data.statusTotal = statusItems.length
    if (type === 'spark' || type === 'workcase') {
      // Priority counts reflect the current status/progress filter (not
      // priority itself), so the tab numbers stay consistent with the list.
      const priorityGroupItems = type === 'workcase'
        ? progress
          ? allItems.filter((item) => getWorkCaseListGroup(item) === progress)
          : allItems
        : type === 'spark' && status
          ? allItems.filter((item) => matchesSparkListFilter(item, status))
          : allItems
      result.data.priorityOptions = getPriorityOptions(priorityGroupItems)
    }
  }
  if (isRecord(result.data)) {
    result.data.items = type === 'spark'
      ? rawItems
        .map(normalizeItem)
        .filter((item): item is ListedObject => Boolean(item))
        .filter((item) => matchesSparkListFilter(item, status, priority))
        .sort(compareByUpdatedDesc)
      : sortByUpdatedDesc(items)
  }

  res.json(result)
})

/**
 * GET /api/objects/:type/:id - 查看对象详情
 */
router.get('/:type/:id', async (req: Request, res: Response): Promise<void> => {
  const type = req.params.type as ObjectType
  const id = req.params.id

  if (!OBJECT_TYPES.includes(type)) {
    res.status(400).json({
      ok: false,
      error: `Invalid object type: ${type}. Valid types: ${OBJECT_TYPES.join(', ')}`,
    })
    return
  }

  let factScope
  try {
    factScope = await requestFactScope(req)
  } catch (scopeError) {
    if (scopeError instanceof ProjectScopeError) {
      res.status(400).json({ ok: false, error: scopeError.message })
      return
    }
    throw scopeError
  }
  const result = await showObject(id, factScope)

  if (!result.ok) {
    res.status(typeof result.exitCode === 'string' ? 503 : 404).json(result)
    return
  }
  const resultType = isRecord(result.data) && typeof result.data.fact_type_key === 'string'
    ? result.data.fact_type_key
    : isRecord(result.data) && isRecord(result.data.object_ref)
      && typeof result.data.object_ref.fact_type_key === 'string'
      ? result.data.object_ref.fact_type_key
      : undefined
  if (resultType !== undefined && resultType !== type) {
    res.status(404).json({
      ok: false,
      error: `Object not found for type ${type}: ${id}`,
      stderr: '',
      exitCode: 1,
    })
    return
  }

  res.json(result)
})

export default router
