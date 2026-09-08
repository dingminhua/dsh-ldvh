/**
 * Cognition API 路由：聚合项目认知中心的待决定事项、推进中事项与近期动态。
 *
 * 已交付模块一（待决定事项）、模块二（近期动态）、模块三（近期热点关系）与模块四（Spark 池健康）
 * + §5 全局信任标记所需的派生字段：
 * generatedAt（观察时间）、scope、inbox（WorkCase Human Gate 与 Pitfall draft 审核的派生收录与排序）、
 * recentActivity（指定窗口内事实对象 change_log 的创建 / 更新事件）、recentHotspots（最近一周内
 * 的事实热点及一跳正式关系）与 issues（模块级降级）。
 * 数据经 Web 字段级直读（localFactReader / facts.ts 的 listObjects），不复用 /api/dashboard 聚合逻辑。
 *
 * 命名纪律（02 §7 第 3 条）：WorkCase 条目只携带 progress_group；待决类型 inboxKind
 * 表示 Human 的计划批准、关闭确认、阻塞待处置或 Pitfall draft 审核。progress_group
 * 决定两个既有行动模块的唯一归属；blocking_overlay 只改变 Human-position 的呈现类型。
 */

import { Router, type Request, type Response } from 'express'
import { listObjects, type ObjectType } from '../services/facts.js'
import { listLocalFacts, type LocalFactItem } from '../services/localFactReader.js'
import {
  deriveWorkCasePresentationProjection,
  isResolvedWorkCasePresentationProjection,
  type ResolvedWorkCasePresentationProjection,
  type WorkCaseProgressGroup,
  type WorkCaseProgressStep,
} from '../../shared/workcaseStatus.js'
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
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'

const router = Router()

type InboxKind = 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution' | 'pitfall_confirmation'
type InboxObjectType = 'workcase' | 'pitfall'
type RecentActivityKind = 'created' | 'updated'
type RecentActivityWindow = '1d' | '3d' | '7d'

const RECENT_ACTIVITY_WINDOWS: Record<RecentActivityWindow, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
}
const RECENT_HOTSPOT_WINDOW: RecentActivityWindow = '7d'
const SPARK_SILENT_THRESHOLD_DAYS = 5
const SPARK_TERMINAL_STATUSES = new Set(['implemented', 'discarded'])
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

type CognitionIssue = { section: string; code: string; message: string; object_ref?: string }

/** 决定依据投影中属于对象身份的字段，不重复收入 card。 */
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
  'progress_group',
  'progress_step',
])

interface InboxBuildItem {
  type: InboxObjectType
  inboxKind: InboxKind
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  progress_group?: WorkCaseProgressGroup
  lifecycle_position?: ResolvedWorkCasePresentationProjection['lifecycle_position']
  blocking_overlay?: boolean
  priority?: string
  updated_at?: string
  read_status: string
  projection: Record<string, unknown>
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
  read_issues: Array<Record<string, unknown>>
}

interface ActiveWorkCaseBuildItem {
  type: 'workcase'
  progress_group: 'progressing' | 'termination_cleanup'
  progress_step?: WorkCaseProgressStep
  lifecycle_position: ResolvedWorkCasePresentationProjection['lifecycle_position']
  blocking_overlay: boolean
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  priority?: string
  updated_at?: string
  read_status: string
  projection: Record<string, unknown>
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
  read_issues: Array<Record<string, unknown>>
}

interface RecentActivityBuildItem {
  type: ObjectType
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  activity: RecentActivityKind
  occurred_at: string
  /** 只读取对应事实流水的完整署名；兼容时间标记不伪造署名。 */
  signature?: FactChangeSignature
  status?: string
  progress_group?: WorkCaseProgressGroup
  priority?: string
  read_status: string
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
}

interface RecentActivityObjectItem extends RecentActivityBuildItem {
  /** 当前窗口内该稳定事实对象的可读流水数。 */
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
  updated_at: string
  /** 取最近一条具备完整署名的事实流水，与对象卡片落款规则一致。 */
  signature?: FactChangeSignature
  /** 当前对象可读 change_log 中的受控修改流水数。 */
  activity_count: number
  silent_days: number
  read_status: string
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
}

/** 面向 Web 的当前两字段事实流水署名；历史字段只读兼容但不投影。单一实现在 shared/factChangeLog。 */
type FactChangeSignature = ChangeLogSignature

export interface RecentHotspotBuildItem {
  type: ObjectType
  object_id: string
  object_uid?: string
  title: string
  title_en?: string
  title_zh?: string
  status?: string
  progress_group?: WorkCaseProgressGroup
  priority?: string
  read_status: string
  lifecycle_position?: ResolvedWorkCasePresentationProjection['lifecycle_position']
  relations: unknown
}

interface RecentHotspotRef {
  occurred_at: string
  activity: RecentActivityKind
}

