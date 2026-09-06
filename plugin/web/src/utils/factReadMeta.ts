import { dump as dumpYaml } from 'js-yaml';

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

/** Source metadata is accepted only from an exact fact-detail payload, never from a route target or object ID. */
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

/** Strip the exact-read envelope before rendering reconstructed carrier data. */
export function projectFactObjectFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !EXACT_READ_METADATA_FIELDS.has(field)),
  );
}

/** Reconstruct readable YAML data without changing scalar types or exposing the exact-read envelope. */
export function reconstructFactYaml(value: Record<string, unknown>): string {
  return dumpYaml(projectFactObjectFields(value), {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
}
