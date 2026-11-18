export const FACT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'] as const

export type FactType = (typeof FACT_TYPES)[number]
export type FieldExpectation = 'string' | 'number' | 'array' | 'object'

export type ObjectShape = Readonly<{
  requiredKeys?: readonly string[]
  nonEmptyKeys?: readonly string[]
}>

export type FactFieldContract = Readonly<Record<string, Readonly<{
  fieldKey: string
  expected: FieldExpectation
  required: boolean
  objectShape?: ObjectShape
}>>>

const field = (fieldKey: string, expected: FieldExpectation, required: boolean) =>
  ({ fieldKey, expected, required })

const objectField = (fieldKey: string, required: boolean, objectShape: ObjectShape) =>
  ({ fieldKey, expected: 'object' as const, required, objectShape })

const common = {
  object_uid: field('object-uid', 'string', false),
  object_id: field('object-id', 'string', true),
  fact_type_key: field('fact-type-key', 'string', true),
  title: field('title', 'string', true),
  status: field('status', 'string', true),
  created_at: field('created-at', 'string', true),
  change_log: field('change-log', 'array', false),
  urls: field('urls', 'array', false),
  relations: field('relations', 'array', false),
} as const


export const FACT_FIELD_CONTRACT: Record<FactType, FactFieldContract> = {
  pitfall: {
    ...common,
    scope: field('pitfall-scope', 'string', true),
    trigger_signal: field('pitfall-trigger-signal', 'string', false),
    disposition: field('pitfall-disposition', 'string', false),
    report_body: field('pitfall-report-body', 'string', false),
  },
  friction: {
    ...common,
    phenomenon: field('friction-phenomenon', 'string', true),
    attribution: field('friction-attribution', 'string', false),
    attribution_ref: objectField('friction-attribution-ref', false, {
      requiredKeys: ['object_uid'],
      nonEmptyKeys: ['object_uid'],
    }),
    occurrence: field('friction-occurrence', 'object', false),
    disposition: field('friction-disposition', 'string', false),
    report_body: field('friction-report-body', 'string', false),
  },
  spark: {
    object_uid: field('object-uid', 'string', false),
    object_id: field('object-id', 'string', true),
    fact_type_key: field('fact-type-key', 'string', true),
    title: field('title', 'string', true),
    status: field('status', 'string', true),
    created_at: field('created-at', 'string', true),
    change_log: field('change-log', 'array', false),
    relations: field('relations', 'array', false),
    question: field('spark-question', 'string', true),
    scope_boundary: field('spark-scope-boundary', 'string', true),
    intent: field('spark-intent', 'string', true),
    summary: field('current-summary', 'string', true),
    evolution: field('evolution', 'array', false),
    serves: field('spark-serves-sg', 'string', false),
    refs: field('spark-refs', 'array', false),
    priority: field('priority', 'string', false),
    disposition: field('spark-disposition', 'string', false),
    report_body: field('spark-report-body', 'string', false),
  },
  report: {
    ...common,
    report_form: field('report-form', 'string', true),
    serves: field('report-serves-sg', 'string', false),
    research_question: field('research-question', 'string', false),
    research_purpose: field('research-purpose', 'string', false),
    stopping_reason: field('report-stopping-reason', 'string', false),
    confirmed_statements: field('report-confirmed-statements', 'array', false),
    uncertain: field('report-uncertain', 'array', false),
    gaps: field('report-gaps', 'array', false),
    implications: field('report-implications', 'array', false),
    clarification_log: field('report-clarification-log', 'array', false),
    retirement_reason: field('retirement-reason', 'string', false),
    retired_at: field('retired-at', 'string', false),
    report_body: field('report-report-body', 'string', false),
    disposition_summary: field('disposition-summary', 'string', false),
  },
  norm: {
    ...common,
    direction_key: field('norm-direction-key', 'string', true),
    retirement_reason: field('retirement-reason', 'string', false),
    retired_at: field('retired-at', 'string', false),
    report_body: field('norm-body', 'string', false),
  },
  subgoal: {
    ...common,
    order: field('subgoal-order', 'number', false),
    parent_goal: field('subgoal-parent-goal', 'string', true),
    criterion: field('subgoal-criterion', 'string', true),
    criterion_kind: field('subgoal-criterion-kind', 'string', true),
    alignment: field('subgoal-alignment', 'string', true),
    disposition: field('subgoal-disposition', 'string', false),
    report_body: field('subgoal-body', 'string', false),
  },
}

export const FACT_LIST_FIELD_NAMES: Record<FactType, readonly string[]> = {
  pitfall: Object.keys(FACT_FIELD_CONTRACT.pitfall).filter((field) => field !== 'report_body' ),
  spark: Object.keys(FACT_FIELD_CONTRACT.spark).filter((field) => field !== 'report_body' ),
  report: Object.keys(FACT_FIELD_CONTRACT.report).filter((field) => field !== 'report_body' ),
  friction: Object.keys(FACT_FIELD_CONTRACT.friction).filter((field) => field !== 'report_body' ),
  norm: Object.keys(FACT_FIELD_CONTRACT.norm).filter((field) => field !== 'report_body' ),
  subgoal: Object.keys(FACT_FIELD_CONTRACT.subgoal).filter((field) => field !== 'report_body' ),
}

export const FACT_TERMINAL_STATUSES: Record<FactType, readonly string[]> = {
  pitfall: ['discarded'],
  spark: ['implemented', 'discarded'],
  report: ['retired'],
  friction: ['resolved', 'voided'],
  norm: ['retired'],
  subgoal: ['achieved', 'retired'],
}

export const FACT_TYPE_DIR_NAMES: Record<FactType, string> = {
  pitfall: 'pitfalls',
  spark: 'sparks',
  report: 'reports',
  friction: 'frictions',
  norm: 'norms',
  subgoal: 'subgoals',
}
