import type { FactCarrier, FactReadStatus } from '@/utils/factReadMeta';
const API_BASE = `${import.meta.env?.BASE_URL ?? '/'}api`;
const inFlightRequests = new Map<string, Promise<unknown>>();

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
  pre_audit_passed?: boolean;
  path: string;
  created?: string;
  updated: string;
  priority?: string;
  independentSubagentUnavailable?: boolean;
  decision?: string;
  trigger_signal?: string;
  retirement_reason?: string;
  retired_at?: string;
  phenomenon?: string;
  attribution?: string;
  occurrence?: {
    count?: number;
    first_at?: string;
    last_at?: string;
  };
  direction_key?: string;
  order?: number;
  parent_goal?: string;
  criterion?: string;
  criterion_kind?: string;
  alignment?: string;
  serving_work?: ServingWorkItem[];
  serving_empty?: boolean;
  serving_unreadable?: string[];
  evolution?: Array<Record<string, unknown>>;
  question?: string;
  scope_boundary?: string;
  intent?: string;
  serves?: string;
  disposition?: string;
  factAssociations?: FactCardAssociation[];
  factRefs?: FactCardAssociation[];
  factRefSources?: FactRefSource[];
  object_uid?: string;
  object_id?: string;
  fact_type_key?: string;
  canonical_path?: string;
  absolute_path?: string;
  carrier?: FactCarrier;
  read_status?: FactReadStatus;
  yaml_source?: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
  read_issues?: Array<Record<string, unknown>>;
  created_at?: string;
  updated_at?: string;
  change_log?: unknown;
  disposition_summary?: string;
  relations?: Array<Record<string, unknown>>;
  report_form?: 'research' | 'summary' | 'audit' | 'action' | 'reference';
  report_kind?: 'external_research' | 'internal_audit' | 'technical_assessment' | 'comparison';
  input_refs?: Array<Record<string, unknown>>;
  sourceBranch?: string;
  mainWorktreeDiffers?: boolean;
  research_intent?: string;
  research_question?: string;
  research_purpose?: string;
  stopping_reason?: string;
  abstract?: string;
  recommendation_summary?: string;
  summary?: string;
  conclusion?: string;
  urls?: Array<string | UrlItem>;
  report_body?: string;
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
    commit: string;
  };

export interface FactCardAssociation {
  relationKey?: string;
  target: FactCardAssociationTarget;
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

export interface ServingWorkItem {
  object_uid?: string;
  type: string;
  id: string;
  title: string;
  status: string;
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


export type CognitionInboxKind = 'friction_repair';

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
  canonical_path?: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
  read_issues?: Array<Record<string, unknown>>;
  occurrence?: Record<string, unknown>;
}

export interface CognitionFrictionInboxItem extends CognitionInboxItemBase {
  type: 'friction';
  status: 'open';
  inboxKind: 'friction_repair';
}

export type CognitionInboxItem = CognitionFrictionInboxItem;

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
  signature?: CommitSignature;
  activityCount: number;
  relativeTime: string;
  typeColor: string;
  priority?: string;
  serves?: string;
  occurrence?: {
    count?: number;
    first_at?: string;
    last_at?: string;
  };
  status?: string;
  pre_audit_passed?: boolean;
  read_status: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
}

export interface CognitionRecentActivityAttributionUsage {
  value: string;
  count: number;
}

export interface CognitionSparkHealthItem {
  type: 'spark';
  id: string;
  object_uid?: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  priority?: string;
  serves?: string;
  updatedAt: string;
  signature?: CommitSignature;
  activityCount: number;
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
    total: number;
    eventTotal: number;
    modelUsage: CognitionRecentActivityAttributionUsage[];
    environmentUsage: CognitionRecentActivityAttributionUsage[];
  };
  sparkHealth?: CognitionSparkHealth;
  frictionLedger?: { acceptedCount: number };
  issues?: CognitionIssue[];
}

export async function fetchCognition(locale?: string, window: CognitionRecentActivityWindow = '1d'): Promise<CognitionData> {
  const search = new URLSearchParams({ window });
  if (locale) search.set('locale', locale);
  const params = `?${search.toString()}`;
  return request<CognitionData>(`/cognition${params}`);
}

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
      status?: string;
      criterion_kind?: string;
      object_uid?: string;
      order?: number;
      created_at?: string;
      serving_work?: ServingWorkItem[];
      serving_unreadable?: string[];
      legacy?: boolean;
    }[];
    created_at?: string;
    change_log?: unknown;
    canonical_path?: string;
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
  form?: string,
  serves?: string,
): Promise<{
  ok: boolean;
  summary: { count: number; coverage_status?: FactCoverageStatus };
  data: {
    items: ObjectItem[];
    coverage_status?: FactCoverageStatus;
    observed_at?: string;
    collection_issues?: FactListProblem[];
    statusOptions?: ObjectStatusOption[];
    statusDisplayTotal?: number;
    formOptions?: ObjectStatusOption[];
    formTotal?: number;
    priorityOptions?: ObjectStatusOption[];
    priorityTotal?: number;
    servesOptions?: ObjectStatusOption[];
    servesTotal?: number;
    servesOrders?: Record<string, number>;
    statusTotal?: number;
  };
}> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (lifecycle) params.set('lifecycle', lifecycle);
  if (priority) params.set('priority', priority);
  if (form) params.set('form', form);
  if (serves) params.set('serves', serves);
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


export interface DiagnosticsScope {
  workspaceRoot?: string;
  sessionDir?: string;
  sessionDirExists?: boolean;
  sessionsScanned?: number;
  zstdAvailable?: boolean;
  ldvhHome?: string;
  runsFileExists?: boolean;
  limits?: string[];
  cachedAt?: string;
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
  byStatus: { status: string; count: number }[];
  byTool: GateToolRow[];
  byCategory: { category: string; count: number }[];
  byCode: { code: string; count: number }[];
  recentFailures: GateFailureRow[];
}

export interface IdleRunRow {
  at?: string | null;
  stage?: string;
  code?: string | null;
  action?: string | null;
  task?: string | null;
  note?: string | null;
  pending_entry_id?: string | null;
}

export interface QueueReport {
  ok: boolean;
  generatedAt: string;
  scope: DiagnosticsScope;
  runs: {
    total: number;
    byStage: { stage: string; count: number }[];
    recent: IdleRunRow[];
  };
}

export async function fetchGateReport(): Promise<GateReport> {
  return request<GateReport>('/diagnostics/gate');
}

export async function fetchQueueReport(): Promise<QueueReport> {
  return request<QueueReport>('/diagnostics/queue');
}

export interface ObservationRow {
  at: string | null;
  anchor: string | null;
  phenomenon: string | null;
  status: string | null;
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

export interface ExperienceBufferRow {
  at: string | null;
  anchor: string | null;
  phenomenon: string | null;
  status: string | null;
}


export async function fetchFrictionObservationReport(): Promise<FrictionObservationReport> {
  return request<FrictionObservationReport>('/diagnostics/observations');
}

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
