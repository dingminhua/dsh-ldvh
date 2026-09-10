export const META_KEYS = [
  'id',
  'object_uid',
  'object_id',
  'type',
  'fact_type_key',
  'status',
  'created',
  'created_at',
  'updated',
  // 03 §6.1：不保留公共 updated_at，变更时间由 change_log 条目的 at 承担。
  'title',
  'title_en',
  'title_zh',
  'path',
  'object_ref',
  'canonical_path',
  'absolute_path',
  'carrier',
  'content_fingerprint',
  'coverage_status',
  'read_status',
  'field_issues',
  'unparsed_structures',
  'observed_at',
  'read_issues',
  'fact_read_failure',
  'factAssociations',
];

export const COMMON_AUXILIARY_META_KEYS = ['priority'];
export const AUXILIARY_META_KEYS_BY_TYPE: Record<string, string[]> = {
  // 20 §8：serves_sg（SG-n 轻量锚点）在元信息行呈现；priority 已随 v5 移除。
  spark: ['serves_sg'],
  pitfall: [],
};

const FIELD_ORDER_BY_TYPE: Record<string, string[]> = {
  workcase: [
    'goal', 'scope', 'phase', 'summary', 'resume_from', 'waiting_on', 'blocking_summary', 'change_log',
    'success_criterion_definitions', 'success_criterion_results', 'plan_version', 'work_items',
    'creation_reviews', 'execution_approval', 'result_version', 'result_summary',
    'controller_check_summary', 'result_reviews', 'validation_summary', 'closure_proposal',
    'closure_outcome', 'disposition_summary', 'residual_responsibilities', 'urls', 'relations',
  ],
  // v5 ADR（22 号规范）：阅读布局按字段契约序消费（decision → scope →
  // trigger_signal → 终态 retirement_reason/retired_at/relations），正文
  // report_body 由布局按 H2 五段（决策背景/决定/备选与理由/后果/适用范围
  // +条件证据）分节呈现——此处只做 ContentField 兜底排序。
  adr: [
    'decision', 'scope', 'trigger_signal', 'report_body',
    'retirement_reason', 'retired_at', 'change_log', 'urls', 'relations',
  ],
  // v5 Pitfall（23 号规范）：阅读布局按字段契约序消费（scope →
  // trigger_signal → 终态 disposition），正文 report_body 由布局按 H2 七段
  // （症状/触发条件/根因/解决/规避/验证/影响与适用范围+条件证据）分节呈现
  // ——此处只做 ContentField 兜底排序。
  pitfall: [
    'scope', 'trigger_signal', 'report_body',
    'disposition', 'change_log', 'urls',
  ],
  // v5 Friction（26 号规范）：阅读布局按字段契约序消费（phenomenon →
  // attribution → impact → serves_sg → 终态 relations），正文 report_body 由
  // 布局按 H2 三段（现象/入账依据+条件处置）分节呈现——此处只做 ContentField
  // 兜底排序。
  friction: [
    'phenomenon', 'attribution', 'impact', 'serves_sg', 'report_body',
    'change_log', 'relations',
  ],
  // v5 Spark（20 号规范）：阅读布局按字段契约序消费（question → scope_boundary
  // → intent → summary → 演变 → 终态 disposition），正文 report_body 由布局按
  // H2 分节呈现——此处只做 ContentField 兜底排序。
  spark: [
    'question', 'scope_boundary', 'intent', 'summary', 'evolution', 'report_body',
    'change_log', 'relations', 'disposition',
  ],
  // v5 Research（24 号薄索引）：正文 report_body 由阅读布局按 H2 分节呈现，
  // 其余为 frontmatter 概览/三态/启发字段的兜底排序。
  research: [
    'research_question', 'research_purpose', 'stopping_reason',
    'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',
    'report_body', 'change_log', 'urls', 'disposition_summary',
  ],
};

export type RelatedContentEntry = [string, unknown[]];

/** Current governed project identity from the read metadata, shared by association readers. */
export function getCurrentProjectId(obj: Record<string, unknown>): string | undefined {
  const ref = obj.object_ref;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return undefined;
  const projectId = (ref as Record<string, unknown>).governed_project_id;
  return typeof projectId === 'string' ? projectId : undefined;
}

function isRelatedContentField(fieldKey: string) {
  return fieldKey === 'urls';
}

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

export function sortRelatedContentEntries(entries: RelatedContentEntry[]) {
  return [...entries].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

export function splitRelatedContentEntries(entries: Array<[string, unknown]>) {
  const primaryEntries: Array<[string, unknown]> = [];
  const relatedEntries: RelatedContentEntry[] = [];

  entries.forEach((entry) => {
    if (isRelatedContentField(entry[0])) {
      if (Array.isArray(entry[1]) && hasContent(entry[1])) {
        relatedEntries.push([entry[0], entry[1]]);
      }
    } else {
      primaryEntries.push(entry);
    }
  });

  return {
    primaryEntries,
    relatedEntries: sortRelatedContentEntries(relatedEntries),
  };
}

export function getObjectDetailContentEntries(obj: Record<string, unknown>, objType: string) {
  const auxiliaryMetaKeys = Array.from(new Set([...(AUXILIARY_META_KEYS_BY_TYPE[objType] || []), ...COMMON_AUXILIARY_META_KEYS]));
  const contentEntries = Object.entries(obj).filter(
    ([key]) => !META_KEYS.includes(key) && !auxiliaryMetaKeys.includes(key),
  );

  const fieldOrder = FIELD_ORDER_BY_TYPE[objType] || [];
  if (fieldOrder.length > 0) {
    contentEntries.sort((a, b) => {
      const aIdx = fieldOrder.indexOf(a[0]);
      const bIdx = fieldOrder.indexOf(b[0]);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    });
  }

  return contentEntries;
}
