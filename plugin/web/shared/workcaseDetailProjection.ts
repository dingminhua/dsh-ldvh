/**
 * Current-only WorkCase detail projection.
 *
 * This projection never reads list DTOs and never branches on status or phase.
 * It only groups fields that are actually present so every WorkCase reuses the
 * same detail information structure.
 */

export const WORKCASE_DETAIL_SECTION_ORDER = [
  'responsibility',
  'current_snapshot',
  'termination_cleanup',
  'success_criteria',
  'plan_and_items',
  'creation_reviews',
  'execution_authorization',
  'execution_approval',
  'result_and_validation',
  'controller_check',
  'result_reviews',
  'closure_proposal',
  'terminal_disposition',
  'relations',
  'urls',
] as const;

export interface CurrentWorkCaseDetailProjection {
  responsibility: boolean;
  currentSnapshot: boolean;
  termination: Record<string, unknown> | null;
  criteria: Array<Record<string, unknown>>;
  criterionResults: Array<Record<string, unknown>>;
  planAndItems: boolean;
  workItems: Array<Record<string, unknown>>;
  creationReviews: Array<Record<string, unknown>>;
  executionAuthorization: Record<string, unknown> | null;
  executionApproval: Record<string, unknown> | null;
  resultAndValidation: boolean;
  controllerCheck: boolean;
  resultReviews: Array<Record<string, unknown>>;
  closureProposal: Record<string, unknown> | null;
  terminalDisposition: boolean;
  terminalResiduals: Array<Record<string, unknown>>;
  terminalSuggestions: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  urls: unknown[];
}

export function projectCurrentWorkCaseDetail(
  obj: Record<string, unknown>,
): CurrentWorkCaseDetailProjection {
  return {
    responsibility: hasAny(obj.goal, obj.scope),
    currentSnapshot: hasAny(
      obj.phase,
      obj.summary,
      obj.resume_from,
      obj.waiting_on,
      obj.blocking_summary,
    ),
    termination: record(obj.termination),
    criteria: records(obj.success_criterion_definitions),
    criterionResults: records(obj.success_criterion_results),
    planAndItems: hasAny(obj.plan_version, obj.work_items),
    workItems: records(obj.work_items),
    creationReviews: records(obj.creation_reviews),
    executionAuthorization: record(obj.execution_authorization),
    executionApproval: record(obj.execution_approval),
    resultAndValidation: hasAny(obj.result_version, obj.result_summary, obj.validation_summary),
    controllerCheck: hasContent(obj.controller_check_summary),
    resultReviews: records(obj.result_reviews),
    closureProposal: record(obj.closure_proposal),
    terminalDisposition: hasAny(
      obj.closure_outcome,
      obj.disposition_summary,
      obj.residual_responsibilities,
      obj.spark_suggestions,
    ),
    terminalResiduals: records(obj.residual_responsibilities),
    terminalSuggestions: records(obj.spark_suggestions),
    relations: records(obj.relations),
    urls: Array.isArray(obj.urls) ? obj.urls : [],
  };
}

function hasAny(...values: unknown[]) {
  return values.some(hasContent);
}

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => record(item) !== null);
}
