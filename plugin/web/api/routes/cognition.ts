
import { Router, type Request, type Response } from 'express'
import { listObjects, deriveServingWorkIndexForScope, type ObjectType } from '../services/facts.js'
import { canonicalUid } from '../../shared/factIdentity.js'
import {
  countChangeLogEntries,
  getLatestChangeLogAt,
  getLatestChangeLogSignature,
  readChangeLogEntrySignature,
  toChangeLogAtText,
  type ChangeLogSignature,
} from '../../shared/factChangeLog.js'
import { normalizeSignature } from '../../shared/signature.js'
import { ProjectScopeError, requestProject } from '../services/requestScope.js'
import { compareTimestamps, getRelativeTime, parseTimestamp } from '../services/time.js'
import { getTypeColor } from '../services/typeColors.js'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'

const router = Router()

type InboxKind = 'plan_confirmation' | 'closure_confirmation' | 'friction_repair'
type InboxObjectType = 'friction'
type RecentActivityKind = 'created' | 'updated'
type RecentActivityWindow = '1d' | '3d' | '7d'

const RECENT_ACTIVITY_WINDOWS: Record<RecentActivityWindow, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
}
const SPARK_TERMINAL_STATUSES = new Set(['implemented', 'discarded'])
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

type CognitionIssue = { section: string; code: string; message: string; object_ref?: string }

const IDENTITY_PROJECTION_KEYS = new Set([
  'object_uid',
  'object_id',
  'fact_type_key',
  'title',
  'title_en',
  'title_zh',
  'status',
  'phase',
  'updated_at',
  'priority',
  'read_status',
  'read_issues',
  'field_issues',
  'unparsed_structures',
  'current_snapshot_projection',
  'group',
  'outcome',
  'has_result_draft',
])

interface InboxBuildItem {
  type: InboxObjectType
  inboxKind: InboxKind
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  priority?: string
  updated_at?: string
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
  read_status: string
  projection: Record<string, unknown>
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
  read_issues: Array<Record<string, unknown>>
}

interface RecentActivityBuildItem {
  type: ObjectType | 'goal'
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  activity: RecentActivityKind
  occurred_at: string
  signature?: FactChangeSignature
  status?: string
  priority?: string
  serves?: string
  occurrence?: { count?: number; first_at?: string; last_at?: string }
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
  read_status: string
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
}

interface RecentActivityObjectItem extends RecentActivityBuildItem {
  activity_count: number
}

interface RecentActivityAttributionUsage {
  value: string
  count: number
}

interface SparkHealthBuildItem {
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  priority?: string
  serves?: string
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
  updated_at: string
  signature?: FactChangeSignature
  activity_count: number
  silent_days: number
  read_status: string
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
}

type FactChangeSignature = ChangeLogSignature

function priorityRank(priority: unknown): number {
  if (typeof priority !== 'string') return 4
  const match = /^P([0-3])$/.exec(priority)
  if (!match) return 4
  return Number(match[1])
}

function canonicalPath(type: InboxObjectType, objectId: string): string {
  const directories: Record<InboxObjectType, string> = {
    friction: 'frictions',
  }
  const directory = directories[type]
  if (directory === undefined) throw new Error(`未知收件类型：${String(type)}`)
  return `ldvh-base/${directory}/${objectId}.md`
}

function factKey(type: string, objectId: string, objectUid?: string): string {
  return canonicalUid(objectUid)
    ? `uid:${objectUid}`
    : `legacy:${type}:${objectId}`
}

function projectFrictionOccurrence(raw: Record<string, unknown>): { occurrence?: Record<string, unknown> } {
  return typeof raw.occurrence === 'object' && raw.occurrence !== null
    ? { occurrence: raw.occurrence as Record<string, unknown> }
    : {}
}

