/** Fields whose string content is Markdown-capable Narrative / Decision / Log. */
export const SUMMARY_TEXT_FIELDS = [
  'description', 'source', 'context', 'consequences', 'success_criteria', 'constraints',
  'rationale', 'observation', 'analysis', 'mitigation', 'resolution', 'decision',
  'symptoms', 'trigger_conditions', 'root_cause', 'avoidance', 'applicability',
  'governance_scope', 'notes',
  'user_intent', 'conclusion', 'report_body',
  'reason',
  'scope', 'impact', 'summary', 'details', 'outcome', 'next_steps',
  'lessons', 'background', 'motivation',
];

/** Markdown fields that should switch to ChecklistCard when the value is a GFM task list. */
export const CHECKLIST_COMPAT_FIELDS = [
  'success_criteria', 'constraints', 'verification',
  'trigger_conditions', 'avoidance', 'next_steps',
];

/** Evidence fields use the EvidenceBlock renderer. */
export const EVIDENCE_FIELDS = ['verification', 'evidence'];

/** Object ID reference fields render through ReferenceCard when values look like LDVH object IDs. */
export const REFERENCE_FIELDS: string[] = [];

/** Path / URL reference fields render through DocPreviewLink when values are previewable paths. */
export const DOC_LINK_FIELDS = ['urls'];

export const PATH_TEXT_FIELDS = ['project_path', 'ldvh_base_path', 'docs_path', 'rules_path', 'skills_path'];

/** Fields that can be folded in detail view. */
export const COLLAPSIBLE_FIELDS = ['urls'];

export function getPreviewableDocPath(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;

  const markdownPath = trimmed.match(/^((?:docs|specs|web\/docs|rules|skills|tools|web)\/.+?\.(?:md|mdx))(?:\s.*)?$/i);
  return markdownPath?.[1] || trimmed;
}

export function isPreviewableDocPath(value: string) {
  const docPath = getPreviewableDocPath(value);
  return docPath.startsWith('http://') || docPath.startsWith('https://') || /^(docs\/|specs\/|web\/docs\/|rules\/|skills\/|tools\/|web\/)/.test(docPath);
}

export function isAffectedDocPath(value: string) {
  return /\.(md|mdx)$/i.test(value) && /^(docs\/|specs\/|web\/docs\/)/.test(value);
}

export function isPreviewablePathForField(_fieldKey: string, value: string) {
  return isPreviewableDocPath(value);
}

export function hasChecklist(value: string) {
  return /^\s*- \[[ xX]\]/m.test(value);
}

export function isObjectRef(refId: string) {
  const match = refId.match(/^([a-z]+)-\d+$/);
  if (!match) return false;
  return ['workcase', 'adr', 'pitfall', 'spark', 'study'].includes(match[1]);
}
