import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Columns2,
  Diff,
  GitBranch,
  GitPullRequestArrow,
  Loader2,
  Rows3,
} from 'lucide-react';
import CopyPathButton from '@/components/CopyPathButton';
import PageHeader from '@/components/PageHeader';
import { useI18n } from '@/i18n/context';
import {
  getDiffLineClass,
  getSplitDiffCellClass,
  type DiffViewMode,
} from '@/pages/project-files/model';
import { useWorkspaceChanges } from '@/pages/changes/useWorkspaceChanges';
import { useProjectScope } from '@/utils/projectContext';
import {
  fetchProjectWorktreeGitStatus,
  type ProjectGitStatusEntry,
} from '@/utils/api';

const WIDE_DIFF_LAYOUT_QUERY = '(min-width: 1280px)';

function getDefaultDiffViewMode(): DiffViewMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'unified';
  return window.matchMedia(WIDE_DIFF_LAYOUT_QUERY).matches ? 'split' : 'unified';
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="ldvh-body-muted flex min-h-56 items-center justify-center rounded-md border border-dashed border-ldvh-border bg-ldvh-bg px-6 text-center">
      {text}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center gap-2 text-ldvh-text-secondary">
      <Loader2 size={16} className="animate-spin" />
      <span className="ldvh-body-muted">{text}</span>
    </div>
  );
}

