import type { FactCarrier, FactReadStatus } from '@/utils/factReadMeta';
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

export interface ObjectItem {
  id: string;
  type: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  status: string;
  has_result_draft?: boolean;
  /**
   * 建前审核轴（21 §8 `pre_reviews`，2026-10-16 建立）：draft 期是否已存在一条
   * `verdict = pass` 的审核条目。仅作徽标后缀「· 待审核」与否的呈现判据——
   * 指纹覆盖关系由写入侧的覆盖闸保证，呈现层不重复实现。
   */
  pre_audit_passed?: boolean;
  path: string;
  created?: string;
  updated: string;
  priority?: string;
  independentSubagentUnavailable?: boolean;
  /** ADR-specific（22 §8：decision 必填；scope 见上公共段；trigger_signal/终态字段条件） */
  decision?: string;
  trigger_signal?: string;
  retirement_reason?: string;
  retired_at?: string;
  /** Friction-specific（26 §8：phenomenon 必填；attribution 条件。
   *  原 impact（轻/中/重影响评级）已于 2026-11-02 随分级制度撤销，见 26 §8） */
  phenomenon?: string;
  attribution?: string;
  /** 26 §8 `occurrence`：重复观察的证据载体，**频次的机械权威源**。
   *
   * （2026-10 修订，Human 决定：观察不进事实源）`count` 记录「该阻碍被独立
   * 观察到的次数」，**不再是任何状态流转的阈值判据**——阈值判定已移到
   * 11 §12bis.1 的摩擦观察缓冲，既有账目的状态变更全部属 Human Gate
   * （26 §9.2）。原第四个键 `human_return_at` 随「放回留观」流转一并删除，
   * 故此处不再声明它。
   *
   * **此处登记为可选**：§8 对「闭集收缩改判而来的 `voided`」有必填豁免（§14.2），
   * 届时该字段合法缺席——呈现层据此不渲染该 chip，不补零、不占位。
   *
   * 本字段此前**从未在前端类型里声明过**，尽管 API 一直在送（`factFieldContract`
   * 登记为 object、`FACT_LIST_FIELD_NAMES.friction` 含它、`copyPresentFields`
   * 实际携带）——词条在、数据在、唯独没有消费方与类型。 */
  occurrence?: {
    count?: number;
    first_at?: string;
    last_at?: string;
  };
  /** Norm-specific（27 §8：direction_key 必填；retirement_reason/retired_at 终态条件） */
  direction_key?: string;
  /** SubGoal-specific（28 §8：身份由 object_uid 承担、显示次序由可选 `order`
   *  承担，二者不可互相替代；criterion/criterion_kind/alignment 是该类型存在
   *  的理由；disposition 仅 retired 出现）。 */
  order?: number;
  parent_goal?: string;
  criterion?: string;
  criterion_kind?: string;
  alignment?: string;
  /**
   * SubGoal 名下工作的**读取时派生**投影（28 §8.1：不落盘、不是存储状态）。
   * `facts.ts` 的单次全场反查结果按子目标 uid 归组后同时附到列表项与详情上——
   * 列表卡因此不必逐条再取一次详情（同一判据不重算 N 遍）。
   */
  serving_work?: ServingWorkItem[];
  /** 名下没有任何 `serves` 指向本条子目标。空集是**歧义**，不是进度 0（28 §8.1）。 */
  serving_empty?: boolean;
  /** 反查时读不到的类型与原因；「读不到」不得并入空集（00 §4.6）。 */
  serving_unreadable?: string[];
  /** Spark-specific（20 §8：v5 字段闭集） */
  evolution?: Array<Record<string, unknown>>;
  question?: string;
  scope_boundary?: string;
  intent?: string;
  serves?: string;
  /** 终态去向与理由（implemented/discarded 时必填） */
  disposition?: string;
  /**
   * 29 §10.4 `occurred_at`：DevLog 条目所记工作的**发生时间**。
   *
   * 与 `created_at`（该条目形成的时间）**不同轴、不可互换**——存量并入时二者常相差
   * 很远（一次过去的工作在很久之后才被整理成条目）。列表卡与详情面呈现它；详情同时
   * 呈现 `created_at`，二者各自标注，没有一个「统一时间」能同时回答两个问题。
   */
  occurred_at?: string;
  /** Exact-read formal relation targets for every fact list card. */
  factAssociations?: FactCardAssociation[];
  /** 03 §7.2 关联引用型 / 20 §8：refs 的精确读取投影。与 factAssociations
   *  并列、语义互不并入（relations 承载生命周期关系，refs 承载普通内容
   *  关联，不参与关系闭集校验）。 */
  factRefs?: FactCardAssociation[];
  /**
   * Read-time reverse projection of ordinary refs that point at this object.
   * This is intentionally separate from outgoing `factRefs` and lifecycle
   * `factAssociations`; it records only a declared source→target association.
   */
  factRefSources?: FactRefSource[];
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

export interface FactRefSource {
  objectUid: string;
  available: boolean;
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  title?: string;
  title_en?: string;
  title_zh?: string;
  status?: string;
}

/** 关联目标的三态（02 §8.1 / §8.2）：权威 UID／已解析 locator／commit hash。 */
export type FactCardAssociationTarget =
  | {
    objectUid: string;
  }
  | {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  }
  | {
    /** 02 §8.1「commit 形态」：解药是一次受控提交，呈现层跳提交详情页。 */
    commit: string;
  };

export interface FactCardAssociation {
  relationKey?: string;
  /**
   * **必填**（2026-11-04 类型收敛，修 spark-b0e805d1 缺陷②）。
   *
   * 此前写作 `target?`（可选），依据是「refs 投影没有 target 字段」这一**当时的
   * 偶然事实**——而 `refs` 实为 `objectUid`，两者的差异是投影层的形状不一致，
   * 不是「可能没有目标」。类型层面的可选性会被下游误当作「可能没有目标」：
   * `dedupeFactCardAssociations` 曾写注「不得依赖 refs 投影当前恰好没有 target
   * 字段这一偶然事实」（2026-09-16 独立复核据此发现跨组去重静默丢弃 refs 条目
   * 的隐患），而该守卫的实际形态是 `if (!target) return true`——它对每条 refs
   * 恒成立，等于对 refs 放弃了去重。
   *
   * 收敛方式：`projectFactRefs` 一并产出 `target: { objectUid }`，使 refs 与
   * relations 走同一形状；字段随之改为必填，「没有目标」不再是合法状态。
   */
  target: FactCardAssociationTarget;
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