function compareCardBuild(
  a: Pick<InboxBuildItem, 'priority' | 'updated_at' | 'object_id'>,
  b: Pick<InboxBuildItem, 'priority' | 'updated_at' | 'object_id'>,
): number {
  const ra = priorityRank(a.priority)
  const rb = priorityRank(b.priority)
  if (ra !== rb) return ra - rb
  const ua = a.updated_at
  const ub = b.updated_at
  if (ua && ub) {
    const timeDelta = compareTimestamps(ua, ub)
    if (timeDelta !== 0) return timeDelta
    return a.object_id.localeCompare(b.object_id)
  }
  if (ua && !ub) return -1
  if (!ua && ub) return 1
  return a.object_id.localeCompare(b.object_id)
}

function toIssue(record: Record<string, unknown>): CognitionIssue {
  return {
    section: String(record.section ?? 'inbox'),
    code: String(record.code ?? 'unknown'),
    message: String(record.message ?? ''),
    ...(record.object_ref !== undefined ? { object_ref: String(record.object_ref) } : {}),
  }
}

function parseRecentActivityWindow(value: unknown): RecentActivityWindow | null {
  if (value === undefined || value === '') return '1d'
  return typeof value === 'string' && value in RECENT_ACTIVITY_WINDOWS
    ? value as RecentActivityWindow
    : null
}

function timestampInWindow(value: unknown, start: number, end: number): value is string {
  if (typeof value !== 'string') return false
  const timestamp = parseTimestamp(value)
  return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end
}

export function buildFactActivityItems(
  raw: Record<string, unknown>,
  type: ObjectType | 'goal',
  start: number,
  end: number,
): RecentActivityBuildItem[] {
  const changeLog = Array.isArray(raw.change_log) ? raw.change_log : []
  const logged: Array<{ occurredAt: string; index: number; signature?: FactChangeSignature }> = []
  for (let index = 0; index < changeLog.length; index += 1) {
    const entry = changeLog[index]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const at = toChangeLogAtText((entry as Record<string, unknown>).at)
    if (at !== undefined && timestampInWindow(at, start, end)) {
      logged.push({ occurredAt: at, index, signature: readChangeLogEntrySignature(entry) })
    }
  }
  if (logged.length > 0) {
    return logged.map(({ occurredAt, index, signature }) => buildRecentActivityItem(
      raw,
      type,
      index === 0 ? 'created' : 'updated',
      occurredAt,
      signature,
    ))
  }

  const createdAt = raw.created_at
  const updatedAt = getLatestChangeLogAt(raw.change_log)
  const fallback: RecentActivityBuildItem[] = []
  if (timestampInWindow(createdAt, start, end)) {
    fallback.push(buildRecentActivityItem(raw, type, 'created', createdAt, undefined))
  }
  if (timestampInWindow(updatedAt, start, end) && updatedAt !== createdAt) {
    fallback.push(buildRecentActivityItem(raw, type, 'updated', updatedAt, undefined))
  }
  return fallback
}

function compareRecentActivity(a: RecentActivityBuildItem, b: RecentActivityBuildItem): number {
  const timeDelta = compareTimestamps(b.occurred_at, a.occurred_at)
  if (timeDelta !== 0) return timeDelta
  if (a.activity !== b.activity) return a.activity === 'updated' ? -1 : 1
  if (a.type !== b.type) return a.type.localeCompare(b.type)
  return a.object_id.localeCompare(b.object_id)
}

function buildRecentActivityItem(
  raw: Record<string, unknown>,
  type: ObjectType | 'goal',
  activity: RecentActivityKind,
  occurredAt: string,
  signature?: FactChangeSignature,
): RecentActivityBuildItem {
  const object_id = String(raw.object_id ?? '')
  const status = String(raw.status ?? 'unknown')
  return {
    type,
    object_id,
    ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
    title: String(raw.title ?? object_id),
    ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
    ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
    activity,
    occurred_at: occurredAt,
    ...(signature ? { signature } : {}),
    status,
    ...(priorityRank(raw.priority) < 4 && typeof raw.priority === 'string' ? { priority: raw.priority } : {}),
    ...(type === 'spark' && typeof raw.serves === 'string' && raw.serves.trim() ? { serves: raw.serves } : {}),
    ...(type === 'friction' && typeof raw.occurrence === 'object' && raw.occurrence !== null
      ? { occurrence: raw.occurrence as { count?: number; first_at?: string; last_at?: string } }
      : {}),
    read_status: String(raw.read_status ?? 'unknown'),
    field_issues: Array.isArray(raw.field_issues) ? raw.field_issues as Array<Record<string, unknown>> : [],
    unparsed_structures: Array.isArray(raw.unparsed_structures) ? raw.unparsed_structures as Array<Record<string, unknown>> : [],
  }
}

