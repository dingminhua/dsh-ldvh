/** Field-level current-fact reader for Human-facing Web views. */
import {
  listLocalFacts,
  readLocalFact,
  type LocalFactItem,
  type LocalFactMetadata,
  type LocalFactScope,
} from './localFactReader.js'
import { resolveCurrentWebProject, WebGovernanceError } from './governanceScope.js'
import {
  deriveWorkCasePresentationProjection,
  type WorkCaseCurrentSnapshotProjection,
} from '../../shared/workcaseStatus.js'
import { hasUnavailableIndependentSubagentReview } from '../../shared/workcaseCapability.js'
import { FACT_LIST_FIELD_NAMES } from './factFieldContract.js'
import {
  getWorktreeInfos,
  collectFingerprints,
  calculateMergeMeta,
  type CrossWorktreeMeta,
} from './crossWorktreeMerger.js'

export const ACTIVE_OBJECT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'study'] as const
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

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function factAssociationTargetKey(target: FactAssociationTarget): string {
  if ('objectUid' in target) return `uid\u0000${target.objectUid}`
  return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`
}

function projectFactAssociationTarget(value: unknown): FactAssociationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  const keys = Object.keys(target)
  if (keys.length === 1 && typeof target.object_uid === 'string' && UUID_V7_PATTERN.test(target.object_uid)) {
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
      if (item.read_status !== 'readable' || typeof objectUid !== 'string' || !UUID_V7_PATTERN.test(objectUid)) continue
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
    const workCasePresentation = locator.factTypeKey === 'workcase'
      ? deriveWorkCasePresentationProjection(source.status, source.phase, exact.item.source_content_fingerprint)
      : null
    return {
      ...projection,
      available: true,
      ...('objectUid' in target ? { resolvedTarget: locator } : {}),
      title: source.title,
      ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
      ...(locator.factTypeKey === 'workcase' && typeof source.closure_outcome === 'string'
        ? { closureOutcome: source.closure_outcome }
        : {}),
      ...(workCasePresentation?.resolution === 'resolved'
        ? { progressGroup: workCasePresentation.progress_group }
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

type CardWorkItem = { id: string; title: string; status: string; blockingReason?: string }

function projectCardWorkItems(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0) return { executionItemsProjectionValid: false, executionItems: [] }
  const items = value.map((candidate): CardWorkItem | null => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const item = candidate as Record<string, unknown>
    if (typeof item.item_id !== 'string' || !item.item_id.trim() || typeof item.goal !== 'string' || !item.goal.trim() || typeof item.status !== 'string' || !item.status.trim()) return null
    return { id: item.item_id, title: item.goal, status: item.status, ...(typeof item.blocking_summary === 'string' && item.blocking_summary.trim() ? { blockingReason: item.blocking_summary } : {}) }
  })
  if (items.some((item) => item === null) || new Set((items as CardWorkItem[]).map((item) => item.id)).size !== items.length) return projectCardWorkItems(null)
  const valid = items as CardWorkItem[]
  return {
    executionItemsProjectionValid: true,
    executionItems: valid,
  }
}

function projectCriterionStatements(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  return value
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const statement = (candidate as Record<string, unknown>).statement
      return typeof statement === 'string' && statement.trim() ? statement : null
    })
    .filter((statement): statement is string => statement !== null)
}

function projectContributedToTargets(value: unknown, uidTargets?: FactUidTargetIndex): Array<Record<string, string>> {
  if (!Array.isArray(value)) return []
  return value.flatMap<Record<string, string>>((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const relation = candidate as Record<string, unknown>
    if (relation.relation_key !== 'contributed-to') return []
    const target = relation.target
    if (!target || typeof target !== 'object' || Array.isArray(target)) return []
    const triple = target as Record<string, unknown>
    if (Object.keys(triple).length === 1 && typeof triple.object_uid === 'string' && UUID_V7_PATTERN.test(triple.object_uid)) {
      const resolvedTarget = uidTargets?.get(triple.object_uid)
      return [{ objectUid: triple.object_uid, ...(resolvedTarget ? {
        governedProjectId: resolvedTarget.governedProjectId,
        factTypeKey: resolvedTarget.factTypeKey,
        objectId: resolvedTarget.objectId,
      } : {}) }]
    }
    if (typeof triple.governed_project_id !== 'string' || !triple.governed_project_id.trim()
      || triple.fact_type_key !== 'pitfall'
      || typeof triple.object_id !== 'string' || !triple.object_id.trim()) return []
    return [{ governedProjectId: triple.governed_project_id, factTypeKey: triple.fact_type_key, objectId: triple.object_id }]
  })
}

const CLOSURE_PROPOSAL_OUTCOMES = new Set(['completed', 'partial', 'not-achieved', 'cancelled'])
const RESIDUAL_DISPOSITIONS = new Set(['route_existing', 'suggest_spark', 'accept_stop'])

function projectRelationTarget(value: unknown, uidTargets?: FactUidTargetIndex): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  if (Object.keys(target).length === 1 && typeof target.object_uid === 'string' && UUID_V7_PATTERN.test(target.object_uid)) {
    const resolvedTarget = uidTargets?.get(target.object_uid)
    return { objectUid: target.object_uid, ...(resolvedTarget ? {
      governedProjectId: resolvedTarget.governedProjectId,
      factTypeKey: resolvedTarget.factTypeKey,
      objectId: resolvedTarget.objectId,
    } : {}) }
  }
  if (typeof target.governed_project_id !== 'string' || !target.governed_project_id.trim()
    || typeof target.fact_type_key !== 'string' || !target.fact_type_key.trim()
    || typeof target.object_id !== 'string' || !target.object_id.trim()) return null
  return { governedProjectId: target.governed_project_id, factTypeKey: target.fact_type_key, objectId: target.object_id }
}

function projectProposalRouteTarget(value: unknown, uidTargets?: FactUidTargetIndex): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  const allowed = new Set(['object_uid', 'governed_project_id', 'fact_type_key', 'object_id', 'content_fingerprint'])
  if (Object.keys(target).some((key) => !allowed.has(key))
    || typeof target.content_fingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(target.content_fingerprint)) return null
  const projected = projectRelationTarget(Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'content_fingerprint')), uidTargets)
  if (projected === null) return null
  if ('objectUid' in projected) return projected
  // 与后端 object_id_pattern 保持一致：接受 legacy 纯数字 ID 与 UID-native Base32 locator。
  const typePrefix = projected.factTypeKey
  if ((typePrefix === 'workcase' || typePrefix === 'spark')
    && !new RegExp(`^${typePrefix}-(?:\\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$`).test(projected.objectId)) return null
  return projected
}

function projectSparkSuggestions(value: unknown): Array<Record<string, string>> | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length === 0) return null
  const projected: Array<Record<string, string>> = []
  const identifiers = new Set<string>()
  const allowed = new Set([
    'suggestion_id', 'suggestion_kind', 'summary', 'follow_up_summary',
    'restriction_reason', 'impact_summary', 'resume_condition',
  ])
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const suggestion = candidate as Record<string, unknown>
    if (Object.keys(suggestion).some((key) => !allowed.has(key))) return null
    if (typeof suggestion.suggestion_id !== 'string' || !/^suggestion-[a-z0-9][a-z0-9-]*$/.test(suggestion.suggestion_id)
      || identifiers.has(suggestion.suggestion_id)
      || !['constrained_responsibility', 'follow_up_opportunity'].includes(String(suggestion.suggestion_kind))
      || typeof suggestion.summary !== 'string' || !suggestion.summary.trim()
      || typeof suggestion.follow_up_summary !== 'string' || !suggestion.follow_up_summary.trim()) return null
    const constrainedFields = ['restriction_reason', 'impact_summary', 'resume_condition']
    if (suggestion.suggestion_kind === 'constrained_responsibility'
      && constrainedFields.some((key) => typeof suggestion[key] !== 'string' || !(suggestion[key] as string).trim())) return null
    if (suggestion.suggestion_kind === 'follow_up_opportunity'
      && constrainedFields.some((key) => key in suggestion)) return null
    identifiers.add(suggestion.suggestion_id)
    projected.push({
      suggestionId: suggestion.suggestion_id,
      suggestionKind: String(suggestion.suggestion_kind),
      summary: suggestion.summary,
      followUpSummary: suggestion.follow_up_summary,
      ...(typeof suggestion.restriction_reason === 'string' ? { restrictionReason: suggestion.restriction_reason } : {}),
      ...(typeof suggestion.impact_summary === 'string' ? { impactSummary: suggestion.impact_summary } : {}),
      ...(typeof suggestion.resume_condition === 'string' ? { resumeCondition: suggestion.resume_condition } : {}),
    })
  }
  return projected
}

function projectResidualDecisions(
  value: unknown,
  outcome: string,
  suggestions: Array<Record<string, string>>,
  uidTargets?: FactUidTargetIndex,
): Array<Record<string, unknown>> | null {
  if (value === undefined) return outcome === 'completed' ? [] : null
  if (!Array.isArray(value) || value.length === 0 || outcome === 'completed') return null
  const projected: Array<Record<string, unknown>> = []
  const identifiers = new Set<string>()
  const suggestionKinds = new Map(suggestions.map((item) => [item.suggestionId, item.suggestionKind]))
  const allowed = new Set(['residual_id', 'summary', 'proposed_disposition', 'route_target', 'spark_suggestion_id'])
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const decision = candidate as Record<string, unknown>
    if (Object.keys(decision).some((key) => !allowed.has(key))) return null
    if (typeof decision.residual_id !== 'string' || !/^residual-[a-z0-9][a-z0-9-]*$/.test(decision.residual_id)
      || identifiers.has(decision.residual_id)) return null
    if (typeof decision.summary !== 'string' || !decision.summary.trim()) return null
    if (typeof decision.proposed_disposition !== 'string' || !RESIDUAL_DISPOSITIONS.has(decision.proposed_disposition)) return null
    const routeTarget = decision.proposed_disposition === 'route_existing' ? projectProposalRouteTarget(decision.route_target, uidTargets) : null
    if (decision.proposed_disposition === 'route_existing'
      && (routeTarget === null || ('factTypeKey' in routeTarget && !['workcase', 'spark'].includes(routeTarget.factTypeKey)))) return null
    if (decision.proposed_disposition !== 'route_existing' && decision.route_target !== undefined) return null
    if (decision.proposed_disposition === 'suggest_spark') {
      if (typeof decision.spark_suggestion_id !== 'string'
        || suggestionKinds.get(decision.spark_suggestion_id) !== 'constrained_responsibility') return null
    } else if (decision.spark_suggestion_id !== undefined) return null
    identifiers.add(decision.residual_id)
    projected.push({
      residualId: decision.residual_id,
      summary: decision.summary,
      proposedDisposition: decision.proposed_disposition,
      ...(routeTarget ? { routeTarget } : {}),
    })
  }
  return projected
}

/**
 * Projects the stable closure-decision subset consumed by the Card. The whole
 * projection is dropped unless every required proposal member is readable and
 * complete. No malformed decision or suggestion is silently omitted.
 */
function projectClosureProposal(value: unknown, uidTargets?: FactUidTargetIndex): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const proposal = value as Record<string, unknown>
  const allowed = new Set(['proposed_outcome', 'proposed_disposition_summary', 'residual_decisions', 'spark_suggestions'])
  if (Object.keys(proposal).some((key) => !allowed.has(key))) return null
  if (typeof proposal.proposed_outcome !== 'string' || !CLOSURE_PROPOSAL_OUTCOMES.has(proposal.proposed_outcome)) return null
  if (typeof proposal.proposed_disposition_summary !== 'string' || !proposal.proposed_disposition_summary.trim()) return null
  const suggestions = projectSparkSuggestions(proposal.spark_suggestions)
  if (suggestions === null) return null
  if (proposal.proposed_outcome === 'completed'
    && suggestions.some((item) => item.suggestionKind === 'constrained_responsibility')) return null
  const decisions = projectResidualDecisions(proposal.residual_decisions, proposal.proposed_outcome, suggestions, uidTargets)
  if (decisions === null) return null
  return {
    proposedOutcome: proposal.proposed_outcome,
    dispositionSummary: proposal.proposed_disposition_summary,
    residualDecisions: decisions,
    sparkSuggestions: suggestions,
  }
}

function projectClosedDisposition(fact: Record<string, unknown>, uidTargets?: FactUidTargetIndex): Record<string, unknown> | null {
  if (typeof fact.closure_outcome !== 'string' || !CLOSURE_PROPOSAL_OUTCOMES.has(fact.closure_outcome)) return null
  if (typeof fact.disposition_summary !== 'string' || !fact.disposition_summary.trim()) return null
  const suggestions = projectSparkSuggestions(fact.spark_suggestions)
  if (suggestions === null) return null
  const routedTo: Array<Record<string, string>> = []
  if (Array.isArray(fact.relations)) {
    for (const candidate of fact.relations) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const relation = candidate as Record<string, unknown>
      if (relation.relation_key !== 'routed-to') continue
      const target = projectRelationTarget(relation.target, uidTargets)
      if (target === null || ('factTypeKey' in target && !['workcase', 'spark'].includes(target.factTypeKey))) return null
      routedTo.push(target)
    }
  } else if (fact.relations !== undefined) return null
  const acceptedStop: Array<Record<string, string>> = []
  const residualIdentifiers = new Set<string>()
  if (fact.residual_responsibilities !== undefined) {
    if (!Array.isArray(fact.residual_responsibilities) || fact.residual_responsibilities.length === 0) return null
    for (const candidate of fact.residual_responsibilities) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const residual = candidate as Record<string, unknown>
      if (typeof residual.residual_id !== 'string' || !residual.residual_id.trim()
        || residualIdentifiers.has(residual.residual_id)
        || typeof residual.summary !== 'string' || !residual.summary.trim()) return null
      residualIdentifiers.add(residual.residual_id)
      acceptedStop.push({ residualId: residual.residual_id, summary: residual.summary })
    }
  }
  if (fact.closure_outcome === 'completed'
    && (routedTo.length > 0 || acceptedStop.length > 0
      || suggestions.some((item) => item.suggestionKind === 'constrained_responsibility'))) return null
  if (fact.closure_outcome !== 'completed'
    && routedTo.length === 0 && acceptedStop.length === 0
    && !suggestions.some((item) => item.suggestionKind === 'constrained_responsibility')) return null
  return {
    outcome: fact.closure_outcome,
    dispositionSummary: fact.disposition_summary,
    routedTo,
    acceptedStop,
    sparkSuggestions: suggestions,
  }
}

function projectCurrentWorkCaseCardShape(
  fact: Record<string, unknown>,
  currentSnapshotProjection: WorkCaseCurrentSnapshotProjection,
  uidTargets?: FactUidTargetIndex,
): Record<string, unknown> {
  const projected = copyPresentFields(fact, ['object_id', 'fact_type_key', 'title', 'status', 'phase', 'updated_at', 'change_log'])
  projected.current_snapshot_projection = currentSnapshotProjection
  if (hasUnavailableIndependentSubagentReview(fact)) projected.independentSubagentUnavailable = true
  const progress = currentSnapshotProjection.resolution === 'resolved'
    ? currentSnapshotProjection
    : null
  if (progress?.progress_group === 'plan_confirmation') {
    // Gate 1 必须让 Human 看到被批准的完整执行基线。这里保留结构原值，
    // 让前端可以区分“缺失/类型错误”与“合法空值”，而不是静默过滤 malformed 成员。
    Object.assign(projected, copyPresentFields(fact, [
      'priority',
      'goal',
      'scope',
      'success_criterion_definitions',
      'work_items',
      'creation_reviews',
      'execution_authorization',
      'execution_approval',
    ]), {
      successCriteria: projectCriterionStatements(fact.success_criterion_definitions),
    })
  } else if (progress?.progress_group === 'progressing') {
    Object.assign(projected, copyPresentFields(fact, ['priority', 'goal', 'waiting_on']))
    Object.assign(projected, projectCardWorkItems(fact.work_items))
  } else if (progress?.progress_group === 'termination_cleanup') {
    Object.assign(projected, copyPresentFields(fact, ['priority', 'goal', 'waiting_on', 'termination']))
  } else if (progress?.progress_group === 'closure_confirmation') {
    Object.assign(projected, copyPresentFields(fact, ['goal']))
    const closureProposal = projectClosureProposal(fact.closure_proposal, uidTargets)
    if (closureProposal) projected.closureProposal = closureProposal
    const contributedTo = projectContributedToTargets(fact.relations, uidTargets)
    if (contributedTo.length > 0) projected.contributedTo = contributedTo
  } else if (progress?.progress_group === 'closed') {
    Object.assign(projected, copyPresentFields(fact, ['goal', 'termination', 'closure_outcome']))
    const closureTerminal = projectClosedDisposition(fact, uidTargets)
    if (closureTerminal) projected.closureTerminal = closureTerminal
    const contributedTo = projectContributedToTargets(fact.relations, uidTargets)
    if (contributedTo.length > 0) projected.contributedTo = contributedTo
  }
  if (progress?.blocking_overlay) {
    Object.assign(projected, copyPresentFields(fact, ['blocking_summary']))
  }
  if (progress) {
    projected.progress_group = progress.progress_group
    if (progress.progress_step) projected.progress_step = progress.progress_step
  }
  return projected
}

export function projectCurrentWorkCaseCard(
  fact: Record<string, unknown>,
  sourceContentFingerprint: string | null,
  uidTargets?: FactUidTargetIndex,
): Record<string, unknown> {
  const currentSnapshotProjection = deriveWorkCasePresentationProjection(
    fact.status,
    fact.phase,
    sourceContentFingerprint,
  )
  return projectCurrentWorkCaseCardShape(fact, currentSnapshotProjection, uidTargets)
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

const OBJECT_ID_PATTERN = /^(workcase|adr|pitfall|spark|study)-(?:\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

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
      field_issues: item.field_issues,
      unparsed_structures: item.unparsed_structures,
      read_issues: item.issues,
    }
    const uidTargets = await currentProjectUidTargets(resolvedScope)
    const associations = await projectFactCardAssociations(item, resolvedScope, uidTargets)
    if (associations.length > 0) data.factAssociations = associations
    if (type === 'workcase') {
      const projection = deriveWorkCasePresentationProjection(
        item.fact_object.status,
        item.fact_object.phase,
        item.source_content_fingerprint,
      )
      data.current_snapshot_projection = projection
      const currentCard = projectCurrentWorkCaseCard(item.fact_object, item.source_content_fingerprint, uidTargets)
      Object.assign(data, currentCard)
      if (projection.resolution === 'resolved') {
        data.progress_group = projection.progress_group
        if (projection.progress_step) data.progress_step = projection.progress_step
      }
    }
    const response = { ...result('show', id, data), summary: { id, type, ...(typeof data.status === 'string' ? { status: data.status } : {}) } }
    response.issues = [...item.issues, ...item.field_issues]
    return response
  } catch (caught) {
    return error(caught)
  }
}
