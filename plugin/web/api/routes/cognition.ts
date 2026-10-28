/**
 * Cognition API 路由：聚合项目认知中心的待决定事项、推进中事项与近期动态。
 *
 * 已交付模块一（待决定事项）、模块二（近期动态）与模块三（Spark 池健康）
 * + §5 全局信任标记所需的派生字段：
 * generatedAt（观察时间）、scope、inbox（WorkCase Human Gate 与 Pitfall draft 审核的派生收录与排序）、
 * recentActivity（指定窗口内事实对象 change_log 的创建 / 更新事件）与 issues（模块级降级）。
 * 数据经 Web 字段级直读（localFactReader / facts.ts 的 listObjects），不复用 /api/dashboard 聚合逻辑。
 *
 * 命名纪律（02 §7 第 3 条）：WorkCase 条目只携带 group（21 号三态直读派生组）；
 * 待决类型 inboxKind 表示 Human 的计划批准（Gate 1）或关闭确认（Gate 2）。
 * group 决定两个既有行动模块（待办收件 / 推进中事项）的唯一归属。
 */

import { Router, type Request, type Response } from 'express'
import { listObjects, type ObjectType } from '../services/facts.js'
import { canonicalUid } from '../../shared/factIdentity.js'
import {
  WORKCASE_V5_STATUSES,
  type WorkCaseV5View,
  type WorkCaseV5Group,
} from '../../shared/workcaseLifecycle.js'
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

// 收件类型闭集（v5）：WorkCase 侧只有两个 Human Gate，加 Pitfall draft 确认，
// 加 Friction `open` 待修（Human 2026-10-19 决定，见 cognition-inbox-contract 的
// 「待修的摩擦」用例）。
// 曾经的 `blocked_resolution`（v4「阻塞待处置」）已移除——v5 状态闭集无 `blocked`，
// `deriveInboxKind` 无法产出该值，保留它等于在类型上承认一个不可达分支。
type InboxKind = 'plan_confirmation' | 'closure_confirmation' | 'pitfall_confirmation' | 'friction_repair'
type InboxObjectType = 'workcase' | 'pitfall' | 'friction'
type RecentActivityKind = 'created' | 'updated'
type RecentActivityWindow = '1d' | '3d' | '7d'

const RECENT_ACTIVITY_WINDOWS: Record<RecentActivityWindow, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
}
// 2026-09-27 移除：`SPARK_SILENT_THRESHOLD_DAYS = 5` 曾把「距最近一次 change_log
// 流水 ≥5 天」的 open Spark 判定为「沉默」并单列成组。该**阈值判据无规范来源**
// （specs/ 全库零授权；20 §12 登记该消费点时已注明「其阈值与判据不由本文定义」），
// 属 00 §4.2 应由 Human 决定的事项与 00 §7.1「声称有机械保障而来源不存在」的形态。
// Human 决定（2026-09-27）移除该判定。
//
// 保留的是**派生量与按时间筛选**：`silentDays()` 由 change_log 末条流水算出「多久
// 未更新」这一中性事实，`sparkHealthAgeFilter`（3d/7d/all）按它筛选——后者由
// 10 §5.2「支持按类型、状态、维度、时间等条件筛选与排序」授权。故移除的是
// 「什么算沉默」这条判据，不是时间呈现本身。
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
  group?: WorkCaseV5Group
  priority?: string
  updated_at?: string
  /** 关联的事实对象引用（03 §7.2 关联引用型 / 20 §8 refs），条件出现 */
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
  read_status: string
  projection: Record<string, unknown>
  field_issues: Array<Record<string, unknown>>
  unparsed_structures: Array<Record<string, unknown>>
  read_issues: Array<Record<string, unknown>>
}