export function buildRecentActivityView(builds: RecentActivityBuildItem[]): {
  items: RecentActivityObjectItem[]
  modelUsage: RecentActivityAttributionUsage[]
  environmentUsage: RecentActivityAttributionUsage[]
} {
  const byObject = new Map<string, RecentActivityObjectItem>()
  const models = new Map<string, number>()
  const environments = new Map<string, number>()
  const uidObjects = new Map<string, Set<string>>()
  for (const build of builds) {
    if (!build.object_uid) continue
    const legacyKey = `${build.type}:${build.object_id}`
    const identities = uidObjects.get(build.object_uid) ?? new Set<string>()
    identities.add(legacyKey)
    uidObjects.set(build.object_uid, identities)
  }

  for (const build of builds) {
    const uniqueUid = build.object_uid && uidObjects.get(build.object_uid)?.size === 1
      ? build.object_uid
      : undefined
    const key = factKey(build.type, build.object_id, uniqueUid)
    const existing = byObject.get(key)
    if (!existing) {
      byObject.set(key, { ...build, activity_count: 1 })
    } else {
      existing.activity_count += 1
      if (compareRecentActivity(build, existing) < 0) {
        const activityCount = existing.activity_count
        byObject.set(key, { ...build, activity_count: activityCount })
      }
    }
    if (build.signature) {
      const { modelName: model, productName: environment } = normalizeSignature(build.signature)
      if (model) models.set(model, (models.get(model) ?? 0) + 1)
      if (environment) environments.set(environment, (environments.get(environment) ?? 0) + 1)
    }
  }

  const compareUsage = (a: RecentActivityAttributionUsage, b: RecentActivityAttributionUsage) => (
    b.count - a.count || a.value.localeCompare(b.value)
  )
  return {
    items: [...byObject.values()].sort(compareRecentActivity),
    modelUsage: [...models.entries()].map(([value, count]) => ({ value, count })).sort(compareUsage),
    environmentUsage: [...environments.entries()].map(([value, count]) => ({ value, count })).sort(compareUsage),
  }
}

function silentDays(updatedAt: unknown, observedAt: number): number | null {
  if (typeof updatedAt !== 'string') return null
  const updatedAtMs = parseTimestamp(updatedAt)
  if (!Number.isFinite(updatedAtMs) || updatedAtMs > observedAt) return null
  return Math.floor((observedAt - updatedAtMs) / MILLISECONDS_PER_DAY)
}

function compareSilentSpark(a: SparkHealthBuildItem, b: SparkHealthBuildItem): number {
  if (a.silent_days !== b.silent_days) return b.silent_days - a.silent_days
  const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority)
  if (priorityDifference !== 0) return priorityDifference
  const timeDelta = compareTimestamps(b.updated_at, a.updated_at)
  if (timeDelta !== 0) return timeDelta
  return a.object_id.localeCompare(b.object_id)
}

