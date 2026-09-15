/** Field-level current-fact reader for Human-facing Web views. */
import {
  listLocalFacts,
  readLocalFact,
  type LocalFactItem,
  type LocalFactMetadata,
  type LocalFactScope,
} from './localFactReader.js'
import { canonicalUid } from '../../shared/factIdentity.js'
import { resolveCurrentWebProject, WebGovernanceError } from './governanceScope.js'
import { deriveWorkCaseV5View, type WorkCaseV5View } from '../../shared/workcaseLifecycle.js'
import { hasUnavailableIndependentSubagentReview } from '../../shared/workcaseCapability.js'
import { FACT_LIST_FIELD_NAMES } from './factFieldContract.js'
import {
  getWorktreeInfos,
  collectFingerprints,
  calculateMergeMeta,
  type CrossWorktreeMeta,
} from './crossWorktreeMerger.js'

// 27 号 §7：norm 事实规范与既有六类同路径（ldvh-base/norms/，localFactReader
// 已登记载体与目录）——纳入列表/详情/关联解析的活跃类型面。
export const ACTIVE_OBJECT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm'] as const
export const OBJECT_TYPES = ACTIVE_OBJECT_TYPES
export type ObjectType = (typeof OBJECT_TYPES)[number]

export interface WebFactResult {
  ok: true
  command: string
  action: string
  target: string
  summary: Record<string, unknown>
  issues: Array<Record<string, unknown>>
  data: Record<string, unknown>
}

export interface WebFactError {
  ok: false
  error: string
  stderr: string
  exitCode: number | string | null
}

function result(action: string, target: string, data: Record<string, unknown>): WebFactResult {
  return { ok: true, command: 'field-level-fact-reader', action, target, summary: { count: Array.isArray(data.items) ? data.items.length : undefined }, issues: [], data }
}

function error(value: unknown): WebFactError {
  if (value instanceof WebGovernanceError) return { ok: false, error: value.message, stderr: '', exitCode: 'governance_unavailable' }
  return { ok: false, error: value instanceof Error ? value.message : 'Fact reader unavailable', stderr: '', exitCode: 1 }
}

async function readingScope(scope?: LocalFactScope): Promise<LocalFactScope> {
  // Explicit scope is an in-process test seam; HTTP requests always resolve it via Helper.
  if (scope) return scope
  const project = await resolveCurrentWebProject()
  return { worktreeLocator: project.path, governedProjectId: project.id }
}

function notIntegrated(type: ObjectType, message: string): WebFactResult {
  const issue = { code: 'type_not_integrated', message }
  const response = result('list', type, { items: [], coverage_status: 'type_not_integrated', collection_issues: [issue] })
  response.issues = [issue]
  response.summary.coverage_status = 'type_not_integrated'
  return response
}

function readFailure(id: string, type: ObjectType, metadata: LocalFactMetadata, issues: Array<Record<string, unknown>>): WebFactResult {
  const response = result('show', id, {
    fact_read_failure: true,
    object_ref: metadata.object_ref,
    canonical_path: metadata.canonical_path,
    carrier: metadata.carrier,
    read_status: 'unreadable',
    field_issues: [],
    unparsed_structures: [],
    read_issues: issues,
  })
  response.summary = { id, type, read_status: 'unreadable' }
  response.issues = issues
  return response
}

function projectFactIdentity(source: Record<string, unknown>): Record<string, unknown> {
  return copyPresentFields(source, ['object_uid'])
}

function projectListItem(type: ObjectType, item: LocalFactItem, uidTargets?: FactUidTargetIndex): Record<string, unknown> {
  const source = item.fact_object ?? {}
  const base = type === 'workcase'
    ? projectCurrentWorkCaseCard(source, item.source_content_fingerprint, uidTargets)
    : copyPresentFields(source, FACT_LIST_FIELD_NAMES[type])
  return {
    ...base,
    ...projectFactIdentity(source),
    // Cards use this only to render the latest update attribution.  Keep the
    // raw carrier so its signature remains traceable to the fact's change log.
    ...copyPresentFields(source, ['change_log']),
    read_status: item.read_status,
    read_issues: item.issues,
    field_issues: item.field_issues,
    unparsed_structures: item.unparsed_structures,
  }
}

type LegacyFactAssociationTarget = {
  governedProjectId: string
  factTypeKey: string
  objectId: string
}

