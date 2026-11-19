import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

export type FactCarrier = 'yaml' | 'markdown' | 'directory';
export type FactReadStatus = 'readable' | 'unreadable';

export type FactReadIssue = {
  category: string;
  fieldPath: string | null;
  summary: string;
};

export type FactReadMeta = {
  canonicalPath?: string;
  carrier?: FactCarrier;
  readStatus?: FactReadStatus;
  issues: FactReadIssue[];
  isFailure: boolean;
};

const EXACT_READ_METADATA_FIELDS = new Set([
  'fact_read_failure',
  'object_ref',
  'canonical_path',
  'absolute_path',
  'carrier',
  'read_status',
  'field_issues',
  'unparsed_structures',
  'content_fingerprint',
  'coverage_status',
  'observed_at',
  'read_issues',
  'report_body',
  'yaml_source',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asCarrier(value: unknown): FactCarrier | undefined {
  return value === 'yaml' || value === 'markdown' || value === 'directory' ? value : undefined;
}

function asReadStatus(value: unknown): FactReadStatus | undefined {
  return value === 'readable' || value === 'unreadable' ? value : undefined;
}

function asIssues(value: unknown): FactReadIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .flatMap((issue) => {
      if (typeof issue.category === 'string' && typeof issue.summary === 'string') {
        return [{
          category: issue.category,
          fieldPath: typeof issue.field_path === 'string' ? issue.field_path : null,
          summary: issue.summary,
        }];
      }
      if (typeof issue.code === 'string' && typeof issue.message === 'string') {
        return [{
          category: issue.code,
          fieldPath: typeof issue.path === 'string' ? issue.path : null,
          summary: issue.message,
        }];
      }
      return [];
    });
}

export function getFactReadMeta(value: Record<string, unknown> | undefined): FactReadMeta {
  const readStatus = asReadStatus(value?.read_status);
  return {
    canonicalPath: typeof value?.canonical_path === 'string' && value.canonical_path.length > 0
      ? value.canonical_path
      : undefined,
    carrier: asCarrier(value?.carrier),
    readStatus,
    issues: asIssues(value?.read_issues),
    isFailure: value?.fact_read_failure === true,
  };
}

export function isReadableFact(meta: FactReadMeta): meta is FactReadMeta & {
  canonicalPath: string;
  carrier: FactCarrier;
  readStatus: 'readable';
} {
  return !meta.isFailure
    && meta.readStatus === 'readable'
    && typeof meta.canonicalPath === 'string'
    && meta.carrier !== undefined;
}

export function projectFactObjectFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !EXACT_READ_METADATA_FIELDS.has(field)),
  );
}

export function reconstructFactYaml(value: Record<string, unknown>): string {
  return dumpYaml(projectFactObjectFields(value), {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
}

const RESEARCH_FRONTMATTER_DISPLAY_ORDER = [
  'title', 'status',
  'research_question', 'research_purpose', 'stopping_reason',
  'confirmed_statements', 'uncertain', 'gaps', 'clarification_log', 'implications',
  'retirement_reason', 'retired_at',
  'urls', 'relations',
  'object_uid', 'fact_type_key', 'created_at',
  'change_log',
];

export function sortedResearchFrontmatterYaml(rawSource: unknown): string | undefined {
  if (typeof rawSource !== 'string' || rawSource.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = loadYaml(rawSource);
  } catch {
    return rawSource;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return rawSource;
  const source = parsed as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of RESEARCH_FRONTMATTER_DISPLAY_ORDER) {
    if (key in source) ordered[key] = source[key];
  }
  for (const key of Object.keys(source)) {
    if (!(key in ordered)) ordered[key] = source[key];
  }
  return dumpYaml(ordered, { noRefs: true, lineWidth: -1, sortKeys: false });
}
