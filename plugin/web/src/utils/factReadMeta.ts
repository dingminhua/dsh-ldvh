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
  // report_body 是 markdown 载体正文的读取层投影名（localFactReader 把正文塞进
  // 投影对象时起的名字），不是 frontmatter 字段——对象文件里它不存在。YAML 源
  // 视图只呈现机器索引层（frontmatter），正文由分节阅读布局与阅读面板承载；
  // 不排除会把整篇正文伪装成一个 YAML 字段并造成双重呈现。
  'report_body',
  // yaml_source 是文件中 YAML 部分的逐字原文（读取层透传），YAML 源视图直接
  // 直显它本身；仅当它缺席时 reconstruction 才兜底，且不得把它当事实字段重建。
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

/**
 * 24 §7 规范阅读序（展示层约定，Human 2026-09-09 定）：语义块在前（标题/状态/
 * 研究三要素/三态证据/澄清启发/退出语义），引用与身份居后，change_log 沉底。
 * 与 plugin/lib/research-writer.js 的 FRONTMATTER_FIELD_ORDER 同源同值。
 */
const RESEARCH_FRONTMATTER_DISPLAY_ORDER = [
  'title', 'status',
  'research_question', 'research_purpose', 'stopping_reason',
  'confirmed_statements', 'uncertain', 'gaps', 'clarification_log', 'implications',
  'retirement_reason', 'retired_at',
  'urls', 'relations',
  'object_uid', 'fact_type_key', 'created_at',
  'change_log',
];

/**
 * 展示时按 24 §7 规范阅读序重排 research frontmatter（Human 2026-09-09：
 * 不强制书写顺序，展示的时候排序）。内容保真：以 yaml_source 原文解析出的
 * 真实字段为界——不注入（如文件名推导的 object_id 不出现）、不过滤（未知
 * 字段按原序跟在阅读序之后，有什么显示什么），只重排键序。原文不可解析时
 * 原样返回（有问题看得见），不静默兜底。
 */
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
