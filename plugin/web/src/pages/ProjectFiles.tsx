import {
  AlertCircle,
  ChevronRight,
  Code2,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import CopyPathButton from '@/components/CopyPathButton';
import MarkdownPreview from '@/components/MarkdownPreview';
import PageHeader from '@/components/PageHeader';
import { useI18n } from '@/i18n/context';
import { getProjectFileKindLabel } from '@/i18n/locales';
import { type ProjectFileEntry } from '@/utils/api';
import { formatDateTime } from '@/utils/dateFormat';
import {
  formatBytes,
  getFileName,
  getSvgDataUrl,
  type ProjectFileEntryKind as EntryKind,
} from '@/pages/project-files/model';
import { useProjectFilesController } from '@/pages/project-files/useProjectFilesController';

function getKindLabel(kind: EntryKind, locale: string): string {
  return getProjectFileKindLabel(kind, locale);
}

function FileIcon({ entry }: { entry: ProjectFileEntry }) {
  if (entry.type === 'directory') return <Folder size={15} className="text-ldvh-accent" />;
  if (entry.kind === 'markdown') return <FileText size={15} className="text-ldvh-accent" />;
  if (entry.kind === 'yaml' || entry.kind === 'svg' || entry.kind === 'text') {
    return <FileCode2 size={15} className="text-ldvh-text-secondary" />;
  }
  return <Code2 size={15} className="text-ldvh-text-secondary" />;
}

function Breadcrumbs({
  dir,
  onNavigate,
}: {
  dir: string;
  onNavigate: (nextDir: string) => void;
}) {
  const parts = dir ? dir.split('/').filter(Boolean) : [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onNavigate('')}
        className="ldvh-caption-strong rounded px-1.5 py-0.5 text-ldvh-accent transition-colors hover:bg-ldvh-border/40"
      >
        /
      </button>
      {parts.map((part, index) => {
        const nextDir = parts.slice(0, index + 1).join('/');
        return (
          <span key={nextDir} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={12} className="text-ldvh-text-secondary" />
            <button
              type="button"
              onClick={() => onNavigate(nextDir)}
              className="ldvh-caption-strong max-w-40 truncate rounded px-1.5 py-0.5 text-ldvh-text-primary transition-colors hover:bg-ldvh-border/40"
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="ldvh-body-muted flex min-h-40 items-center justify-center rounded-md border border-dashed border-ldvh-border bg-ldvh-bg px-4 text-center">
      {text}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-ldvh-text-secondary">
      <Loader2 size={16} className="animate-spin" />
      <span className="ldvh-body-muted">{text}</span>
    </div>
  );
}

export default function ProjectFiles() {
  const { locale, t } = useI18n();
  const {
    projects,
    projectId,
    projectsLoading,
    projectsError,
    currentDir,
    entries,
    entriesLoading,
    entriesError,
    filePanel,
    showHiddenFiles,
    handleNavigateDir,
    handleOpenEntry,
    handleShowHiddenChange,
  } = useProjectFilesController();
  const copy = {
    title: t('projectFiles.title'),
    subtitle: t('projectFiles.subtitle'),
    showHiddenFiles: t('projectFiles.showHiddenFiles'),
    fileBrowser: t('projectFiles.fileBrowser'),
    preview: t('projectFiles.preview'),
    loading: t('projectFiles.loading'),
    noProjects: t('projectFiles.noProjects'),
    noEntries: t('projectFiles.noEntries'),
    chooseFile: t('projectFiles.chooseFile'),
    binary: t('projectFiles.binary'),
    truncated: t('projectFiles.truncated'),
    readOnly: t('projectFiles.readOnly'),
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
        <PageHeader title={copy.title} subtitle={copy.subtitle} />
        <EmptyState text={copy.noProjects} />
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="ldvh-page-frame">
        <PageHeader title={copy.title} subtitle={copy.subtitle} />
        <EmptyState text={t('projectFiles.chooseProjectGlobally')} />
      </div>
    );
  }

  return (
    <div className="ldvh-page-frame flex min-h-full min-w-0 flex-col overflow-x-hidden xl:h-full">
      <div className="ldvh-page-toolbar mb-4 min-w-0 shrink-0">
        <PageHeader title={copy.title} subtitle={copy.subtitle} compact />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="ldvh-page-toolbar-badge">{copy.readOnly}</span>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-ldvh-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen size={16} className="shrink-0 text-ldvh-accent" />
              <h2 className="ldvh-section-title shrink-0">{copy.fileBrowser}</h2>
            </div>
            <span className="ldvh-meta-primary shrink-0">{entries.length}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-ldvh-border px-4 py-3">
            <Breadcrumbs dir={currentDir} onNavigate={handleNavigateDir} />
            <label className="ldvh-chip inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-ldvh-border bg-ldvh-bg px-3 py-1.5 text-ldvh-text-secondary transition-colors hover:text-ldvh-text-primary">
              <input
                type="checkbox"
                checked={showHiddenFiles}
                onChange={(event) => handleShowHiddenChange(event.target.checked)}
                className="h-3.5 w-3.5 accent-ldvh-accent"
              />
              {copy.showHiddenFiles}
            </label>
          </div>
          <div className="min-w-0 overflow-y-auto p-3 xl:min-h-0 xl:flex-1">
            {entriesLoading ? (
              <LoadingState text={copy.loading} />
            ) : entriesError ? (
              <EmptyState text={entriesError} />
            ) : entries.length === 0 ? (
              <EmptyState text={copy.noEntries} />
            ) : (
              <div className="space-y-1">
                {entries.map((entry) => (
                  <div
                    key={entry.path || entry.name}
                    className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-ldvh-border/30 ${
                      filePanel.data?.path === entry.path ? 'bg-ldvh-accent/10 text-ldvh-accent' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenEntry(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <FileIcon entry={entry} />
                      <span className="min-w-0 flex-1">
                        <span className="ldvh-card-title block truncate transition-colors group-hover:text-ldvh-accent">
                          {entry.name}
                        </span>
                        <span className="ldvh-meta block truncate">
                          {getKindLabel(entry.kind, locale)}
                          {entry.type === 'file' ? ` · ${formatBytes(entry.size)}` : ''}
                          {' · '}
                          {formatDateTime(entry.updated)}
                        </span>
                      </span>
                    </button>
                    <CopyPathButton path={entry.absolutePath} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-ldvh-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={16} className="shrink-0 text-ldvh-accent" />
              <div className="min-w-0">
                <h2 className="ldvh-section-title">{copy.preview}</h2>
                {filePanel.data && <p className="ldvh-meta truncate">{filePanel.data.path}</p>}
              </div>
            </div>
            <CopyPathButton path={filePanel.data?.absolutePath} />
          </div>
          <div className="min-h-[36rem] min-w-0 p-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
            {filePanel.loading ? (
              <LoadingState text={copy.loading} />
            ) : filePanel.error ? (
              <EmptyState text={filePanel.error} />
            ) : !filePanel.data ? (
              <EmptyState text={copy.chooseFile} />
            ) : filePanel.data.kind === 'binary' ? (
              <EmptyState text={`${copy.binary} ${formatBytes(filePanel.data.size)}`} />
            ) : (
              <div className="min-w-0 xl:flex xl:h-full xl:flex-col">
                <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="ldvh-chip rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-1 text-ldvh-text-secondary">
                    {getKindLabel(filePanel.data.kind, locale)}
                  </span>
                  <span className="ldvh-meta">{formatBytes(filePanel.data.size)}</span>
                  {filePanel.data.truncated && (
                    <span className="ldvh-chip rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                      {copy.truncated}
                    </span>
                  )}
                </div>
                {filePanel.data.kind === 'markdown' ? (
                  <article className="min-w-0 overflow-auto rounded-md bg-ldvh-bg px-4 py-4 xl:min-h-0 xl:flex-1">
                    <MarkdownPreview content={filePanel.data.content} renderSvgBlocks />
                  </article>
                ) : filePanel.data.kind === 'svg' ? (
                  <div className="flex min-w-0 items-center justify-center overflow-auto rounded-md bg-ldvh-bg p-4 xl:min-h-0 xl:flex-1">
                    <img
                      src={getSvgDataUrl(filePanel.data.content)}
                      alt={getFileName(filePanel.data.path)}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <pre className="ldvh-meta-primary min-w-0 overflow-auto whitespace-pre-wrap rounded-md bg-ldvh-bg p-4 xl:min-h-0 xl:flex-1">
                    {filePanel.data.content}
                  </pre>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
