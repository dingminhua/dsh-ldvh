import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderPlus, GitBranch, Loader2, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { fetchGovernedProjectsSettings, fetchWorkspaceWorktrees, saveGovernedProjectsSettings, verifyGovernedProjectsSettings, type GovernedProjectSetting, type GovernedProjectsSettingsData, type WorkspaceWorktree } from '@/utils/api';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';

const blankProject = (): GovernedProjectSetting => ({ id: '', path: '', name: '' });

export default function Settings() {
  const [settings, setSettings] = useState<GovernedProjectsSettingsData | null>(null);
  const [newProject, setNewProject] = useState<GovernedProjectSetting>(blankProject);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifiedMessage, setVerifiedMessage] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<WorkspaceWorktree[] | null>(null);
  const [worktreeLoading, setWorktreeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reloadProjects } = useProjectScope();
  const { t } = useI18n();

  const reload = useCallback(() => {
    setLoading(true); setError(null); setVerifiedMessage(null);
    fetchGovernedProjectsSettings().then(setSettings).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const save = async (projects: GovernedProjectSetting[], requestedDefaultProjectId = settings?.defaultProjectId ?? ''): Promise<boolean> => {
    if (!settings) return false;
    setSaving(true); setError(null);
    try {
      const next = await saveGovernedProjectsSettings(projects, settings.fingerprint, requestedDefaultProjectId);
      setSettings(next); reloadProjects(); setVerifiedMessage(t('settings.savedVerified'));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
    return false;
  };

  const verify = async () => {
    setVerifying(true); setError(null); setVerifiedMessage(null);
    try {
      await verifyGovernedProjectsSettings();
      setVerifiedMessage(t('settings.currentVerified'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setVerifying(false); }
  };

  const rename = (project: GovernedProjectSetting, name: string) => {
    const normalizedName = name.trim();
    if (!settings || normalizedName === (project.name ?? '')) return;
    void save(settings.projects.map((item) => item.id === project.id ? { ...item, ...(normalizedName ? { name: normalizedName } : { name: undefined }) } : item));
  };
  const remove = (project: GovernedProjectSetting) => {
    if (!settings || !window.confirm(t('settings.removeConfirm', { project: project.name || project.id }))) return;
    const projects = settings.projects.filter((item) => item.id !== project.id);
    void save(projects, project.id === settings.defaultProjectId ? (projects[0]?.id ?? '') : settings.defaultProjectId);
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    void save([...settings.projects, newProject]).then((saved) => { if (saved) setNewProject(blankProject); });
  };
  const refreshWorktrees = async () => {
    setWorktreeLoading(true); setError(null);
    try { setWorktrees((await fetchWorkspaceWorktrees()).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorktreeLoading(false); }
  };
  const addWorktree = (worktree: WorkspaceWorktree) => {
    const rawBaseId = worktree.path.split('/').filter(Boolean).pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project';
    const baseId = rawBaseId.replace(/^-+|-+$/g, '') || 'project';
    const usedIds = new Set(settings?.projects.map((project) => project.id) ?? []);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    setNewProject({ id, path: worktree.path, name: worktree.path.split('/').filter(Boolean).pop() ?? '' });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      <div className="border-b border-ldvh-border pb-5">
        <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} compact />
        <div className="mt-4 grid grid-cols-2 gap-6">
          <section className="border-l-2 border-ldvh-accent pl-3">
            <p className="ldvh-caption-strong text-ldvh-accent">{t('settings.managementScope')}</p>
            <p className="ldvh-body-muted mt-1">{t('settings.configOnly')}</p>
          </section>
          <section className="border-l border-ldvh-border pl-3">
            <p className="ldvh-caption-strong">{t('settings.verificationBoundary')}</p>
            <p className="ldvh-body-muted mt-1">{t('settings.gitNotice')}</p>
          </section>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div> : error ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300"><span>{error}</span><button type="button" onClick={reload} className="ldvh-card-title rounded-md border border-red-500/30 px-3 py-2 text-red-700 hover:bg-red-500/10 dark:text-red-200">{t('settings.retryLoad')}</button></div>
      ) : settings && <>
        <div className="mt-6 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="ldvh-caption-strong">{t('settings.governedProjects')}</p><button type="button" disabled={saving || verifying} onClick={() => void verify()} className="ldvh-card-title inline-flex items-center gap-2 rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary hover:text-ldvh-text-primary disabled:opacity-50"><ShieldCheck size={15} />{verifying ? t('settings.verifying') : t('settings.verifyCurrent')}</button></div>
          <p className="ldvh-meta mt-1 break-all">{settings.configPath}</p>
          {verifiedMessage && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 size={16} />{verifiedMessage}</p>}
          <div className="mt-4 grid max-w-sm gap-2"><label className="grid gap-1"><span className="ldvh-meta">{t('settings.defaultProject')}</span><select value={settings.defaultProjectId} disabled={saving || !settings.projects.length} onChange={(event) => void save(settings.projects, event.target.value)} className="rounded-md border border-ldvh-border bg-ldvh-bg px-2.5 py-2 text-sm outline-none focus:border-ldvh-accent">{settings.projects.map((project) => <option key={project.id} value={project.id}>{project.name || project.id}</option>)}</select></label><div className="flex items-center gap-2"><button type="button" disabled={saving || !settings.projects.length} onClick={() => void save(settings.projects, settings.defaultProjectId)} className="ldvh-card-title inline-flex w-fit items-center gap-2 rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary hover:text-ldvh-text-primary disabled:opacity-50"><Save size={15} />{t('settings.saveDefault')}</button><span className="ldvh-meta">{settings.hasExplicitDefault ? t('settings.defaultExplicit') : t('settings.defaultFallback')}</span></div></div>
          <div className="mt-4 grid gap-3">
            {settings.projects.map((project) => <ProjectRow key={project.id} project={project} saving={saving} onRename={rename} onRemove={remove} />)}
          </div>
        </div>
        <section className="mt-5 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="ldvh-caption-strong">{t('settings.workspaceWorktrees')}</p><p className="ldvh-body-muted mt-1">{t('settings.workspaceWorktreesHint')}</p></div>
            <button type="button" disabled={worktreeLoading || saving} onClick={() => void refreshWorktrees()} className="ldvh-card-title inline-flex items-center gap-2 rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary hover:text-ldvh-text-primary disabled:opacity-50"><RefreshCw size={15} className={worktreeLoading ? 'animate-spin' : ''} />{t('settings.refreshWorktrees')}</button>
          </div>
          {worktrees && <div className="mt-4 grid gap-3">
            {worktrees.length === 0 ? <p className="ldvh-body-muted">{t('settings.noWorktrees')}</p> : worktrees.map((worktree) => <WorktreeRow key={worktree.path} worktree={worktree} saving={saving} onAdd={addWorktree} />)}
          </div>}
        </section>
        <form onSubmit={add} className="mt-5 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <div className="flex items-center gap-2"><FolderPlus size={16} /><p className="ldvh-caption-strong">{t('settings.addProject')}</p></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <Field label={t('settings.stableId')} value={newProject.id} onChange={(id) => setNewProject((value) => ({ ...value, id }))} required />
            <Field label={t('settings.localWorktreePath')} value={newProject.path} onChange={(path) => setNewProject((value) => ({ ...value, path }))} required />
            <Field label={t('settings.nickname')} value={newProject.name ?? ''} onChange={(name) => setNewProject((value) => ({ ...value, name }))} />
          </div>
          <button disabled={saving} className="ldvh-card-title mt-4 inline-flex items-center gap-2 rounded-md bg-ldvh-accent px-3 py-2 text-white disabled:opacity-50"><Save size={15} />{t('settings.addAndVerify')}</button>
        </form>
      </>}
    </div>
  );
}

function WorktreeRow({ worktree, saving, onAdd }: { worktree: WorkspaceWorktree; saving: boolean; onAdd: (worktree: WorkspaceWorktree) => void }) {
  const { t } = useI18n();
  const status = worktree.status;
  return <div className="rounded-lg border border-ldvh-border p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><GitBranch size={15} className="shrink-0 text-ldvh-accent" /><span className="ldvh-caption-strong">{worktree.branch || t('settings.detachedHead')}</span>{worktree.isMain && <span className="rounded-full border border-ldvh-accent/30 bg-ldvh-accent/5 px-1.5 py-0.5 text-[11px] text-ldvh-accent">{t('settings.mainWorktree')}</span>}{worktree.head && <code className="ldvh-meta">{worktree.head}</code>}</div><p className="ldvh-meta mt-1 break-all">{worktree.path}</p>{status ? <p className="ldvh-meta mt-2">{t('settings.worktreeStatus', { staged: String(status.staged), unstaged: String(status.unstaged), untracked: String(status.untracked), conflicted: String(status.conflicted) })}</p> : <p className="ldvh-meta mt-2">{t('settings.worktreeStatusUnavailable')}</p>}</div>{worktree.registeredProjectId ? <span className="ldvh-caption shrink-0 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-300">{t('settings.worktreeRegistered', { id: worktree.registeredProjectId })}</span> : worktree.governedProjectId ? <span className="ldvh-caption shrink-0 rounded-md bg-sky-500/10 px-2 py-1 text-sky-600 dark:text-sky-300">{t('settings.worktreeGovernedBy', { id: worktree.governedProjectId })}</span> : <button type="button" disabled={saving} onClick={() => onAdd(worktree)} className="ldvh-card-title shrink-0 rounded-md border border-ldvh-accent/40 px-3 py-2 text-ldvh-accent hover:bg-ldvh-accent/5 disabled:opacity-50">{t('settings.addWorktree')}</button>}</div></div>;
}

function ProjectRow({ project, saving, onRename, onRemove }: { project: GovernedProjectSetting; saving: boolean; onRename: (project: GovernedProjectSetting, name: string) => void; onRemove: (project: GovernedProjectSetting) => void }) {
  const [name, setName] = useState(project.name ?? '');
  const { t } = useI18n();
  return <div className="rounded-lg border border-ldvh-border p-3"><div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_1fr_auto] lg:items-end"><Field label={t('settings.projectId')} value={project.id} readOnly /><Field label={t('settings.projectPath')} value={project.path} readOnly /><Field label={t('settings.nickname')} value={name} onChange={setName} /><div className="flex gap-2"><button type="button" disabled={saving} aria-label={t('settings.saveNickname')} onClick={() => onRename(project, name)} className="rounded-md border border-ldvh-border p-2 text-ldvh-text-secondary hover:text-ldvh-text-primary"><Save size={15} /></button><button type="button" disabled={saving} aria-label={t('settings.removeProject')} onClick={() => onRemove(project)} className="rounded-md border border-red-500/30 p-2 text-red-400"><Trash2 size={15} /></button></div></div></div>;
}

function Field({ label, value, onChange, required, readOnly }: { label: string; value: string; onChange?: (value: string) => void; required?: boolean; readOnly?: boolean }) {
  return <label className="grid gap-1"><span className="ldvh-meta">{label}</span><input value={value} required={required} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} className="rounded-md border border-ldvh-border bg-ldvh-bg px-2.5 py-2 text-sm outline-none focus:border-ldvh-accent" /></label>;
}
