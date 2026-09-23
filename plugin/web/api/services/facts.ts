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
import { parseWorkCaseResultDraft, parseWorkCaseCancellation } from '../../shared/workcaseResultDraft.js'
import { hasUnavailableIndependentSubagentReview } from '../../shared/workcaseCapability.js'
import { toRfc3339Text } from '../../shared/timestamp.js'
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

/**
 * refs（03 §7.2 关联引用型 / 20 §8）：把普通内容关联投影为可读的关联条目。
 *
 * 与 projectFactCardAssociations 的分工（03 §7.2「分工纪律」）：`relations`
 * 承载生命周期关系（合并/拆分/替代），`refs` 承载普通内容关联；两者语义
 * **互不替代**，因此这里产出的是并列的独立字段 `factRefs`，绝不并入
 * relations 数组、也不为其编造 relation key（refs 不参与关系闭集校验）。
 *
 * 解析失败（目标不可解析/不可读/跨项目）时保留该条并标 available:false，
 * 由呈现层如实标注——03 §7.2 机械校验边界：目标解析失败不得降级为空数组
 * 或静默丢弃该条目。
 */
async function projectFactRefs(
  item: LocalFactItem,
  scope: LocalFactScope,
  uidTargets: FactUidTargetIndex,
): Promise<Array<Record<string, unknown>>> {
  const refs = item.fact_object?.refs
  if (!Array.isArray(refs)) return []
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const candidate of refs) {
    const objectUid = typeof candidate === 'string'
      ? candidate
      : (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as { object_uid?: unknown }).object_uid
        : undefined)
    if (typeof objectUid !== 'string' || !objectUid.trim() || seen.has(objectUid)) continue
    seen.add(objectUid)
    const locator = uidTargets.get(objectUid) ?? null
    if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey)) {
      out.push({ objectUid, available: false })
      continue
    }
    const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope)
    if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null) {
      out.push({ objectUid, available: false })
      continue
    }
    const source = exact.item.fact_object
    if (typeof source.title !== 'string' || !source.title.trim()) {
      out.push({ objectUid, available: false })
      continue
    }
    out.push({
      objectUid,
      available: true,
      resolvedTarget: locator,
      title: source.title,
      ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
    })
  }
  return out
}