export function buildSparkHealth(
  rawItems: Array<Record<string, unknown>>,
  observedAt: number,
) {
  const terminalByStatus = { implemented: 0, discarded: 0 }
  const openByPriority: Record<string, number> = {}
  const openItems: SparkHealthBuildItem[] = []
  let total = 0
  let openTotal = 0

  for (const raw of rawItems) {
    const status = typeof raw.status === 'string' ? raw.status : ''
    if (status !== 'open' && !SPARK_TERMINAL_STATUSES.has(status)) continue
    total += 1
    if (status !== 'open') {
      terminalByStatus[status as keyof typeof terminalByStatus] += 1
      continue
    }

    openTotal += 1
    const priority = priorityRank(raw.priority) < 4 && typeof raw.priority === 'string' ? raw.priority : undefined
    if (priority) openByPriority[priority] = (openByPriority[priority] ?? 0) + 1
    const updatedAt = getLatestChangeLogAt(raw.change_log) ?? ''
    const days = silentDays(updatedAt, observedAt)
    if (days === null) continue
    const signature = getLatestChangeLogSignature(raw.change_log)
    const item: SparkHealthBuildItem = {
      object_id: String(raw.object_id ?? ''),
      ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
      title: String(raw.title ?? raw.object_id ?? ''),
      ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
      ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
      ...(priority ? { priority } : {}),
      ...(typeof raw.serves === 'string' && raw.serves.trim() ? { serves: raw.serves } : {}),
      updated_at: updatedAt,
      ...(signature ? { signature } : {}),
      activity_count: countChangeLogEntries(raw.change_log),
      silent_days: days,
      read_status: String(raw.read_status ?? 'unknown'),
      field_issues: Array.isArray(raw.field_issues) ? raw.field_issues as Array<Record<string, unknown>> : [],
      unparsed_structures: Array.isArray(raw.unparsed_structures) ? raw.unparsed_structures as Array<Record<string, unknown>> : [],
    }
    openItems.push(item)
  }

  openItems.sort(compareSilentSpark)
  const terminalTotal = terminalByStatus.implemented + terminalByStatus.discarded
  return {
    total,
    openTotal,
    terminalTotal,
    terminalByStatus,
    openByPriority,
    openItems,
  }
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const generatedAt = new Date().toISOString()
  try {
    const locale = String(req.query.locale || 'zh')
    const recentWindow = parseRecentActivityWindow(req.query.window)
    if (recentWindow === null) {
      res.status(400).json({ ok: false, error: 'Unsupported recent activity window' })
      return
    }
    const project = await requestProject(req)
    const factScope = { worktreeLocator: project.path, governedProjectId: project.id }

    const [pitfallResult, sparkResult, studyResult, frictionResult, normResult, subGoalResult] = await Promise.all([
      listObjects('pitfall', undefined, undefined, factScope),
      listObjects('spark', undefined, undefined, factScope),
      listObjects('report', undefined, undefined, factScope),
      listObjects('friction', undefined, undefined, factScope),
      listObjects('norm', undefined, undefined, factScope),
      listObjects('subgoal', undefined, undefined, factScope),
    ])
    const issues: CognitionIssue[] = []
    let sparkHealth: ReturnType<typeof buildSparkHealth> | undefined
    if (!sparkResult.ok || !('data' in sparkResult)) {
      const message = sparkResult.ok ? 'Spark 列表读取失败' : (sparkResult as { error: string }).error
      issues.push({ section: 'sparkHealth', code: 'spark_list_unavailable', message })
    } else {
      const data = sparkResult.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(data.collection_issues) ? data.collection_issues : []) {
        issues.push({ ...toIssue(issue), section: 'sparkHealth' })
      }
      sparkHealth = buildSparkHealth(data.items, parseTimestamp(generatedAt))
    }
    const builds: InboxBuildItem[] = []
    let acceptedFrictionCount = 0
    if (!frictionResult.ok || !('data' in frictionResult)) {
      const message = frictionResult.ok ? 'Friction 列表读取失败' : (frictionResult as { error: string }).error
      issues.push({ section: 'inbox', code: 'friction_list_unavailable', message })
    } else {
      const data = frictionResult.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(data.collection_issues) ? data.collection_issues : []) issues.push(toIssue(issue))
      for (const raw of data.items) {
        if (raw.status === 'accepted') acceptedFrictionCount += 1
      }
      for (const raw of data.items) {
        if (raw.status !== 'open') continue
        const object_id = String(raw.object_id ?? '')
        builds.push({
          type: 'friction', inboxKind: 'friction_repair', object_id, title: String(raw.title ?? object_id),
          ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
          ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
          ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
          updated_at: getLatestChangeLogAt(raw.change_log),
          read_status: String(raw.read_status ?? 'unknown'), projection: raw,
          field_issues: Array.isArray(raw.field_issues) ? (raw.field_issues as Array<Record<string, unknown>>) : [],
          unparsed_structures: Array.isArray(raw.unparsed_structures) ? (raw.unparsed_structures as Array<Record<string, unknown>>) : [],
          read_issues: Array.isArray(raw.read_issues) ? (raw.read_issues as Array<Record<string, unknown>>) : [],
        })
      }
    }
    builds.sort(compareCardBuild)

    const recentStart = new Date(generatedAt).getTime() - RECENT_ACTIVITY_WINDOWS[recentWindow] * 24 * 60 * 60 * 1000
    const recentBuilds: RecentActivityBuildItem[] = []
    const recentSources: Array<[ObjectType, typeof pitfallResult]> = [
      ['pitfall', pitfallResult],
      ['spark', sparkResult],
      ['report', studyResult],
      ['friction', frictionResult],
      ['norm', normResult],
      ['subgoal', subGoalResult],
    ]
    for (const [type, source] of recentSources) {
      if (!source.ok || !('data' in source)) {
        const message = source.ok ? `${type} 列表读取失败` : (source as { error: string }).error
        issues.push({ section: 'recentActivity', code: `${type}_list_unavailable`, message })
        continue
      }
      const sourceData = source.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(sourceData.collection_issues) ? sourceData.collection_issues : []) {
        issues.push({ ...toIssue(issue), section: 'recentActivity' })
      }
      for (const raw of sourceData.items) {
        recentBuilds.push(...buildFactActivityItems(raw, type, recentStart, parseTimestamp(generatedAt)))
      }
    }
    const goalRecord = await readGoalRecord(project)
    if (goalRecord.status === 'readable') {
      recentBuilds.push(...buildFactActivityItems(
        {
          ...goalRecord.raw,
          object_id: 'goal',
          read_status: 'readable',
          field_issues: goalRecord.fieldIssues,
          unparsed_structures: [],
        },
        'goal',
        recentStart,
        parseTimestamp(generatedAt),
      ))
    } else if (goalRecord.status === 'unreadable') {
      issues.push({ section: 'recentActivity', code: 'goal_unreadable', message: goalRecord.issues[0]?.message ?? 'goal.md 读取失败' })
    }
    recentBuilds.sort(compareRecentActivity)

    const items = builds.map((build) => {
      const card = Object.fromEntries(
        Object.entries(build.projection).filter(([key]) => !IDENTITY_PROJECTION_KEYS.has(key)),
      )
      const entry: Record<string, unknown> = {
        type: build.type,
        id: build.object_id,
        ...(build.object_uid ? { object_uid: build.object_uid } : {}),
        title: build.title,
        ...(build.title_en !== undefined ? { title_en: build.title_en } : {}),
        ...(build.title_zh !== undefined ? { title_zh: build.title_zh } : {}),
        relativeTime: getRelativeTime(build.updated_at ?? '', locale),
        typeColor: getTypeColor(build.type),
        inboxKind: build.inboxKind,
        read_status: build.read_status,
        card,
      }
      {
        entry.status = String(build.projection.status ?? '')
        Object.assign(entry, projectFrictionOccurrence(build.projection))
      }
      if (build.refs !== undefined) entry.refs = build.refs
      if (priorityRank(build.priority) < 4 && typeof build.priority === 'string') entry.priority = build.priority
      if (build.updated_at) entry.updatedAt = build.updated_at
      if (build.read_status === 'readable') entry.canonical_path = canonicalPath(build.type, build.object_id)
      if (build.field_issues.length > 0) entry.field_issues = build.field_issues
      if (build.unparsed_structures.length > 0) entry.unparsed_structures = build.unparsed_structures
      if (build.read_issues.length > 0) entry.read_issues = build.read_issues
      return entry
    })

    const recentActivityView = buildRecentActivityView(recentBuilds)
    const recentItems = recentActivityView.items.map((build) => ({
      type: build.type,
      id: build.object_id,
      ...(build.object_uid ? { object_uid: build.object_uid } : {}),
      title: build.title,
      ...(build.title_en !== undefined ? { title_en: build.title_en } : {}),
      ...(build.title_zh !== undefined ? { title_zh: build.title_zh } : {}),
      activity: build.activity,
      occurredAt: build.occurred_at,
      ...(build.signature !== undefined ? { signature: build.signature } : {}),
      activityCount: build.activity_count,
      relativeTime: getRelativeTime(build.occurred_at, locale),
      typeColor: getTypeColor(build.type),
      ...(build.priority !== undefined ? { priority: build.priority } : {}),
      ...(build.serves !== undefined ? { serves: build.serves } : {}),
      ...(build.occurrence !== undefined ? { occurrence: build.occurrence } : {}),
      ...(build.refs !== undefined ? { refs: build.refs } : {}),
      ...(build.status !== undefined ? { status: build.status } : {}),
      read_status: build.read_status,
      ...(build.field_issues.length > 0 ? { field_issues: build.field_issues } : {}),
      ...(build.unparsed_structures.length > 0 ? { unparsed_structures: build.unparsed_structures } : {}),
    }))

    res.json({
      generatedAt,
      scope: { governedProjectId: project.id },
      inbox: { items, total: items.length },
      frictionLedger: { acceptedCount: acceptedFrictionCount },
      recentActivity: {
        window: recentWindow,
        windowStart: new Date(recentStart).toISOString(),
        items: recentItems,
        total: recentItems.length,
        eventTotal: recentBuilds.length,
        modelUsage: recentActivityView.modelUsage,
        environmentUsage: recentActivityView.environmentUsage,
      },
      ...(sparkHealth ? {
        sparkHealth: {
          total: sparkHealth.total,
          openTotal: sparkHealth.openTotal,
          terminalTotal: sparkHealth.terminalTotal,
          terminalByStatus: sparkHealth.terminalByStatus,
          openByPriority: sparkHealth.openByPriority,
          openItems: sparkHealth.openItems.map((item) => ({
            type: 'spark',
            id: item.object_id,
            ...(item.object_uid ? { object_uid: item.object_uid } : {}),
            title: item.title,
            ...(item.title_en !== undefined ? { title_en: item.title_en } : {}),
            ...(item.title_zh !== undefined ? { title_zh: item.title_zh } : {}),
            ...(item.priority !== undefined ? { priority: item.priority } : {}),
            ...(item.serves !== undefined ? { serves: item.serves } : {}),
            ...(item.refs !== undefined ? { refs: item.refs } : {}),
            updatedAt: item.updated_at,
            ...(item.signature !== undefined ? { signature: item.signature } : {}),
            activityCount: item.activity_count,
            silentDays: item.silent_days,
            typeColor: getTypeColor('spark'),
            read_status: item.read_status,
            ...(item.field_issues.length > 0 ? { field_issues: item.field_issues } : {}),
            ...(item.unparsed_structures.length > 0 ? { unparsed_structures: item.unparsed_structures } : {}),
          })),
        },
      } : {}),
      ...(issues.length > 0 ? { issues } : {}),
    })
  } catch (err) {
    if (err instanceof ProjectScopeError) {
      res.status(400).json({ ok: false, error: err.message })
      return
    }
    console.error('Cognition aggregation failed', err)
    res.status(500).json({ ok: false, error: 'Cognition aggregation failed' })
  }
})

