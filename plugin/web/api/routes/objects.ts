
import { Router, type Request, type Response } from 'express'
import { listObjects, showObject, OBJECT_TYPES, type ObjectType } from '../services/facts.js'
import { ProjectScopeError, requestFactScope } from '../services/requestScope.js'
import { compareTimestamps } from '../services/time.js'
import type { LocalFactScope } from '../services/localFactReader.js'
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
  const v5Object = typeof value.object_id === 'string' && typeof value.fact_type_key === 'string'
  const id = toStringValue(value.object_id) || toStringValue(value.id)
  if (!id) return null
  const type = toStringValue(value.fact_type_key) || toStringValue(value.type)
  const status = toStringValue(value.status)

  return {
    ...value,
    id,
    type,
    status,
    title: toStringValue(value.title),
    title_en: toStringValue(value.title_en) || undefined,
    title_zh: toStringValue(value.title_zh) || undefined,
    path: v5Object ? toStringValue(value.canonical_path) : toStringValue(value.path),
    created: v5Object ? toStringValue(value.created_at) || undefined : toStringValue(value.created) || undefined,
    updated: resolveListItemUpdated(value),
  }
}

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

const SPARK_PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'] as const

const REPORT_FORMS = ['research', 'summary', 'audit', 'action', 'reference'] as const

function getFormOptions(items: ListedObject[]): StatusOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const form = (item as Record<string, unknown>).report_form
    if (typeof form !== 'string' || form.length === 0) continue
    counts.set(form, (counts.get(form) ?? 0) + 1)
  }
  return REPORT_FORMS
    .filter((form) => counts.has(form))
    .map((form) => ({ status: form, count: counts.get(form) ?? 0 }))
}

function getSparkPriorityOptions(items: ListedObject[]): StatusOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (typeof item.priority !== 'string') continue
    counts.set(item.priority, (counts.get(item.priority) ?? 0) + 1)
  }
  return SPARK_PRIORITY_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

async function listObjectSummaries(type: ObjectType, scope: LocalFactScope): Promise<ListedObject[]> {
  const result = await listObjects(type, undefined, undefined, scope)
  if (!result.ok) return []
  return getResultItems(result)
}

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
  if (typeof req.query.progress === 'string') {
    res.status(400).json({
      ok: false,
      error: '?progress= 已随 v4 状态机废弃，改用 ?lifecycle=closed|all',
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
  const priority = type === 'spark' && typeof req.query.priority === 'string'
    ? req.query.priority
    : undefined
  if (priority && !SPARK_PRIORITY_ORDER.includes(priority as typeof SPARK_PRIORITY_ORDER[number])) {
    res.status(400).json({ ok: false, error: `Invalid spark priority: ${priority} (20 §8: P0/P1/P2/P3)` })
    return
  }
  const form = type === 'report' && typeof req.query.form === 'string' ? req.query.form : undefined
  if (form && !REPORT_FORMS.includes(form as typeof REPORT_FORMS[number])) {
    res.status(400).json({ ok: false, error: `Invalid report form: ${form} (24 §5: ${REPORT_FORMS.join('/')})` })
    return
  }

  const result = await listObjects(type, undefined, status, factScope)

  if (!result.ok) {
    res.status(typeof result.exitCode === 'string' ? 503 : 500).json(result)
    return
  }

  const allItems = getResultItems(result)
  const items = type === 'spark'
    ? allItems.filter((item) => !priority || item.priority === priority)
    : type === 'report'
      ? allItems.filter((item) => !form || (item as Record<string, unknown>).report_form === form)
      : allItems
  if (isRecord(result.data)) {
    const statusItems = status ? await listObjectSummaries(type, factScope) : items
    result.data.statusOptions = getStatusOptions(statusItems)
    result.data.formOptions = type === 'report' ? getFormOptions(statusItems) : []
    if (type === 'spark') {
      const priorityPool = status
        ? allItems.filter((item) => item.status === status)
        : allItems
      result.data.priorityOptions = getSparkPriorityOptions(priorityPool)
    }
    result.data.statusTotal = statusItems.length
  }
  if (isRecord(result.data)) {
    result.data.items = sortByUpdatedDesc(items)
    if (isRecord(result.summary) && typeof result.summary.count === 'number') {
      result.summary.count = items.length
    }
  }

  res.json(result)
})

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