interface RecentHotspotNode extends Omit<RecentHotspotBuildItem, 'object_id' | 'relations' | 'phase'> {
  id: string
  typeColor: string
  activityRefs: RecentHotspotRef[]
}

interface RecentHotspotEdge {
  source: string
  target: string
  relationKey: string
}

interface RecentHotspotRelation {
  direction: 'outgoing' | 'incoming'
  relationKey: string
  node: RecentHotspotNode
}

/** P0=0 … P3=3；缺失或非法落 4（排最后，并省略优先级信号）。 */
function priorityRank(priority: unknown): number {
  if (typeof priority !== 'string') return 4
  const match = /^P([0-3])$/.exec(priority)
  if (!match) return 4
  return Number(match[1])
}

/** 与 localFactReader.metadataFor 一致：按事实类型返回当前 canonical path。 */
function canonicalPath(type: InboxObjectType, objectId: string): string {
  return `ldvh-base/${type === 'workcase' ? 'workcases' : 'pitfalls'}/${objectId}.yaml`
}

function factKey(type: string, objectId: string, objectUid?: string): string {
  return objectUid && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(objectUid)
    ? `uid:${objectUid}`
    : `legacy:${type}:${objectId}`
}

function deriveInboxKind(projection: ResolvedWorkCasePresentationProjection): InboxKind | null {
  if (projection.progress_group !== 'plan_confirmation' && projection.progress_group !== 'closure_confirmation') {
    return null
  }
  if (projection.blocking_overlay) return 'blocked_resolution'
  if (projection.progress_group === 'plan_confirmation' && projection.handoff_narrative_key === 'gate1_waiting') {
    return 'plan_confirmation'
  }
  if (projection.progress_group === 'closure_confirmation' && projection.handoff_narrative_key === 'gate2_waiting') {
    return 'closure_confirmation'
  }
  return null
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
  // updated_at 正序（等待最久在前）；相同按 object_id 升序 tiebreak；缺失排最后。
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

function currentWorkCaseProjection(raw: Record<string, unknown>): ResolvedWorkCasePresentationProjection | null {
  return isResolvedWorkCasePresentationProjection(raw.current_snapshot_projection)
    ? raw.current_snapshot_projection
    : null
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
  type: ObjectType,
  activity: RecentActivityKind,
  occurredAt: string,
  signature?: FactChangeSignature,
): RecentActivityBuildItem {
  const object_id = String(raw.object_id ?? '')
  const status = String(raw.status ?? 'unknown')
  const progressGroup = type === 'workcase'
    ? currentWorkCaseProjection(raw)?.progress_group
    : undefined
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
    ...(type === 'workcase' ? { progress_group: progressGroup } : { status }),
    ...(priorityRank(raw.priority) < 4 && typeof raw.priority === 'string' ? { priority: raw.priority } : {}),
    read_status: String(raw.read_status ?? 'unknown'),
    field_issues: Array.isArray(raw.field_issues) ? raw.field_issues as Array<Record<string, unknown>> : [],
    unparsed_structures: Array.isArray(raw.unparsed_structures) ? raw.unparsed_structures as Array<Record<string, unknown>> : [],
  }
}



/**
 * 将事实对象自身的流水转为近期动态。流水只约定 `at`，没有独立动作字段；
 * 因此第一条有效记录表示受控创建，之后的记录表示受控更新。没有可读流水的
 * 旧事实才使用 created_at 作为兼容回退（不读 updated_at——03 第 6.1 节不保留
 * 该公共字段），绝不从 Git 提交反推事件。
 */
export function buildFactActivityItems(
  raw: Record<string, unknown>,
  type: ObjectType,
  start: number,
  end: number,
): RecentActivityBuildItem[] {
  const changeLog = Array.isArray(raw.change_log) ? raw.change_log : []
  const logged: Array<{ occurredAt: string; index: number; signature?: FactChangeSignature }> = []
  for (let index = 0; index < changeLog.length; index += 1) {
    const entry = changeLog[index]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    // YAML 未加引号的时间戳在进程内是 Date 实例——先归一为文本再判窗口；
    // 署名读取 v5 扁平 provider/model 与 v4 嵌套 signature 两种形态。
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
  // 03 §6.1：最近更新时间取 change_log 末条流水的 at，不读 updated_at。
  const updatedAt = getLatestChangeLogAt(raw.change_log)
  const fallback: RecentActivityBuildItem[] = []
  if (timestampInWindow(createdAt, start, end)) {
    fallback.push(buildRecentActivityItem(raw, type, 'created', createdAt))
  }
  if (timestampInWindow(updatedAt, start, end) && updatedAt !== createdAt) {
    fallback.push(buildRecentActivityItem(raw, type, 'updated', updatedAt))
  }
  return fallback
}

/**
 * 近期动态按稳定事实对象合并：相同对象只保留最近一条作为阅读锚点，
 * 并如实保留窗口内流水数。署名用量仍按每一条事实流水计数，不从对象头推断。
 */
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
      // 单次归一取两个维度：v5 provider 逐字（供应商 id 不美化），
      // v4 product_name 走既有归一（'cindy'→'Cindy' 等契约行为保持）。
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
  // updated_at 为内部结构字段，已由 change_log 末条 at 填充。
  const timeDelta = compareTimestamps(b.updated_at, a.updated_at)
  if (timeDelta !== 0) return timeDelta
  return a.object_id.localeCompare(b.object_id)
}

