/** Exact machine locator copied for AI routing and object lookup. */
export function formatObjectReference(
  projectId: string | undefined,
  objectId: string | undefined,
): string | undefined {
  if (!projectId || !objectId) return undefined;
  return `${projectId}@${objectId}`;
}
