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
import { FACT_LIST_FIELD_NAMES } from './factFieldContract.js'
import { getGitCommit } from './git.js'

// 27 号 §7：norm 事实规范与既有六类同路径（ldvh-base/norms/，localFactReader
// 已登记载体与目录）——纳入列表/详情/关联解析的活跃类型面。
//
// 29 号 DevLog 已于 2026-11-14 撤除（Human 根决定，01 §8 号位表 29 为空位）：
// 'devlog' 退出类型值域；21 条存量载体已于同日删除批（91b3d727）物理移除，
// 其逐字副本存于 docs/devlog-archive/（普通文档，非事实源）。
// （原「列表次序排最后」的导航口径随之作废——本数组是类型值域，不是呈现次序。）
export const ACTIVE_OBJECT_TYPES = ['adr', 'pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'] as const
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

/**
 * 「该类型尚未接入」的列表结果。
 *
 * **2026-11-02（Human 定案）起，本函数不再由「对象目录不存在」触发**——那条判定在
 * 读取层已改为按零对象处理（口径与实测证据见 `localFactReader.ts` 的
 * `emptyTypeDirectory` 注释）。此处保留本函数与 `coverage_status: 'type_not_integrated'`
 * 这个投影值，因为它是**前端契约的一部分**（`FactCoverageStatus` 有该成员、三个筛选器
 * 按它显示 `—`、列表页有专门的分支与文案），且未来若出现「有目录契约但无读取支持」
 * 的类型，它才是正确答案。
 *
 * 现在唯一的触发点是 `listed.status !== 'complete'`：读取层只在**真的**判定该类型无法
 * 列举时才会给出这个状态。当前九类全部接入，故它在运行期不出现——这不是「没测过」，
 * 而是「判据已不可能成立」。
 */
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

