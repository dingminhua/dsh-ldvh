/**
 * Runtime projection of the Web-consumed fields.
 *
 * This is deliberately a transport projection, not a fact schema: every
 * entry retains its 05.Att.01 field_key and is mechanically reconciled with
 * 05.Att.01, the type bindings, and 08.Att.01 by fact-field-contract.test.ts.
 */
export const FACT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm'] as const

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
  // 03 §6.1 明文不保留公共 updated_at：变更时间由 change_log[].at 承担。
  // 该字段已从公共契约移除——排序与回退一律取 change_log 末条流水的 at。
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
  // v5 ADR（22 §8 薄索引）：decision/scope 必填（正文对应段逐字包含）、
  // trigger_signal 条件出现（遵守预检消费）、终态字段随 status 约束
  // （retirement_reason/retired_at 仅 retired，§9）；正文「决策背景/决定/
  // 备选与理由/后果/适用范围/证据」由 report_body 承载。v4 的
  // decision_question/applicability/rationale/consequences/disposition_summary
  // 已随 22 号移除（分析性长文本住正文，不留 frontmatter 字段）。
  adr: {
    ...common,
    decision: field('adr-decision', 'string', true),
    scope: field('adr-scope', 'string', true),
    trigger_signal: field('adr-trigger-signal', 'string', false),
    retirement_reason: field('adr-retirement-reason', 'string', false),
    retired_at: field('adr-retired-at', 'string', false),
    // 正文承载（22 §8 固定 H2），由阅读布局按 H2 分节解析呈现；不登记会被
    // 判为 unconsumed_field，且必须从列表投影排除。
    report_body: field('adr-report-body', 'string', false),
  },
  // v5 Pitfall（23 §8 薄索引）：scope 必填（正文「影响与适用范围」段逐字
  // 包含）、trigger_signal 条件出现（依赖版本/环境变化时重审）、终态
  // disposition 仅 discarded（§9）；正文「症状/触发条件/根因/解决/规避/
  // 验证/影响与适用范围/证据」由 report_body 承载。v4 的 symptoms/
  // trigger_conditions/root_cause/resolution/avoidance/scope_of_impact/
  // applicability/validation_summary/disposition_summary 已随 23 号移除
  // （分析性长文本住正文，不留 frontmatter 字段）。
  pitfall: {
    ...common,
    scope: field('pitfall-scope', 'string', true),
    trigger_signal: field('pitfall-trigger-signal', 'string', false),
    disposition: field('pitfall-disposition', 'string', false),
    // 正文承载（23 §8 固定 H2），由阅读布局按 H2 分节解析呈现；不登记会被
    // 判为 unconsumed_field，且必须从列表投影排除。
    report_body: field('pitfall-report-body', 'string', false),
  },
  // v5 Friction（26 号规范）：改进账本的字段闭集——phenomenon/impact 必填
  //（现象单句 + 影响闭集 light/medium/heavy）；attribution 条件后补、
  // serves_sg 条件（框架摩擦挂 SG-3）、relations 仅 resolved 时的 informs。
  // 本类型不设 urls（26 §10：摩擦是内部体验）与 trigger_signal（重审信号由
  // 处置段的重启条件承载）——故不展开 common 的 urls。正文三节（现象/入账
  // 依据/条件处置）由 report_body 承载。
  friction: {
    ...common,
    phenomenon: field('friction-phenomenon', 'string', true),
    attribution: field('friction-attribution', 'string', false),
    impact: field('friction-impact', 'string', true),
    report_body: field('friction-report-body', 'string', false),
  },
  // v5 Spark（20 号规范）：悬置问题的字段闭集——question/scope_boundary/
  // intent/summary 必填；evolution（{at, summary} 流水）/serves_sg（SG-n 轻
  // 量锚点）/disposition（终态去向）条件出现；relations 仅 merged-into/
  // split-into（§11）。本类型不设 urls（§10：悬置问题不直接接受外部证据，
  // 由 30 号调研系统收集）与 priority（§14.2：v4 存量不迁入）——故不展开
  // common 的 urls，也不用 v4 的 disposition_summary（终态去向由 disposition
  // 承载）。正文四节（当前理解/调查问题/调查边界/演变）由 report_body 承载。
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
    serves_sg: field('spark-serves-sg', 'string', false),
    disposition: field('spark-disposition', 'string', false),
    // 正文承载（20 §8 固定 H2），由阅读布局按 H2 分节解析呈现；不登记会被
    // 判为 unconsumed_field，且必须从列表投影排除。
    report_body: field('spark-report-body', 'string', false),
  },
  // v5 Research（24 号规范薄索引）：frontmatter 字段面以调研对象为准——
  // research_question/research_purpose 必填，stopping_reason（闭集 sufficient/
  // no-gain/round-cap）/confirmed_statements（声明索引）/uncertain/gaps/
  // implications/clarification_log 数组，retired 时 retirement_reason/retired_at；
  // 正文承载研究主体（Web 呈现层按 H2 分节解析）。
  research: {
    ...common,
    research_question: field('research-question', 'string', true),
    research_purpose: field('research-purpose', 'string', true),
    stopping_reason: field('research-stopping-reason', 'string', false),
    confirmed_statements: field('research-confirmed-statements', 'array', false),
    uncertain: field('research-uncertain', 'array', false),
    gaps: field('research-gaps', 'array', false),
    implications: field('research-implications', 'array', false),
    clarification_log: field('research-clarification-log', 'array', false),
    retirement_reason: field('retirement-reason', 'string', false),
    retired_at: field('retired-at', 'string', false),
    // 正文承载研究主体（24 §7 固定 H2/H3），由阅读布局按 H2 分节解析并呈现。
    // 属已消费字段：不登记会被判为 unconsumed_field，误报为未解析结构。
    report_body: field('research-report-body', 'string', false),
    disposition_summary: field('disposition-summary', 'string', false),
  },
  // v5 Norm（27 号规范）：事实规范的字段闭集——direction_key（专属方向键，
  // 唯一性公式 Count(direction_key=d ∧ status="active") ≤ 1）必填；title/
  // status/created_at/change_log 走 common；retirement_reason/retired_at
  // 条件出现（retired 必填、active 禁现，同 22 号形态）。本类型不设 urls
  // （规则住正文）与 relations（跨方向以正文引用实现，§9）。正文四段固定
  // H2 骨架（方向定位与适用范围／核心规则体系／约束与反模式／验证与遵从性
  // 检查）由 report_body 承载——读取层对 markdown 载体统一以 report_body
  // 投影正文（同 20/22/23/24/26 形态），不登记为独立字段。
  norm: {
    ...common,
    direction_key: field('norm-direction-key', 'string', true),
    retirement_reason: field('retirement-reason', 'string', false),
    retired_at: field('retired-at', 'string', false),
    report_body: field('norm-body', 'string', false),
  },
}