type GoalSubGoal = {
  id: string
  text: string
  status?: string
  criterion_kind?: string
  criterion?: string
  object_uid?: string
  order?: number
  created_at?: string
  serving_work?: Array<{
    object_uid?: string
    type: string
    id: string
    title: string
    status: string
    governed_project_id: string
    group?: string
    href: string
  }>
  serving_unreadable?: string[]
  legacy?: boolean
}

function legacySubGoalAnchors(body: string): Array<{ anchor: string; text: string }> {
  const sectionMatch = /^##\s*子目标\s*$/m.exec(body)
  if (!sectionMatch) return []
  const rest = body.slice(sectionMatch.index + sectionMatch[0].length)
  const nextH2 = /^##\s/m.exec(rest)
  const section = nextH2 ? rest.slice(0, nextH2.index) : rest
  const out: Array<{ anchor: string; text: string }> = []
  const sgRe = /^\s*(?:[-*+]\s+)?(SG-\d+)[:：]?\s+(.+)$/
  for (const line of section.split('\n')) {
    const match = sgRe.exec(line)
    if (match) out.push({ anchor: match[1].trim(), text: match[2].trim() })
  }
  return out
}

async function readSubGoalProjection(
  project: { path: string },
  legacy: Array<{ anchor: string; text: string }>,
): Promise<GoalSubGoal[]> {
  const dir = path.join(project.path, 'ldvh-base', 'subgoals')
  const rows: GoalSubGoal[] = []
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    try {
      const raw = await readFile(path.join(dir, name), 'utf-8')
      const parsed = parseCarrierFrontmatter(raw)
      if (parsed === null) continue
      const objectUid = typeof parsed.object_uid === 'string' ? parsed.object_uid.trim() : ''
      if (objectUid === '') continue
      rows.push({
        id: objectUid,
        order: typeof parsed.order === 'number' ? parsed.order : undefined,
        created_at: typeof parsed.created_at === 'string' ? parsed.created_at : undefined,
        text: typeof parsed.title === 'string' && parsed.title.trim() !== ''
          ? parsed.title.trim()
          : (typeof parsed.criterion === 'string' ? parsed.criterion.trim() : ''),
        status: typeof parsed.status === 'string' ? parsed.status : undefined,
        criterion_kind: typeof parsed.criterion_kind === 'string' ? parsed.criterion_kind : undefined,
        criterion: typeof parsed.criterion === 'string' && parsed.criterion.trim() !== ''
          ? parsed.criterion.trim()
          : undefined,
        object_uid: objectUid,
      })
    } catch {
      continue
    }
  }
  rows.sort(compareSubGoalDisplayOrder)
  for (const entry of legacy) {
    rows.push({ id: entry.anchor, text: entry.text, legacy: true })
  }
  return rows
}

