import {
  WORKCASE_CLOSED_PRESENTATION,
  WORKCASE_CURRENT_PHASES,
  WORKCASE_PHASE_HANDOFF,
  WORKCASE_PHASE_PRESENTATION,
  WORKCASE_PRESENTATION_CONTRACT_IDENTITY,
  WORKCASE_PRESENTATION_HANDOFF_REASONS,
  WORKCASE_PRESENTATION_UNRESOLVED_REASONS,
} from './workcasePresentationContract.generated.js'

export {
  WORKCASE_CURRENT_PHASES,
  WORKCASE_PHASE_HANDOFF,
  WORKCASE_PRESENTATION_CONTRACT_IDENTITY,
  WORKCASE_PRESENTATION_HANDOFF_REASONS,
}

export const WORKCASE_DEFAULT_LIST_STATUS = null

export const WORKCASE_PROGRESS_GROUP_ORDER = [
  'plan_confirmation',
  'progressing',
  'termination_cleanup',
  'closure_confirmation',
  'closed',
] as const

export type WorkCaseProgressGroup = typeof WORKCASE_PROGRESS_GROUP_ORDER[number]

export const WORKCASE_PROGRESS_STEP_ORDER = [
  'item_execution',
  'controller_self_check',
  'independent_review',
  'controller_synthesis',
] as const

export type WorkCaseProgressStep = typeof WORKCASE_PROGRESS_STEP_ORDER[number]
export type WorkCaseLifecyclePosition = typeof WORKCASE_CURRENT_PHASES[number] | 'closed'
export type WorkCaseUnresolvedReason = typeof WORKCASE_PRESENTATION_UNRESOLVED_REASONS[number]
export type WorkCaseHandoffReason = typeof WORKCASE_PRESENTATION_HANDOFF_REASONS[number]
export type WorkCaseNextRequiredControlStep =
  | typeof WORKCASE_PHASE_PRESENTATION[keyof typeof WORKCASE_PHASE_PRESENTATION]['next_required_control_step']
  | typeof WORKCASE_CLOSED_PRESENTATION['next_required_control_step']
export type WorkCaseHandoffNarrativeKey =
  | typeof WORKCASE_PHASE_PRESENTATION[keyof typeof WORKCASE_PHASE_PRESENTATION]['handoff_narrative_key']
  | 'blocked_at_current_position'
  | 'gate2_position_blocked'
  | 'closed'

export interface ResolvedWorkCasePresentationProjection {
  contract_identity: typeof WORKCASE_PRESENTATION_CONTRACT_IDENTITY
  resolution: 'resolved'
  source_content_fingerprint: string
  lifecycle_position: WorkCaseLifecyclePosition
  handoff_narrative_key: WorkCaseHandoffNarrativeKey
  next_required_control_step: WorkCaseNextRequiredControlStep
  progress_group: WorkCaseProgressGroup
  progress_step: WorkCaseProgressStep | null
  blocking_overlay: boolean
  handoff_allowed: boolean
  handoff_reason: WorkCaseHandoffReason
}

export interface UnresolvedWorkCasePresentationProjection {
  contract_identity: typeof WORKCASE_PRESENTATION_CONTRACT_IDENTITY
  resolution: 'unresolved'
  source_content_fingerprint: string | null
  unresolved_reason: WorkCaseUnresolvedReason
  handoff_allowed: boolean
  handoff_reason: WorkCaseHandoffReason
}

export type WorkCaseCurrentSnapshotProjection =
  | ResolvedWorkCasePresentationProjection
  | UnresolvedWorkCasePresentationProjection

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const LIFECYCLE_POSITION_SET = new Set<string>([...WORKCASE_CURRENT_PHASES, 'closed'])
const NEXT_REQUIRED_CONTROL_STEP_SET = new Set<string>([
  ...Object.values(WORKCASE_PHASE_PRESENTATION).map((value) => value.next_required_control_step),
  WORKCASE_CLOSED_PRESENTATION.next_required_control_step,
])
const HANDOFF_NARRATIVE_KEY_SET = new Set<string>([
  ...Object.values(WORKCASE_PHASE_PRESENTATION).map((value) => value.handoff_narrative_key),
  WORKCASE_CLOSED_PRESENTATION.handoff_narrative_key,
  'blocked_at_current_position',
  'gate2_position_blocked',
])
const PHASE_TABLE = WORKCASE_PHASE_PRESENTATION as Record<string, {
  lifecycle_position: WorkCaseLifecyclePosition
  handoff_narrative_key: WorkCaseHandoffNarrativeKey
  next_required_control_step: WorkCaseNextRequiredControlStep
  progress_group: WorkCaseProgressGroup
  progress_step: WorkCaseProgressStep | null
}>

function unresolved(
  reason: WorkCaseUnresolvedReason,
  sourceContentFingerprint: string | null,
): UnresolvedWorkCasePresentationProjection {
  return {
    contract_identity: WORKCASE_PRESENTATION_CONTRACT_IDENTITY,
    resolution: 'unresolved',
    source_content_fingerprint: sourceContentFingerprint,
    unresolved_reason: reason,
    handoff_allowed: true,
    handoff_reason: 'unresolved',
  }
}