  available: boolean;
}

export interface UrlItem {
  ref: string;
  title?: string;
  summary?: string;
}

/**
 * 子目标「名下的工作」一行（28 §8.1 反查派生，不落盘）。
 *
 */
export interface ServingWorkItem {
  object_uid?: string;
  type: string;
  id: string;
  title: string;
  status: string;
  /** 目标所属项目——联邦视图里它与卡片所在项目可能不同，统一关联行据此判可否打开。 */
  governed_project_id?: string;
  href?: string;
}

export interface ObjectStatusOption {
  status: string;
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

export interface ObjectDetail<TData extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean;
  action: string;
  target: string;
  summary: { id: string; type: string; status?: string; read_status?: FactReadStatus };
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


/** 认知中心待决类型（v5）：Friction `open` 待修（Human 2026-10-19 决定：只收 open；
 * 2026-10 修订后 26 §9 闭集为 open/resolved/voided/accepted，但待决只收 open——
 * accepted 是已接受、不再报告，不进待决；resolved/voided 亦不进）。
 * **`pitfall_confirmation` 已移除**（2026-11-03）：Pitfall 取消 `draft` 待确认态后
 * 不再有「待确认的经验」这一档（23 §9），机械通道产出即 `active`。 */
export type CognitionInboxKind = 'friction_repair';

/** 决定依据区内联投影（Q3）：source-bound 字段子集，
 * 不含对象身份字段（id/title/status 等在条目层）。
 */
export interface CognitionInboxCard extends Record<string, unknown> {
  summary?: string
  serves?: string
  scope?: string
  change_log?: unknown[]
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
  /**
   * 26 §8 Friction 的 `occurrence`：**平铺在条目根上**，与列表卡给
   * `ObjectCardFrame` 的输入同形（卡头徽标读对象根，不翻 card）。服务端显式投影，
   * 见 `cognition.ts` 的 `projectFrictionOccurrence`。
   */
  occurrence?: Record<string, unknown>;
}

export interface CognitionFrictionInboxItem extends CognitionInboxItemBase {
  type: 'friction';
  status: 'open';
  inboxKind: 'friction_repair';
}

export type CognitionInboxItem = CognitionFrictionInboxItem;

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
  /** 26 §8 `occurrence`（重复观察次数 = **频次的机械权威源**），条件出现——
   * 摩擦的近期动态行显示它（Human 2026-11 的「聚焦里依然没有重中轻的标签」
   * 在同一处暴露了 occurrence 的同类缺口：字段在事实源与列表投影里都有、
   * 却不进聚焦页。同处显示的 impact 评级已于 2026-11-02 撤销。）
   *
   * 条件出现而非必填：§8 对「闭集收缩改判而来的 `voided`」有必填豁免（§14.2）。
   * 形状依 §8：`{ count, first_at, last_at }`（`human_return_at` 已随
   * 「放回留观」流转删除）。 */
  occurrence?: {
    count?: number;
    first_at?: string;
    last_at?: string;
  };
  status?: string;
  /**
   * 建前审核轴（21 §8 `pre_reviews`）的派生判据：draft 期是否已有 pass 结论。
   * 近期动态行与列表卡、聚焦收件箱卡**必须同形**——状态词后缀不能只在一处出现
   * （2026-10-17 Human 指出「聚焦栏的 card 表现要同步」）。
   */
  pre_audit_passed?: boolean;
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
  /** 当前全部待处理 Spark，供界面按未更新时间筛选；不含已收敛项。 */
  openItems: CognitionSparkHealthItem[];
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
  /** 26 §12 dogfood 度量消费点（2026-10 新增 accepted）：已接受成本单列计数。
   * 不进 inbox（accepted 不是待决定事项），也不进解决率分母（26 §12）。 */
  frictionLedger?: { acceptedCount: number };
  issues?: CognitionIssue[];
}

export async function fetchCognition(locale?: string, window: CognitionRecentActivityWindow = '1d'): Promise<CognitionData> {
  const search = new URLSearchParams({ window });
  if (locale) search.set('locale', locale);
  const params = `?${search.toString()}`;
  return request<CognitionData>(`/cognition${params}`);
}

/** Goal(单例冻结锚) 的 Web 投影读取 —— 对应 GET /api/cognition/goal（specs/25 直读消费点）。
 *  承载 goal.md 原文投影：窄字段（statement/sub_goals）+ 详情阅读面
 *  （created_at/change_log 修订史 + 读取层元数据，同多例类型 exact-read 形态）。 */
export interface CognitionGoalData {
  ok: boolean;
  goal?: {
    goal_key: string;
    title: string;
    status: string;
    statement: string;
    sub_goals: {
      id: string;
      text: string;
      /** SubGoal status (28 §9). Absent on rows recovered from the legacy section. */
      status?: string;
      /** SubGoal criterion_kind (28 §10.2). Absent on legacy rows. */
      criterion_kind?: string;
      /** SubGoal object_uid — the stable identity for drill-down. Since 2026-11-01
       *  `id` carries this same uid on object rows (28 §7 废止 SG-n 业务编号). */
      object_uid?: string;
      /** SubGoal `order` (28 §8): optional display order; absent sorts last. */
      order?: number;
      /** SubGoal `created_at`: the tiebreak when `order` is absent or equal. */
      created_at?: string;
      /** 名下工作行（`serves` 反查，28 §8.1 的派生）。聚焦页每条子目标的火花
       *  落实比值就取它——与子目标列表卡、详情面同一次反查、同一套口径。 */
      serving_work?: ServingWorkItem[];
      /** 反查时读不到的类型；「读不到」不得并入空集（00 §4.6）。 */
      serving_unreadable?: string[];
      /** True when the row still comes from the migrated-away `## 子目标` section. */
      legacy?: boolean;
    }[];
    created_at?: string;
    change_log?: unknown;
    canonical_path?: string;
    // frontmatter 逐字原文：与多例类型的 yaml_source 同形，详情阅读面用它直显
    // goal.md 原文（缺失时前端才回退 reconstructFactYaml 重建兜底）。
    yaml_source?: string;
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

// ============================================================
// 运行时诊断（/api/diagnostics）：只读聚合「写入关卡」与「闲时辅助」的运行实况。
// 两条数据来源不同——gate 来自宿主会话日志，idle 来自 ~/.dsh/ldvh 下插件自己的账。
// ============================================================

export interface DiagnosticsScope {
  workspaceRoot?: string;
  sessionDir?: string;
  sessionDirExists?: boolean;
  sessionsScanned?: number;
  zstdAvailable?: boolean;
  ldvhHome?: string;
  queueFileExists?: boolean;
  runsFileExists?: boolean;
  limits?: string[];
}

export interface GateToolRow {
  tool: string;
  calls: number;
  completed: number;
  failed: number;
}

export interface GateFailureRow {
  tool: string;
  status: string;
  codes?: string[];
  detail?: string;
  sessionId?: string;
  at?: string | null;
}

export interface GateReport {
  ok: boolean;
  generatedAt: string;
  scope: DiagnosticsScope;
  totals: { calls: number; completed: number; failed: number };
  byTool: GateToolRow[];
  byCategory: { category: string; count: number }[];
  byCode: { code: string; count: number }[];
  recentFailures: GateFailureRow[];
}

export interface IdleQueueEntry {
  at?: string | null;
  task?: string | null;
  category?: string;
  reason?: string;
}

/** 已核查（结案）的一条登记：`note` 是核查产物，null 表示这条没有留下说明。 */
export interface IdleSettledEntry {
  resolved_at?: string | null;
  task?: string | null;
  note?: string | null;
}

export interface IdleRunRow {
  at?: string | null;
  stage?: string;
  code?: string | null;
  action?: string | null;
  task?: string | null;
  /** 「为什么 stopped」的当场说明（2026-11-03 起有生产者）。 */
  note?: string | null;
  /** 与队列的共同键；null = 按分流不入队（不是「没有失败」）。 */
  pending_entry_id?: string | null;
}

export interface IdleReport {
  ok: boolean;
  generatedAt: string;
  scope: DiagnosticsScope;
  queue: {
    total: number;
    unresolved: number;
    /** 已核查条数——结案通道被使用过的次数。 */
    settled: number;
    over24h: number;
    byCategory: { category: string; count: number }[];
    recent: IdleQueueEntry[];
    settledRecent: IdleSettledEntry[];
  };
  runs: {
    total: number;
    byStage: { stage: string; count: number }[];
    recent: IdleRunRow[];
  };
}

export async function fetchGateReport(): Promise<GateReport> {
  return request<GateReport>('/diagnostics/gate');
}

export async function fetchIdleReport(): Promise<IdleReport> {
  return request<IdleReport>('/diagnostics/idle');
}

/**
 * 摩擦观察缓冲（11 §12bis.1）的只读投影。
 *
 * **字段面即规范面**：11 §12bis.1 第 2 条只允许呈现现象/时间/来源/状态四项，
 * 不得呈现 `evidence` 全文、不得使其可点击进入事实对象（它没有对象身份）。
 * 故本类型**刻意不含** `evidence`/`session`/`promoted_to`——不是遗漏。
 */
export interface ObservationRow {
  at: string | null;
  /** 「来源」：材料位置（anchor），不是会话 id。 */
  anchor: string | null;
  phenomenon: string | null;
  status: string | null;
  /** 观察组：只为看出「同一阻碍被看过几次」，不是对象标识。 */
  group: string | null;
}

export interface ObservationGroupRow {
  group: string;
  pendingCount: number;
  promotionReady: boolean;
  firstAt: string | null;
  lastAt: string | null;
  latestPhenomenon: string | null;
}

export interface FrictionObservationReport {
  ok: boolean;
  generatedAt: string;
  scope: {
    ldvhHome: string;
    bufferDir: string;
    bufferDirExists: boolean;
    files: string[];
    threshold: number;
    limits: string[];
  };
  totals: {
    entries: number;
    byStatus: { status: string; count: number }[];
    projects: number;
  };
  groups: ObservationGroupRow[];
  recent: ObservationRow[];
}

/** 经验留观区条目投影（只四项 —— 11 §12bis 读取纪律第 2 条）。 */
export interface ExperienceBufferRow {
  at: string | null;
  anchor: string | null;
  phenomenon: string | null;
  status: string | null;
}

/**
 * 经验留观缓冲报告（11 §12bis）。
 *
 * **类型上就没有 `evidence`/`candidate_question`/`id`/`consumed_by`** —— 这不是遗漏，
 * 是规范红线：前两者属「内容」与「判断输入」，后两者属对象身份与去向，都不在
 * Human 查阅面的允许范围。把它们写进类型就等于给未来的误用开了口子。
 */
export interface ExperienceBufferReport {
  ok: boolean;
  generatedAt: string;
  scope: {
    ldvhHome: string;
    bufferDir: string;
    bufferDirExists: boolean;
    files: string[];
    limits: string[];
  };
  totals: {
    entries: number;
    byStatus: { status: string; count: number }[];
    projects: number;
  };
  /** 未审核条目数——「还有多少材料等着被审」。 */
  pendingCount: number;
  /** 最旧一条 pending 的时刻。 */
  oldestPendingAt: string | null;
  recent: ExperienceBufferRow[];
}

export async function fetchExperienceBufferReport(): Promise<ExperienceBufferReport> {
  return request<ExperienceBufferReport>('/diagnostics/experience-observations');
}

export async function fetchFrictionObservationReport(): Promise<FrictionObservationReport> {
  return request<FrictionObservationReport>('/diagnostics/observations');
}

/** 可清理的日志目标（与后端 `LOGGABLE_TARGETS` 对应）。 */
export interface LogTargetPreview {
  id: string;
  label: string;
  note: string;
  exists: boolean;
  removing: number;
  keeping: number;
  unparsable: number;
  bytes: number;
}

export interface CleanupPlan {
  ok: boolean;
  cutoff: string;
  retentionDays: number;
  targets: LogTargetPreview[];
  backupDir: string | null;
  applied?: { id: string; removed: number; kept: number; error?: string }[];
  backupPath?: string | null;
}

export async function fetchCleanupPreview(days: number, targets: string[]): Promise<CleanupPlan> {
  const qs = new URLSearchParams({ days: String(days), targets: targets.join(',') });
  return request<CleanupPlan>(`/diagnostics/logs/preview?${qs.toString()}`);
}

export async function runCleanup(days: number, targets: string[]): Promise<CleanupPlan> {
  return request<CleanupPlan>('/diagnostics/logs/clean', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days, targets }),
  });
}
