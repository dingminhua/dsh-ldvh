/**
 * 全部管辖联邦聚焦页（全部管辖计划 Step 3）。
 *
 * 只读跨项目汇总：项目卡网格（悬置/推进/待决定计数 + 最后动态 + 进入项目）
 * 与跨项目悬置 Top 列表（项目色标识来源维度）。卡片语言沿用统一设计系统
 * （ldvh-card / ldvh-meta / 左色条 = 项目色第三正交维度，不侵占类型色与状态色）。
 * 单项目详情一律经「进入项目」回到该项目的单项目页面，本页不复制对象阅读功能。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Inbox, Layers, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { fetchFederationOverview, type FederationOverviewData, type FederationProjectCard } from '@/utils/api';
import { formatDateTime } from '@/utils/dateFormat';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { projectColorVar, resolvedProjectColorKey } from '@/shared/projectColors';

function countText(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

export default function Federation() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { selectProject } = useProjectScope();
  const [data, setData] = useState<FederationOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchFederationOverview()
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const enterProject = (project: FederationProjectCard) => {
    selectProject(project.id, project.path);
    navigate('/');
  };

  return (
    <div>
      <PageHeader title={t('federation.title')} subtitle={t('federation.subtitle')}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={load}
            className="ldvh-page-toolbar-action"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {t('federation.refresh')}
          </button>
          {data && <span className="ldvh-meta">{formatDateTime(data.generatedAt)}</span>}
        </div>
      </PageHeader>

      {loading && !data ? (
        <div className="ldvh-body-muted flex justify-center py-20"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={load} className="ldvh-card-title rounded-md border border-red-500/30 px-3 py-2 text-red-700 hover:bg-red-500/10 dark:text-red-200">{t('federation.retry')}</button>
        </div>
      ) : data && (
        <>
          {data.projects.length === 0 ? (
            <div className="ldvh-body-muted py-20 text-center">
              {t('federation.noProjects')}
            </div>
          ) : (
            <div className="ldvh-section-grid">
              {data.projects.map((project) => {
                const colorKey = resolvedProjectColorKey(project.color, project.id);
                const color = projectColorVar(colorKey);
                return (
                  <section key={project.id} className="flex flex-col overflow-hidden rounded-lg border border-ldvh-border bg-ldvh-panel border-l-[3px]" style={{ borderLeftColor: color }}>
                    <div className="flex min-w-0 items-center gap-2 border-b border-ldvh-border px-3.5 py-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="ldvh-card-title-prominent truncate max-w-full leading-5 text-ldvh-text-primary">{project.name}</span>
                          {project.isDefault && <span className="shrink-0 rounded-full border border-ldvh-accent/30 bg-ldvh-accent/5 px-1.5 py-0.5 text-xs font-semibold leading-none text-ldvh-accent">{t('federation.defaultProject')}</span>}
                        </span>
                        <span className="ldvh-meta mt-0.5 block truncate">{project.id}</span>
                      </span>
                    </div>
                    <div className="grid flex-1 gap-2 px-3.5 py-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-md border border-ldvh-border/60 bg-ldvh-bg/40 px-2.5 py-2">
                          <p className="ldvh-caption-strong flex items-center gap-1.5"><Sparkles size={12} />{t('federation.sparkOpen')}</p>
                          <p className="mt-0.5 text-lg font-semibold leading-6 text-ldvh-text-primary">
                            {countText(project.sparkOpen)}
                            {project.sparkP1 !== undefined && project.sparkP1 > 0 && <span className="ml-1.5 text-xs font-semibold text-amber-600 dark:text-amber-300">P1 × {project.sparkP1}</span>}
                          </p>
                        </div>
                        <div className="rounded-md border border-ldvh-border/60 bg-ldvh-bg/40 px-2.5 py-2">
                          <p className="ldvh-caption-strong flex items-center gap-1.5"><Layers size={12} />{t('federation.activeWorkCases')}</p>
                          <p className="mt-0.5 text-lg font-semibold leading-6 text-ldvh-text-primary">{countText(project.activeWorkCases)}</p>
                        </div>
                        <div className="rounded-md border border-ldvh-border/60 bg-ldvh-bg/40 px-2.5 py-2">
                          <p className="ldvh-caption-strong flex items-center gap-1.5"><Inbox size={12} />{t('federation.pendingDecisions')}</p>
                          <p className="mt-0.5 text-lg font-semibold leading-6 text-ldvh-text-primary">{countText(project.pendingDecisions)}</p>
                        </div>
                      </div>
                      <p className="ldvh-meta">{t('federation.lastActivity')}: {project.lastActivityAt ? formatDateTime(project.lastActivityAt) : '—'}</p>
                      {project.issues.length > 0 && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle size={12} />{t('federation.projectIssues')}</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {project.issues.map((issue) => <li key={issue} className="text-xs leading-5 text-amber-700 dark:text-amber-300/90">{issue}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-ldvh-border px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => enterProject(project)}
                        className="ldvh-card-title inline-flex items-center gap-1.5 rounded-md border border-ldvh-border px-3 py-1.5 text-ldvh-text-secondary transition-colors hover:border-ldvh-accent/40 hover:bg-ldvh-accent/5 hover:text-ldvh-accent"
                      >
                        {t('federation.enterProject')}<ArrowRight size={13} />
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {data.crossProjectSparks.length > 0 && (
            <section className="mt-6 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
              <p className="ldvh-section-title">{t('federation.crossSparks')}</p>
              <div className="mt-3 grid gap-2">
                {data.crossProjectSparks.map((spark) => {
                  const colorKey = resolvedProjectColorKey(spark.color, spark.projectId);
                  const color = projectColorVar(colorKey);
                  return (
                    <div key={`${spark.projectId}/${spark.objectId}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ldvh-border/60 bg-ldvh-bg/40 px-3 py-2">
                      {spark.priority && (
                        <span className="ldvh-chip-sm items-center border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" aria-label={spark.priority}>
                          {spark.priority}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-ldvh-text-primary">{spark.title}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ldvh-border px-1.5 py-0.5" title={spark.projectId}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                        <span className="ldvh-meta">{spark.projectId}</span>
                      </span>
                      <span className="ldvh-meta shrink-0">{spark.updatedAt ? formatDateTime(spark.updatedAt) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