function projectListItem(type: ObjectType, item: LocalFactItem, _uidTargets?: FactUidTargetIndex): Record<string, unknown> {
  const source = item.fact_object ?? {}
  const base = copyPresentFields(source, FACT_LIST_FIELD_NAMES[type])
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

type FactAssociationTarget = LegacyFactAssociationTarget
  // 02 §8.1「commit 形态」：解药是一次受控提交、没有任何对象身份。提交不是事实
  // 对象，故没有 title/status 可解析——但它**是**一条可用的关联（呈现层跳提交详情
  // 页 /changelog/:hash），故不得与「解析失败」混为一谈。
  | { objectUid: string }
  | { commit: string }
type FactUidTargetIndex = Map<string, LegacyFactAssociationTarget | null>
type FactRefSourceIndex = Map<string, Array<Record<string, unknown>>>
function refObjectUid(value: unknown): string | null {
  return canonicalUid(value) ? value : null
}

// 03 §6.1：canonical object_uid 是 UUIDv4（版本位 4），规范明文不采用时间有序的
// UUIDv7——此处曾误用 v7 形态，使每个按规范创建的对象都无法被认作关联目标，
// uidTargets 索引恒空、全部关联降级为「关联信息不可用」。单一权威判定见
// shared/factIdentity.canonicalUid()，全读取层复用它而不是各自维护正则。

function factAssociationTargetKey(target: FactAssociationTarget): string {
  if ('commit' in target) return `commit\u0000${target.commit}`
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
  // commit 形态（02 §8.1）：单键 {commit} 且为 40 位十六进制。与 object_uid 形态
  // 互斥——混带形态在写侧已被拒，这里仍拒以免历史/手改数据绕过形状纪律。
  if (keys.length === 1 && typeof target.commit === 'string' && /^[0-9a-f]{40}$/i.test(target.commit.trim())) {
    return { commit: target.commit.trim() }
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

/**
 * 读取受控提交的**描述部分**，供呈现层显示「这次提交做了什么」——不含
 * conventional commit 前缀（type(scope):），那是记账格式而非内容。
 * 读失败（提交不可达、git 不可用、worktree 不在 Git 仓内）一律返回 null，
 * 由调用方退回短 hash——标题是增强，不是可用性的前提。
 */
/**
 * 提交描述缓存：每条 commit 形态的关联都要读一次提交标题，而一次 git 子进程
 * 约 79ms。事实对象里的 commit hash 是**不可变**的（同一 hash 永远同一提交），
 * 因此按 hash + worktree 缓存永不失效——这是唯一无需指纹判据的缓存。
 */
const commitDescriptionCache = new Map<string, string | null>()
const COMMIT_CACHE_LIMIT = 512

async function readCommitDescription(hash: string, scope: { worktreeLocator?: string }): Promise<string | null> {
  const cwd = scope.worktreeLocator;
  if (typeof cwd !== 'string' || !cwd) return null;
  const cacheKey = `${cwd}\u0000${hash}`
  if (commitDescriptionCache.has(cacheKey)) return commitDescriptionCache.get(cacheKey) ?? null
  try {
    const entry = await getGitCommit(hash, 'zh', cwd);
    // 只取**描述部分**：conventional commit 前缀（type(scope): / type!:）是提交
    // 纪律的记账格式，不是内容。读者要看的是「这次提交做了什么」，不需要在前缀上
    // 再读一遍它的类型与范围（与 08 §5「定位符不当内容呈现」同一纪律）。
    const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
    if (description) return rememberCommit(cacheKey, description);
    // 非常规格式（或解析失败）时退回整条 subject——宁可多显示前缀，也不显示空。
    const message = typeof entry?.message === 'string' ? entry.message.trim() : '';
    return rememberCommit(cacheKey, message || null);
  } catch {
    return rememberCommit(cacheKey, null);
  }
}

function rememberCommit(key: string, value: string | null): string | null {
  if (commitDescriptionCache.size >= COMMIT_CACHE_LIMIT && !commitDescriptionCache.has(key)) {
    const oldest = commitDescriptionCache.keys().next().value
    if (oldest !== undefined) commitDescriptionCache.delete(oldest)
  }
  commitDescriptionCache.set(key, value)
  return value
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
 * Derive the reverse side of ordinary `refs` associations for object cards.
 *
 * This is deliberately a read-time projection, not a persisted lifecycle index:
 * each readable fact in the current governed project is scanned and its declared
 * refs are inverted into `target UID -> source entries`.  The result says only
 * that a source object currently declares a reference to the target; it does
 * not infer advice fulfilment, semantic coverage, approval, or closure.
 *
 * Unreadable/cross-project sources never enter the index. A readable source
 * remains available even when it has no usable title; the presentation layer
 * falls back to its UID for display in that case.
 */
async function currentProjectFactRefSources(scope: LocalFactScope): Promise<FactRefSourceIndex> {
  const reverse = new Map<string, Array<Record<string, unknown>>>()
  const seen = new Set<string>()
  for (const type of ACTIVE_OBJECT_TYPES) {
    const listed = await listLocalFacts(type, scope)
    for (const item of listed.items) {
      if (item.read_status !== 'readable' || item.fact_object === null) continue
      const sourceUid = refObjectUid(item.fact_object.object_uid)
      if (!sourceUid || !Array.isArray(item.fact_object.refs)) continue
      const sourceTarget = {
        governedProjectId: scope.governedProjectId,
        factTypeKey: type,
        objectId: item.object_ref.object_id,
      }
      const sourceTitle = typeof item.fact_object.title === 'string' && item.fact_object.title.trim()
        ? item.fact_object.title
        : undefined
      const sourceEntry: Record<string, unknown> = {
        objectUid: sourceUid,
        // Readability, not optional title metadata, determines availability.
        available: true,
        resolvedTarget: sourceTarget,
        ...(sourceTitle !== undefined ? { title: sourceTitle } : {}),
        ...copyPresentFields(item.fact_object, ['title_en', 'title_zh', 'status']),
      }
      for (const candidate of item.fact_object.refs) {
        const targetUid = typeof candidate === 'string'
          ? refObjectUid(candidate)
          : candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            ? refObjectUid((candidate as Record<string, unknown>).object_uid)
            : null
        if (!targetUid) continue
        const edgeKey = `${sourceUid.toLowerCase()}\u0000${targetUid.toLowerCase()}`
        if (seen.has(edgeKey)) continue
        seen.add(edgeKey)
        const targetKey = targetUid.toLowerCase()
        const sources = reverse.get(targetKey) ?? []
        sources.push({ ...sourceEntry })
        reverse.set(targetKey, sources)
      }
    }
  }
  return reverse
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
    // commit 形态（02 §8.1）：无需解析对象——hash 的真实性已在写侧由 git
    // cat-file -e 核过（fail-closed），此处只负责把它标成「可用关联」并交给呈现层
    // 跳提交详情页。不标 available 会被读成「关联信息不可用」，与「提交不可用」
    // 这两件不同的事混为一谈。
    if ('commit' in target) {
      // 呈现要的是「这次提交做了什么」，hash 只是定位符（08 §5：不把定位符
      // 当内容呈现）。故读出提交标题；读不到时退回短 hash，绝不因标题缺失
      // 把整条关联判为不可用——提交本身是存在的。
      const shortHash = target.commit.slice(0, 7)
      const commitDescription = await readCommitDescription(target.commit, scope)
      return { ...projection, available: true, shortHash, ...(commitDescription ? { title: commitDescription } : {}) }
    }
    const locator = 'objectUid' in target ? uidTargets.get(target.objectUid) : target
    if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey)) return projection
    const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope)
    if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null) return projection
    const source = exact.item.fact_object
    if (typeof source.title !== 'string' || !source.title.trim()) return projection
    return {
      ...projection,
      available: true,
      ...('objectUid' in target ? { resolvedTarget: locator } : {}),
      title: source.title,
      ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
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
    // `target` 与顶层 `objectUid` **同时**产出（2026-11-04 类型收敛，修
    // spark-b0e805d1 缺陷②）：`target` 让 refs 与 relations 走同一形状
    // （`FactCardAssociation.target` 已改为必填），顶层 `objectUid` 保留是因为
    // 详情页 `projectFactReadingRefs` 按它归一；两处读到的是同一个权威 UID，
    // 不是两份事实。
    if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey)) {
      out.push({ objectUid, target: { objectUid }, available: false })
      continue
    }
    const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope)
    if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null) {
      out.push({ objectUid, target: { objectUid }, available: false })
      continue
    }
    const source = exact.item.fact_object
    if (typeof source.title !== 'string' || !source.title.trim()) {
      out.push({ objectUid, target: { objectUid }, available: false })
      continue
    }
    out.push({
      objectUid,
      target: { objectUid },
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
  _refSourceIndex?: FactRefSourceIndex,
): Promise<Record<string, unknown>> {
  const associations = await projectFactCardAssociations(item, scope, uidTargets)
  // 03 §7.2 分工纪律：refs 与 relations 并列投影、互不并入。列表卡与详情卡
  // 共用同一投影契约——否则同一对象的关联在两层阅读器里不一致（10 §5.2
  // 卡片网格承载「关联计数」）。此处只新增调用，解析规则仍由 projectFactRefs
  // 单点承载（不新写逻辑）。
  const refs = await projectFactRefs(item, scope, uidTargets)
  const inboundRefSources: never[] = []
  return {
    ...projectListItem(type, item, uidTargets),
    ...(associations.length > 0 ? { factAssociations: associations } : {}),
    ...(refs.length > 0 ? { factRefs: refs } : {}),
    ...(inboundRefSources.length > 0 ? { factRefSources: inboundRefSources } : {}),
  }
}

function copyPresentFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => Object.prototype.hasOwnProperty.call(source, field) ? [[field, source[field]]] : []))
}


