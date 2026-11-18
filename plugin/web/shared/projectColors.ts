
export const PROJECT_COLOR_KEYS = [
  'emerald',
  'sky',
  'violet',
  'amber',
  'rose',
  'cyan',
  'indigo',
  'orange',
  'teal',
  'fuchsia',
] as const;

export type ProjectColorKey = (typeof PROJECT_COLOR_KEYS)[number];

export function isProjectColorKey(value: unknown): value is ProjectColorKey {
  return typeof value === 'string' && (PROJECT_COLOR_KEYS as readonly string[]).includes(value);
}

export function projectColorVar(key: ProjectColorKey): string {
  return `var(--ldvh-pj-${key})`;
}

export function hashProjectColorKey(projectId: string): ProjectColorKey {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_COLOR_KEYS[hash % PROJECT_COLOR_KEYS.length];
}

export function resolvedProjectColorKey(color: string | undefined, projectId: string): ProjectColorKey {
  return isProjectColorKey(color) ? color : hashProjectColorKey(projectId);
}
