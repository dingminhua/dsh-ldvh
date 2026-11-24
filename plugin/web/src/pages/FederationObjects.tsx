import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ProjectIssuesNotice from '@/components/ProjectIssuesNotice';
import {
  ObjectCardFrame,
  FrictionCardContent,
  NormCardContent,
  PitfallCardContent,
  SparkCardContent,
  ResearchCardContent,
  SubGoalCardContent,
} from '@/pages/ObjectList';
import { fetchFederationObjects, type FederationObjectItem, type FederationProjectOption } from '@/utils/api';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { getTypeLabel } from '@/i18n/locales';
import { projectColorVar, resolvedProjectColorKey } from '@/shared/projectColors';
import { LDVH_ERROR_SURFACE_CLASS, LDVH_ERROR_TITLE_CLASS } from '@/utils/semanticColors';

const OBJECT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'] as const;

function ProjectFilterChips({
  projects,
  active,
  onChange,
  counts,
}: {
  projects: FederationProjectOption[];
  active: string | null;
  onChange: (projectId: string | null) => void;
  counts: Map<string, number>;
}) {
  const { t } = useI18n();
  const buttonClass = (isActive: boolean) =>
    `ldvh-tab-button ${isActive ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
  return (
    <div className="ldvh-tab-list min-w-0" role="group" aria-label={t('federation.projectFilter')}>
      <span className="ldvh-meta shrink-0">{t('federation.projectFilter')}</span>
      <button type="button" onClick={() => onChange(null)} className={buttonClass(active === null)}>
        {t('federation.allProjects')}
        <span className="ldvh-tab-count">{counts.get('*') ?? 0}</span>
      </button>
      {projects.map((project) => {
        const color = projectColorVar(resolvedProjectColorKey(project.color, project.id));
        const isActive = active === project.id;
        return (
          <button key={project.id} type="button" onClick={() => onChange(project.id)} className={buttonClass(isActive)} title={project.id}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            <span className="min-w-0 truncate">{project.name}</span>
            <span className="ldvh-tab-count">{counts.get(project.id) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function FederationObjects() {
  const { type } = useParams<{ type: string }>();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { selectProject } = useProjectScope();
  const currentType = (OBJECT_TYPES as readonly string[]).includes(type ?? '') ? (type as typeof OBJECT_TYPES[number]) : null;
  const [items, setItems] = useState<FederationObjectItem[]>([]);
  const [projects, setProjects] = useState<FederationProjectOption[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentType) return;
    setLoading(true);
    setError(null);
    fetchFederationObjects(currentType)
      .then((data) => {
        setItems(data.items ?? []);
        setProjects(data.projects ?? []);
        setIssues(data.issues ?? []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [currentType]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setActiveProject(null); }, [currentType]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    map.set('*', items.length);
    for (const item of items) {
      const id = item.federationProject.id;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const visibleItems = useMemo(
    () => (activeProject === null ? items : items.filter((item) => item.federationProject.id === activeProject)),
    [items, activeProject],
  );

  const openObject = (item: FederationObjectItem) => {
    selectProject(item.federationProject.id);
    navigate(`/objects/${currentType}/${item.id}`, {
      state: { from: `/federation/objects/${currentType}` },
    });
  };

  const renderContent = (item: FederationObjectItem) => {
    if (currentType === 'pitfall') return <PitfallCardContent obj={item} />;
    if (currentType === 'spark') return <SparkCardContent obj={item} />;
    if (currentType === 'report') return <ResearchCardContent obj={item} />;
    if (currentType === 'friction') return <FrictionCardContent obj={item} />;
    if (currentType === 'norm') return <NormCardContent obj={item} />;
    if (currentType === 'subgoal') return <SubGoalCardContent obj={item} />;
    return null;
  };

  if (!currentType) {
    return (
      <div className="ldvh-body-muted p-6">{t('federation.unsupportedType')}</div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${t('federation.objectsTitle')} · ${getTypeLabel(currentType, locale)}`}
        subtitle={t('federation.objectsSubtitle')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={load}
            className="ldvh-page-toolbar-action"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {t('federation.refresh')}
          </button>
          {loading && <span className="ldvh-meta">{t('federation.loading')}</span>}
          {!loading && <span className="ldvh-meta">{`${visibleItems.length} / ${items.length}`}</span>}
        </div>
      </PageHeader>

      {projects.length > 0 && (
        <div className="mb-4">
          <ProjectFilterChips projects={projects} active={activeProject} onChange={setActiveProject} counts={counts} />
        </div>
      )}

      <ProjectIssuesNotice issues={issues} variant="page" className="mb-4" />

      {loading && items.length === 0 ? (
        <div className="ldvh-body-muted flex justify-center py-20"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className={`mt-2 rounded-lg border ${LDVH_ERROR_SURFACE_CLASS} p-4 ${LDVH_ERROR_TITLE_CLASS}`}>{error}</div>
      ) : visibleItems.length === 0 ? (
        <div className="ldvh-body-muted py-20 text-center">
          {t('federation.noObjects')}
        </div>
      ) : (
        <div className="ldvh-section-grid items-stretch">
          {visibleItems.map((item) => {
            const project = item.federationProject;
            const color = projectColorVar(resolvedProjectColorKey(project.color, project.id));
            return (
              <ObjectCardFrame
                key={`${project.id}/${item.id}`}
                obj={item}
                locale={locale}
                onOpen={() => openObject(item)}
                showNonActiveReason={false}
              >
                { }
                <button
                  type="button"
                  onClick={() => openObject(item)}
                  className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-ldvh-border bg-ldvh-bg/40 px-1.5 py-0.5 transition-colors hover:border-ldvh-accent/40"
                  title={project.id}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                  <span className="ldvh-meta">{project.id}</span>
                </button>
                {renderContent(item)}
              </ObjectCardFrame>
            );
          })}
        </div>
      )}
    </div>
  );
}
