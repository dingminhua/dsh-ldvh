
export const PROJECT_URL_PARAM = 'ldvhProject';

export type ProjectSelectionInput = {
  urlProjectId: string;
  currentProjectId: string;
  defaultProjectId: string | null | undefined;
  registeredProjectIds: readonly string[];
};

export function resolveInitialProjectId(input: ProjectSelectionInput): string {
  const registered = new Set(input.registeredProjectIds);
  if (input.urlProjectId !== '' && registered.has(input.urlProjectId)) return input.urlProjectId;
  if (input.currentProjectId !== '' && registered.has(input.currentProjectId)) return input.currentProjectId;
  if (input.defaultProjectId && registered.has(input.defaultProjectId)) return input.defaultProjectId;
  return input.registeredProjectIds[0] ?? '';
}
