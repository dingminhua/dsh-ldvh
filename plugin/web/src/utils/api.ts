import type { FactCarrier, FactReadStatus } from '@/utils/factReadMeta';
import type {
  WorkCaseV5View,
  WorkCaseV5Status,
  WorkCaseV5Outcome,
  WorkCaseV5Group,
  WorkCaseV5Filter,
} from '@/shared/workcaseLifecycle';
import type {
  WorkCaseCancellationRecord,
  WorkCaseDraftAdvice,
  WorkCaseDraftCheck,
} from '@/shared/workcaseResultDraft';

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

// 21 号三态直读 + 派生分组（v5）。筛选五档与派生 group 共用 workcaseLifecycle 派生函数。
export type { WorkCaseV5View, WorkCaseV5Status, WorkCaseV5Outcome, WorkCaseV5Group, WorkCaseV5Filter };
/** 列表筛选五档值（pending_gate1/executing/awaiting_gate2/closed/all）。 */
export const WORKCASE_V5_FILTER_VALUES = ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'all'] as const;

/** WorkCase 列表项的派生分组（21 号三态直读派生）。 */
export type WorkCaseListGroup = WorkCaseV5Group;

export interface ObjectItem {
  id: string;
  type: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  status: string;
  /** 21 号三态直读派生分组（pending_gate1/executing/awaiting_gate2/closed）。 */
  group?: WorkCaseV5Group;
  outcome?: WorkCaseV5Outcome;
  has_result_draft?: boolean;
  current_snapshot_projection?: WorkCaseV5View;
  phase?: string;
  /** workcase 目标范围；22 §8 ADR scope（必填）复用同声明。 */
  scope?: string;
  path: string;
  created?: string;
  updated: string;
  priority?: string;
  independentSubagentUnavailable?: boolean;
  // v5 WorkCase 字段（21 §8 闭集）：plan/attempt/result/gate_1。
  // summary 与 serves 已在其它类型段声明（类型 string?，共用），不重复。
  //
  // 这四项**复用**下方 WorkCaseDetailData 所用的同一组类型
  // （WorkCasePlanStep/WorkCaseAttempt/WorkCaseResult/WorkCaseGate1），不在此
  // 另起一套内联形状。此前列表侧内联声明 `satisfied?: string`、`residual?: string`，
  // 与详情侧的 `boolean`/`string[]` 相互矛盾——同一字段两套类型使类型系统无法
  // 拦截投影层的类型错位（WorkCase 呈现保真缺陷 D5）。契约只有一份。
  plan?: WorkCasePlanStep[];
  attempt?: WorkCaseAttempt;
  result?: WorkCaseResult;
  gate_1?: WorkCaseGate1;
  // 10 §5.5「执行期阶段」：`executing` 组的四阶段（执行中/复核中/修订中/结项中）
  // 由 reviews 与 change_log 的数组序派生。`change_log` 已在恒复制清单内；`reviews`
  // 需投影层显式搬运，否则卡片侧恒判为「执行中」。复用详情侧同一类型，不另起形状。
  reviews?: WorkCaseReviewEntry[];
  // 「待批准关闭」：`21 §8` 的 `result` 字段出现 ⇔ `status = closed`，故该期的核对结论与
  // 建议只在正文「## 结果」节里；投影层解析后以此二字段搬运（见 shared/workcaseResultDraft）。
  /** 21 §8 取消记录（仅 outcome=cancelled）：正文 `- cancellation:` 段的解析结果。 */
  cancellation?: WorkCaseCancellationRecord;
  result_checks?: WorkCaseDraftCheck[];
  advice?: WorkCaseDraftAdvice[];
  /** 建议段前的事后补记声明（仅补写过的对象有；21 §8）。 */
  advice_note?: string;
  /** 「待批准关闭」期的残留条目（`21 §8` 正文承载；已关闭期改读 `result.residual` 字段）。 */
  result_residual?: string[];
  /** 21 §8：给 Human 扫读的一句话要点。卡面渲染它而非 summary（10 §5.5）；
   * draft/open 必填、closed 条件（终态缺失合法，卡面须如实降级）。 */
  gist?: string;
  /** ADR-specific（22 §8：decision 必填；scope 见上公共段；trigger_signal/终态字段条件） */
  decision?: string;
  trigger_signal?: string;
  retirement_reason?: string;
  retired_at?: string;
  /** Friction-specific（26 §8：phenomenon/impact 必填；attribution/serves 条件） */
  phenomenon?: string;
  attribution?: string;
  impact?: string;
  /** Norm-specific（27 §8：direction_key 必填；retirement_reason/retired_at 终态条件） */
  direction_key?: string;
  /** Spark-specific（20 §8：v5 字段闭集） */
  evolution?: Array<Record<string, unknown>>;
  question?: string;
  scope_boundary?: string;
  intent?: string;
  serves?: string;
  /** 终态去向与理由（implemented/discarded 时必填） */
  disposition?: string;
  /** Exact-read formal relation targets for every fact list card. */
  factAssociations?: FactCardAssociation[];
  /** 03 §7.2 关联引用型 / 20 §8：refs 的精确读取投影。与 factAssociations
   *  并列、语义互不并入（relations 承载生命周期关系，refs 承载普通内容
   *  关联，不参与关系闭集校验）。 */
  factRefs?: FactCardAssociation[];
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
  /** WorkCase 关联目标携带 21 号派生 group（v5；facts.ts 投影，非对象字段）。 */
  group?: WorkCaseV5Group;
  available: boolean;
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

/** WorkCase 列表筛选五档聚合（v5）：group + 计数。 */
export interface WorkCaseLifecycleOption {
  group: WorkCaseV5Filter;
  count: number;
}

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

// 21 号 v5 WorkCase 投影类型（§8 字段闭集）。
export interface WorkCasePlanStep {
  step?: string;
  done_criteria?: string;
}

export interface WorkCaseResultCheck {
  /** 21 §9.3：布尔判定，来源 frontmatter `satisfied`。 */
  satisfied?: boolean;
  evidence?: string;
}

export interface WorkCaseResult {
  criteria_checks?: WorkCaseResultCheck[];
  achieved_scope?: string;
  /** 21 §9.3：残留责任为字符串数组（可空数组表示无残留）。 */
  residual?: string[];
}

/** 21 §8：复核节点概要的单条记录；`at`/署名由 Code 托管。 */
export interface WorkCaseReviewEntry {
  at?: string;
  provider?: string;
  model?: string;
  /** 结构化概要，≤ 600 字符，含 02 §15 判据七要素。 */
  summary?: string;
}

export interface WorkCaseAttempt {
  attempt_id?: unknown;
  controller?: string;
  heartbeat_at?: string;
  started_at?: string;
  /**
   * 21 §8/§14：该 attempt 所属执行会话的权威身份（Code 从 DSH 会话记录取得，
   * AI 不得自填）。它是**关闭侧独立性比对的基准**——21 §14 关闭前置条件二按条目
   * 比对 `reviews[].session_id` 与 `implementer_session_id`。
   *
   * 缺席合法（身份不可得时 writer 条件展开）：**未知不等于独立**，故消费者不得把
   * 缺失读作「无独立复核义务」（21 §14）。
   */
  session_id?: string;
  /** 同一身份的 provenance（`host` 可采信 / `shell` 一律不计入，21 §14）。 */
  session_source?: string;
}

export interface WorkCaseGate1 {
  approved_at?: string;
  approver?: string;
  /** 21 §8/§10.3 C2 授权钉扎：绑定当次 `plan`+`scope` 的内容指纹（授权失效比对基准）。 */
  authorization_fingerprint?: string;
  /** 21 §8/§10.3 授权时的范围快照——越权拒绝的比对基准。 */
  scope_snapshot?: string;
}

/** Exact-detail fields from the single current WorkCase contract (21 §8 三态直读). */
export interface WorkCaseDetailData extends Record<string, unknown> {
  object_id: string;
  fact_type_key: 'workcase';
  title: string;
  status: WorkCaseV5Status;
  created_at: string;
  updated_at: string;
  /** 21 §8：给 Human 扫读的一句话要点（≤200 字符、纯文本、无正文承载）。
   * draft/open 必填，closed 条件（终态只读，缺失合法）。卡面渲染它而非 summary。 */
  gist?: string;
  summary?: string;
  serves?: string;
  scope?: string;
  plan?: WorkCasePlanStep[];
  attempt?: WorkCaseAttempt;
  /** 21 §8：复核节点概要流水（Human 裁定 2026-09-16）。详情不入对象。 */
  reviews?: WorkCaseReviewEntry[];
  result?: WorkCaseResult;
  outcome?: WorkCaseV5Outcome;
  gate_1?: WorkCaseGate1;
  change_log?: unknown[];
  current_snapshot_projection?: WorkCaseV5View;
  relations?: Array<Record<string, unknown>>;
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
  /** 21 §8：给 Human 扫读的一句话要点。聚焦收件箱卡体渲染它而非 summary（10 §5.5）。 */
  gist?: string;
  summary?: string;
  serves?: string;
  scope?: string;
  plan?: WorkCasePlanStep[];
  attempt?: WorkCaseAttempt;
  result?: WorkCaseResult;
  outcome?: WorkCaseV5Outcome;
  gate_1?: WorkCaseGate1;
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

/** 21 号三态直读：WorkCase 待办收件只携带派生 group（pending_gate1 / awaiting_gate2）。 */
export interface CognitionWorkCaseInboxItem extends CognitionInboxItemBase {
  type: 'workcase';
  group: WorkCaseV5Group;
  inboxKind: 'plan_confirmation' | 'closure_confirmation';
}

/** Pitfall draft 的待确认是类型专属状态，按来源状态直接呈现。 */
export interface CognitionPitfallInboxItem extends CognitionInboxItemBase {
  type: 'pitfall';
  status: 'draft';
  inboxKind: 'pitfall_confirmation';
}

export type CognitionInboxItem = CognitionWorkCaseInboxItem | CognitionPitfallInboxItem;

/** 处于执行主链的 WorkCase（group=executing）；与两个 Human Gate 的待决定事项互斥。 */
export interface CognitionActiveWorkCaseItem extends Omit<CognitionInboxItemBase, 'inboxKind'> {
  type: 'workcase';
  group: 'executing';
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
  /** Spark 的 goal.md 子目标锚点（20 §6 serves），条件出现。 */
  serves?: string;
  /** WorkCase 只携带派生 group；其它对象携带自身当前状态。 */
  group?: WorkCaseV5Group;
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
  /** Spark 的 goal.md 子目标锚点（20 §6 serves），条件出现。 */
  serves?: string;
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
  /** WorkCase 仅携带派生 group；其它对象携带自身状态。 */
  group?: WorkCaseV5Group;
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
 *  承载 goal.md 原文投影：蓝图窄字段（statement/sub_goals）+ 详情阅读面
 *  （created_at/change_log 修订史 + 读取层元数据，同多例类型 exact-read 形态）。 */
export interface CognitionGoalData {
  ok: boolean;
  goal?: {
    goal_key: string;
    title: string;
    status: string;
    statement: string;
    sub_goals: { id: string; text: string }[];
    created_at?: string;
    change_log?: unknown;
    canonical_path?: string;
    carrier?: FactCarrier;
    read_status?: FactReadStatus;
    field_issues?: FieldIssue[];
    unparsed_structures?: UnparsedStructure[];
    read_issues?: Array<Record<string, unknown>>;
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
  lifecycle?: string,
  priority?: string,
): Promise<{
  ok: boolean;
  summary: { count: number; coverage_status?: FactCoverageStatus };
  data: {
    items: ObjectItem[];
    coverage_status?: FactCoverageStatus;
    observed_at?: string;
    collection_issues?: FactListProblem[];
    statusOptions?: ObjectStatusOption[];
    /** WorkCase 列表筛选五档聚合（v5）。 */
    lifecycleOptions?: WorkCaseLifecycleOption[];
    /** Spark 三联过滤之 priority（20 §8）计数。 */
    priorityOptions?: ObjectStatusOption[];
    statusTotal?: number;
    /** IDs absent from the current worktree's full object collection. */
  };
}> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (lifecycle) params.set('lifecycle', lifecycle);
  if (priority) params.set('priority', priority);
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