/**
 * 28 §8.1：子目标名下工作的**读取时派生**（不是存储状态）。
 *
 * 子目标不存「拆解进度」字段，进度由下游 `serves` 反查得到。这里读 spark 与
 * 两类全量，把 `serves === subGoalUid` 的对象收成一行一行的工作清单。
 *
 * 2026-11-01：匹配键由 `SG-n` 改为 SubGoal 的 `object_uid`（28 §12.3 废止锚点
 * 形态）。两侧都是 uuid，故这是**精确相等**判断，不存在「标签写错一半」的模糊面。
 *
 * **空集必须可区分地呈现**：名下没有任何 `serves` 的子目标，其拆解进度表现为
 * 空集——但空集既可能是「还没拆解」，也可能是「拆解了但没声明 serves」，
 * 这两种情形在机械层不可区分（28 §8.1）。故调用方必须同时拿到 `serving_empty`
 * 与一句显式的歧义说明，不得把 0 条折算成「进度 0%」。
 *
 * 读取失败**不得**当作空集：无法枚举某类型时该类型记为 unreadable 并列出，
 * 否则「读不到」会被读者读成「没有」（00 §4.6）。
 */
type ServingWorkRow = {
  object_uid?: string
  type: string
  id: string
  title: string
  status: string
  /** 目标对象所属项目：联邦视图里卡片的当前项目与对象所属项目可能不同，
   *  统一关联行要据此判「能否在本项目的面板里打开」。 */
  governed_project_id: string
  href: string
}