/** Spark 健康度只聚合当前状态与更新时间；不从更新时间推断实际分流发生时刻。 */
export function buildSparkHealth(rawItems: Array<Record<string, unknown>>, observedAt: number) {
  const terminalByStatus = { implemented: 0, discarded: 0 }
  const openByPriority: Record<string, number> = {}
  const openItems: SparkHealthBuildItem[] = []
  const silentItems: SparkHealthBuildItem[] = []
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
    // 03 §6.1：最近更新时间取 change_log 末条流水的 at，不读 updated_at。
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
      updated_at: updatedAt,
      ...(signature ? { signature } : {}),
      activity_count: countChangeLogEntries(raw.change_log),
      silent_days: days,
      read_status: String(raw.read_status ?? 'unknown'),
      field_issues: Array.isArray(raw.field_issues) ? raw.field_issues as Array<Record<string, unknown>> : [],
      unparsed_structures: Array.isArray(raw.unparsed_structures) ? raw.unparsed_structures as Array<Record<string, unknown>> : [],
    }
    openItems.push(item)
    if (days >= SPARK_SILENT_THRESHOLD_DAYS) silentItems.push(item)
  }

  openItems.sort(compareSilentSpark)
  silentItems.sort(compareSilentSpark)
  const terminalTotal = terminalByStatus.implemented + terminalByStatus.discarded
  return {
    total,
    openTotal,
    terminalTotal,
    terminalByStatus,
    openByPriority,
    silentThresholdDays: SPARK_SILENT_THRESHOLD_DAYS,
    silentCount: silentItems.length,
    openItems,
    silentItems,
  }
}

export function projectRecentHotspotFact(item: LocalFactItem, type: ObjectType): RecentHotspotBuildItem | null {
  const raw = item.fact_object
  if (item.read_status !== 'readable' || raw === null || item.field_issues.length > 0) return null
  if (item.object_ref.fact_type_key !== type || !item.object_ref.object_id) return null
  const objectId = item.object_ref.object_id
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : null
  if (title === null) return null
  const status = typeof raw.status === 'string' ? raw.status : undefined
  const currentProjection = type === 'workcase'
    ? deriveWorkCasePresentationProjection(raw.status, raw.phase, item.source_content_fingerprint)
    : null
  const progressGroup = currentProjection?.resolution === 'resolved'
    ? currentProjection.progress_group
    : undefined
  const discardedWorkCase = type === 'workcase'
    && progressGroup === 'closed'
    && raw.closure_outcome === 'cancelled'
  const priority = priorityRank(raw.priority) < 4 && typeof raw.priority === 'string' ? raw.priority : undefined
  return {
    type,
    object_id: objectId,
    ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
    title,
    ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
    ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
    ...(discardedWorkCase ? { status: 'discarded' } : status ? { status } : {}),
    ...(currentProjection?.resolution === 'resolved'
      ? { lifecycle_position: currentProjection.lifecycle_position }
      : {}),
    ...(type === 'workcase' && progressGroup ? { progress_group: progressGroup } : {}),
    ...(priority ? { priority } : {}),
    read_status: item.read_status,
    relations: raw.relations,
  }
}

function isDisplayableFormalRelation(
  source: RecentHotspotBuildItem,
  target: RecentHotspotBuildItem,
  relationKey: string,
): boolean {
  if (source.type === 'spark') {
    if (relationKey === 'related-to') return true
    return false
  }
  if (source.type === 'workcase') {
    if (!source.status || !['open', 'blocked', 'closed'].includes(source.status)) return false
    if (relationKey === 'related-to') return true
    if (relationKey === 'depends-on') {
      return source.status !== 'closed'
        && source.lifecycle_position !== undefined
        && source.lifecycle_position !== 'human_closure_confirming'
        && target.type === 'workcase'
        && (target.status === 'open' || target.status === 'blocked')
    }
    if (relationKey === 'routed-to') {
      return source.status === 'closed'
        && ((target.type === 'workcase' && ['open', 'blocked', 'closed'].includes(target.status ?? ''))
      || (target.type === 'spark' && ['open', 'implemented', 'discarded'].includes(target.status ?? '')))
    }
    if (relationKey === 'contributed-to') {
      return target.type === 'pitfall' && ['draft', 'active', 'discarded'].includes(target.status ?? '')
    }
    return false
  }
  if (source.type === 'research') {
    return (relationKey === 'inspired-by' || relationKey === 'informs')
      && (target.type === 'spark' || target.type === 'workcase' || target.type === 'adr')
  }
  return false
}