function compareSubGoalDisplayOrder(a: GoalSubGoal, b: GoalSubGoal): number {
  const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY
  const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY
  if (ao !== bo) return ao - bo
  const ac = a.created_at ?? ''
  const bc = b.created_at ?? ''
  if (ac !== bc) return ac < bc ? -1 : 1
  return a.id.localeCompare(b.id)
}

const GOAL_REQUIRED_FIELDS = ['goal_key', 'title', 'status', 'created_at'] as const

type GoalRecord =
  | { status: 'missing' }
  | { status: 'unreadable'; issues: Array<{ code: string; message: string; path?: string }> }
  | {
      status: 'readable'
      raw: Record<string, unknown>
      frontmatterSource: string
      statement: string
      subGoals: GoalSubGoal[]
      fieldIssues: Array<{ path: string; reason: 'missing' | 'identity_mismatch'; expected: string; raw_value?: unknown }>
      issues: Array<{ code: string; message: string; path?: string }>
    }

async function readGoalRecord(project: { path: string }): Promise<GoalRecord> {
  const goalPath = path.join(project.path, 'ldvh-base', 'goal.md')
  let raw: string
  try {
    raw = await readFile(goalPath, 'utf-8')
  } catch {
    return { status: 'missing' }
  }
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { status: 'unreadable', issues: [{ code: 'frontmatter_missing', message: 'goal.md 缺少 frontmatter', path: 'ldvh-base/goal.md' }] }
  }
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIdx === -1) {
    return { status: 'unreadable', issues: [{ code: 'frontmatter_unclosed', message: 'goal.md frontmatter 未闭合', path: 'ldvh-base/goal.md' }] }
  }
  const frontmatterSource = lines.slice(1, endIdx).join('\n')
  const body = lines.slice(endIdx + 1).join('\n')
  let meta: Record<string, unknown>
  try {
    meta = yaml.load(frontmatterSource) as Record<string, unknown>
  } catch (err) {
    return { status: 'unreadable', issues: [{ code: 'frontmatter_parse_failed', message: `goal.md frontmatter 解析失败：${err instanceof Error ? err.message : String(err)}`, path: 'ldvh-base/goal.md' }] }
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { status: 'unreadable', issues: [{ code: 'frontmatter_parse_failed', message: 'goal.md frontmatter 顶层不是键值映射', path: 'ldvh-base/goal.md' }] }
  }

  let statement = ''
  const stmtMatch = /^##\s*目标陈述\s*$/m.exec(body)
  if (stmtMatch) {
    const stmtSection = body.slice(stmtMatch.index + stmtMatch[0].length)
    const nextH2 = /^##\s/m.exec(stmtSection)
    statement = (nextH2 ? stmtSection.slice(0, nextH2.index) : stmtSection).trim()
  }

  const subGoals: GoalSubGoal[] = await readSubGoalProjection(project, legacySubGoalAnchors(body))

  const fieldIssues: Array<{ path: string; reason: 'missing' | 'identity_mismatch'; expected: string; raw_value?: unknown }> = []
  for (const fieldKey of GOAL_REQUIRED_FIELDS) {
    const value = (meta as Record<string, unknown>)[fieldKey]
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      fieldIssues.push({ path: fieldKey, reason: 'missing', expected: 'string' })
    }
  }
  if (typeof meta.goal_key === 'string' && meta.goal_key !== 'project-goal') {
    fieldIssues.push({ path: 'goal_key', reason: 'identity_mismatch', expected: 'project-goal', raw_value: meta.goal_key })
  }

  return {
    status: 'readable',
    raw: { ...meta },
    frontmatterSource,
    statement,
    subGoals,
    fieldIssues,
    issues: [],
  }
}