/**
 * 全场反查一次，得到「子目标 uid → 名下工作行」的索引。
 *
 * 为什么要有索引形态（2026-11-02）：列表页要为**每一条**子目标卡呈现名下工作。
 * 逐条调用单子目标版本会让 spark 等类型被扫描 N 次（N = 子目标数），
 * 而反查口径完全相同——同一份判据算 N 遍。故在此单点扫描、按 uid 归组，列表与
 * 详情共用同一份结果与同一套判据。
 *
 * 读取失败**不得**当作空集（00 §4.6）：无法枚举某类型时该类型记入 `unreadable`
 * 并列出，否则「读不到」会被读者读成「没有」。
 */
async function deriveServingWorkIndex(scope: LocalFactScope): Promise<{
  bySubGoal: Map<string, ServingWorkRow[]>
  unreadable: string[]
}> {
  const types = ['spark'] as const
  const bySubGoal = new Map<string, ServingWorkRow[]>()
  const unreadable: string[] = []
  for (const type of types) {
    let listed
    try {
      listed = await listLocalFacts(type, scope)
    } catch {
      unreadable.push(`${type}: read failed`)
      continue
    }
    if (listed.status !== 'complete') {
      unreadable.push(`${type}: ${listed.issues[0]?.message ?? 'unavailable'}`)
      continue
    }
    for (const item of listed.items) {
      if (item.read_status !== 'readable' || item.fact_object === null) {
        unreadable.push(`${type}: ${item.object_ref.object_id} unreadable`)
        continue
      }
      const serves = item.fact_object.serves
      const targets = Array.isArray(serves) ? serves : typeof serves === 'string' ? [serves] : []
      if (targets.length === 0) continue
      const uid = typeof item.fact_object.object_uid === 'string' ? item.fact_object.object_uid : undefined
      const status = typeof item.fact_object.status === 'string' ? item.fact_object.status : ''
      for (const target of targets) {
        if (typeof target !== 'string' || target.length === 0) continue
        const rows = bySubGoal.get(target) ?? []
        rows.push({
          object_uid: uid,
          type,
          // `id` 必须是**载体标识 `<type>-<uuid>`**，不是裸 uuid。详情路由
          // （`showObject` 的 ObjectIdPattern）只认带类型前缀的形态，而列表/详情的
          // 「名下的工作」行是被当作导航目标消费的（面板 `openPanel({objectId})`）。
          // 早先写成 `uid ?? object.object_id`，凡 uid 存在就落成裸 uuid，点开必然
          // 404「Object not found: <uuid>」——而该行本身明明可读。故这里取 object_ref
          // 的 object_id（读取层由载体文件名得出，恒为带前缀形态），uid 仍由
          // `object_uid` 单独承载（03 §6.1 两套标识各司其职，不得互相顶替）。
          id: item.object_ref.object_id,
          title: typeof item.fact_object.title === 'string' ? item.fact_object.title : item.object_ref.object_id,
          status,
          governed_project_id: item.object_ref.governed_project_id,
          // href 是**路由路径**，不是 hash 片段：应用用 BrowserRouter（`App.tsx`），
          // `#/objects/...` 只会改 fragment、不触发路由，点上去看起来「没反应」。
          href: `/objects/${type}/${item.object_ref.object_id}`,
        })
        bySubGoal.set(target, rows)
      }
    }
  }
  return { bySubGoal, unreadable }
}