function compareRecentHotspotRef(a: RecentHotspotRef, b: RecentHotspotRef): number {
  const timeDelta = compareTimestamps(b.occurred_at, a.occurred_at)
  if (timeDelta !== 0) return timeDelta
  if (a.activity !== b.activity) return a.activity === 'updated' ? -1 : 1
  return 0
}

function compareHotspotNode(a: RecentHotspotNode, b: RecentHotspotNode): number {
  if (a.activityRefs.length !== b.activityRefs.length) return b.activityRefs.length - a.activityRefs.length
  const aLatest = a.activityRefs[0]?.occurred_at ?? ''
  const bLatest = b.activityRefs[0]?.occurred_at ?? ''
  const timeDelta = compareTimestamps(bLatest, aLatest)
  if (timeDelta !== 0) return timeDelta
  // 活跃度相同时，非终态 WorkCase 只作为稳定的阅读顺序兜底，不覆盖事实热点本身。
  const aWorkCase = a.type === 'workcase' && a.progress_group !== 'closed'
  const bWorkCase = b.type === 'workcase' && b.progress_group !== 'closed'
  if (aWorkCase !== bWorkCase) return aWorkCase ? -1 : 1
  return factKey(a.type, a.id).localeCompare(factKey(b.type, b.id))
}

export function buildRecentHotspots(
  facts: RecentHotspotBuildItem[],
  activityByFact: Map<string, RecentHotspotRef[]>,
  governedProjectId: string,
) {
  const uidCounts = new Map<string, number>()
  for (const item of facts) {
    if (item.object_uid) uidCounts.set(item.object_uid, (uidCounts.get(item.object_uid) ?? 0) + 1)
  }
  const nodeKey = (item: RecentHotspotBuildItem) => factKey(
    item.type,
    item.object_id,
    item.object_uid && uidCounts.get(item.object_uid) === 1 ? item.object_uid : undefined,
  )
  const byKey = new Map(facts.map((item) => [nodeKey(item), item]))
  const byLegacyKey = new Map<string, string | null>()
  for (const item of facts) {
    const legacyKey = factKey(item.type, item.object_id)
    const authorityKey = nodeKey(item)
    if (!byLegacyKey.has(legacyKey)) byLegacyKey.set(legacyKey, authorityKey)
    else if (byLegacyKey.get(legacyKey) !== authorityKey) byLegacyKey.set(legacyKey, null)
  }
  const activityKey = (key: string) => byKey.has(key) ? key : (byLegacyKey.get(`legacy:${key}`) ?? undefined)
  const hotspots = new Set([...activityByFact.entries()]
    .filter(([, refs]) => refs.length > 0)
    .map(([key]) => activityKey(key))
    .filter((key): key is string => typeof key === 'string')
    .filter((key) => byKey.has(key)))
  const edges = new Map<string, RecentHotspotEdge>()
  for (const source of facts) {
    const sourceKey = nodeKey(source)
    if (!Array.isArray(source.relations)) continue
    for (const relation of source.relations) {
      if (!relation || typeof relation !== 'object' || Array.isArray(relation)) continue
      const record = relation as Record<string, unknown>
      const target = record.target
      if (typeof record.relation_key !== 'string' || !target || typeof target !== 'object' || Array.isArray(target)) continue
      const targetRecord = target as Record<string, unknown>
      const targetFields = new Set(Object.keys(targetRecord))
      let targetKey: string | undefined
      if (targetFields.size === 1 && targetFields.has('object_uid')
        && typeof targetRecord.object_uid === 'string'
        && uidCounts.get(targetRecord.object_uid) === 1
        && factKey('', '', targetRecord.object_uid).startsWith('uid:')) targetKey = `uid:${targetRecord.object_uid}`
      else {
        if (targetFields.size !== 3
          || !targetFields.has('governed_project_id')
          || !targetFields.has('fact_type_key')
          || !targetFields.has('object_id')
          || targetRecord.governed_project_id !== governedProjectId
          || typeof targetRecord.fact_type_key !== 'string'
          || typeof targetRecord.object_id !== 'string') continue
        targetKey = byLegacyKey.get(factKey(targetRecord.fact_type_key, targetRecord.object_id)) ?? undefined
      }
      if (!targetKey) continue
      const targetFact = byKey.get(targetKey)
      if (!targetFact || targetKey === sourceKey || (!hotspots.has(sourceKey) && !hotspots.has(targetKey))) continue
      if (!isDisplayableFormalRelation(source, targetFact, record.relation_key)) continue
      const edge: RecentHotspotEdge = { source: sourceKey, target: targetKey, relationKey: record.relation_key }
      edges.set(`${edge.source}\u0000${edge.target}\u0000${edge.relationKey}`, edge)
    }
  }

  const edgeValues = [...edges.values()]
  const makeNode = (key: string): RecentHotspotNode => {
    const item = byKey.get(key)
    if (!item) throw new Error(`Recent hotspot fact not found: ${key}`)
    const legacyActivityKey = `${item.type}:${item.object_id}`
    const refs = [...(activityByFact.get(key) ?? activityByFact.get(legacyActivityKey) ?? [])]
      .sort(compareRecentHotspotRef)
    return {
      type: item.type,
      id: item.object_id,
      ...(item.object_uid !== undefined ? { object_uid: item.object_uid } : {}),
      title: item.title,
      ...(item.title_en !== undefined ? { title_en: item.title_en } : {}),
      ...(item.title_zh !== undefined ? { title_zh: item.title_zh } : {}),
      ...(item.status !== undefined ? { status: item.status } : {}),
      ...(item.progress_group !== undefined ? { progress_group: item.progress_group } : {}),
      ...(item.priority !== undefined ? { priority: item.priority } : {}),
      read_status: item.read_status,
      typeColor: getTypeColor(item.type),
      activityRefs: refs,
    }
  }

  const clusters: Array<{ primary: RecentHotspotNode; relations: RecentHotspotRelation[] }> = []
  for (const hotspotKey of [...hotspots].sort()) {
    const incident = edgeValues.filter((edge) => edge.source === hotspotKey || edge.target === hotspotKey)
    if (incident.length === 0) continue
    const relations = incident.map((edge): RecentHotspotRelation => ({
      direction: edge.source === hotspotKey ? 'outgoing' : 'incoming',
      relationKey: edge.relationKey,
      node: makeNode(edge.source === hotspotKey ? edge.target : edge.source),
    })).sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'outgoing' ? -1 : 1
      if (a.relationKey !== b.relationKey) return a.relationKey.localeCompare(b.relationKey)
      return factKey(a.node.type, a.node.id).localeCompare(factKey(b.node.type, b.node.id))
    })
    clusters.push({ primary: makeNode(hotspotKey), relations })
  }
  clusters.sort((a, b) => compareHotspotNode(a.primary, b.primary))

  return {
    totalEvents: [...activityByFact.values()].reduce((total, refs) => total + refs.length, 0),
    hotspotTotal: clusters.length,
    relationTotal: edgeValues.length,
    clusters,
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

    const [workCaseResult, pitfallResult, adrResult, sparkResult, studyResult] = await Promise.all([
      listObjects('workcase', undefined, undefined, factScope),
      listObjects('pitfall', undefined, undefined, factScope),
      listObjects('adr', undefined, undefined, factScope),
      listObjects('spark', undefined, undefined, factScope),
      listObjects('research', undefined, undefined, factScope),
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
    const activeWorkCaseBuilds: ActiveWorkCaseBuildItem[] = []
    if (!workCaseResult.ok || !('data' in workCaseResult)) {
      const message = workCaseResult.ok ? 'WorkCase 列表读取失败' : (workCaseResult as { error: string }).error
      issues.push({ section: 'inbox', code: 'workcase_list_unavailable', message })
      issues.push({ section: 'activeWorkCases', code: 'workcase_list_unavailable', message })
    } else {
      const data = workCaseResult.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(data.collection_issues) ? data.collection_issues : []) {
        const projected = toIssue(issue)
        issues.push(projected, { ...projected, section: 'activeWorkCases' })
      }
      for (const raw of data.items) {
        const object_id = String(raw.object_id ?? '')
        const progress = currentWorkCaseProjection(raw)
        if (progress === null) {
          issues.push({ section: 'inbox', code: 'progress_group_unresolved', message: `WorkCase ${object_id} 的当次 current_snapshot_projection 未 resolved，未收入收件箱`, object_ref: object_id })
          issues.push({ section: 'activeWorkCases', code: 'progress_group_unresolved', message: `WorkCase ${object_id} 的当次 current_snapshot_projection 未 resolved，未收入推进中事项`, object_ref: object_id })
          continue
        }
        const progressGroup = progress.progress_group
        if (progress.progress_group === 'progressing' || progress.progress_group === 'termination_cleanup') {
          activeWorkCaseBuilds.push({
            type: 'workcase', progress_group: progress.progress_group,
            ...(progress.progress_step ? { progress_step: progress.progress_step } : {}),
            lifecycle_position: progress.lifecycle_position,
            blocking_overlay: progress.blocking_overlay,
            object_id, title: String(raw.title ?? object_id),
            ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
            ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
            ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
            priority: typeof raw.priority === 'string' ? raw.priority : undefined,
            updated_at: getLatestChangeLogAt(raw.change_log),
            read_status: String(raw.read_status ?? 'unknown'), projection: raw,
            field_issues: Array.isArray(raw.field_issues) ? (raw.field_issues as Array<Record<string, unknown>>) : [],
            unparsed_structures: Array.isArray(raw.unparsed_structures) ? (raw.unparsed_structures as Array<Record<string, unknown>>) : [],
            read_issues: Array.isArray(raw.read_issues) ? (raw.read_issues as Array<Record<string, unknown>>) : [],
          })
          continue
        }
        const inboxKind = deriveInboxKind(progress)
        if (inboxKind === null) continue
        builds.push({
          type: 'workcase', inboxKind, progress_group: progressGroup,
          lifecycle_position: progress.lifecycle_position,
          blocking_overlay: progress.blocking_overlay,
          object_id, title: String(raw.title ?? object_id),
          ...(typeof raw.object_uid === 'string' ? { object_uid: raw.object_uid } : {}),
          ...(typeof raw.title_en === 'string' ? { title_en: raw.title_en } : {}),
          ...(typeof raw.title_zh === 'string' ? { title_zh: raw.title_zh } : {}),
          priority: typeof raw.priority === 'string' ? raw.priority : undefined,
          updated_at: getLatestChangeLogAt(raw.change_log),
          read_status: String(raw.read_status ?? 'unknown'), projection: raw,
          field_issues: Array.isArray(raw.field_issues) ? (raw.field_issues as Array<Record<string, unknown>>) : [],
          unparsed_structures: Array.isArray(raw.unparsed_structures) ? (raw.unparsed_structures as Array<Record<string, unknown>>) : [],
          read_issues: Array.isArray(raw.read_issues) ? (raw.read_issues as Array<Record<string, unknown>>) : [],
        })
      }
    }

    if (!pitfallResult.ok || !('data' in pitfallResult)) {
      const message = pitfallResult.ok ? 'Pitfall 列表读取失败' : (pitfallResult as { error: string }).error
      issues.push({ section: 'inbox', code: 'pitfall_list_unavailable', message })
    } else {
      const data = pitfallResult.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(data.collection_issues) ? data.collection_issues : []) issues.push(toIssue(issue))
      for (const raw of data.items) {
        if (raw.status !== 'draft') continue
        const object_id = String(raw.object_id ?? '')
        builds.push({
          type: 'pitfall', inboxKind: 'pitfall_confirmation', object_id, title: String(raw.title ?? object_id),
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
    activeWorkCaseBuilds.sort(compareCardBuild)

    const recentStart = new Date(generatedAt).getTime() - RECENT_ACTIVITY_WINDOWS[recentWindow] * 24 * 60 * 60 * 1000
    const hotspotStart = new Date(generatedAt).getTime() - RECENT_ACTIVITY_WINDOWS[RECENT_HOTSPOT_WINDOW] * 24 * 60 * 60 * 1000
    const recentBuilds: RecentActivityBuildItem[] = []
    const recentSources: Array<[ObjectType, typeof workCaseResult]> = [
      ['workcase', workCaseResult],
      ['pitfall', pitfallResult],
      ['adr', adrResult],
      ['spark', sparkResult],
      ['research', studyResult],
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
    recentBuilds.sort(compareRecentActivity)

    // 模块三与近期动态共用事实 change_log；只读取当前正式关系，不从 Git、标题或关键词推断关联。
    let recentHotspots: ReturnType<typeof buildRecentHotspots> | undefined
    try {
      const graphFacts: RecentHotspotBuildItem[] = []
      const activityByFact = new Map<string, RecentHotspotRef[]>()
      const graphTypes: ObjectType[] = ['workcase', 'adr', 'pitfall', 'spark', 'research']
      const graphResults = await Promise.all(graphTypes.map(async (type) => [type, await listLocalFacts(type, factScope)] as const))
      for (const [type, result] of graphResults) {
        if (result.status !== 'complete') {
          issues.push({ section: 'recentHotspots', code: `${type}_relation_list_unavailable`, message: result.issues[0]?.message ?? `${type} 正式关系读取失败` })
          continue
        }
        for (const item of result.items) {
          const projected = projectRecentHotspotFact(item, type)
          if (!projected) continue
          graphFacts.push(projected)
          activityByFact.set(
            factKey(projected.type, projected.object_id, projected.object_uid),
            buildFactActivityItems(item.fact_object ?? {}, type, hotspotStart, parseTimestamp(generatedAt)).map((activity) => ({
              occurred_at: activity.occurred_at,
              activity: activity.activity,
            })),
          )
        }
        for (const issue of result.issues) {
          issues.push({ section: 'recentHotspots', code: issue.code, message: issue.message })
        }
      }
      recentHotspots = buildRecentHotspots(graphFacts, activityByFact, project.id)
    } catch (caught) {
      issues.push({
        section: 'recentHotspots',
        code: 'recent_hotspot_data_unavailable',
        message: caught instanceof Error ? caught.message : '近期事实热点数据不可用',
      })
    }

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
      if (build.type === 'workcase') {
        entry.progress_group = build.progress_group
        entry.lifecycle_position = build.lifecycle_position
        entry.isBlocked = build.blocking_overlay === true
      }
      else entry.status = 'draft'
      // priority 缺失/非法落 P3 之后并省略优先级信号（Q8）。
      if (priorityRank(build.priority) < 4 && typeof build.priority === 'string') entry.priority = build.priority
      // updated_at 缺失排最后并省略时间显示（Q8）。
      if (build.updated_at) entry.updatedAt = build.updated_at
      // 字段级直读 readable 时携带 canonical_path，供条件显示"复制对象路径"（Q4）。
      if (build.read_status === 'readable') entry.canonical_path = canonicalPath(build.type, build.object_id)
      if (build.field_issues.length > 0) entry.field_issues = build.field_issues
      if (build.unparsed_structures.length > 0) entry.unparsed_structures = build.unparsed_structures
      if (build.read_issues.length > 0) entry.read_issues = build.read_issues
      return entry
    })

    const activeWorkCaseItems = activeWorkCaseBuilds.map((build) => {
      const card = Object.fromEntries(
        Object.entries(build.projection).filter(([key]) => !IDENTITY_PROJECTION_KEYS.has(key)),
      )
      const entry: Record<string, unknown> = {
        type: 'workcase',
        id: build.object_id,
        ...(build.object_uid ? { object_uid: build.object_uid } : {}),
        title: build.title,
        ...(build.title_en !== undefined ? { title_en: build.title_en } : {}),
        ...(build.title_zh !== undefined ? { title_zh: build.title_zh } : {}),
        relativeTime: getRelativeTime(build.updated_at ?? '', locale),
        typeColor: getTypeColor('workcase'),
        progress_group: build.progress_group,
        ...(build.progress_step ? { progress_step: build.progress_step } : {}),
        lifecycle_position: build.lifecycle_position,
        isBlocked: build.blocking_overlay,
        read_status: build.read_status,
        card,
      }
      if (priorityRank(build.priority) < 4 && typeof build.priority === 'string') entry.priority = build.priority
      if (build.updated_at) entry.updatedAt = build.updated_at
      if (build.read_status === 'readable') entry.canonical_path = canonicalPath('workcase', build.object_id)
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
      ...(build.type === 'workcase' && build.progress_group !== undefined
        ? { progress_group: build.progress_group }
        : build.type !== 'workcase' && build.status !== undefined ? { status: build.status } : {}),
      read_status: build.read_status,
      ...(build.field_issues.length > 0 ? { field_issues: build.field_issues } : {}),
      ...(build.unparsed_structures.length > 0 ? { unparsed_structures: build.unparsed_structures } : {}),
    }))

    res.json({
      generatedAt,
      scope: { governedProjectId: project.id },
      inbox: { items, total: items.length },
      activeWorkCases: { items: activeWorkCaseItems, total: activeWorkCaseItems.length },
      recentActivity: {
        window: recentWindow,
        windowStart: new Date(recentStart).toISOString(),
        items: recentItems,
        total: recentItems.length,
        eventTotal: recentBuilds.length,
        modelUsage: recentActivityView.modelUsage,
        environmentUsage: recentActivityView.environmentUsage,
      },
      ...(recentHotspots ? {
        recentHotspots: {
          window: RECENT_HOTSPOT_WINDOW,
          totalEvents: recentHotspots.totalEvents,
          hotspotTotal: recentHotspots.hotspotTotal,
          relationTotal: recentHotspots.relationTotal,
          clusters: recentHotspots.clusters,
        },
      } : {}),
      ...(sparkHealth ? {
        sparkHealth: {
          total: sparkHealth.total,
          openTotal: sparkHealth.openTotal,
          terminalTotal: sparkHealth.terminalTotal,
          terminalByStatus: sparkHealth.terminalByStatus,
          openByPriority: sparkHealth.openByPriority,
          silentThresholdDays: sparkHealth.silentThresholdDays,
          silentCount: sparkHealth.silentCount,
          openItems: sparkHealth.openItems.map((item) => ({
            type: 'spark',
            id: item.object_id,
            ...(item.object_uid ? { object_uid: item.object_uid } : {}),
            title: item.title,
            ...(item.title_en !== undefined ? { title_en: item.title_en } : {}),
            ...(item.title_zh !== undefined ? { title_zh: item.title_zh } : {}),
            ...(item.priority !== undefined ? { priority: item.priority } : {}),
            updatedAt: item.updated_at,
            ...(item.signature !== undefined ? { signature: item.signature } : {}),
            activityCount: item.activity_count,
            silentDays: item.silent_days,
            typeColor: getTypeColor('spark'),
            read_status: item.read_status,
            ...(item.field_issues.length > 0 ? { field_issues: item.field_issues } : {}),
            ...(item.unparsed_structures.length > 0 ? { unparsed_structures: item.unparsed_structures } : {}),
          })),
          silentItems: sparkHealth.silentItems.map((item) => ({
            type: 'spark',
            id: item.object_id,
            ...(item.object_uid ? { object_uid: item.object_uid } : {}),
            title: item.title,
            ...(item.title_en !== undefined ? { title_en: item.title_en } : {}),
            ...(item.title_zh !== undefined ? { title_zh: item.title_zh } : {}),
            ...(item.priority !== undefined ? { priority: item.priority } : {}),
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

/**
 * GET /api/cognition/goal — 蓝图「当前目标」投影的机械来源读取（specs/25 直读消费点）。
 *
 * 读取被管辖项目 worktree 下的单例 goal.md，仅投影蓝图所需的窄字段：
 * 目标陈述 + 子目标(SG-n)清单 + 计划区条目（裁定 14「下一步」H2）。此处不做任何 AI 判断或派生——只把 goal.md 原文里
 * 的结构化字段搬给前端；服务端不缓存、不回写、不建索引（25 §10 消费点直读）。
 * 该路由仅为蓝图首页（/focus-v2 测试页）提供 goal.md 的读取入口，不承载 Goal 类型
 * 的创建/更新/翻转等受控操作（那些走 AI 受控写入路径）。
 */
type GoalSubGoal = { id: string; text: string }
type GoalPlanItem = { text: string; serves: string | null }
router.get('/goal', async (req: Request, res: Response): Promise<void> => {
  try {
    const project = await requestProject(req)
    const goalPath = path.join(project.path, 'ldvh-base', 'goal.md')
    let raw: string
    try {
      raw = await readFile(goalPath, 'utf-8')
    } catch (err) {
      res.status(404).json({ ok: false, error: 'goal.md 不存在——Goal 事实对象尚未创建', exitCode: 'goal_missing' })
      return
    }
    const lines = raw.split(/\r?\n/)
    if (lines[0]?.trim() !== '---') {
      res.status(500).json({ ok: false, error: 'goal.md 缺少 frontmatter', code: 'frontmatter_missing' })
      return
    }
    const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (endIdx === -1) {
      res.status(500).json({ ok: false, error: 'goal.md frontmatter 未闭合', code: 'frontmatter_unclosed' })
      return
    }
    const metaLines = lines.slice(1, endIdx).join('\n')
    const body = lines.slice(endIdx + 1).join('\n')
    let meta: Record<string, unknown>
    try {
      meta = yaml.load(metaLines) as Record<string, unknown>
    } catch (err) {
      res.status(500).json({ ok: false, error: 'goal.md frontmatter 解析失败', code: 'frontmatter_parse_failed' })
      return
    }

    // 子目标解析：正文里 `SG-n …` 行（目标陈述段与子目标段都按原文抽取，避免臆造进度）。
    const subGoals: GoalSubGoal[] = []
    const sgRe = /^\s*(SG-\d+)[:：]?\s+(.+)$/
    for (const line of body.split('\n')) {
      const match = sgRe.exec(line)
      if (match) subGoals.push({ id: match[1].trim(), text: match[2].trim() })
    }

    // 计划区解析（裁定 14）：「## 下一步」H2 下的有序列表条目，`<安排> → SG-n` 尾部
    // 标注为建议性 serves（仅展示；真正绑定发生在 WC 的 Gate 1）。无该 H2 时为空数组。
    const planItems: GoalPlanItem[] = []
    const planMatch = /^##\s*下一步\s*$/m.exec(body)
    if (planMatch) {
      const planSection = body.slice(planMatch.index + planMatch[0].length)
      const nextH2 = /^##\s/m.exec(planSection)
      const planBody = nextH2 ? planSection.slice(0, nextH2.index) : planSection
      const planLineRe = /^\s*\d+[.、]\s*(.+)$/
      for (const line of planBody.split('\n')) {
        const m = planLineRe.exec(line)
        if (!m) continue
        let text = m[1].trim()
        let serves: string | null = null
        const arrow = /\s*(?:→|->)\s*(SG-\d+)\s*$/.exec(text)
        if (arrow) {
          serves = arrow[1]
          text = text.slice(0, arrow.index).trim()
        }
        planItems.push({ text, serves })
      }
    }

    res.json({
      ok: true,
      goal: {
        goal_key: typeof meta.goal_key === 'string' ? meta.goal_key : 'project-goal',
        title: typeof meta.title === 'string' ? meta.title : '',
        status: typeof meta.status === 'string' ? meta.status : 'active',
        sub_goals: subGoals,
        plan_items: planItems,
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
