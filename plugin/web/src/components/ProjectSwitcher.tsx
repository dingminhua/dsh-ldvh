import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderGit2, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { useProjectScope } from '@/utils/projectContext';

export default function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const { projects, selectedProject, selectedProjectId, selectedWorktree, selectedWorktreePath, loading, error, selectProject, reloadProjects } = useProjectScope();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerLabel = selectedProject?.name || t('projectSwitcher.choose');
  const triggerBranch = selectedWorktree?.branch || (selectedProject ? t('projectSwitcher.detached') : '');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative min-w-0 ${collapsed ? '' : 'flex-1'}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('projectSwitcher.label')}
        title={collapsed ? `${triggerLabel}${triggerBranch ? ` · ${triggerBranch}` : ''}` : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-w-0 items-center rounded-md border transition-colors ${
          open
            ? 'border-ldvh-accent/40 bg-ldvh-accent/10 text-ldvh-accent'
            : 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary hover:border-ldvh-accent/35 hover:text-ldvh-text-primary'
        } ${collapsed ? 'h-9 w-9 justify-center' : 'h-12 w-full gap-2 px-2.5 text-left'}`}
      >
        {collapsed ? (
          <FolderGit2 size={15} className="shrink-0" />
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-4">{triggerLabel}</span>
              {triggerBranch && <span className="ldvh-meta mt-0.5 flex items-center gap-1 truncate"><GitBranch size={11} className="shrink-0" />{triggerBranch}</span>}
            </span>
            <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('projectSwitcher.label')}
          className={`absolute z-[70] w-[22rem] overflow-hidden rounded-xl border border-ldvh-border bg-ldvh-panel shadow-xl shadow-black/20 ${
            collapsed ? 'left-full top-0 ml-2' : 'left-0 top-full mt-2'
          }`}
        >
          <div className="flex items-center gap-3 border-b border-ldvh-border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="ldvh-caption-strong">{t('projectSwitcher.label')}</p>
                {!loading && !error && projects.length > 0 && (
                  <span className="rounded-full border border-ldvh-text-secondary/20 bg-ldvh-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ldvh-text-secondary">
                    {t('projectSwitcher.projectCount', { count: String(projects.length) })}
                  </span>
                )}
              </div>
              <p className="ldvh-meta mt-0.5">{t('projectSwitcher.worktreeScopeHint')}</p>
            </div>
            <button
              type="button"
              aria-label={t('projectSwitcher.refresh')}
              title={t('projectSwitcher.refresh')}
              disabled={loading}
              onClick={() => reloadProjects()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ldvh-border text-ldvh-text-secondary transition-colors hover:border-ldvh-accent/35 hover:bg-ldvh-accent/5 hover:text-ldvh-accent disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-2.5">
            {loading ? (
              <div className="ldvh-body-muted flex items-center justify-center gap-2 px-3 py-6">
                <Loader2 size={14} className="animate-spin" />
                {t('projectSwitcher.loading')}
              </div>
            ) : error ? (
              <div className="px-3 py-4">
                <p className="ldvh-body-muted text-red-400">{t('projectSwitcher.loadFailed')}</p>
                <p className="ldvh-meta mt-1 break-words">{error}</p>
              </div>
            ) : projects.length === 0 ? (
              <p className="ldvh-body-muted px-3 py-6 text-center">{t('projectSwitcher.noProjects')}</p>
            ) : (
              <div className="grid gap-2.5">
              {projects.map((project) => {
                const worktrees = project.worktrees.length > 0
                  ? project.worktrees
                  : [{ path: project.path, isMain: true }];
                const projectSelected = project.id === selectedProjectId;
                return (
                  <section key={project.id} className="overflow-hidden rounded-lg border border-ldvh-text-secondary/25 bg-ldvh-panel shadow-sm shadow-black/[0.03]">
                    <div className={`flex min-w-0 items-center gap-2 border-b border-ldvh-border border-l-[3px] px-3 py-2.5 ${projectSelected ? 'border-l-ldvh-accent bg-ldvh-accent/[0.06]' : 'border-l-ldvh-text-secondary/50 bg-ldvh-text-secondary/[0.045]'}`}>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${projectSelected ? 'bg-ldvh-accent/15 text-ldvh-accent' : 'bg-ldvh-text-secondary/10 text-ldvh-text-secondary'}`}>
                        <FolderGit2 size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold leading-5 text-ldvh-text-primary">{project.name || project.id}</span>
                        <span className="ldvh-meta mt-0.5 block truncate">{project.id}</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-ldvh-text-secondary/20 bg-ldvh-panel/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ldvh-text-secondary">
                        {t('projectSwitcher.worktreeCount', { count: String(worktrees.length) })}
                      </span>
                    </div>
                    <div className="grid gap-1 bg-ldvh-bg/30 p-1.5">
                    {worktrees.map((worktree) => {
                      const selected = project.id === selectedProjectId && worktree.path === selectedWorktreePath;
                      const branch = worktree.branch || t('projectSwitcher.detached');
                      return (
                        <button
                          key={worktree.path}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          title={worktree.path}
                          onClick={() => {
                            selectProject(project.id, worktree.path);
                            setOpen(false);
                          }}
                          className={`group flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                            selected
                              ? 'border border-ldvh-accent/45 border-l-4 border-l-ldvh-accent bg-ldvh-accent/10 pl-2 text-ldvh-text-primary'
                              : 'border-transparent text-ldvh-text-primary hover:border-ldvh-border hover:bg-ldvh-panel'
                          }`}
                        >
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${selected ? 'bg-ldvh-accent text-white' : 'bg-ldvh-border/25 text-ldvh-text-secondary group-hover:text-ldvh-text-primary'}`}>
                            <GitBranch size={12} />
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold leading-5 text-ldvh-text-primary">
                            <span className="truncate">{branch}</span>
                            {worktree.isMain && <span className="shrink-0 rounded-full border border-ldvh-accent/25 bg-ldvh-panel px-1.5 py-0.5 text-[10px] font-medium leading-none text-ldvh-accent">{t('projectSwitcher.mainWorktree')}</span>}
                          </span>
                          {selected && <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ldvh-accent text-white"><Check size={10} strokeWidth={3} /></span>}
                        </button>
                      );
                    })}
                    </div>
                  </section>
                );
              })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
