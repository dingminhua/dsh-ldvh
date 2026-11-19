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