/**
 * List candidates never carry the Markdown body (Spark 20 §12 / Research 24 §12
 * F1：卡片只投影最小权威字段，不投影正文)。report_body 只属详情阅读面，
 * 登记进 FACT_FIELD_CONTRACT 是让它不被判为 unconsumed_field（详情消费），
 * 但必须从列表投影中排除，否则列表会带上整篇正文。
 */
export const FACT_LIST_FIELD_NAMES: Record<Exclude<FactType, 'workcase'>, readonly string[]> = {
  adr: Object.keys(FACT_FIELD_CONTRACT.adr).filter((field) => field !== 'report_body'),
  pitfall: Object.keys(FACT_FIELD_CONTRACT.pitfall).filter((field) => field !== 'report_body'),
  spark: Object.keys(FACT_FIELD_CONTRACT.spark).filter((field) => field !== 'report_body'),
  research: Object.keys(FACT_FIELD_CONTRACT.research).filter((field) => field !== 'report_body'),
  // friction（26 号）此前遗漏于本表，而 FACT_TERMINAL_STATUSES 已含 friction——
  // 列表投影缺 friction 会使其字段被判为未登记。此处补齐。
  friction: Object.keys(FACT_FIELD_CONTRACT.friction).filter((field) => field !== 'report_body'),
  // norm（27 号）：正文以 report_body 承载（读取层统一投影），列表投影不
  // 携带全文（同其余 markdown 类型纪律）。
  norm: Object.keys(FACT_FIELD_CONTRACT.norm).filter((field) => field !== 'report_body'),
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
  research: ['retired'],
  // 26 §9：resolved 终态；deferred 可逆（重新激活），不是终态。
  friction: ['resolved'],
  // 27 号 §9：active/retired 两态，retired 为终态（不重开）。
  norm: ['retired'],
}

/**
 * v5 事实类型 → 载体目录名（ldvh-base/ 下）。目录名 = 类型短名复数（03 §6.1 惯例）。
 * 25 Goal 为单例（ldvh-base/goal.md），不占目录，故不在本表。
 */
export const FACT_TYPE_DIR_NAMES: Record<FactType, string> = {
  workcase: 'workcases',
  adr: 'adrs',
  pitfall: 'pitfalls',
  spark: 'sparks',
  research: 'researches',
  friction: 'frictions',
  norm: 'norms',
}