/**
 * 导出给 `/api/cognition/goal` 用：聚焦页目标区要**逐条**子目标挂火花落实比值，
 * 而那条路由不走 `listObjects('subgoal')`（它读的是 goal.md 单例 + subgoals/ 反查）。
 *
 * 为什么仍从这里取而不是在 cognition.ts 里再扫一遍：反查口径只有一份——分子分母
 * 必须是「同一次 serves 反查的结果」，两处各扫一次就会在两次读取之间出现不一致
 * （一个对象刚被改、另一处还读到旧值），而读者看到的是一条自相矛盾的卡。
 */
export async function deriveServingWorkIndexForScope(scope: LocalFactScope): Promise<{
  bySubGoal: Map<string, ServingWorkRow[]>
  unreadable: string[]
}> {
  return deriveServingWorkIndex(scope)
}

async function deriveServingWork(
  scope: LocalFactScope,
  subGoalUid: string,
): Promise<{ items: ServingWorkRow[]; unreadable: string[] }> {
  const index = await deriveServingWorkIndex(scope)
  return { items: index.bySubGoal.get(subGoalUid) ?? [], unreadable: index.unreadable }
}

export async function listObjects(type: ObjectType, _baseDir?: string, status?: string, scope?: LocalFactScope): Promise<WebFactResult | WebFactError> {
  try {
    const resolvedScope = await readingScope(scope)
    const listed = await listLocalFacts(type, resolvedScope)
    // 目录缺失已在上游按零对象处理（见 `localFactReader.emptyTypeDirectory`），故此分支
    // 只在读取层真的报「无法列举」时才命中，不再等价于「目录不存在」。
    if (listed.status !== 'complete') return notIntegrated(type, listed.issues[0]?.message ?? `类型 ${type} 无法列举`)
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    // Reverse ordinary refs are derived once per read and only attached to
    // Object cards. They remain separate from outgoing factRefs and formal
    // factAssociations; no persisted lifecycle index is introduced.
    const refSourceIndex = await currentProjectFactRefSources(resolvedScope)
    // 28 §8.1 的派生在列表层同样成立，且必须与详情同源：子目标卡的「名下工作」
    // 不是新增字段，而是同一次反查的投影。索引只建一次——逐条建索引会让 spark 与
    // 被扫描 N 次（N = 子目标数），而判据完全相同。
    const servingWork = type === 'subgoal' ? await deriveServingWorkIndex(resolvedScope) : null
    const projectedItems = await Promise.all(
      listed.items.map(async (item) => {
        const projected = await projectListItemWithAssociations(type, item, resolvedScope, uidTargets, refSourceIndex)
        if (servingWork === null) return projected
        const subGoalUid = typeof item.fact_object?.object_uid === 'string' ? item.fact_object.object_uid : ''
        if (!subGoalUid) return projected
        const derived = servingWork.bySubGoal.get(subGoalUid) ?? []
        return {
          ...projected,
          serving_work: derived,
          ...(derived.length === 0 ? { serving_empty: true } : {}),
          ...(servingWork.unreadable.length > 0 ? { serving_unreadable: servingWork.unreadable } : {}),
        }
      }),
    )
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

const OBJECT_ID_PATTERN = /^(adr|pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

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
    if (type === 'subgoal') {
      // 28 §8.1：拆解与落实情况不存字段，由 serves 反查派生。空集与读取失败
      // 分列两个键——前者是「未声明或未拆解」的歧义，后者是「读不到」，
      // 都不许被折算成一个进度值。
      const subGoalUid = typeof item.fact_object.object_uid === 'string' ? item.fact_object.object_uid : ''
      if (subGoalUid) {
        const derived = await deriveServingWork(resolvedScope, subGoalUid)
        data.serving_work = derived.items
        if (derived.items.length === 0) data.serving_empty = true
        if (derived.unreadable.length > 0) data.serving_unreadable = derived.unreadable
      }
    }
    const response = { ...result('show', id, data), summary: { id, type, ...(typeof data.status === 'string' ? { status: data.status } : {}) } }
    response.issues = [...item.issues, ...item.field_issues]
    return response
  } catch (caught) {
    return error(caught)
  }
}