function parseCarrierFrontmatter(raw: string): Record<string, unknown> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (match === null) return null
  try {
    const value = yaml.load(match[1])
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

router.get('/goal', async (req: Request, res: Response): Promise<void> => {
  try {
    const project = await requestProject(req)
    const record = await readGoalRecord(project)
    if (record.status === 'missing') {
      res.status(404).json({ ok: false, error: 'goal.md 不存在——Goal 事实对象尚未创建', exitCode: 'goal_missing' })
      return
    }
    if (record.status === 'unreadable') {
      const first = record.issues[0]
      res.status(500).json({ ok: false, error: first?.message ?? 'goal.md 读取失败', code: first?.code ?? 'goal_read_failed' })
      return
    }
    const meta = record.raw
    const factScope = { worktreeLocator: project.path, governedProjectId: project.id }
    const servingIndex = await deriveServingWorkIndexForScope(factScope)
    const subGoalsWithServing = record.subGoals.map((sg) => {
      if (typeof sg.object_uid !== 'string' || sg.object_uid === '') return sg
      const derived = servingIndex.bySubGoal.get(sg.object_uid) ?? []
      return {
        ...sg,
        serving_work: derived,
        ...(servingIndex.unreadable.length > 0 ? { serving_unreadable: servingIndex.unreadable } : {}),
      }
    })
    res.json({
      ok: true,
      goal: {
        goal_key: typeof meta.goal_key === 'string' ? meta.goal_key : 'project-goal',
        title: typeof meta.title === 'string' ? meta.title : '',
        status: typeof meta.status === 'string' ? meta.status : 'active',
        statement: record.statement,
        sub_goals: subGoalsWithServing,
        created_at: typeof meta.created_at === 'string' ? meta.created_at : undefined,
        change_log: Array.isArray(meta.change_log) ? meta.change_log : [],
        canonical_path: 'ldvh-base/goal.md',
        yaml_source: record.frontmatterSource,
        carrier: 'markdown',
        read_status: 'readable',
        field_issues: record.fieldIssues,
        unparsed_structures: [],
        read_issues: record.issues,
      },
    })
  } catch (err) {
    if (err instanceof ProjectScopeError) {
      res.status(400).json({ ok: false, error: err.message })
      return
    }
    console.error('Goal read failed', err)
    res.status(500).json({ ok: false, error: 'Goal read failed' })
  }
})

export default router
