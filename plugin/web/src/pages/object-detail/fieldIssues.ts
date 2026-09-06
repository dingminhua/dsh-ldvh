/**
 * Shared field-level presentation issues (08 §5.3/§7.1).
 *
 * The field-level reader emits top-level field issues; every fact reading
 * layout marks them in place inside the node that consumes the field.
 */
export type FieldPresentationIssue = {
  path: string;
  reason: 'missing' | 'type_mismatch' | 'identity_mismatch';
  expected: string;
  raw_value?: unknown;
};

export function fieldIssue(
  obj: Record<string, unknown>,
  field: string,
): FieldPresentationIssue | undefined {
  const issues = obj.field_issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.find((issue): issue is FieldPresentationIssue => Boolean(
    issue && typeof issue === 'object' && !Array.isArray(issue)
      && (issue as Record<string, unknown>).path === field
      && typeof (issue as Record<string, unknown>).reason === 'string'
      && typeof (issue as Record<string, unknown>).expected === 'string',
  ));
}
