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
  'factRefs',
  'factRefSources',
  'refs',
];

export const COMMON_AUXILIARY_META_KEYS = ['priority'];
export const AUXILIARY_META_KEYS_BY_TYPE: Record<string, string[]> = {
  spark: [],
  pitfall: [],
  friction: [],
  subgoal: [],
};

const FIELD_ORDER_BY_TYPE: Record<string, string[]> = {

  pitfall: [
    'scope', 'trigger_signal', 'report_body',
    'disposition', 'change_log', 'urls',
  ],
  friction: [
    'phenomenon', 'attribution', 'occurrence', 'disposition', 'report_body',
    'change_log', 'relations',
  ],
  norm: [
    'direction_key', 'report_body',
    'retirement_reason', 'retired_at', 'change_log',
  ],
  subgoal: [
    'order', 'parent_goal', 'criterion', 'criterion_kind', 'alignment',
    'report_body', 'disposition', 'change_log',
  ],
  spark: [
    'question', 'scope_boundary', 'intent', 'summary', 'evolution', 'report_body',
    'change_log', 'relations', 'disposition',
  ],
  research: [
    'research_question', 'research_purpose', 'stopping_reason',
    'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',
    'report_body', 'change_log', 'urls', 'disposition_summary',
  ],
};

export type RelatedContentEntry = [string, unknown[]];

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
