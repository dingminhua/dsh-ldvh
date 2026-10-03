/**
 * 联邦对象列表（全部管辖计划 Step 4）——五类事实对象的跨项目聚合视图。
 *
 * 卡片语言沿用统一对象卡基线（ObjectCardFrame + 各类型内容组件原样复用）；
 * 联邦增量仅两处：卡片顶部项目色 chip（来源维度标识）与项目筛选 chips。
 * 打开对象即进入其所属项目的单项目详情（selectProject + 导航），本页不复制详情阅读。
 * 单项目专属页（目录/变更/提交）在联邦态由 Sidebar 灰显，不在本页处理。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ProjectIssuesNotice from '@/components/ProjectIssuesNotice';
import WorkCaseGistLine from '@/components/WorkCaseGistLine';
import {
  ObjectCardFrame,
  AdrCardContent,
  FrictionCardContent,
  NormCardContent,
  PitfallCardContent,
  SparkCardContent,
  ResearchCardContent,
} from '@/pages/ObjectList';
import { fetchFederationObjects, type FederationObjectItem, type FederationProjectOption } from '@/utils/api';
import { useProjectScope } from '@/utils/projectContext';
import { useI18n } from '@/i18n/context';
import { getTypeLabel } from '@/i18n/locales';
import { projectColorVar, resolvedProjectColorKey } from '@/shared/projectColors';
import { LDVH_ERROR_SURFACE_CLASS, LDVH_ERROR_TITLE_CLASS } from '@/utils/semanticColors';

const OBJECT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm'] as const;

/** 项目筛选 chips：全部 + 每项目一枚（色点 + 名称 + 计数），单选。
 *
 * **统一走 `ldvh-tab-list` 家族**（`docs/01 §1.4` 约束 7：筛选、视图切换和同层 tab
 * 控件统一使用该家族；`docs/11 §4` 曾把本处登记为「仍使用手造 tab 变体」的欠账）。
 *
 * 此前本处手写 `buttonClass` 自定圆角、边框、内距与 hover，虽有注释自称「tab 视觉」，
 * 但与同层筛选控件（对象页状态筛选）外观并不一致——同一动作两套皮肤。
 *
 * 项目色点**保留**：它承载项目身份识别（`docs/01 §1.10` 色彩 5「对象类型色优先用于
 * 识别这个对象是什么」），不是装饰；色点落在 tab 按钮内部，不改变按钮几何。
 */
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
    // 进入对象所属项目的单项目详情——联邦卡是入口不是第二阅读器。
    selectProject(item.federationProject.id);
    navigate(`/objects/${currentType}/${item.id}`);
  };

  const renderContent = (item: FederationObjectItem) => {
    if (currentType === 'adr') return <AdrCardContent obj={item} />;
    if (currentType === 'pitfall') return <PitfallCardContent obj={item} />;
    if (currentType === 'spark') return <SparkCardContent obj={item} />;
    if (currentType === 'research') return <ResearchCardContent obj={item} />;
    if (currentType === 'friction') return <FrictionCardContent obj={item} />;
    if (currentType === 'norm') return <NormCardContent obj={item} />;
    if (currentType === 'workcase') {
      // WorkCase 联邦卡不复制单项目列表的阶段卡片投影（依赖当前项目的投影服务），
      // 卡体首行同样渲染 gist（10 §5.5「卡面与详情的字段分工」适用于全部卡面，
      // 不因卡片来自联邦视图而改变）——summary 是给执行者的完整快照，不进卡面。
      // 进入项目后阅读完整阶段卡片。
      return <WorkCaseGistLine gist={item.gist} />;
    }
    return null;
  };

  if (!currentType) {
    return (
      <div>
        <PageHeader title={t('federation.objectsTitle')} subtitle={t('federation.unsupportedType')} />
      </div>
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
                {/* 项目来源 chip：色点 + 项目 ID（复制友好），第三正交维度的卡片落点 */}
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