export default function Changes() {
  const { locale, t } = useI18n();
  const {
    projects,
    selectedProject,
    selectedWorktreePath,
    loading: projectsLoading,
    error: projectsError,
  } = useProjectScope();
  const projectId = selectedProject?.id ?? '';
  const {
    entries,
    entriesLoading,
    entriesError,
    selectedEntry,
    diff,
    splitDiffRows,
    openDiff,
  } = useWorkspaceChanges(projectId);
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>(getDefaultDiffViewMode);
  const diffViewModeWasSelected = useRef(false);

  // 其他分支的 git status 数据
  const [otherWorktrees, setOtherWorktrees] = useState<{
    branch: string;
    path: string;
    entries: ProjectGitStatusEntry[];
    loading: boolean;
    error: string | null;
  }[]>([]);
  const [otherWorktreesLoading, setOtherWorktreesLoading] = useState(false);
  const [expandedWorktree, setExpandedWorktree] = useState<string | null>(null);

  useEffect(() => {
    const worktrees = selectedProject?.worktrees ?? [];
    const others = worktrees.filter((w) => w.path !== selectedWorktreePath);
    if (others.length === 0) {
      setOtherWorktrees([]);
      return;
    }

    setOtherWorktreesLoading(true);
    setOtherWorktrees(
      others.map((w) => ({
        branch: w.branch ?? 'detached',
        path: w.path,
        entries: [],
        loading: true,
        error: null,
      })),
    );

    Promise.allSettled(
      others.map(async (w) => {
        const result = await fetchProjectWorktreeGitStatus(projectId, w.path);
        return { path: w.path, entries: result.entries ?? [] };
      }),
    ).then((results) => {
      setOtherWorktrees(
        others.map((w, i) => {
          const r = results[i];
          return {
            branch: w.branch ?? 'detached',
            path: w.path,
            entries: r.status === 'fulfilled' ? r.value.entries : [],
            loading: false,
            error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null,
          };
        }),
      );
      setOtherWorktreesLoading(false);
    });
  }, [projectId, selectedWorktreePath, selectedProject]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(WIDE_DIFF_LAYOUT_QUERY);
    const syncDefaultDiffViewMode = () => {
      if (!diffViewModeWasSelected.current) {
        setDiffViewMode(mediaQuery.matches ? 'split' : 'unified');
      }
    };

    syncDefaultDiffViewMode();
    mediaQuery.addEventListener('change', syncDefaultDiffViewMode);
    return () => mediaQuery.removeEventListener('change', syncDefaultDiffViewMode);
  }, []);

  const selectDiffViewMode = (mode: DiffViewMode) => {
    diffViewModeWasSelected.current = true;
    setDiffViewMode(mode);
  };

  if (projectsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={22} className="animate-spin text-ldvh-accent" />
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="ldvh-body-muted">{projectsError}</p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="ldvh-page-frame">
        <PageHeader title={t('changes.title')} subtitle={t('changes.subtitle')} />
        <EmptyState text={t('changes.noProjects')} />
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="ldvh-page-frame">
        <PageHeader title={t('changes.title')} subtitle={t('changes.subtitle')} />
        <EmptyState text={t('changes.noProject')} />
      </div>
    );
  }

  return (
    <div className="ldvh-page-frame flex min-h-full min-w-0 flex-col overflow-x-hidden xl:h-full">
      <div className="ldvh-page-toolbar mb-4 min-w-0 shrink-0">
        <PageHeader title={t('changes.title')} subtitle={t('changes.subtitle')} compact />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="ldvh-page-toolbar-badge">{t('changes.readOnly')}</span>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-ldvh-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <GitPullRequestArrow size={16} className="shrink-0 text-ldvh-accent" />
              <h2 className="ldvh-section-title">{t('changes.files')}</h2>
            </div>
            <span className="ldvh-meta-primary">{entries.length}</span>
          </div>
          <div className="min-w-0 overflow-y-auto p-3 xl:min-h-0 xl:flex-1">
            {!projectId ? (
              <EmptyState text={t('changes.noProject')} />
            ) : entriesLoading ? (
              <LoadingState text={t('changes.loading')} />
            ) : entriesError ? (
              <EmptyState text={entriesError} />
            ) : entries.length === 0 ? (
              <EmptyState text={t('changes.noChanges')} />
            ) : (
              <div className="space-y-1">
                {entries.map((entry) => {
                  const selected = selectedEntry?.projectId === entry.projectId
                    && selectedEntry.path === entry.path
                    && selectedEntry.status === entry.status;
                  return (
                    <div
                      key={`${entry.projectId}:${entry.status}:${entry.path}`}
                      className={`group relative flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-ldvh-border/30 ${
                        selected ? 'bg-ldvh-accent/10 text-ldvh-accent' : ''
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => openDiff(entry)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="ldvh-meta-primary w-8 shrink-0 rounded bg-ldvh-bg px-1.5 py-0.5 text-center">
                          {entry.status}
                        </span>
                        <span className="group/tooltip relative min-w-0">
                          <span className="ldvh-card-title block min-w-0 truncate">
                            {entry.path}
                          </span>
                          <span className="ldvh-caption pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden max-w-[calc(100vw-8rem)] break-all rounded-md border border-ldvh-border bg-ldvh-panel px-2 py-1 text-ldvh-text-primary shadow-lg shadow-black/10 group-hover/tooltip:block">
                            {entry.path}
                          </span>
                        </span>
                      </button>
                      <CopyPathButton path={entry.absolutePath} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* 其他分支 */}
            {otherWorktrees.length > 0 && (
              <div className="mt-3 min-w-0 border-t border-ldvh-border pt-3">
                <div className="flex min-w-0 items-center justify-between gap-3 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <GitBranch size={14} className="shrink-0 text-ldvh-accent" />
                    <h2 className="ldvh-section-title">{t('changes.otherBranches')}</h2>
                  </div>
                  {otherWorktreesLoading && <Loader2 size={14} className="animate-spin text-ldvh-text-secondary" />}
                </div>
                <div className="mt-2 min-w-0 space-y-1">
                  {otherWorktrees.map((wt) => {
                    const changeCount = wt.entries.length;
                    const isExpanded = expandedWorktree === wt.path;
                    return (
                      <div key={wt.path}>
                        <button
                          type="button"
                          onClick={() => setExpandedWorktree(isExpanded ? null : wt.path)}
                          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-ldvh-border/30"
                        >
                          {wt.error ? (
                            <AlertCircle size={14} className="shrink-0 text-red-400" />
                          ) : changeCount > 0 ? (
                            isExpanded ? <ChevronDown size={14} className="shrink-0 text-ldvh-accent" />
                              : <ChevronRight size={14} className="shrink-0 text-ldvh-accent" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 text-ldvh-text-secondary" />
                          )}
                          <span className="ldvh-card-title min-w-0 flex-1 truncate">{wt.branch}</span>
                          {wt.error ? (
                            <span className="ldvh-meta shrink-0 text-red-400">{wt.error}</span>
                          ) : changeCount > 0 ? (
                            <span className="ldvh-meta-primary shrink-0">{changeCount} {t('changes.otherBranchesChanges')}</span>
                          ) : (
                            <span className="ldvh-meta shrink-0">{t('changes.otherBranchesClean')}</span>
                          )}
                        </button>
                        {isExpanded && changeCount > 0 && !wt.error && (
                          <div className="ml-5 space-y-0.5 border-l border-ldvh-border pl-2">
                            {wt.entries.map((entry) => (
                              <div
                                key={`${entry.status}:${entry.path}`}
                                className="flex min-w-0 items-center gap-2 rounded px-2 py-1"
                              >
                                <span className="ldvh-meta w-7 shrink-0 rounded bg-ldvh-bg px-1 py-0.5 text-center text-xs">
                                  {entry.status}
                                </span>
                                <span className="group/tooltip relative min-w-0 flex-1">
                                  <span className="ldvh-meta block min-w-0 truncate text-xs">
                                    {entry.path}
                                  </span>
                                  <span className="ldvh-caption pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden max-w-[calc(100vw-8rem)] break-all rounded-md border border-ldvh-border bg-ldvh-panel px-2 py-1 text-ldvh-text-primary shadow-lg shadow-black/10 group-hover/tooltip:block">
                                    {entry.path}
                                  </span>
                                </span>
                                <CopyPathButton
                                  path={entry.absolutePath}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-ldvh-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Diff size={16} className="shrink-0 text-ldvh-accent" />
              <div className="min-w-0">
                <h2 className="ldvh-section-title">{t('changes.diff')}</h2>
                {selectedEntry && <p className="ldvh-meta truncate">{selectedEntry.path}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div
                role="group"
                aria-label={t('changes.diffMode')}
                className="grid grid-cols-2 rounded-md border border-ldvh-border bg-ldvh-bg p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={diffViewMode === 'unified'}
                  onClick={() => selectDiffViewMode('unified')}
                  className={`ldvh-chip inline-flex items-center justify-center gap-1 rounded px-2 py-1 transition-colors ${
                    diffViewMode === 'unified'
                      ? 'bg-ldvh-panel text-ldvh-accent'
                      : 'text-ldvh-text-secondary hover:text-ldvh-text-primary'
                  }`}
                >
                  <Rows3 size={13} />
                  {t('changes.unifiedDiff')}
                </button>
                <button
                  type="button"
                  aria-pressed={diffViewMode === 'split'}
                  onClick={() => selectDiffViewMode('split')}
                  className={`ldvh-chip inline-flex items-center justify-center gap-1 rounded px-2 py-1 transition-colors ${
                    diffViewMode === 'split'
                      ? 'bg-ldvh-panel text-ldvh-accent'
                      : 'text-ldvh-text-secondary hover:text-ldvh-text-primary'
                  }`}
                >
                  <Columns2 size={13} />
                  {t('changes.splitDiff')}
                </button>
              </div>
              <CopyPathButton path={diff.data?.absolutePath} />
            </div>
          </div>
          <div className="min-h-[36rem] min-w-0 p-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
            {!projectId ? (
              <EmptyState text={t('changes.noProject')} />
            ) : diff.loading ? (
              <LoadingState text={t('changes.loadingDiff')} />
            ) : diff.error ? (
              <EmptyState text={diff.error} />
            ) : !diff.data ? (
              <EmptyState text={t('changes.chooseFile')} />
            ) : diffViewMode === 'unified' ? (
              <pre className="ldvh-meta-primary h-full min-w-0 overflow-auto rounded-md bg-ldvh-bg p-4">
                {diff.data.diff.split('\n').map((line, index) => (
                  <span key={`${index}-${line.slice(0, 12)}`} className={`${getDiffLineClass(line)} block min-w-max whitespace-pre`}>
                    {line || ' '}
                  </span>
                ))}
              </pre>
            ) : (
              <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-ldvh-bg">
                <div className="min-w-0">
                  <div className="ldvh-meta sticky top-0 z-10 grid grid-cols-[4rem_minmax(0,1fr)_4rem_minmax(0,1fr)] border-b border-ldvh-border bg-ldvh-panel/95">
                    <div className="border-r border-ldvh-border px-2 py-2 text-right">-</div>
                    <div className="border-r border-ldvh-border px-3 py-2">{t('changes.before')}</div>
                    <div className="border-r border-ldvh-border px-2 py-2 text-right">+</div>
                    <div className="px-3 py-2">{t('changes.after')}</div>
                  </div>
                  <div className="ldvh-meta-primary">
                    {splitDiffRows.map((row, index) => {
                      if (row.kind !== 'line') {
                        return (
                          <div
                            key={`${row.kind}-${index}-${row.text.slice(0, 12)}`}
                            className={`whitespace-pre-wrap break-words border-b border-ldvh-border/40 px-3 py-1 ${
                              row.kind === 'hunk' ? 'bg-ldvh-accent/10 text-ldvh-accent' : 'text-sky-700 dark:text-sky-300'
                            }`}
                          >
                            {row.text || ' '}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={`line-${index}-${row.oldCell.lineNumber ?? 'x'}-${row.newCell.lineNumber ?? 'x'}`}
                          className="grid grid-cols-[4rem_minmax(0,1fr)_4rem_minmax(0,1fr)] border-b border-ldvh-border/20"
                        >
                          <div className="border-r border-ldvh-border/40 px-2 py-1 text-right text-ldvh-text-secondary">
                            {row.oldCell.lineNumber ?? ''}
                          </div>
                          <div className={`${getSplitDiffCellClass(row.oldCell)} border-r border-ldvh-border/40 px-3 py-1`}>
                            <span className="block whitespace-pre-wrap break-words">{row.oldCell.text ?? ' '}</span>
                          </div>
                          <div className="border-r border-ldvh-border/40 px-2 py-1 text-right text-ldvh-text-secondary">
                            {row.newCell.lineNumber ?? ''}
                          </div>
                          <div className={`${getSplitDiffCellClass(row.newCell)} px-3 py-1`}>
                            <span className="block whitespace-pre-wrap break-words">{row.newCell.text ?? ' '}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