type FactAssociationTarget = LegacyFactAssociationTarget | { objectUid: string }
type FactUidTargetIndex = Map<string, LegacyFactAssociationTarget | null>

// 03 §6.1：canonical object_uid 是 UUIDv4（版本位 4），规范明文不采用时间有序的
// UUIDv7——此处曾误用 v7 形态，使每个按规范创建的对象都无法被认作关联目标，
// uidTargets 索引恒空、全部关联降级为「关联信息不可用」。单一权威判定见
// shared/factIdentity.canonicalUid()，全读取层复用它而不是各自维护正则。

function factAssociationTargetKey(target: FactAssociationTarget): string {
  if ('objectUid' in target) return `uid\u0000${target.objectUid}`
  return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`
}

// 03 §6.1：fact_type_key 载体值为类型短名（各类型规范登记的值域），关联目标
// 与路由直接按短名比较——无归一化层；spec_key 形态的值由读取层报 identity_mismatch。

function projectFactAssociationTarget(value: unknown): FactAssociationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  const keys = Object.keys(target)
  if (keys.length === 1 && canonicalUid(target.object_uid)) {
    return { objectUid: target.object_uid }
  }
  if (keys.length !== 3
    || !keys.every((key) => ['governed_project_id', 'fact_type_key', 'object_id'].includes(key))) return null
  if (typeof target.governed_project_id !== 'string' || !target.governed_project_id.trim()
    || typeof target.fact_type_key !== 'string' || !target.fact_type_key.trim()
    || typeof target.object_id !== 'string' || !target.object_id.trim()) return null
  return {
    governedProjectId: target.governed_project_id,
    factTypeKey: target.fact_type_key,
    objectId: target.object_id,
  }
}

function isObjectType(value: string): value is ObjectType {
  return ACTIVE_OBJECT_TYPES.includes(value as ObjectType)
}

async function currentProjectUidTargets(scope: LocalFactScope): Promise<FactUidTargetIndex> {
  const matches = new Map<string, LegacyFactAssociationTarget[]>()
  for (const type of ACTIVE_OBJECT_TYPES) {
    const listed = await listLocalFacts(type, scope)
    for (const item of listed.items) {
      const objectUid = item.fact_object?.object_uid
      if (item.read_status !== 'readable' || !canonicalUid(objectUid)) continue
      const targets = matches.get(objectUid) ?? []
      targets.push({
        governedProjectId: scope.governedProjectId,
        factTypeKey: type,
        objectId: item.object_ref.object_id,
      })
      matches.set(objectUid, targets)
    }
  }
  return new Map([...matches].map(([objectUid, targets]) => [objectUid, targets.length === 1 ? targets[0] : null]))
}

/**
 * Fact list cards show association targets as an exact-read projection.  A
 * relation never carries a copied title itself, so an unavailable target stays
 * explicit instead of being silently omitted or given a guessed title.
 */
async function projectFactCardAssociations(
  item: LocalFactItem,
  scope: LocalFactScope,
  uidTargets: FactUidTargetIndex,
): Promise<Array<Record<string, unknown>>> {
  const relations = item.fact_object?.relations
  if (!Array.isArray(relations)) return []
  const seenTargets = new Set<string>()
  const visibleRelations = relations.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return true
    const relation = candidate as Record<string, unknown>
    const target = projectFactAssociationTarget(relation.target)
    if (typeof relation.relation_key !== 'string' || target === null) return true
    const targetKey = factAssociationTargetKey(target)
    if (seenTargets.has(targetKey)) return false
    seenTargets.add(targetKey)
    return true
  })
  return Promise.all(visibleRelations.map(async (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { available: false }
    const relation = candidate as Record<string, unknown>
    const target = projectFactAssociationTarget(relation.target)
    if (typeof relation.relation_key !== 'string' || target === null) return { available: false }
    const projection: Record<string, unknown> = { relationKey: relation.relation_key, target, available: false }
    const locator = 'objectUid' in target ? uidTargets.get(target.objectUid) : target
    if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey)) return projection
    const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope)
    if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null) return projection
    const source = exact.item.fact_object
    if (typeof source.title !== 'string' || !source.title.trim()) return projection
    const workCaseView = locator.factTypeKey === 'workcase'
      ? deriveWorkCaseV5View(
        source.status,
        source.outcome,
        source.report_body,
        exact.item.source_content_fingerprint,
      )
      : null
    return {
      ...projection,
      available: true,
      ...('objectUid' in target ? { resolvedTarget: locator } : {}),
      title: source.title,
      ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
      ...(locator.factTypeKey === 'workcase' && workCaseView?.group
        ? { group: workCaseView.group }
        : {}),
    }
  }))
}

async function projectListItemWithAssociations(
  type: ObjectType,
  item: LocalFactItem,
  scope: LocalFactScope,
  uidTargets: FactUidTargetIndex,
): Promise<Record<string, unknown>> {
  const associations = await projectFactCardAssociations(item, scope, uidTargets)
  return {
    ...projectListItem(type, item, uidTargets),
    ...(associations.length > 0 ? { factAssociations: associations } : {}),
  }
}

function copyPresentFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => Object.prototype.hasOwnProperty.call(source, field) ? [[field, source[field]]] : []))
}



/**
 * 21 号 v5 呈现投影：从 v5 字段闭集（summary/serves/scope/plan/gate_1/attempt/
 * result/outcome）派生列表卡与详情卡形状。不引入 v4 的 phase/work_items/
 * closure_proposal 等字段；派生分组只由 workcaseLifecycle 给出，不写回对象。
 */

/** 提取 markdown 正文中某个 H2 节（## <heading>）的节体（不含标题行），忽略代码围栏。 */
function extractMarkdownSection(body: unknown, heading: string): string | null {
  if (typeof body !== 'string' || body.length === 0) return null
  const lines = body.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''
  let capturing = false
  const collected: string[] = []
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(```|~~~)/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) continue
    const headingMatch = /^ {0,3}##\s+([^\s].*?)\s*$/.exec(line)
    if (headingMatch) {
      if (capturing) break
      if (headingMatch[1].trim() === heading) capturing = true
      continue
    }
    if (capturing) collected.push(line)
  }
  if (!capturing) return null
  const text = collected.join('\n').trim()
  return text.length > 0 ? text : null
}

