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

export const ACTIVE_OBJECT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'] as const
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

function projectListItem(type: ObjectType, item: LocalFactItem, _uidTargets?: FactUidTargetIndex): Record<string, unknown> {
  const source = item.fact_object ?? {}
  const base = copyPresentFields(source, FACT_LIST_FIELD_NAMES[type])
  return {
    ...base,
    ...projectFactIdentity(source),
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
  | { objectUid: string }
  | { commit: string }
type FactUidTargetIndex = Map<string, LegacyFactAssociationTarget | null>
type FactRefSourceIndex = Map<string, Array<Record<string, unknown>>>
function refObjectUid(value: unknown): string | null {
  return canonicalUid(value) ? value : null
}


function factAssociationTargetKey(target: FactAssociationTarget): string {
  if ('commit' in target) return `commit\u0000${target.commit}`
  if ('objectUid' in target) return `uid\u0000${target.objectUid}`
  return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`
}


function projectFactAssociationTarget(value: unknown): FactAssociationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  const keys = Object.keys(target)
  if (keys.length === 1 && canonicalUid(target.object_uid)) {
    return { objectUid: target.object_uid }
  }
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

const commitDescriptionCache = new Map<string, string | null>()
const COMMIT_CACHE_LIMIT = 512

async function readCommitDescription(hash: string, scope: { worktreeLocator?: string }): Promise<string | null> {
  const cwd = scope.worktreeLocator;
  if (typeof cwd !== 'string' || !cwd) return null;
  const cacheKey = `${cwd}\u0000${hash}`
  if (commitDescriptionCache.has(cacheKey)) return commitDescriptionCache.get(cacheKey) ?? null
  try {
    const entry = await getGitCommit(hash, 'zh', cwd);
    const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
    if (description) return rememberCommit(cacheKey, description);
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
    if ('commit' in target) {
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


type ServingWorkRow = {
  object_uid?: string
  type: string
  id: string
  title: string
  status: string
  governed_project_id: string
  href: string
}

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
          id: item.object_ref.object_id,
          title: typeof item.fact_object.title === 'string' ? item.fact_object.title : item.object_ref.object_id,
          status,
          governed_project_id: item.object_ref.governed_project_id,
          href: `/objects/${type}/${item.object_ref.object_id}`,
        })
        bySubGoal.set(target, rows)
      }
    }
  }
  return { bySubGoal, unreadable }
}

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
    if (listed.status !== 'complete') return notIntegrated(type, listed.issues[0]?.message ?? `类型 ${type} 无法列举`)
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    const refSourceIndex = await currentProjectFactRefSources(resolvedScope)
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

const OBJECT_ID_PATTERN = /^(pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

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
      ...(typeof item.yaml_source === 'string' ? { yaml_source: item.yaml_source } : {}),
      field_issues: item.field_issues,
      unparsed_structures: item.unparsed_structures,
      read_issues: item.issues,
    }
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    const associations = await projectFactCardAssociations(item, resolvedScope, uidTargets)
    if (associations.length > 0) data.factAssociations = associations
    const refs = await projectFactRefs(item, resolvedScope, uidTargets)
    if (refs.length > 0) data.factRefs = refs
    if (type === 'subgoal') {
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