interface ActiveWorkCaseBuildItem {
  type: 'workcase'
  group: 'executing'
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
  /** 25 号 Goal 是单例冻结锚（非 ACTIVE_OBJECT_TYPES 多例）——change_log 流水
   * 同样进近期动态，type='goal' 走消费点直读而非对象列表。 */
  type: ObjectType | 'goal'
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
  group?: WorkCaseV5Group
  priority?: string
  /** Spark 的 goal.md 子目标锚点（20 §6 serves），条件出现。 */
  serves?: string
  /** 26 §8 impact（轻/中/重），条件出现——摩擦的近期动态行据此显示影响标签。 */
  impact?: string
  /** 26 §8 `occurrence`（重复观察次数 = **频次的机械权威源**），条件出现。
   *
   * 与 `impact` 同规格：摩擦的近期动态行**同序同形**显示它（类型 → 优先级 →
   * SG → 影响 → 重复观察 → 修改次数）。此前本路由只投影 `impact` 而未投影
   * `occurrence`，致该字段虽在事实源与列表投影里都有、却不进聚焦页——与
   * 「词条在、数据在、唯独没有消费方」是同一类缺口（Human 2026-11 发现）。
   *
   * 条件出现而非必填：§8 对「闭集收缩改判而来的 `voided`」有必填豁免（§14.2），
   * 届时合法缺席——呈现层据此不渲染，不补零。
   *
   * 形状依 26 §8（2026-10 修订）：`{ count, first_at, last_at }`。原第四个键
   * `human_return_at` 随「放回留观」流转一并删除（该流转已随观察态退出闭集
   * 而作废，26 §9.2），故此处不再声明它。 */
  occurrence?: { count?: number; first_at?: string; last_at?: string }
  /** 关联的事实对象引用（03 §7.2 / 20 §8 refs），条件出现。 */
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
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
  /** 20 §6 serves（SG-n 子目标锚点），健康度行与卡头同标签序。 */
  serves?: string
  /** 20 §8 refs（关联事实对象引用），与卡头同标签序。 */
  refs?: Array<{ object_uid: string; title?: string; type?: string }>
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

/** P0=0 … P3=3；缺失或非法落 4（排最后，并省略优先级信号）。 */
function priorityRank(priority: unknown): number {
  if (typeof priority !== 'string') return 4
  const match = /^P([0-3])$/.exec(priority)
  if (!match) return 4
  return Number(match[1])
}

/** 与 localFactReader.metadataFor 一致：按事实类型返回当前 canonical path。 */
function canonicalPath(type: InboxObjectType, objectId: string): string {
  // 三类载体都是平铺单文件且文件名就是 `<对象 id>.md`（02 §7.2 / 26 §7），故只有
  // 目录名随类型变化。此前写作 `'workcase' ? 'workcases' : 'pitfalls'` 的二元式，
  // 新增类型时会静默落到 fallback 分支给出**错误的目录**——错误路径不会报错，
  // 只会让「复制对象路径」复制出不存在的位置。故改为显式查表，缺项即失败。
  const directories: Record<InboxObjectType, string> = {
    workcase: 'workcases',
    pitfall: 'pitfalls',
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

/**
 * 21 号三态直读收件判定（与列表筛选器共用同一派生函数，防口径漂移）：
 *   - group=pending_gate1 ⇒ 'plan_confirmation'（Gate 1 待批收件）
 *   - group=awaiting_gate2 ⇒ 'closure_confirmation'（Gate 2 待关收件）
 *   - executing / closed ⇒ 不进待办收件（返回 null）
 */
function deriveInboxKind(view: WorkCaseV5View): InboxKind | null {
  if (view.resolution !== 'resolved' || view.group === null) return null
  if (view.group === 'pending_gate1') return 'plan_confirmation'
  if (view.group === 'awaiting_gate2') return 'closure_confirmation'
  return null
}

/**
 * 26 §8 Friction `impact`（影响评级闭集）与 `occurrence`（重复观察证据）在收件项上的
 * 平铺投影。
 *
 * **为什么必须平铺**：卡头徽标（`FrictionImpactBadge` / `FrictionOccurrenceBadge`）在
 * `ObjectCardFrame` 里读的是**对象根**上的 `obj.impact` / `obj.occurrence`。列表卡传入的
 * 是完整 `ObjectItem`，而收件项走 `toObjectCard` 平铺——`impact` 只落在 `card` 里时，
 * 徽标在聚焦页静默消失（近期动态投影当初正是踩了这条：`recentItems` 逐字段重建时丢掉
 * `impact`，界面上就是「聚焦里没有重中轻的标签」）。故此处与 workcase 的 `pre_audit_passed`
 * 同法：在 build → entry 这一层显式平铺，不依赖客户端翻 `card`。
 */
function projectFrictionImpact(raw: Record<string, unknown>): { impact?: string } {
  return typeof raw.impact === 'string' && raw.impact.trim() ? { impact: raw.impact } : {}
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

/**
 * 21 号三态直读：读取 item 上**已由权威派生点写入**的 v5 视图。
 *
 * 权威派生点是 `facts.ts:projectCurrentWorkCaseCardShape`——它拿完整 fact（含
 * `report_body`）算出 view，写入 `group`/`outcome`/`has_result_draft` 与
 * `current_snapshot_projection`。
 *
 * **不得在此重算**：本函数的两处调用（`buildRecentActivityItem` 与收件箱主循环）
 * 拿到的都是 `listObjects` 的列表项，而列表投影按载荷纪律剥离了 `report_body`
 * （`factFieldContract.ts` 的 `FACT_LIST_FIELD_NAMES` 把 workcase 整体排除）。
 * 从被剥离的输入重算只会得到 `executing`——这正是认知中心对「open ∧ 含结果节」
 * 的工单不产生 **Gate 2 待办**（`inboxKind` 落空）的成因，与列表/筛选侧的
 * `getWorkCaseV5Group` 缺陷同源。
 *
 * 读法：优先取 `current_snapshot_projection`（完整 view）；若缺失，则用已派生的
 * `group` 等字段重建一个等价 view，保持返回形状不变。
 */
function currentWorkCaseProjection(raw: Record<string, unknown>): WorkCaseV5View | null {
  const snapshot = raw.current_snapshot_projection
  if (snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const view = snapshot as WorkCaseV5View
    if (view.resolution === 'resolved') return view
  }
  const group = raw.group
  if (typeof group !== 'string') return null
  if (!WORKCASE_V5_STATUSES.includes(raw.status as (typeof WORKCASE_V5_STATUSES)[number])) return null
  return {
    resolution: 'resolved',
    reason: null,
    fingerprint: null,
    status: raw.status as WorkCaseV5View['status'],
    group: group as WorkCaseV5View['group'],
    outcome: (raw.outcome as WorkCaseV5View['outcome']) ?? null,
    has_result_draft: raw.has_result_draft === true,
  }
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
  const group = type === 'workcase'
    ? currentWorkCaseProjection(raw)?.group ?? undefined
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
    ...(type === 'workcase' ? { group } : { status }),
    ...(priorityRank(raw.priority) < 4 && typeof raw.priority === 'string' ? { priority: raw.priority } : {}),
    ...(type === 'spark' && typeof raw.serves === 'string' && raw.serves.trim() ? { serves: raw.serves } : {}),
    // 26 §8 impact：摩擦的近期动态行与列表卡卡头、详情头同形显示轻/中/重。
    ...(type === 'friction' && typeof raw.impact === 'string' && raw.impact.trim() ? { impact: raw.impact } : {}),
    // 26 §8 occurrence：同上同序（重复观察次数紧随影响标签）。只透传事实源里
    // 已有的形状，**不构造、不补零**——`voided` 的 §14.2 豁免形态据此原样缺席。
    ...(type === 'friction' && typeof raw.occurrence === 'object' && raw.occurrence !== null
      ? { occurrence: raw.occurrence as { count?: number; first_at?: string; last_at?: string } }
      : {}),
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
  type: ObjectType | 'goal',
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
    fallback.push(buildRecentActivityItem(raw, type, 'created', createdAt, undefined))
  }
  if (timestampInWindow(updatedAt, start, end) && updatedAt !== createdAt) {
    fallback.push(buildRecentActivityItem(raw, type, 'updated', updatedAt, undefined))
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
      // 20 §6 serves（SG-n 子目标锚点）：健康度行与卡头同标签序（Human 定案
      // 2026-09-13：类型 → 优先级 → SG → 修改次数）。
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

    const [workCaseResult, pitfallResult, adrResult, sparkResult, studyResult, frictionResult, normResult] = await Promise.all([
      listObjects('workcase', undefined, undefined, factScope),
      listObjects('pitfall', undefined, undefined, factScope),
      listObjects('adr', undefined, undefined, factScope),
      listObjects('spark', undefined, undefined, factScope),
      listObjects('research', undefined, undefined, factScope),
      // 26 号 Friction 与 27 号 Norm 是后加入 OBJECT_TYPES 的活跃类型，同样有
      // change_log 流水——此前遗漏在近期动态之外（Human 2026-11：「聚焦里的近期
      // 动态怎么没有摩擦的改动」）。二者与上面五类在动态里是同一等比对象。
      listObjects('friction', undefined, undefined, factScope),
      listObjects('norm', undefined, undefined, factScope),
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
          issues.push({ section: 'inbox', code: 'workcase_view_unresolved', message: `WorkCase ${object_id} 的三态直读视图未 resolved，未收入收件箱 / 推进中事项`, object_ref: object_id })
          issues.push({ section: 'activeWorkCases', code: 'workcase_view_unresolved', message: `WorkCase ${object_id} 的三态直读视图未 resolved，未收入推进中事项`, object_ref: object_id })
          continue
        }
        // 21 号三态直读：executing ⇒ 推进中事项；pending_gate1 / awaiting_gate2 ⇒ 待办收件。
        if (progress.group === 'executing') {
          activeWorkCaseBuilds.push({
            type: 'workcase', group: 'executing',
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
          type: 'workcase', inboxKind, group: progress.group ?? undefined,
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

    // 26 §12「Web 账本呈现」消费点：open 账目进入聚焦的待决定事项（Human 2026-10-19
    // 决定：只收 `open`）。
    //
    // 为什么只收 `open`（2026-10 修订后的口径）：26 §9 的状态闭集为**四值**
    // ——`open`（待修）/ `resolved`（已销账）/ `voided`（已废弃）/
    // `accepted`（已接受、不可清偿）；但待决定事项**只收 `open`**——accepted 是
    // 「记录一次、不再报告」，resolved/voided 亦属终态。原第四值
    // `observing`（留观）**已退出闭集**：「已看见但尚未攒够」的观察不再作为
    // 事实对象存在，改由 11 §12bis.1 的摩擦观察缓冲承载（非事实对象、不进
    // 事实源、不参与 F0–F4 召回）——故本分支**不再有「攒熟中的活账」可铺**，
    // 只剩「已攒够、确实待修」的账目才是待决定事项。
    //
    // `resolved`/`voided` 是终态，26 §12 明写不进默认候选（`voided` 还额外
    // 不参与查重、度量与迭代决策输入）。`accepted` 同为终态、不进待决定事项，
    // 但**须单列计数**（26 §12 dogfood 度量：已接受成本，不进解决率分母；
    // 26 §18 第 7 条把它列为 accepted 的必备消费方之一）。
    let acceptedFrictionCount = 0
    if (!frictionResult.ok || !('data' in frictionResult)) {
      const message = frictionResult.ok ? 'Friction 列表读取失败' : (frictionResult as { error: string }).error
      issues.push({ section: 'inbox', code: 'friction_list_unavailable', message })
    } else {
      const data = frictionResult.data as { items: Array<Record<string, unknown>>; collection_issues?: Array<Record<string, unknown>> }
      for (const issue of Array.isArray(data.collection_issues) ? data.collection_issues : []) issues.push(toIssue(issue))
      // 26 §12：accepted 单列计数（已接受成本），不进待决定事项、不进解决率分母。
      // **单独一次遍历**：待决定事项的收录判定必须保持字面 `raw.status !== 'open'`
      // （下方契约测试钉住该形态，防止「顺手多带一个状态」的口径漂移）。
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
          // Friction 无 priority 字段（26 §8 闭集无它）——不传，排序自然落到
          // `priorityRank(undefined)=4` 的「缺失排最后」分支，与 Pitfall 同法。
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
    const recentBuilds: RecentActivityBuildItem[] = []
    // 近期动态的取数范围 = OBJECT_TYPES 全集（活跃事实类型皆有 change_log 流水）。
    // 此前本表停在早期的五类上，friction/norm 加入 OBJECT_TYPES 时未随行——遗漏
    // 会让 Human 在认知中心看不到这两类的任何改动（26 §12 的 F1 召回与本节无关：
    // 这里只读 change_log 流水，不做状态筛选）。
    const recentSources: Array<[ObjectType, typeof workCaseResult]> = [
      ['workcase', workCaseResult],
      ['pitfall', pitfallResult],
      ['adr', adrResult],
      ['spark', sparkResult],
      ['research', studyResult],
      ['friction', frictionResult],
      ['norm', normResult],
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
    // 25 号 Goal：单例冻结锚的 change_log 修订史也进近期动态（§6 修订史是 HV5
    // 演进链第一环）。goal.md 尚未创建是合法状态（项目初始化前），静默跳过；
    // 存在但不可读时如实披露。单例路径即身份，object_id 以 'goal' 稳定填充。
    const goalRecord = await readGoalRecord(project)
    if (goalRecord.status === 'readable') {
      recentBuilds.push(...buildFactActivityItems(
        {
          ...goalRecord.raw,
          object_id: 'goal',
          // 读取层判定结果随条目携带：readable 已由 readGoalRecord 成立（否则
          // 走 unreadable 分支），不注入会让展示层回退 'unknown' 误报红字；
          // 轻校验的 field_issues 如实带入（goal.md 字段问题可见）。
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
      if (build.type === 'workcase') {
        entry.group = build.group
        // 建前审核后缀的判据（21 §8 `pre_reviews`）：与收件箱卡、列表卡同源——
        // 取自已投影的 `card`，不在此处重算指纹覆盖（呈现层不重复实现门禁判据）。
        // 平铺到 entry 而非让客户端翻 card：近期动态行的徽标是平铺消费的。
        if (typeof card.pre_audit_passed === 'boolean') entry.pre_audit_passed = card.pre_audit_passed
      }
      else if (build.type === 'pitfall') entry.status = 'draft'
      else {
        // Friction（26 §8）：`status` 是来源状态的直读值（本分支只收 `open`），
        // 与 Pitfall 的 `draft` 同法平铺——否则 entry 上没有 status，客户端
        // `toObjectCard` 会把 `undefined` 当状态传给状态徽标。
        // `impact`/`occurrence` 见 projectFriction* 的注释：卡头徽标读对象根。
        entry.status = String(build.projection.status ?? '')
        Object.assign(entry, projectFrictionImpact(build.projection), projectFrictionOccurrence(build.projection))
      }
      // refs（03 §7.2 / 20 §8）：关联对象 chip，与卡头标签序一致
      // （类型 → 优先级 → SG → refs → 修改次数）。
      if (build.refs !== undefined) entry.refs = build.refs
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
        group: build.group,
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
      ...(build.serves !== undefined ? { serves: build.serves } : {}),
      ...(build.impact !== undefined ? { impact: build.impact } : {}),
      // 26 §8 occurrence：第二层映射（build → recentItems）此前遗漏它——
      // 上层 buildRecentActivityItem 已投影，此处逐字段重建时丢掉，故客户端
      // 收不到。与 impact 同序（重复观察紧随影响标签）。
      ...(build.occurrence !== undefined ? { occurrence: build.occurrence } : {}),
      ...(build.refs !== undefined ? { refs: build.refs } : {}),
      ...(build.type === 'workcase' && build.group !== undefined
        ? { group: build.group }
        : build.type !== 'workcase' && build.status !== undefined ? { status: build.status } : {}),
      read_status: build.read_status,
      ...(build.field_issues.length > 0 ? { field_issues: build.field_issues } : {}),
      ...(build.unparsed_structures.length > 0 ? { unparsed_structures: build.unparsed_structures } : {}),
    }))

    res.json({
      generatedAt,
      scope: { governedProjectId: project.id },
      inbox: { items, total: items.length },
      // 26 §12 dogfood 度量消费点（2026-10 新增 accepted）：已接受成本单列计数。
      // 它**不进** inbox（accepted 不是待决定事项），也**不进**解决率分母
      // （26 §12：accepted 不进解决率分母、不计入 open 待修数）。
      frictionLedger: { acceptedCount: acceptedFrictionCount },
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

/**
 * GET /api/cognition/goal — Web「当前目标」投影的机械来源读取（specs/25 直读消费点）。
 *
 * 读取被管辖项目 worktree 下的单例 goal.md，投影字段覆盖两档消费：窄字段
 * （目标陈述 + 子目标 SG-n 清单）与详情阅读面（created_at + change_log 修订史 +
 * 读取层元数据——canonical_path/carrier/read_status 供前端 getFactReadMeta 消费）。
 * 此处不做任何 AI 判断或派生——只把 goal.md 原文里的结构化字段搬给前端；服务端
 * 不缓存、不回写、不建索引（25 §10 消费点直读）。该路由不承载 Goal 类型的
 * 创建/更新/翻转等受控操作（那些走 AI 受控写入路径）。
 */
type GoalSubGoal = { id: string; text: string }

/** 25 号 Goal 的必填字段闭集（§6 frontmatter 全必填）——呈现层轻校验，
 * 只报告 missing，不做类型系统级契约（Goal 不走 FACT_FIELD_CONTRACT 单例豁免）。 */
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

/** 单例 goal.md 读取与解析（/goal 直读路由与近期动态共用；25 §5 路径即身份）。 */
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

  // 目标陈述解析：「## 目标陈述」H2 下的段落（到下一个 H2 为止，去首尾空白）。
  let statement = ''
  const stmtMatch = /^##\s*目标陈述\s*$/m.exec(body)
  if (stmtMatch) {
    const stmtSection = body.slice(stmtMatch.index + stmtMatch[0].length)
    const nextH2 = /^##\s/m.exec(stmtSection)
    statement = (nextH2 ? stmtSection.slice(0, nextH2.index) : stmtSection).trim()
  }

  // 子目标解析：正文里 `SG-n …` 行（目标陈述段与子目标段都按原文抽取，避免臆造进度）。
  const subGoals: GoalSubGoal[] = []
  const sgRe = /^\s*(SG-\d+)[:：]?\s+(.+)$/
  for (const line of body.split('\n')) {
    const match = sgRe.exec(line)
    if (match) subGoals.push({ id: match[1].trim(), text: match[2].trim() })
  }

  // 呈现层轻校验：必填闭集 missing + goal_key 固定值 identity（25 §6/§10）。
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
    res.json({
      ok: true,
      goal: {
        goal_key: typeof meta.goal_key === 'string' ? meta.goal_key : 'project-goal',
        title: typeof meta.title === 'string' ? meta.title : '',
        status: typeof meta.status === 'string' ? meta.status : 'active',
        statement: record.statement,
        sub_goals: record.subGoals,
        // 详情阅读面投影（25 §6 修订史是 HV5 演进链第一环）：
        created_at: typeof meta.created_at === 'string' ? meta.created_at : undefined,
        change_log: Array.isArray(meta.change_log) ? meta.change_log : [],
        // 读取层元数据：与多例类型的 exact-read 投影同形态，供前端 getFactReadMeta
        // 消费（25 §5 单例路径即身份——canonical_path 固定）。
        canonical_path: 'ldvh-base/goal.md',
        // frontmatter 逐字原文（与多例类型的 yaml_source 同形）：读取层已在该单例
        // 读取实现里解析出原文（readGoalRecord 的 frontmatterSource，:1145），此处
        // 逐字透传即可。此前缺该投影，前端 YamlDataNode 的「原文优先、重建兜底」
        // 对 goal 恒走重建分支——Human 读到的是重整过的 YAML 而非 goal.md 原文
        //（workcase 9208ce82 补齐；旧残留见 workcase 63700bd2 的 Gate 2 记录）。
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
