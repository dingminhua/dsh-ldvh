import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchProjectFilesProjects, setCurrentProjectScope, type GovernedProject, type ProjectWorktree } from '@/utils/api';

const PROJECT_STORAGE_KEY = 'ldvh-active-project-id';
const WORKTREE_STORAGE_KEY = 'ldvh-active-worktree-path';

type ProjectScopeContextValue = {
  projects: GovernedProject[];
  selectedProjectId: string;
  selectedProject: GovernedProject | null;
  selectedWorktreePath: string;
  selectedWorktree: ProjectWorktree | null;
  loading: boolean;
  error: string | null;
  selectProject: (projectId: string, worktreePath?: string) => void;
  /** Internal post-save synchronization; not exposed as a UI refresh action. */
  reloadProjects: () => void;
};

const ProjectScopeContext = createContext<ProjectScopeContextValue | null>(null);

function readStoredProjectId(): string {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function readStoredWorktreePath(): string {
  try { return localStorage.getItem(WORKTREE_STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function ProjectScopeProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<GovernedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(readStoredProjectId);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState(readStoredWorktreePath);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProjectFilesProjects()
      .then((result) => {
        if (cancelled) return;
        const nextProjects = result.projects ?? [];
        setProjects(nextProjects);
        setSelectedProjectId((current) => {
          const nextProjectId = current && nextProjects.some((project) => project.id === current)
            ? current
            : (nextProjects.some((project) => project.id === result.defaultProjectId) ? result.defaultProjectId : (nextProjects[0]?.id ?? ''));
          const nextProject = nextProjects.find((project) => project.id === nextProjectId);
          setSelectedWorktreePath((currentPath) => (
            currentPath && nextProject?.worktrees.some((worktree) => worktree.path === currentPath)
              ? currentPath
              : (nextProject?.path ?? '')
          ));
          return nextProjectId;
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setProjects([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const selectProject = useCallback((projectId: string, worktreePath?: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    const nextWorktreePath = worktreePath && project?.worktrees.some((worktree) => worktree.path === worktreePath)
      ? worktreePath
      : (project?.path ?? '');
    setSelectedProjectId(projectId);
    setSelectedWorktreePath(nextWorktreePath);
    try {
      if (projectId) localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
      else localStorage.removeItem(PROJECT_STORAGE_KEY);
      if (nextWorktreePath) localStorage.setItem(WORKTREE_STORAGE_KEY, nextWorktreePath);
      else localStorage.removeItem(WORKTREE_STORAGE_KEY);
    } catch {
      // The in-memory selection remains usable when storage is unavailable.
    }
  }, [projects]);

  const reloadProjects = useCallback(() => setReloadKey((current) => current + 1), []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedWorktree = useMemo(
    () => selectedProject?.worktrees.find((worktree) => worktree.path === selectedWorktreePath) ?? null,
    [selectedProject, selectedWorktreePath],
  );

  // Keep the api client's project id in sync with the selection, synchronously during
  // render so children's mount-time fetches already carry the correct id. Idempotent
  // external-store sync (not React state), safe under StrictMode double-render.
  setCurrentProjectScope(selectedProjectId, selectedWorktreePath);

  return (
    <ProjectScopeContext.Provider value={{
      projects,
      selectedProjectId,
      selectedProject,
      selectedWorktreePath,
      selectedWorktree,
      loading,
      error,
      selectProject,
      reloadProjects,
    }}>
      {children}
    </ProjectScopeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectScope() {
  const context = useContext(ProjectScopeContext);
  if (!context) throw new Error('useProjectScope must be used within ProjectScopeProvider');
  return context;
}