async function projectListItemWithAssociations(
  type: ObjectType,
  item: LocalFactItem,
  scope: LocalFactScope,
  uidTargets: FactUidTargetIndex,
): Promise<Record<string, unknown>> {
  const associations = await projectFactCardAssociations(item, scope, uidTargets)
  // 03 §7.2 分工纪律：refs 与 relations 并列投影、互不并入。列表卡与详情卡
  // 共用同一投影契约——否则同一对象的关联在两层阅读器里不一致（10 §5.2
  // 卡片网格承载「关联计数」）。此处只新增调用，解析规则仍由 projectFactRefs
  // 单点承载（不新写逻辑）。
  const refs = await projectFactRefs(item, scope, uidTargets)
  return {
    ...projectListItem(type, item, uidTargets),
    ...(associations.length > 0 ? { factAssociations: associations } : {}),
    ...(refs.length > 0 ? { factRefs: refs } : {}),
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

/**
 * result 投影：criteria_checks[{satisfied, evidence}] + achieved_scope + residual（21 §8）。
 *
 * 21 §9.3 的字段真实类型是 `satisfied: boolean`、`residual: string[]`（21 §8
 * frontmatter 闭集）。此前本函数按 `typeof === 'string'` 判定，对真实对象
 * **恒不命中**：`residual` 是数组、`satisfied` 是布尔，两者都被静默丢弃——
 * 于是 closed 详情的「逐条判据核对」全部退化为「未记录」、残留责任节点整体
 * 消失（WorkCase 呈现保真缺陷 D1/D2）。此处按字段真实类型判定，**不放宽也不
 * 收紧字段闭集**：类型不符者仍如实丢弃（由读取层的 field_issues 另行报告）。
 */
function projectWorkCaseResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  const checks = Array.isArray(result.criteria_checks)
    ? result.criteria_checks
      .map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
        const check = candidate as Record<string, unknown>
        return {
          ...(typeof check.satisfied === 'boolean' ? { satisfied: check.satisfied } : {}),
          ...(typeof check.evidence === 'string' ? { evidence: check.evidence } : {}),
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null)
    : []
  const residual = Array.isArray(result.residual)
    ? result.residual.filter((item): item is string => typeof item === 'string')
    : null
  return {
    ...(checks.length > 0 ? { criteria_checks: checks } : {}),
    ...(typeof result.achieved_scope === 'string' ? { achieved_scope: result.achieved_scope } : {}),
    // 空数组是合法值（21 §9.3：`completed` 时 residual 可为空），必须与「缺失」
    // 区分——丢失它会让详情无法区分「无残留」与「未记录残留」。
    ...(residual !== null ? { residual } : {}),
  }
}

/**
 * gate_1 投影：`approved_at` / `approver` / `authorization_fingerprint` / `scope_snapshot`
 * （21 §8 声明的 gate_1 全四字段）。
 *
 * 两点必守：
 * 1. `approved_at` 经 js-yaml 解析后是 `Date`（未加引号的 ISO 时间戳），不是字符串；
 *    按 string 判定会把它丢弃，使详情取不到批准时间（缺陷 D3）。时间字段统一经
 *    `toRfc3339Text` 归一为 RFC 3339 文本。
 * 2. **必须保留 `authorization_fingerprint` 与 `scope_snapshot`**：它们是 C2 授权钉扎
 *    的两个承载（21 §10.3）——指纹是「授权是否仍覆盖当前 plan+scope」的比对基准，
 *    `scope_snapshot` 是越权拒绝的比对基准（21 §8 称其为 scope 的授权时快照）。
 *    此前的投影只留 `approved_at`/`approver`，而 `showObject` 的装配顺序是
 *    `data = {...fact_object}` 后 `Object.assign(data, currentCard)`——投影会**覆盖**
 *    来源对象，于是这两个字段在 closed 详情被静默丢弃（open 因不投影 gate_1 反而
 *    侥幸保留了原值，造成同一字段两种运行期形态）。
 */
function projectWorkCaseGate1(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const gate = value as Record<string, unknown>
  const approvedAt = toRfc3339Text(gate.approved_at)
  return {
    ...(approvedAt !== undefined ? { approved_at: approvedAt } : {}),
    ...(typeof gate.approver === 'string' ? { approver: gate.approver } : {}),
    ...(typeof gate.authorization_fingerprint === 'string'
      ? { authorization_fingerprint: gate.authorization_fingerprint }
      : {}),
    ...(typeof gate.scope_snapshot === 'string' ? { scope_snapshot: gate.scope_snapshot } : {}),
  }
}

/**
 * attempt 投影：21 §8 登记的全部字段——attempt_id / started_at / controller /
 * heartbeat_at / session_id（+ Code 一并盖戳的 provenance `session_source`）。
 *
 * `started_at` 与 `heartbeat_at` 同 gate_1 是 `Date`，且此前**根本未被复制**——
 * open 详情的执行现场因此缺两格，而 `heartbeat_at` 正是 21 §10.4 判定 attempt
 * 是否为孤立 attempt 的依据（缺陷 D4）。
 *
 * **`session_id` / `session_source` 的补齐（缺陷 D5，2026-09-20）**：二者由
 * workcase-2be11478 引入（21 §8 的 `attempt` 字段登记、§14 关闭前置条件二的身份
 * 基准），但本投影的白名单**停留在此前的 4 个字段**，于是被静默丢弃。后果不是
 * 样式问题而是**证据链断裂**：关闭侧独立性比对以 `attempt.session_id` 为基准，
 * Human 在详情面无法回读这个基准值，只能读结论而看不到比对依据。
 *
 * 根因与 gate_1 同形：**白名单与字段登记是两处权威**，新增字段时后者更新而前者
 * 未同步，且当时无守卫。现按 21 §8 的登记补齐；`web/tests/api/workcase-projection-
 * fidelity.test.ts` 的运行时保真守卫（对真实载体逐字段对照）与此后新增的登记集
 * 用例共同覆盖这条缝。
 *
 * 不做类型分流的理由同 gist：缺失与否由**来源对象**决定（`session_id` 在 identity
 * 不可得时合法缺席——见 writer 的条件展开），投影只负责忠实搬运。故除 Date 归一
 * 外不做类型判定，一律原值搬运，避免重演 D1–D4 那类「按错误类型判定 → 静默丢弃」。
 */
function projectWorkCaseAttempt(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attempt = value as Record<string, unknown>
  const startedAt = toRfc3339Text(attempt.started_at)
  const heartbeatAt = toRfc3339Text(attempt.heartbeat_at)
  return {
    ...(typeof attempt.attempt_id !== 'undefined' ? { attempt_id: attempt.attempt_id } : {}),
    ...(typeof attempt.controller === 'string' ? { controller: attempt.controller } : {}),
    ...(startedAt !== undefined ? { started_at: startedAt } : {}),
    ...(heartbeatAt !== undefined ? { heartbeat_at: heartbeatAt } : {}),
    // 「无身份」不得被解释为「无该字段」：仅当来源确有值时才搬运，缺席即缺席。
    ...(typeof attempt.session_id === 'string' ? { session_id: attempt.session_id } : {}),
    ...(typeof attempt.session_source === 'string' ? { session_source: attempt.session_source } : {}),
  }
}

function projectCurrentWorkCaseCardShape(
  fact: Record<string, unknown>,
  view: WorkCaseV5View,
): Record<string, unknown> {
  // 恒复制：身份 + 标题 + 状态 + serves + 基础字段。
  // `gist`（21 §8）同样恒复制：它是**卡面**渲染的字段（10 §5.5「卡面与详情的
  // 字段分工」），三个状态都要有——此前 summary 只在 draft 分支投影，open/closed
  // 卡面因此拿不到可渲染文本。gist 不重复该错误：缺失与否由**来源对象**决定
  // （closed 缺失合法，21 §8），投影只负责忠实搬运，不做状态分流。
  const projected = copyPresentFields(fact, [
    'object_id', 'fact_type_key', 'title', 'status', 'serves', 'created_at', 'change_log', 'gist',
  ])
  // 21 号三态直读视图序列化（current_snapshot_projection 改为 WorkCaseV5View）。
  projected.current_snapshot_projection = view
  if (view.group) projected.group = view.group
  if (view.outcome) projected.outcome = view.outcome
  if (view.has_result_draft) projected.has_result_draft = true
  if (hasUnavailableIndependentSubagentReview(fact)) projected.independentSubagentUnavailable = true

  // gate_1 与状态无关地投影——21 §9.1 的「`gate_1` 出现 ⇔ `status ∈ {open, closed}`」
  // 由**来源对象**保证（draft 对象本就不携带该字段，此处自然不产出）。此前它只在
  // closed 分支投影，后果有二：①closed 走投影重建、open 走 `{...fact_object}` 原值
  // 透传，同一字段出现两种运行期形态（open 的 `approved_at` 仍是 `Date`，closed 才是
  // 归一文）；②重建会覆盖来源，而重建昔只含 2 个字段，于是 closed 详情的
  // `authorization_fingerprint` 与 `scope_snapshot` 被静默丢弃——那是 C2 授权钉扎的
  // 比对基准（21 §10.3）。统一为一处投影后，字段集与类型都不再随状态漂移。
  if (fact.gate_1 !== undefined && fact.gate_1 !== null) {
    const gate1 = projectWorkCaseGate1(fact.gate_1)
    if (gate1 && Object.keys(gate1).length > 0) projected.gate_1 = gate1
  }

  if (view.status === 'draft') {
    // draft：计划判据 + summary + scope + serves。
    Object.assign(projected, copyPresentFields(fact, ['summary', 'scope', 'serves']))
    const plan = projectWorkCasePlan(fact.plan)
    if (plan.length > 0) projected.plan = plan
  } else if (view.status === 'open') {
    // open：attempt 现场 + plan + reviews。不投影「## 执行 节存在性」——该标记零消费方
    // （曾为 `has_execution_section`），属 v4 遗留的展示耦合；21 §8 未定义该字段，
    // 21 §19 第 4 条亦明确「不为执行过程建完整日志字段」（过程在 transcript 与
    // Git）。执行进展由 `attempt`（谁在做、做到哪里）与 change_log 承载。
    const attempt = projectWorkCaseAttempt(fact.attempt)
    if (attempt && Object.keys(attempt).length > 0) projected.attempt = attempt
    const plan = projectWorkCasePlan(fact.plan)
    if (plan.length > 0) projected.plan = plan
    // 10 §5.5「执行期阶段」：`executing` 组内部按 reviews 与 change_log 的数组序派生
    // 四阶段（执行中/复核中/修订中/结项中）。派生需要两个输入，`change_log` 已在恒
    // 复制清单内，`reviews` 此前未投影——缺它则「复核中/修订中/结项中」三者恒不可判
    // （会被一律判为「执行中」）。故此处补齐 `reviews` 的投影，与详情面同源同形。
    const reviews = Array.isArray(fact.reviews) ? fact.reviews : []
    if (reviews.length > 0) projected.reviews = reviews
    // 「待批准关闭」期（open ∧ 正文含「## 结果」节）：`21 §8` 的 `result` 字段尚不存在
    // （该字段出现 ⇔ `status = closed`），核对结论与建议**只在正文里**。故此处按
    // 已登记的词表与结构解析正文，投影为卡片可呈现的 `result_checks` 与 `advice`。
    // 解析不出的条目落空而不猜（见 shared/workcaseResultDraft）。
    if (view.has_result_draft) {
      const draft = parseWorkCaseResultDraft(fact.report_body, fact.plan)
      if (draft.checks.length > 0) projected.result_checks = draft.checks
      if (draft.advice.length > 0) projected.advice = draft.advice
    }
  } else if (view.status === 'closed') {
    // closed：outcome 四值 + result 逐条核对 + plan（gate_1 已在上方统一投影）。
    //
    // 取消记录（`21 §8`，仅 outcome=cancelled）：取消理由与「未发生的范围」写在正文
    // 「## 结果」节的 `- cancellation:` 段，须解析后投影为卡片可呈现的 `cancellation`。
    // 此前这两件事被塞进 `achieved_scope`（语义为「已证实范围」），呈现层取不到，
    // 卡面因此整段不显示。
    //
    // `plan` 此前不在本分支投影。后果是**列表卡拿不到步骤标题**：`21 §8` 的
    // `result.criteria_checks[]` 只有 `{satisfied, evidence}`，不含判据文本，故
    // 「哪一条判据达成了」只能由 `plan[i].step` 给出。详情面不受影响——`showObject`
    // 直接展开 `fact_object`，故详情一直有 `plan`；缺口只在本投影。
    // 不投影会让 closed 卡只能显示 evidence 长句（实测最长 258 字），撑破扫读窗口。
    const plan = projectWorkCasePlan(fact.plan)
    if (plan.length > 0) projected.plan = plan
    if (typeof fact.outcome === 'string') projected.outcome = fact.outcome
    const result = projectWorkCaseResult(fact.result)
    if (result && Object.keys(result).length > 0) projected.result = result
    if (fact.outcome === 'cancelled') {
      const cancellation = parseWorkCaseCancellation(fact.report_body)
      if (cancellation !== null) projected.cancellation = cancellation
    }
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
    // 03 §7.2 关联引用型 / 20 §8：refs 与 relations 并列投影、互不并入。
    const refs = await projectFactRefs(item, resolvedScope, uidTargets)
    if (refs.length > 0) data.factRefs = refs
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