export function deriveWorkCaseHandoffVerdict(
  status: unknown,
  phase: unknown,
): { handoff_allowed: boolean; handoff_reason: WorkCaseHandoffReason } {
  if (typeof status !== 'string' || !['open', 'blocked', 'closed'].includes(status)) {
    return { handoff_allowed: true, handoff_reason: 'unresolved' }
  }
  if (status === 'closed') return { handoff_allowed: true, handoff_reason: 'closed' }
  if (status === 'blocked') {
    return phase === 'human_closure_confirming'
      ? { handoff_allowed: true, handoff_reason: 'gate2_position_blocked' }
      : { handoff_allowed: true, handoff_reason: 'blocked_at_current_position' }
  }
  if (typeof phase === 'string' && phase in WORKCASE_PHASE_HANDOFF) {
    const entry = WORKCASE_PHASE_HANDOFF[phase as keyof typeof WORKCASE_PHASE_HANDOFF]
    return { handoff_allowed: entry.handoff_allowed, handoff_reason: entry.handoff_reason }
  }
  return { handoff_allowed: true, handoff_reason: 'unresolved' }
}

export function deriveWorkCasePresentationProjection(
  status: unknown,
  phase: unknown,
  sourceContentFingerprint: unknown,
): WorkCaseCurrentSnapshotProjection {
  const fingerprint = typeof sourceContentFingerprint === 'string' && FINGERPRINT_PATTERN.test(sourceContentFingerprint)
    ? sourceContentFingerprint
    : null
  if (fingerprint === null) return unresolved('missing_source_content_fingerprint', null)
  if (status === null || status === undefined || status === '') return unresolved('missing_status', fingerprint)
  if (typeof status !== 'string' || !['open', 'blocked', 'closed'].includes(status)) {
    return unresolved('unsupported_status', fingerprint)
  }
  if (status === 'closed') {
    if (phase !== null && phase !== undefined && phase !== '') return unresolved('closed_with_phase', fingerprint)
    return {
      ...WORKCASE_CLOSED_PRESENTATION,
      contract_identity: WORKCASE_PRESENTATION_CONTRACT_IDENTITY,
      resolution: 'resolved',
      source_content_fingerprint: fingerprint,
      blocking_overlay: false,
      ...deriveWorkCaseHandoffVerdict(status, phase),
    }
  }
  if (phase === null || phase === undefined || phase === '') return unresolved('missing_phase', fingerprint)
  if (typeof phase !== 'string') return unresolved('invalid_status_phase_combination', fingerprint)
  const phaseProjection = PHASE_TABLE[phase]
  if (!phaseProjection) return unresolved('unexpected_phase', fingerprint)
  const blocked = status === 'blocked'
  return {
    ...phaseProjection,
    handoff_narrative_key: blocked
      ? phase === 'human_closure_confirming' ? 'gate2_position_blocked' : 'blocked_at_current_position'
      : phaseProjection.handoff_narrative_key,
    contract_identity: WORKCASE_PRESENTATION_CONTRACT_IDENTITY,
    resolution: 'resolved',
    source_content_fingerprint: fingerprint,
    blocking_overlay: blocked,
    ...deriveWorkCaseHandoffVerdict(status, phase),
  }
}

export function isResolvedWorkCasePresentationProjection(
  value: unknown,
): value is ResolvedWorkCasePresentationProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const projection = value as Record<string, unknown>
  return projection.contract_identity === WORKCASE_PRESENTATION_CONTRACT_IDENTITY
    && projection.resolution === 'resolved'
    && typeof projection.source_content_fingerprint === 'string'
    && FINGERPRINT_PATTERN.test(projection.source_content_fingerprint)
    && typeof projection.lifecycle_position === 'string'
    && LIFECYCLE_POSITION_SET.has(projection.lifecycle_position)
    && typeof projection.handoff_narrative_key === 'string'
    && HANDOFF_NARRATIVE_KEY_SET.has(projection.handoff_narrative_key)
    && typeof projection.next_required_control_step === 'string'
    && NEXT_REQUIRED_CONTROL_STEP_SET.has(projection.next_required_control_step)
    && typeof projection.progress_group === 'string'
    && WORKCASE_PROGRESS_GROUP_ORDER.includes(projection.progress_group as WorkCaseProgressGroup)
    && (projection.progress_step === null
      || (typeof projection.progress_step === 'string'
        && WORKCASE_PROGRESS_STEP_ORDER.includes(projection.progress_step as WorkCaseProgressStep)))
    && typeof projection.blocking_overlay === 'boolean'
    && typeof projection.handoff_allowed === 'boolean'
    && typeof projection.handoff_reason === 'string'
    && WORKCASE_PRESENTATION_HANDOFF_REASONS.includes(projection.handoff_reason as WorkCaseHandoffReason)
}

export function isWorkCaseProgressGroup(value: string | null | undefined): value is WorkCaseProgressGroup {
  return WORKCASE_PROGRESS_GROUP_ORDER.includes(value as WorkCaseProgressGroup)
}