/** plan 数组投影为 {step, done_criteria} 摘要（21 §8）。 */
function projectWorkCasePlan(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const step = candidate as Record<string, unknown>
      if (typeof step.step !== 'string' && typeof step.done_criteria !== 'string') return null
      return {
        ...(typeof step.step === 'string' ? { step: step.step } : {}),
        ...(typeof step.done_criteria === 'string' ? { done_criteria: step.done_criteria } : {}),
      }
    })
    .filter((item): item is Record<string, unknown> => item !== null)
}

/** result 投影：criteria_checks[{satisfied, evidence}] + achieved_scope + residual（21 §8）。 */
function projectWorkCaseResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  const checks = Array.isArray(result.criteria_checks)
    ? result.criteria_checks
      .map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
        const check = candidate as Record<string, unknown>
        return {
          ...(typeof check.satisfied === 'string' ? { satisfied: check.satisfied } : {}),
          ...(typeof check.evidence === 'string' ? { evidence: check.evidence } : {}),
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null)
    : []
  return {
    ...(checks.length > 0 ? { criteria_checks: checks } : {}),
    ...(typeof result.achieved_scope === 'string' ? { achieved_scope: result.achieved_scope } : {}),
    ...(typeof result.residual === 'string' ? { residual: result.residual } : {}),
  }
}

/** gate_1 投影：approved_at / approver（21 §8）。 */
function projectWorkCaseGate1(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const gate = value as Record<string, unknown>
  return {
    ...(typeof gate.approved_at === 'string' ? { approved_at: gate.approved_at } : {}),
    ...(typeof gate.approver === 'string' ? { approver: gate.approver } : {}),
  }
}

/** attempt 投影：attempt_id / controller / heartbeat_at（21 §8）。 */
function projectWorkCaseAttempt(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attempt = value as Record<string, unknown>
  return {
    ...(typeof attempt.attempt_id !== 'undefined' ? { attempt_id: attempt.attempt_id } : {}),
    ...(typeof attempt.controller === 'string' ? { controller: attempt.controller } : {}),
    ...(typeof attempt.heartbeat_at === 'string' ? { heartbeat_at: attempt.heartbeat_at } : {}),
  }
}

