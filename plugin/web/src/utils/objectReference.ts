export function formatObjectReference(
  projectId: string | undefined,
  objectId: string | undefined,
): string | undefined {
  if (!projectId || !objectId) return undefined;
  return `${projectId}@${objectId}`;
}
