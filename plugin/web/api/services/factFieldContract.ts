/**
 * Runtime projection of the Web-consumed fields.
 *
 * This is deliberately a transport projection, not a fact schema: every
 * entry retains its 05.Att.01 field_key and is mechanically reconciled with
 * 05.Att.01, the type bindings, and 08.Att.01 by fact-field-contract.test.ts.
 */
export const FACT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'study'] as const

export type FactType = (typeof FACT_TYPES)[number]
export type FieldExpectation = 'string' | 'number' | 'array' | 'object'

export type FactFieldContract = Readonly<Record<string, Readonly<{
  fieldKey: string
  expected: FieldExpectation
  required: boolean
}>>>

const field = (fieldKey: string, expected: FieldExpectation, required: boolean) => ({ fieldKey, expected, required })

const common = {
  object_uid: field('object-uid', 'string', false),
  object_id: field('object-id', 'string', true),
  fact_type_key: field('fact-type-key', 'string', true),
  title: field('title', 'string', true),
  status: field('status', 'string', true),
  created_at: field('created-at', 'string', true),
  updated_at: field('updated-at', 'string', true),
  change_log: field('change-log', 'array', false),
  urls: field('urls', 'array', false),
  relations: field('relations', 'array', false),
} as const


export const FACT_FIELD_CONTRACT: Record<FactType, FactFieldContract> = {
  workcase: {
    ...common,
    summary: field('current-summary', 'string', false),
    resume_from: field('workcase-resume-from', 'string', false),
    waiting_on: field('workcase-waiting-on', 'string', false),
    priority: field('priority', 'string', false),
    disposition_summary: field('disposition-summary', 'string', false),
    goal: field('workcase-goal', 'string', true),
    scope: field('workcase-scope', 'string', true),
    success_criterion_definitions: field('workcase-success-criterion-definitions', 'array', true),
    success_criterion_results: field('workcase-success-criterion-results', 'array', false),
    residual_responsibilities: field('workcase-residual-responsibilities', 'array', false),
    phase: field('workcase-phase', 'string', false),
    plan_version: field('workcase-plan-version', 'number', false),
    work_items: field('workcase-items', 'array', false),
    creation_reviews: field('workcase-creation-reviews', 'array', false),
    execution_authorization: field('workcase-execution-authorization', 'object', false),
    execution_approval: field('workcase-execution-approval', 'object', false),
    result_version: field('workcase-result-version', 'number', false),
    result_summary: field('workcase-overall-result-summary', 'string', false),
    controller_check_summary: field('workcase-controller-check-summary', 'string', false),
    result_reviews: field('workcase-result-reviews', 'array', false),
    validation_summary: field('workcase-validation-summary', 'string', false),
    blocking_summary: field('workcase-blocking-summary', 'string', false),
    closure_proposal: field('workcase-closure-proposal', 'object', false),
    spark_suggestions: field('workcase-spark-suggestions', 'array', false),
    closure_outcome: field('workcase-closure-outcome', 'string', false),
    termination: field('workcase-termination', 'object', false),
  },
  adr: {
    ...common,
    disposition_summary: field('disposition-summary', 'string', false),
    decision_question: field('adr-decision-question', 'string', true),
    decision: field('adr-decision', 'string', true),
    applicability: field('adr-applicability', 'string', true),
    trigger_signal: field('adr-trigger-signal', 'string', true),
    rationale: field('adr-rationale', 'string', true),
    consequences: field('adr-consequences', 'string', true),
  },
  pitfall: {
    ...common,
    disposition_summary: field('disposition-summary', 'string', false),
    scope_of_impact: field('pitfall-scope-of-impact', 'string', true),
    applicability: field('adr-applicability', 'string', true),
    validation_summary: field('workcase-validation-summary', 'string', true),
    symptoms: field('pitfall-symptoms', 'string', true),
    trigger_conditions: field('pitfall-trigger-conditions', 'string', true),
    root_cause: field('pitfall-root-cause', 'string', true),
    resolution: field('pitfall-resolution', 'string', true),
    avoidance: field('pitfall-avoidance', 'string', true),
  },
  spark: {
    ...common,
    intent: field('spark-intent', 'string', false),
    summary: field('current-summary', 'string', true),
    priority: field('priority', 'string', false),
    evolution: field('evolution', 'array', false),
    disposition_summary: field('disposition-summary', 'string', false),
  },
  study: {
    ...common,
    report_kind: field('study-report-kind', 'string', false),
    urls: field('urls', 'array', false),
    input_refs: field('study-input-refs', 'array', false),
    disposition_summary: field('disposition-summary', 'string', false),
    research_question: field('study-research-question', 'string', true),
    abstract: field('study-abstract', 'string', true),
    research_intent: field('study-research-intent', 'string', false),
    recommendation_summary: field('study-recommendation-summary', 'string', false),
    report_body: field('study-report-body', 'string', false),
  },
}

/** List candidates never carry a Study Markdown body. */
export const FACT_LIST_FIELD_NAMES: Record<Exclude<FactType, 'workcase'>, readonly string[]> = {
  adr: Object.keys(FACT_FIELD_CONTRACT.adr),
  pitfall: Object.keys(FACT_FIELD_CONTRACT.pitfall),
  spark: Object.keys(FACT_FIELD_CONTRACT.spark),
  study: Object.keys(FACT_FIELD_CONTRACT.study).filter((name) => !['report_body', 'input_refs'].includes(name)),
}

/**
 * Terminal status sets per fact type. Unique definition sources are the
 * status closures in each type spec's "§6 对象语义与生命周期"
 * (specs/20–24); changing any set requires updating the type spec first.
 */
export const FACT_TERMINAL_STATUSES: Record<FactType, readonly string[]> = {
  workcase: ['closed'],
  adr: ['retired'],
  pitfall: ['discarded'],
  spark: ['implemented', 'discarded'],
  study: ['retired'],
}