function projectCurrentWorkCaseCardShape(
  fact: Record<string, unknown>,
  view: WorkCaseV5View,
): Record<string, unknown> {
  // 恒复制：身份 + 标题 + 状态 + serves + 基础字段。
  const projected = copyPresentFields(fact, [
    'object_id', 'fact_type_key', 'title', 'status', 'serves', 'created_at', 'change_log',
  ])
  // 21 号三态直读视图序列化（current_snapshot_projection 改为 WorkCaseV5View）。
  projected.current_snapshot_projection = view
  if (view.group) projected.group = view.group
  if (view.outcome) projected.outcome = view.outcome
  if (view.has_result_draft) projected.has_result_draft = true
  if (hasUnavailableIndependentSubagentReview(fact)) projected.independentSubagentUnavailable = true

  if (view.status === 'draft') {
    // draft：计划判据 + summary + scope + serves。
    Object.assign(projected, copyPresentFields(fact, ['summary', 'scope', 'serves']))
    const plan = projectWorkCasePlan(fact.plan)
    if (plan.length > 0) projected.plan = plan
  } else if (view.status === 'open') {
    // open：attempt 现场 + plan + 「## 执行」节存在性标记。
    const attempt = projectWorkCaseAttempt(fact.attempt)
    if (attempt && Object.keys(attempt).length > 0) projected.attempt = attempt
    const plan = projectWorkCasePlan(fact.plan)
    if (plan.length > 0) projected.plan = plan
    projected.has_execution_section = extractMarkdownSection(fact.report_body, '执行') !== null
  } else if (view.status === 'closed') {
    // closed：outcome 四值 + result 逐条核对 + gate_1 批准信息。
    if (typeof fact.outcome === 'string') projected.outcome = fact.outcome
    const result = projectWorkCaseResult(fact.result)
    if (result && Object.keys(result).length > 0) projected.result = result
    const gate1 = projectWorkCaseGate1(fact.gate_1)
    if (gate1 && Object.keys(gate1).length > 0) projected.gate_1 = gate1
  }
  return projected
}

export function projectCurrentWorkCaseCard(
  fact: Record<string, unknown>,
  sourceContentFingerprint: string | null,
  uidTargets?: FactUidTargetIndex,
): Record<string, unknown> {
  const view = deriveWorkCaseV5View(
    fact.status,
    fact.outcome,
    fact.report_body,
    sourceContentFingerprint,
  )
  return projectCurrentWorkCaseCardShape(fact, view)
}

export async function listObjects(type: ObjectType, _baseDir?: string, status?: string, scope?: LocalFactScope): Promise<WebFactResult | WebFactError> {
  try {
    const resolvedScope = await readingScope(scope)
    const listed = await listLocalFacts(type, resolvedScope)
    if (listed.status !== 'complete') return notIntegrated(type, listed.issues[0]?.message ?? `类型 ${type} 尚无对象目录`)
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    const projectedItems = await Promise.all(
      listed.items.map((item) => projectListItemWithAssociations(type, item, resolvedScope, uidTargets)),
    )
    // 跨 worktree 合并：当前 worktree 缺的对象补充进来；带分支元数据
    const mergeMeta = await buildCrossWorktreeMeta(type, resolvedScope)
    if (mergeMeta.ok) {
      const { itemsByWorktree, meta } = mergeMeta
      for (const item of projectedItems) {
        const metaForItem = meta.get(String(item.object_id ?? item.id))
        if (metaForItem) Object.assign(item, metaForItem)
      }
      const presentIds = new Set(projectedItems.map((item) => String(item.object_id ?? item.id)))
      const extraProjects: Array<Promise<Record<string, unknown>>> = []
      for (const fps of itemsByWorktree) {
        for (const item of fps.items) {
          const objectId = item.object_ref.object_id
          if (presentIds.has(objectId)) continue
          // 非当前 worktree 的对象，用其所在 worktree 读取（避免占用当前 worktree uid index）
          const foreignScope: LocalFactScope = {
            worktreeLocator: fps.path,
            governedProjectId: fps.governedProjectId,
          }
          const projected = projectListItemWithAssociations(type, item, foreignScope, uidTargets)
          const m = meta.get(objectId)
          if (m) Object.assign(await projected, m)
          presentIds.add(objectId)
          extraProjects.push(projected)
        }
      }
      const extras = await Promise.all(extraProjects)
      projectedItems.push(...extras)
    }
    const items = projectedItems.filter((item) => !status || item.status === status)
    const response = result('list', type, { items, coverage_status: 'complete', collection_issues: listed.issues })
    response.issues = [
      ...listed.issues.map((issue) => ({ ...issue })),
      ...listed.items.flatMap((item) => item.issues.map((issue) => ({ ...issue, object_ref: item.object_ref }))),
      ...listed.items.flatMap((item) => item.field_issues.map((issue) => ({
        code: issue.reason,
        message: `字段 ${issue.path} ${issue.reason}；期望 ${issue.expected}`,
        path: issue.path,
        object_ref: item.object_ref,
      }))),
    ]
    return response
  } catch (caught) {
    return error(caught)
  }
}

