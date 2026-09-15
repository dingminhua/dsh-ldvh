/**
 * Objects API 路由：按类型列表和按 ID 查看详情
 */

import { Router, type Request, type Response } from 'express'
import { listObjects, showObject, OBJECT_TYPES, type ObjectType } from '../services/facts.js'
import { ProjectScopeError, requestFactScope } from '../services/requestScope.js'
import { compareTimestamps } from '../services/time.js'
import type { LocalFactScope } from '../services/localFactReader.js'
import {
  WORKCASE_V5_FILTER_VALUES,
  WORKCASE_V5_STATUSES,
  type WorkCaseV5Filter,
  type WorkCaseV5Group,
  deriveWorkCaseV5View,
} from '../../shared/workcaseLifecycle.js'
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

/** v5 WorkCase 列表筛选五档（Human 2026-09-15 定案）。 */
interface LifecycleOption {
  group: WorkCaseV5Filter
  count: number
}

type WorkCaseListStatus = (typeof WORKCASE_V5_STATUSES)[number]

function getWorkCaseStatus(item: ListedObject): WorkCaseListStatus | null {
  return WORKCASE_V5_STATUSES.includes(item.status as WorkCaseListStatus)
    ? (item.status as WorkCaseListStatus)
    : null
}

/** 由 item 可得字段（status / outcome / report_body / fingerprint）派生 v5 视图分组。 */
function getWorkCaseV5Group(item: ListedObject): WorkCaseV5Group | null {
  const status = getWorkCaseStatus(item)
  if (status === null) return null
  const view = deriveWorkCaseV5View(
    status,
    item.outcome ?? null,
    item.report_body ?? null,
    item.source_content_fingerprint ?? null,
  )
  return view.group
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
  const v5Object = typeof value.object_id === 'string' && typeof value.fact_type_key === 'string'
  const id = toStringValue(value.object_id) || toStringValue(value.id)
  if (!id) return null
  // 03 §6.1：fact_type_key 载体值为类型短名（各类型规范登记的值域）——直接
  // 透传，无归一化；非短名形态由读取层报 identity_mismatch，路由层不再兜底。
  const type = toStringValue(value.fact_type_key) || toStringValue(value.type)
  const status = toStringValue(value.status)

  const v5View = type === 'workcase'
    ? deriveWorkCaseV5View(
      getWorkCaseStatus(value as ListedObject),
      (value as Record<string, unknown>).outcome ?? null,
      (value as Record<string, unknown>).report_body ?? null,
      (value as Record<string, unknown>).source_content_fingerprint ?? null,
    )
    : null

  return {
    ...value,
    id,
    type,
    status,
    // v5 WorkCase 派生分组（pending_gate1/executing/awaiting_gate2/closed），
    // 由 workcaseLifecycle 统一派生，不写回对象；列表三态呈现仍可用 status。
    ...(v5View ? { group: v5View.group, outcome: v5View.outcome, has_result_draft: v5View.has_result_draft } : {}),
    title: toStringValue(value.title),
    title_en: toStringValue(value.title_en) || undefined,
    title_zh: toStringValue(value.title_zh) || undefined,
    path: v5Object ? toStringValue(value.canonical_path) : toStringValue(value.path),
    created: v5Object ? toStringValue(value.created_at) || undefined : toStringValue(value.created) || undefined,
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

/** Spark 优先级档位（20 §8，2026-09-13 Human 裁定新增）：闭集 P0–P3，
 *  AI 出初值、Human 可调整；仅 open 时出现。列表据此提供筛选与排序。
 *  （WorkCase 侧仍无此字段——21 §160 字段闭集未含 priority。） */
const SPARK_PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'] as const

function getSparkPriorityOptions(items: ListedObject[]): StatusOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (typeof item.priority !== 'string') continue
    counts.set(item.priority, (counts.get(item.priority) ?? 0) + 1)
  }
  // 未分档的 Spark 不单列选项（20 §8 允许缺失），计数只反映已分档项。
  return SPARK_PRIORITY_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

/**
 * WorkCase 列表筛选五档聚合（v5）：all 恒在，其余四档按派生 group 计数。
 * 21 §160 状态闭集三值 + 派生判据「open ∧ 正文 ## 结果 节 ⇒ awaiting_gate2」。
 */
const WORKCASE_LIST_GROUP_ORDER: readonly WorkCaseV5Group[] = ['pending_gate1', 'executing', 'awaiting_gate2', 'closed']

function getWorkCaseLifecycleOptions(items: ListedObject[]): LifecycleOption[] {
  const counts = new Map<WorkCaseV5Group, number>()
  for (const item of items) {
    const group = getWorkCaseV5Group(item)
    if (!group) continue
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  const options: LifecycleOption[] = WORKCASE_LIST_GROUP_ORDER.map((group) => ({ group, count: counts.get(group) ?? 0 }))
  options.push({ group: 'all', count: items.length })
  return options
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
  // v4 状态机随 21 号三态直读废弃：?progress= 不再接受，提示新参数。
  if (typeof req.query.progress === 'string') {
    res.status(400).json({
      ok: false,
      error: '?progress= 已随 v4 状态机废弃，改用 ?lifecycle=pending_gate1|executing|awaiting_gate2|closed|all',
    })
    return
  }
  // WorkCase 列表筛选按 v5 五档（pending_gate1/executing/awaiting_gate2/closed/all）。
  const lifecycle = type === 'workcase' && typeof req.query.lifecycle === 'string'
    ? req.query.lifecycle
    : undefined
  if (lifecycle && !WORKCASE_V5_FILTER_VALUES.includes(lifecycle as WorkCaseV5Filter)) {
    res.status(400).json({
      ok: false,
      error: `Invalid WorkCase lifecycle filter: ${lifecycle} (v5: pending_gate1|executing|awaiting_gate2|closed|all)`,
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
  // Spark 三联过滤之二：priority（20 §8）。非法值直接 400，避免静默忽略。
  const priority = type === 'spark' && typeof req.query.priority === 'string'
    ? req.query.priority
    : undefined
  if (priority && !SPARK_PRIORITY_ORDER.includes(priority as typeof SPARK_PRIORITY_ORDER[number])) {
    res.status(400).json({ ok: false, error: `Invalid spark priority: ${priority} (20 §8: P0/P1/P2/P3)` })
    return
  }
  // v5 Spark 与通用类型同路径：状态闭集（open/implemented/discarded，20 §9）
  // 直接下推过滤；WorkCase 走 lifecycle 派生分组过滤。
  const result = await listObjects(type, undefined, type === 'workcase' ? undefined : status, factScope)

  if (!result.ok) {
    res.status(typeof result.exitCode === 'string' ? 503 : 500).json(result)
    return
  }

  const allItems = getResultItems(result)
  const items = type === 'workcase'
    ? allItems.filter((item) => {
      if (!lifecycle || lifecycle === 'all') return true
      const group = getWorkCaseV5Group(item)
      return group === lifecycle
    })
    : type === 'spark'
      ? allItems.filter((item) => !priority || item.priority === priority)
      : allItems
  if (isRecord(result.data)) {
    const statusItems = type === 'workcase'
      ? allItems
      : status ? await listObjectSummaries(type, factScope) : items
    if (type === 'workcase') {
      result.data.lifecycleOptions = getWorkCaseLifecycleOptions(allItems)
    } else {
      result.data.statusOptions = getStatusOptions(statusItems)
    }
    if (type === 'spark') {
      // priority 计数与状态过滤同口径（反映当前池，非全量）。
      const priorityPool = status
        ? allItems.filter((item) => item.status === status)
        : allItems
      result.data.priorityOptions = getSparkPriorityOptions(priorityPool)
    }
    result.data.statusTotal = statusItems.length
  }
  if (isRecord(result.data)) {
    result.data.items = sortByUpdatedDesc(items)
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
