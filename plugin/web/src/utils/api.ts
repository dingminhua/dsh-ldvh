import type { FactCarrier, FactReadStatus } from '@/utils/factReadMeta';
import type {
  WorkCaseHandoffReason,
  WorkCaseLifecyclePosition,
  WorkCaseNextRequiredControlStep,
} from '@/shared/workcaseStatus';

// 基址跟随 vite base：dev（BASE_URL='/'）保持 '/api' 走 vite 代理；
// DSH 挂载构建（vite build --base=/ldvh/）下请求落在 '/ldvh/api'——由插件
// 的 /ldvh/api 路由（本地治理端点 + Web API 子进程代理）承接。
const API_BASE = `${import.meta.env?.BASE_URL ?? '/'}api`;
const inFlightRequests = new Map<string, Promise<unknown>>();

/** Selected governed-project id, kept in sync by ProjectScopeProvider. Appended to
 *  every request so the backend scopes facts + git to the project shown in the UI.
 *  Lives outside React state so request() can read it synchronously at call time. */
let currentProjectId = '';
let currentWorktreePath = '';
export function setCurrentProjectScope(projectId: string, worktreePath: string): void {
  currentProjectId = projectId || '';
  currentWorktreePath = worktreePath || '';
}

function withProjectScope(url: string): string {
  const [pathname, rawQuery = ''] = url.split('?', 2);
  const search = new URLSearchParams(rawQuery);
  if (currentProjectId && !search.has('projectId')) search.set('projectId', currentProjectId);
  if (currentWorktreePath && !search.has('worktreePath')) search.set('worktreePath', currentWorktreePath);
  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

export type WorkCaseProgressGroup = 'plan_confirmation' | 'progressing' | 'termination_cleanup' | 'closure_confirmation' | 'closed';
export type WorkCaseProgressStep = 'item_execution' | 'controller_self_check' | 'independent_review' | 'controller_synthesis';

export type WorkCasePresentationUnresolvedReason =
  | 'missing_source_content_fingerprint'
  | 'missing_status'
  | 'unsupported_status'
  | 'missing_phase'
  | 'unexpected_phase'
  | 'closed_with_phase'
  | 'invalid_status_phase_combination';

export interface ResolvedWorkCaseCurrentSnapshotProjection {
  contract_identity: 'workcase-current-snapshot-presentation/2';
  resolution: 'resolved';
  source_content_fingerprint: string;
  lifecycle_position: WorkCaseLifecyclePosition;
  handoff_narrative_key: string;
  next_required_control_step: WorkCaseNextRequiredControlStep;
  progress_group: WorkCaseProgressGroup;
  progress_step: WorkCaseProgressStep | null;
  blocking_overlay: boolean;
  handoff_allowed: boolean;
  handoff_reason: WorkCaseHandoffReason;
}

export interface UnresolvedWorkCaseCurrentSnapshotProjection {
  contract_identity: 'workcase-current-snapshot-presentation/2';
  resolution: 'unresolved';
  source_content_fingerprint: string | null;
  unresolved_reason: WorkCasePresentationUnresolvedReason;
  handoff_allowed: boolean;
  handoff_reason: WorkCaseHandoffReason;
}

export type WorkCaseCurrentSnapshotProjection =
  | ResolvedWorkCaseCurrentSnapshotProjection
  | UnresolvedWorkCaseCurrentSnapshotProjection;

export interface ObjectItem {
  id: string;
  type: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  status: string;
  progress_group?: string;
  progress_step?: string;
  current_snapshot_projection?: WorkCaseCurrentSnapshotProjection;
  lifecycle_position?: WorkCaseLifecyclePosition;
  phase?: string;
  goal?: string;
  scope?: string;
  waiting_on?: string;
  blocking_summary?: string;
  path: string;
  created?: string;
  updated: string;
  priority?: string;
  executionItemsProjectionValid?: boolean;
  executionItems?: WorkCaseExecutionItem[];
  successCriteria?: string[];
  success_criterion_definitions?: WorkCaseCriterionDefinition[] | unknown;
  work_items?: WorkCaseItem[] | unknown;
  creation_reviews?: WorkCaseReview[] | unknown;
  execution_authorization?: WorkCaseExecutionAuthorization | unknown;
  independentSubagentUnavailable?: boolean;
  execution_approval?: WorkCaseExecutionApproval | unknown;
  termination?: WorkCaseTermination | unknown;
  closure_outcome?: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  /** closure_confirmation Card 的“后续贡献”区；仅实际声明 contributed-to 时出现 */
  contributedTo?: WorkCaseContributionTarget[];
  /** closure_confirmation Card 的关闭判断输入区；仅 closure_proposal 结构合法时出现 */
  closureProposal?: WorkCaseClosureProposalCard;
  /** closed Card 的终态关闭扫读投影；不反推原 proposal 身份 */
  closureTerminal?: WorkCaseClosureTerminalCard;
  /** ADR-specific fields */
  decision?: string;
  consequences?: string;
  /** Spark-specific */
  evolution?: Array<Record<string, unknown>>;
  /** Exact-read formal relation targets for every fact list card. */
  factAssociations?: FactCardAssociation[];
  /** Exact field-level source metadata. */
  object_uid?: string;
  object_id?: string;
  fact_type_key?: string;
  canonical_path?: string;
  absolute_path?: string;
  carrier?: FactCarrier;
  read_status?: FactReadStatus;
  /** 文件中 YAML 部分的逐字原文，YAML 源视图直显（有什么就显示什么）。 */
  yaml_source?: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
  read_issues?: Array<Record<string, unknown>>;
  created_at?: string;
  updated_at?: string;
  /** Present on list items so cards can attribute the latest update without an extra detail request. */
  change_log?: unknown;
  disposition_summary?: string;
  relations?: Array<Record<string, unknown>>;
  /** v4 Study 专属（v4 归档模式下仍可见）；v5 Research 无此字段，卡片摘要由 research_question 承担（24 §12）。 */
  report_kind?: 'external_research' | 'internal_audit' | 'technical_assessment' | 'comparison';
  input_refs?: Array<Record<string, unknown>>;
  /** 跨工作区合并元数据 */
  sourceBranch?: string;
  mainWorktreeDiffers?: boolean;
  research_intent?: string;
  research_question?: string;
  /** v5 Research F1 投影字段（24 §12）：卡片只投影 research_question/research_purpose/stopping_reason。 */
  research_purpose?: string;
  stopping_reason?: string;
  abstract?: string;
  recommendation_summary?: string;
  summary?: string;
  conclusion?: string;
  urls?: Array<string | UrlItem>;
  report_body?: string;
  /** Pitfall-specific */
  symptoms?: string;
  trigger_conditions?: string;
  scope_of_impact?: string;
  resolution?: string;
  avoidance?: string;
  validation_summary?: string;
  applicability?: string;
}

export interface FactCardAssociation {
  relationKey?: string;
  target?: {
    objectUid: string;
  } | {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  /** Current-project locator resolved uniquely from an authoritative UID; never part of the relation identity. */
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  title?: string;
  title_en?: string;
  title_zh?: string;
  status?: string;
  closureOutcome?: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  progressGroup?: WorkCaseProgressGroup;
  available: boolean;
}

export interface WorkCaseExecutionItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  blockingReason?: string;
}

export interface UrlItem {
  ref: string;
  title?: string;
  summary?: string;
}

export interface ObjectStatusOption {
  status: string;
  count: number;
}

export interface WorkCaseProgressOption {
  group: string;
  count: number;
}

/** Web-only list classification; `discarded` is derived from a closed cancelled WorkCase. */
export type WorkCaseListGroup = WorkCaseProgressGroup | 'discarded';

export type FactCoverageStatus = 'complete' | 'partial' | 'unavailable' | 'type_not_integrated';

export interface FactListProblem {
  code?: string;
  message?: string;
  path?: string;
  error?: string;
  object_ref?: {
    governed_project_id?: string;
    fact_type_key?: string;
    object_id?: string;
  };
  scope?: 'workcase_collection';
  read_status?: string;
}

export interface FieldIssue {
  path: string;
  reason: 'missing' | 'type_mismatch' | 'identity_mismatch';
  expected: string;
  raw_value?: unknown;
}

export interface UnparsedStructure {
  path: string;
  reason: string;
  raw_value?: unknown;
}

export interface RelatedObjectSummary {
  id: string;
  type: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  status: string;
  path: string;
  updated: string;
  priority?: string;
  role?: string;
  mode?: string;
  expectedOutput?: string;
  resultSummary?: string;
  blockingReason?: string;
  inputRefs?: string[];
  evidenceRefs?: string[];
}

export interface WorkCaseCriterionDefinition {
  criterion_id: string;
  statement: string;
}

export interface WorkCaseCriterionResult {
  criterion_id: string;
  outcome: 'satisfied' | 'not_satisfied' | 'not_verified';
  summary: string;
}

export interface WorkCaseItem {
  item_id: string;
  goal: string;
  expected_result: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  depends_on?: string[];
  approach_summary?: string;
  template_keys?: string[];
  template_deviation_summary?: string;
  current_summary?: string;
  resume_from?: string;
  blocking_summary?: string;
  result_summary?: string;
}

export interface WorkCaseReview {
  reviewer: string;
  reviewed_at: string;
  subject_version: number;
  scope: string;
  conclusion: 'pass' | 'pass_with_followups' | 'changes_required' | 'blocked';
  feedback?: string[];
  controller_resolution?: string;
  actual_method?: 'subagent-read-only' | 'same-ai-switched-role-read-only';
  capability_evidence?: string[];
  assurance_gap?: string;
  human_disclosure_summary?: string;
  human_disclosed_at?: string;
}

export interface WorkCaseExecutionApproval {
  subject_version: number;
  approved_at: string;
  summary: string;
  baseline_fingerprint: string;
  source_refs: string[];
}

export interface WorkCaseAuthorizedAction {
  action_id: string;
  summary: string;
  target_scope: string;
  effect_scope: string;
  risk_summary: string;
  rollback_summary: string;
  rule_refs: string[];
}

export interface WorkCaseExecutionAuthorization {
  authorized_actions: WorkCaseAuthorizedAction[];
  action_ceiling: string;
  prohibited_actions: string[];
  allowed_adjustments: string;
  verification_and_rollback: string;
  out_of_bounds_handling: string;
  human_prerequisites?: string[];
}

export interface WorkCaseRouteTarget {
  governed_project_id: string;
  fact_type_key: 'workcase' | 'spark';
  object_id: string;
  content_fingerprint: string;
}

export interface WorkCaseRelationTarget {
  governed_project_id: string;
  fact_type_key: 'workcase' | 'spark' | 'adr' | 'pitfall' | 'research';
  object_id: string;
}

export interface WorkCaseRelation {
  relation_key: 'depends-on' | 'routed-to' | 'contributed-to' | 'related-to';
  target: WorkCaseRelationTarget;
}

/** closure_confirmation Card 只消费稳定目标三元组，不复制目标标题。 */
export interface WorkCaseContributionTarget {
  governedProjectId?: string;
  factTypeKey?: string;
  objectId?: string;
  objectUid?: string;
}

/**
 * closure_confirmation Card 只消费关闭提案的稳定子集，不透传整对象；
 * route target 只携带稳定三元组，标题与类型由当前目标回读呈现。
 */
export interface WorkCaseClosureProposalCard {
  proposedOutcome: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  dispositionSummary: string;
  residualDecisions: WorkCaseResidualDecisionCard[];
  sparkSuggestions: WorkCaseSparkSuggestionCard[];
}

export interface WorkCaseResidualDecisionCard {
  residualId: string;
  summary: string;
  proposedDisposition: 'route_existing' | 'suggest_spark' | 'accept_stop';
  routeTarget?: WorkCaseContributionTarget;
}

export interface WorkCaseSparkSuggestionCard {
  suggestionId: string;
  suggestionKind: 'constrained_responsibility' | 'follow_up_opportunity';
  summary: string;
  followUpSummary: string;
  restrictionReason?: string;
  impactSummary?: string;
  resumeCondition?: string;
}

export interface WorkCaseClosureTerminalCard {
  outcome: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  dispositionSummary: string;
  routedTo: WorkCaseContributionTarget[];
  acceptedStop: Array<{ residualId: string; summary: string }>;
  sparkSuggestions: WorkCaseSparkSuggestionCard[];
}

export interface WorkCaseResidualDecision {
  residual_id: string;
  summary: string;
  proposed_disposition: 'route_existing' | 'suggest_spark' | 'accept_stop';
  route_target?: WorkCaseRouteTarget;
  spark_suggestion_id?: string;
}

export interface WorkCaseClosureProposal {
  proposed_outcome: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  proposed_disposition_summary: string;
  residual_decisions?: WorkCaseResidualDecision[];
  spark_suggestions?: WorkCaseSparkSuggestion[];
}

export interface WorkCaseSparkSuggestion {
  suggestion_id: string;
  suggestion_kind: 'constrained_responsibility' | 'follow_up_opportunity';
  summary: string;
  follow_up_summary: string;
  restriction_reason?: string;
  impact_summary?: string;
  resume_condition?: string;
}

export interface WorkCaseResidualResponsibility {
  residual_id: string;
  summary: string;
}

export interface WorkCaseTermination extends Record<string, unknown> {
  reason: string;
  cleanup_status: 'pending' | 'blocked' | 'completed';
  cleanup_summary: string;
  retained_scope?: string[];
  discarded_scope?: string[];
  unverified_scope?: string[];
  relationship_impacts?: string[];
  quality_steps?: string[];
}

/** Exact-detail fields from the single current WorkCase contract. */
export interface WorkCaseDetailData extends Record<string, unknown> {
  object_id: string;
  fact_type_key: 'workcase';
  title: string;
  status: 'open' | 'blocked' | 'closed';
  created_at: string;
  updated_at: string;
  goal: string;
  scope: string;
  success_criterion_definitions: WorkCaseCriterionDefinition[];
  current_snapshot_projection?: WorkCaseCurrentSnapshotProjection;
  phase?: 'human_plan_confirming' | 'plan_revising' | 'executing' | 'controller_checking' | 'independent_reviewing' | 'closure_preparing' | 'human_closure_confirming' | 'termination_preparing';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  summary?: string;
  resume_from?: string;
  waiting_on?: string;
  blocking_summary?: string;
  plan_version?: number;
  work_items?: WorkCaseItem[];
  creation_reviews?: WorkCaseReview[];
  execution_authorization?: WorkCaseExecutionAuthorization;
  execution_approval?: WorkCaseExecutionApproval;
  result_version?: number;
  success_criterion_results?: WorkCaseCriterionResult[];
  result_summary?: string;
  controller_check_summary?: string;
  result_reviews?: WorkCaseReview[];
  validation_summary?: string;
  closure_proposal?: WorkCaseClosureProposal;
  closure_outcome?: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
  termination?: WorkCaseTermination;
  disposition_summary?: string;
  residual_responsibilities?: WorkCaseResidualResponsibility[];
  spark_suggestions?: WorkCaseSparkSuggestion[];
  relations?: WorkCaseRelation[];
  urls?: UrlItem[];
}

export interface ObjectDetail<TData extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean;
  action: string;
  target: string;
  summary: { id: string; type: string; status?: string; phase?: string; read_status?: FactReadStatus };
  data: TData;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE}${withProjectScope(url)}`;
  const cacheKey = init ? `${init.method ?? 'GET'} ${fullUrl}` : fullUrl;
  const existing = !init || init.method === undefined || init.method === 'GET' ? inFlightRequests.get(cacheKey) : undefined;
  if (existing) return existing as Promise<T>;

  const promise = fetch(fullUrl, init)
    .then(async (res) => {
      const body = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok) {
        const message = typeof body?.error === 'string' && body.error.trim()
          ? body.error
          : `API error: ${res.status} ${res.statusText}`;
        const code = typeof body?.exitCode === 'string' ? body.exitCode : undefined;
        throw new ApiRequestError(res.status, message, code);
      }
      return body as T;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  if (!init || init.method === undefined || init.method === 'GET') inFlightRequests.set(cacheKey, promise);
  return promise;
}


/** 认知中心待决类型：两个 WorkCase Human Gate、阻塞处置与 Pitfall draft 审核。 */
export type CognitionInboxKind = 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution' | 'pitfall_confirmation';

/**
 * 决定依据区内联投影（Q3）：与 WorkCase 列表 Card 同源的 source-bound 字段子集，
 * 不含对象身份字段（id/title/status 等在条目层）。
 */
export interface CognitionInboxCard extends Record<string, unknown> {
  goal?: string;
  scope?: string;
  waiting_on?: string;
  blocking_summary?: string;
  executionItemsProjectionValid?: boolean;
  executionItems?: WorkCaseExecutionItem[];
  successCriteria?: string[];
  success_criterion_definitions?: WorkCaseCriterionDefinition[] | unknown;
  work_items?: WorkCaseItem[] | unknown;
  creation_reviews?: WorkCaseReview[] | unknown;
  execution_authorization?: WorkCaseExecutionAuthorization | unknown;
  execution_approval?: WorkCaseExecutionApproval | unknown;
  closureProposal?: WorkCaseClosureProposalCard;
  contributedTo?: WorkCaseContributionTarget[];
}

interface CognitionInboxItemBase {
  id: string;
  object_uid?: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  relativeTime: string;
  typeColor: string;
  inboxKind: CognitionInboxKind;
  read_status: string;
  card: CognitionInboxCard;
  priority?: string;
  updatedAt?: string;
  /** 仅字段级直读 read_status=readable 时出现（Q4），供条件显示"复制对象路径"。 */
  canonical_path?: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
  read_issues?: Array<Record<string, unknown>>;
}

/** WorkCase 条目只携带 progress_group，不复用来源 status 语义。 */
export interface CognitionWorkCaseInboxItem extends CognitionInboxItemBase {
  type: 'workcase';
  progress_group: 'plan_confirmation' | 'closure_confirmation';
  lifecycle_position: WorkCaseLifecyclePosition;
  isBlocked: boolean;
  inboxKind: 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution';
}

/** Pitfall draft 的待确认是类型专属状态，按来源状态直接呈现。 */
export interface CognitionPitfallInboxItem extends CognitionInboxItemBase {
  type: 'pitfall';
  status: 'draft';
  inboxKind: 'pitfall_confirmation';
}

export type CognitionInboxItem = CognitionWorkCaseInboxItem | CognitionPitfallInboxItem;

/** 处于结果推进主链的 WorkCase；与两个 Human Gate 的待决定事项互斥。 */
export interface CognitionActiveWorkCaseItem extends Omit<CognitionInboxItemBase, 'inboxKind'> {
  type: 'workcase';
  progress_group: 'progressing' | 'termination_cleanup';
  progress_step?: WorkCaseProgressStep;
  lifecycle_position: WorkCaseLifecyclePosition;
  isBlocked: boolean;
}

/** 近期动态由事实对象自身的 change_log 派生；不承载 Git 提交记录或字段级 diff。 */
export type CognitionRecentActivityWindow = '1d' | '3d' | '7d';
export type CognitionRecentActivityKind = 'created' | 'updated';

export interface CognitionRecentActivityItem {
  id: string;
  object_uid?: string;
  type: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  activity: CognitionRecentActivityKind;
  occurredAt: string;
  /** 来自该条近期事实流水的完整署名；缺失时不补造。 */
  signature?: CommitSignature;
  /** 当前窗口内同一稳定事实对象的可读 change_log 条数。 */
  activityCount: number;
  relativeTime: string;
  typeColor: string;
  priority?: string;
  /** WorkCase 只携带派生 progress_group；其它对象携带自身当前状态。 */
  progress_group?: WorkCaseProgressGroup;
  status?: string;
  read_status: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
}

/** 近期事实流水的完整署名维度用量；按 change_log 流水署名计数（v5 扁平 provider/model 或 v4 嵌套 signature）。 */
export interface CognitionRecentActivityAttributionUsage {
  value: string;
  count: number;
}

/** Spark 池健康是从当前状态与更新时间派生的只读快照，不承载分流建议。 */
export interface CognitionSparkHealthItem {
  type: 'spark';
  id: string;
  object_uid?: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  priority?: string;
  updatedAt: string;
  /** 最近一条完整 change_log 署名，与事实卡片落款一致。 */
  signature?: CommitSignature;
  /** 该 Spark 可读 change_log 中的受控修改流水数。 */
  activityCount: number;
  /** 距 API 本次 generatedAt 的完整静默天数。 */
  silentDays: number;
  typeColor: string;
  read_status: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
}

export interface CognitionSparkHealth {
  total: number;
  openTotal: number;
  terminalTotal: number;
  terminalByStatus: { implemented: number; discarded: number };
  openByPriority: Record<string, number>;
  /** Web 展示参数；不写回事实源。 */
  silentThresholdDays: number;
  silentCount: number;
  /** 当前全部待处理 Spark，供界面按未更新时间筛选；不含已收敛项。 */
  openItems: CognitionSparkHealthItem[];
  silentItems: CognitionSparkHealthItem[];
}

/** 近期热点中心对应的事实修改流水；只表示本窗口内的事实活动。 */
export interface CognitionRecentHotspotRef {
  occurred_at: string;
  activity: CognitionRecentActivityKind;
}

export interface CognitionRecentHotspotNode {
  type: string;
  id: string;
  object_uid?: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  /** WorkCase 仅携带派生 progress_group；其它对象携带自身状态。 */
  progress_group?: WorkCaseProgressGroup;
  status?: string;
  priority?: string;
  read_status: string;
  typeColor: string;
  /** 仅热点中心有非空数组；一跳关系节点为 []。 */
  activityRefs: CognitionRecentHotspotRef[];
}

export interface CognitionRecentHotspotRelation {
  direction: 'outgoing' | 'incoming';
  relationKey: string;
  node: CognitionRecentHotspotNode;
}

export interface CognitionRecentHotspotCluster {
  /** 当前窗口内有事实修改流水的唯一中心。 */
  primary: CognitionRecentHotspotNode;
  /** 只含与中心直接相连的一跳正式关系；不会递归展开邻居。 */
  relations: CognitionRecentHotspotRelation[];
}

/**
 * 当前窗口内由事实 change_log 直接产生的热点。
 * 只返回至少有一条正式关系、能展开一跳工作的热点关系簇。
 */
export interface CognitionRecentHotspots {
  window: CognitionRecentActivityWindow;
  totalEvents: number;
  hotspotTotal: number;
  relationTotal: number;
  clusters: CognitionRecentHotspotCluster[];
}

export interface CognitionIssue {
  section: string;
  code: string;
  message: string;
  object_ref?: string;
}

export interface CognitionData {
  generatedAt: string;
  scope: { governedProjectId: string };
  inbox: { items: CognitionInboxItem[]; total: number };
  activeWorkCases: { items: CognitionActiveWorkCaseItem[]; total: number };
  recentActivity: {
    window: CognitionRecentActivityWindow;
    windowStart: string;
    items: CognitionRecentActivityItem[];
    /** 当前窗口内唯一事实对象数。 */
    total: number;
    /** 当前窗口内可读事实流水总数；用于模块标题的“动态数”。 */
    eventTotal: number;
    modelUsage: CognitionRecentActivityAttributionUsage[];
    environmentUsage: CognitionRecentActivityAttributionUsage[];
  };
  /** Spark 列表不可读取时整体省略，并通过 issues 就地说明。 */
  sparkHealth?: CognitionSparkHealth;
  /** 事实流水或关系读取不可用时整体省略，并通过 issues 就地说明。 */
  recentHotspots?: CognitionRecentHotspots;
  issues?: CognitionIssue[];
}

export async function fetchCognition(locale?: string, window: CognitionRecentActivityWindow = '1d'): Promise<CognitionData> {
  const search = new URLSearchParams({ window });
  if (locale) search.set('locale', locale);
  const params = `?${search.toString()}`;
  return request<CognitionData>(`/cognition${params}`);
}

/** Goal(单例冻结锚) 的蓝图投影读取 —— 对应 GET /api/cognition/goal（specs/25 直读消费点）。
 *  仅承载 goal.md 原文的窄投影（目标陈述由 title + 正文子目标文本承载，不做 AI 派生）。 */
export interface CognitionGoalData {
  ok: boolean;
  goal?: {
    goal_key: string;
    title: string;
    status: string;
    statement: string;
    sub_goals: { id: string; text: string }[];
    plan_items: { text: string; serves: string | null }[];
  };
  error?: string;
  code?: string;
}

export async function fetchCognitionGoal(): Promise<CognitionGoalData> {
  return request<CognitionGoalData>(`/cognition/goal`);
}

export async function fetchObjects(
  type: string,
  status?: string,
  priority?: string,
  progress?: string,
): Promise<{
  ok: boolean;
  summary: { count: number; coverage_status?: FactCoverageStatus };
  data: {
    items: ObjectItem[];
    coverage_status?: FactCoverageStatus;
    observed_at?: string;
    collection_issues?: FactListProblem[];
    statusOptions?: ObjectStatusOption[];
    progressOptions?: WorkCaseProgressOption[];
    priorityOptions?: ObjectStatusOption[];
    statusTotal?: number;
    /** IDs absent from the current worktree's full object collection. */
  };
}> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (progress) params.set('progress', progress);
  const qs = params.toString();
  return request(`/objects/${type}${qs ? `?${qs}` : ''}`);
}

export async function fetchObjectDetail<TData extends Record<string, unknown> = Record<string, unknown>>(
  type: string,
  id: string,
): Promise<ObjectDetail<TData>> {
  return request<ObjectDetail<TData>>(`/objects/${type}/${encodeURIComponent(id)}`);
}


export interface ChangelogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  body: string;
  category: string;
  scope: string;
  description: string;
  isBreaking: boolean;
  relativeTime: string;
  pushStatus: GitPushStatus;
  signature?: CommitSignature;
}

export type GitPushStatus = 'pushed' | 'unpushed' | 'incoming' | 'unknown';

export interface CommitSignature {
  productName?: string;
  modelName?: string;
  /** v5 扁平署名原词（LDVH-Provider/LDVH-Model trailer 与 change_log provider/model）——
   *  逐字携键到显示层，经 normalizeSignature 逐字呈现（供应商 id 不美化）。 */
  provider?: string;
  model?: string;
}

export interface CommitDetailPanelData {
  entry: ChangelogEntry;
  stat: string;
}

export async function fetchChangelog(count?: number, locale?: string): Promise<ChangelogEntry[]> {
  const params = new URLSearchParams();
  if (count) params.set('count', String(count));
  if (locale) params.set('locale', locale);
  const qs = params.toString();
  return request<ChangelogEntry[]>(`/changelog${qs ? `?${qs}` : ''}`);
}

export async function fetchCommitDetail(hash: string, locale?: string): Promise<{ hash: string; stat: string; body: string; entry?: ChangelogEntry }> {
  const params = new URLSearchParams();
  if (locale) params.set('locale', locale);
  const qs = params.toString();
  return request<{ hash: string; stat: string; body: string; entry?: ChangelogEntry }>(`/changelog/${hash}${qs ? `?${qs}` : ''}`);
}

export interface DocContent {
  path: string;
  content: string;
  truncated: boolean;
}

export async function fetchDocContent(docPath: string): Promise<DocContent> {
  return request<DocContent>(`/docs?path=${encodeURIComponent(docPath)}`);
}

export interface GovernedProject {
  id: string;
  name: string;
  description: string;
  path: string;
  color?: string;
  docsPath: string;
  ldvhBasePath: string;
  worktrees: ProjectWorktree[];
}

export interface ProjectWorktree {
  path: string;
  branch?: string;
  head?: string;
  isMain: boolean;
  status?: WorkspaceWorktreeStatusSummary;
}

export interface ProjectFilesProjectsData {
  ok: boolean;
  workspaceRoot: string;
  defaultProjectId: string;
  projects: GovernedProject[];
}

export interface ProjectFileEntry {
  name: string;
  path: string;
  absolutePath: string;
  type: 'directory' | 'file';
  kind: 'directory' | 'markdown' | 'yaml' | 'svg' | 'text' | 'binary';
  size: number;
  updated: string;
}

export interface ProjectFileEntriesData {
  ok: boolean;
  project: GovernedProject;
  dir: string;
  parent: string;
  showHidden: boolean;
  truncated: boolean;
  entries: ProjectFileEntry[];
}

export interface ProjectFileContentData {
  ok: boolean;
  project: GovernedProject;
  path: string;
  absolutePath: string;
  kind: 'markdown' | 'yaml' | 'svg' | 'text' | 'binary';
  size: number;
  content: string;
  truncated: boolean;
}

export interface ProjectGitStatusEntry {
  projectId: string;
  status: string;
  path: string;
  absolutePath: string;
  staged: boolean;
  unstaged: boolean;
}

export interface ProjectGitStatusData {
  ok: boolean;
  entries: ProjectGitStatusEntry[];
}

export interface ProjectGitDiffData {
  ok: boolean;
  project: GovernedProject;
  hash?: string;
  path: string;
  absolutePath: string;
  status: string;
  diff: string;
}

export interface ProjectGitCommitEntry {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  body: string;
  category: string;
  scope: string;
  description: string;
  isBreaking: boolean;
  pushStatus: GitPushStatus;
  isMerge: boolean;
}

export interface ProjectGitCommitFile {
  status: string;
  path: string;
  absolutePath: string;
}

export interface ProjectGitCommitDetail extends ProjectGitCommitEntry {
  files: ProjectGitCommitFile[];
}

export interface ProjectGitCommitsData {
  ok: boolean;
  project: GovernedProject;
  entries: ProjectGitCommitEntry[];
}

export interface ProjectGitCommitDetailData {
  ok: boolean;
  project: GovernedProject;
  commit: ProjectGitCommitDetail;
}

export async function fetchProjectFilesProjects(): Promise<ProjectFilesProjectsData> {
  return request<ProjectFilesProjectsData>('/project-files/projects');
}

export interface GovernedProjectSetting { id: string; path: string; name?: string; color?: string }
export interface GovernedProjectsSettingsData {
  ok: boolean;
  workspaceRoot: string;
  configPath: string;
  fingerprint: string;
  defaultProjectId: string;
  hasExplicitDefault: boolean;
  projects: GovernedProjectSetting[];
}

export interface WorkspaceWorktreeStatusSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

/** Read-only workspace discovery; these paths do not become governed projects until saved. */
export interface WorkspaceWorktree {
  path: string;
  branch?: string;
  head?: string;
  isMain: boolean;
  status?: WorkspaceWorktreeStatusSummary;
  registeredProjectId?: string;
  governedProjectId?: string;
}

export interface WorkspaceWorktreesData {
  ok: boolean;
  workspaceRoot: string;
  items: WorkspaceWorktree[];
}

export async function fetchGovernedProjectsSettings(): Promise<GovernedProjectsSettingsData> {
  return request<GovernedProjectsSettingsData>('/settings/governed-projects');
}

export async function fetchWorkspaceWorktrees(): Promise<WorkspaceWorktreesData> {
  return request<WorkspaceWorktreesData>('/settings/workspace-worktrees');
}

export async function verifyGovernedProjectsSettings(): Promise<void> {
  await request<{ ok: true }>('/settings/governed-projects/verify', { method: 'POST' });
}

export async function saveGovernedProjectsSettings(
  projects: GovernedProjectSetting[],
  expectedFingerprint: string,
  defaultProjectId: string,
): Promise<GovernedProjectsSettingsData> {
  return request<GovernedProjectsSettingsData>('/settings/governed-projects', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects, expectedFingerprint, defaultProjectId }),
  });
}

export async function fetchProjectFileEntries(projectId: string, dir = '', showHidden = false): Promise<ProjectFileEntriesData> {
  const params = new URLSearchParams({ projectId });
  if (dir) params.set('dir', dir);
  if (showHidden) params.set('showHidden', 'true');
  return request<ProjectFileEntriesData>(`/project-files/entries?${params.toString()}`);
}

export async function fetchProjectFileContent(projectId: string, filePath: string, showHidden = false): Promise<ProjectFileContentData> {
  const params = new URLSearchParams({ projectId, path: filePath });
  if (showHidden) params.set('showHidden', 'true');
  return request<ProjectFileContentData>(`/project-files/content?${params.toString()}`);
}

export async function fetchProjectGitStatus(projectId?: string): Promise<ProjectGitStatusData> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();
  return request<ProjectGitStatusData>(`/project-files/git/status${qs ? `?${qs}` : ''}`);
}

/** 读取指定 worktree 的 git 未提交变更（只读，用于其他分支概览）。 */
export async function fetchProjectWorktreeGitStatus(
  projectId: string,
  worktreePath: string,
): Promise<ProjectGitStatusData> {
  const params = new URLSearchParams({ projectId, worktreePath });
  return request<ProjectGitStatusData>(`/project-files/git/status?${params.toString()}`);
}

export async function fetchProjectGitDiff(projectId: string, filePath: string, status: string): Promise<ProjectGitDiffData> {
  const params = new URLSearchParams({ projectId, path: filePath, status });
  return request<ProjectGitDiffData>(`/project-files/git/diff?${params.toString()}`);
}

export async function fetchProjectGitCommits(projectId: string, count = 50): Promise<ProjectGitCommitsData> {
  const params = new URLSearchParams({ projectId, count: String(count) });
  return request<ProjectGitCommitsData>(`/project-files/git/commits?${params.toString()}`);
}

export async function fetchProjectGitCommitDetail(projectId: string, hash: string): Promise<ProjectGitCommitDetailData> {
  const params = new URLSearchParams({ projectId });
  return request<ProjectGitCommitDetailData>(`/project-files/git/commit/${encodeURIComponent(hash)}?${params.toString()}`);
}

export async function fetchProjectGitCommitFileDiff(projectId: string, hash: string, filePath: string): Promise<ProjectGitDiffData> {
  const params = new URLSearchParams({ projectId, path: filePath });
  return request<ProjectGitDiffData>(`/project-files/git/commit/${encodeURIComponent(hash)}/diff?${params.toString()}`);
}

export interface FederationProjectCard {
  id: string;
  name: string;
  path: string;
  color?: string;
  isDefault: boolean;
  sparkOpen?: number;
  sparkP1?: number;
  activeWorkCases?: number;
  pendingDecisions?: number;
  lastActivityAt?: string;
  issues: string[];
}

export interface FederationCrossSpark {
  projectId: string;
  projectName: string;
  color?: string;
  objectId: string;
  title: string;
  priority?: string;
  updatedAt?: string;
}

export interface FederationOverviewData {
  ok: boolean;
  generatedAt: string;
  defaultProjectId: string;
  projects: FederationProjectCard[];
  crossProjectSparks: FederationCrossSpark[];
}

export async function fetchFederationOverview(): Promise<FederationOverviewData> {
  return request<FederationOverviewData>('/federation/overview');
}

export interface FederationProjectOption {
  id: string;
  name: string;
  color?: string;
}

export interface FederationObjectItem extends ObjectItem {
  federationProject: FederationProjectOption;
}

export interface FederationObjectsData {
  ok: boolean;
  type: string;
  generatedAt: string;
  projects: FederationProjectOption[];
  items: FederationObjectItem[];
  issues: string[];
}

export async function fetchFederationObjects(type: string): Promise<FederationObjectsData> {
  const params = new URLSearchParams({ type });
  return request<FederationObjectsData>(`/federation/objects?${params.toString()}`);
}

export async function setProjectColor(projectId: string, color: string | null): Promise<GovernedProjectsSettingsData> {
  return request<GovernedProjectsSettingsData>('/settings/governed-projects/color', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, color }),
  });
}