/** 跨 worktree 合并的元数据构建（列表流程内部使用）。 */
async function buildCrossWorktreeMeta(
  type: ObjectType,
  resolvedScope: LocalFactScope,
): Promise<{ ok: true; itemsByWorktree: Array<{ path: string; governedProjectId: string; items: LocalFactItem[] }>; meta: Map<string, CrossWorktreeMeta> } | { ok: false }> {
  try {
    const worktreeInfos = await getWorktreeInfos(resolvedScope.worktreeLocator)
    if (worktreeInfos.length <= 1) return { ok: false }
    const { fingerprints, itemsByWorktree } = await collectFingerprints(
      worktreeInfos,
      resolvedScope.governedProjectId,
      type,
    )
    const meta = calculateMergeMeta(
      fingerprints,
      worktreeInfos,
      resolvedScope.worktreeLocator,
      worktreeInfos[0].path, // 主工作区 = 第一条
    )
    return { ok: true, itemsByWorktree: Array.from(itemsByWorktree.entries()).map(([path, items]) => ({ path, governedProjectId: resolvedScope.governedProjectId, items })), meta }
  } catch {
    // 合并失败不阻断主流程（当前 worktree 数据始终可用）
    return { ok: false }
  }
}

const OBJECT_ID_PATTERN = /^(workcase|adr|pitfall|spark|research|friction|norm)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

export async function showObject(id: string, scope?: LocalFactScope): Promise<WebFactResult | WebFactError> {
  const match = OBJECT_ID_PATTERN.exec(id)
  if (!match) return { ok: false, error: `Object not found: ${id}`, stderr: '', exitCode: 1 }
  const type = match[1] as ObjectType
  try {
    const resolvedScope = await readingScope(scope)
    const detail = await readLocalFact(type, id, resolvedScope)
    if (detail.status !== 'ok') return readFailure(id, type, detail.metadata, detail.issues)
    const item = detail.item
    if (item.read_status === 'unreadable' || item.fact_object === null) return readFailure(id, type, item, item.issues)
    const data: Record<string, unknown> = {
      ...item.fact_object,
      object_ref: item.object_ref,
      canonical_path: item.canonical_path,
      carrier: item.carrier,
      read_status: item.read_status,
      // YAML 源视图直显用：文件中 YAML 部分的逐字原文（有什么就显示什么）。
      ...(typeof item.yaml_source === 'string' ? { yaml_source: item.yaml_source } : {}),
      field_issues: item.field_issues,
      unparsed_structures: item.unparsed_structures,
      read_issues: item.issues,
    }
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    const associations = await projectFactCardAssociations(item, resolvedScope, uidTargets)
    if (associations.length > 0) data.factAssociations = associations
    if (type === 'workcase') {
      const projection = deriveWorkCaseV5View(
        item.fact_object.status,
        item.fact_object.outcome,
        item.fact_object.report_body,
        item.source_content_fingerprint,
      )
      data.current_snapshot_projection = projection
      const currentCard = projectCurrentWorkCaseCard(item.fact_object, item.source_content_fingerprint, uidTargets)
      Object.assign(data, currentCard)
      if (projection.group) data.group = projection.group
      if (projection.outcome) data.outcome = projection.outcome
    }
    const response = { ...result('show', id, data), summary: { id, type, ...(typeof data.status === 'string' ? { status: data.status } : {}) } }
    response.issues = [...item.issues, ...item.field_issues]
    return response
  } catch (caught) {
    return error(caught)
  }
}
