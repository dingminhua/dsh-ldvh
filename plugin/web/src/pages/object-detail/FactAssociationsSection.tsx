import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { ObjectTypeIcon, OBJECT_TYPE_ICONS } from '@/components/SemanticIcon';

const CommitRelationIcon = OBJECT_TYPE_ICONS.commit;
import StatusBadge from '@/components/StatusBadge';
import { getFieldLabel, getLocalizedObjectTitle, getObjectStatusLocale } from '@/i18n/locales';
import {
  ReadingNodeSection,
  getReadingNodeNextState,
  type ReadingNodeState,
} from '@/pages/ObjectDetail';
import {
  groupRelationsByTargetType,
  projectFactReadingAssociations,
  projectFactReadingRefs,
  type ReadingRef,
  type ReadingRelation,
  type UnresolvedAssociation,
} from '@/pages/object-detail/factReadingProjection';
import { getCurrentProjectId } from '@/pages/object-detail/model';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { fetchObjectDetail, type ObjectDetail } from '@/utils/api';
import { getFactReadMeta, isReadableFact } from '@/utils/factReadMeta';
import { usePanel } from '@/utils/panelContext';
import { LDVH_WARN_SURFACE_CLASS } from '@/utils/semanticColors';

/** Reads the deliberately minimal relation contract, not source or evidence projections. */
export function FactAssociationsSection({
  obj,
  locale,
  title,
  showRelationKey = false,
}: {
  obj: Record<string, unknown>;
  locale: string;
  title?: string;
  showRelationKey?: boolean;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const associations = projectFactReadingAssociations(obj);
  // 03 §7.2 关联引用型 / 20 §8：refs 是普通内容关联，与 relations 并列呈现、
  // 语义互不并入（relations 承载生命周期关系）。二者共用同一种可点行渲染，
  // 但数据上始终是两个独立集合。
  const refs = projectFactReadingRefs(obj);
  if (associations.relations.length === 0 && associations.unresolved.length === 0 && refs.length === 0) return null;
  const currentProjectId = getCurrentProjectId(obj);
  const factTypeKey = typeof obj.fact_type_key === 'string' ? obj.fact_type_key : typeof obj.type === 'string' ? obj.type : undefined;
  return (
    <ReadingNodeSection
      title={title ?? getFieldLabel('fact_associations', locale)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <div className="flex flex-col gap-3">
        <RelationGroup
          relations={associations.relations}
          currentProjectId={currentProjectId}
          locale={locale}
          showRelationKey={showRelationKey}
          semanticRelationLabels={factTypeKey === 'research'}
        />
        <RefGroup refs={refs} currentProjectId={currentProjectId} locale={locale} />
        <UnresolvedGroup items={associations.unresolved} locale={locale} />
      </div>
    </ReadingNodeSection>
  );
}

/**
 * refs 关联对象行（03 §7.2 关联引用型 / 20 §8）。
 *
 * 与 RelationGroup 并列但**独立**：refs 不定义 relation key、不参与关系
 * 闭集校验，因此这里不渲染 relation key chip，也不并入 relations 列表。
 */
function RefGroup({ refs, currentProjectId, locale }: {
  refs: ReadingRef[];
  currentProjectId?: string;
  locale: string;
}) {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {refs.map((ref) => (
        <RefTarget key={ref.originPath} entry={ref} currentProjectId={currentProjectId} locale={locale} />
      ))}
    </div>
  );
}

/**
 * 单条 refs 目标行：复用与 relations 相同的可点行形态（图标 + 标题 + 状态
 * 徽章 + 跳转箭头）。
 *
 * Hook 纪律：本组件无条件调用 usePanel/useState/useEffect，**是否可读的分支
 * 在 hook 之后**——否则条件挂载会破坏 hook 调用序（react-hooks/rules-of-hooks）。
 * 目标不可读时如实标注 uid，不伪造本地对象（03 §7.2 第 5 条同精神：目标解析
 * 失败不得降级为「无关联」）。
 */
function RefTarget({ entry, currentProjectId, locale }: {
  entry: ReadingRef;
  currentProjectId?: string;
  locale: string;
}) {
  const { isOpen: panelOpen, content: panelContent, openPanel } = usePanel();
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const locator = entry.resolvedTarget;
  const readable = Boolean(locator && currentProjectId && locator.governedProjectId === currentProjectId);
  // effect 只消费这两个标量。依赖整个 locator 对象会在其每次新建时重取详情，故先在
  // 渲染期取出，使依赖数组与 effect 真正读取的值一致（react-hooks/exhaustive-deps）。
  const locatorFactTypeKey = locator?.factTypeKey;
  const locatorObjectId = locator?.objectId;

  useEffect(() => {
    if (!readable || !locatorFactTypeKey || !locatorObjectId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    fetchObjectDetail(locatorFactTypeKey, locatorObjectId)
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [readable, locatorFactTypeKey, locatorObjectId]);

  if (!readable || !locator) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2">
        <ObjectTypeIcon type="uid" size={13} className="shrink-0" style={{ color: CATEGORY_COLORS.other }} />
        <span className="ldvh-meta-primary min-w-0 flex-1 truncate">{entry.objectUid}</span>
      </div>
    );
  }

  const status = detail?.summary.status;
  const readMeta = getFactReadMeta(detail?.data);
  const title = relationTargetTitle(detail, readMeta, locale);
  const typeColor = CATEGORY_COLORS[locator.factTypeKey] || CATEGORY_COLORS.other;
  const isCurrentPanelOpen = Boolean(panelOpen && panelContent?.type === 'object'
    && panelContent.objectType === locator.factTypeKey && panelContent.objectId === locator.objectId);
  const PanelIcon = isCurrentPanelOpen ? ChevronLeft : ChevronRight;
  const open = () => openPanel({ type: 'object', title, objectType: locator.factTypeKey, objectId: locator.objectId });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown} className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50">
      <ObjectTypeIcon type={locator.factTypeKey} size={13} className="shrink-0" style={{ color: typeColor }} />
      <span className="ldvh-meta-primary min-w-0 flex-1 truncate group-hover:text-ldvh-accent">{title}</span>
      {status && <StatusBadge status={status} statusLabel={getObjectStatusLocale(locator.factTypeKey, status, locale)} objectType={locator.factTypeKey} size="xs" />}
      <PanelIcon size={16} className="shrink-0 text-ldvh-text-secondary/70 transition-colors group-hover:text-ldvh-accent" aria-hidden="true" />
    </div>
  );
}

function RelationGroup({ relations, currentProjectId, locale, showRelationKey, semanticRelationLabels }: {
  relations: ReadingRelation[];
  currentProjectId?: string;
  locale: string;
  showRelationKey: boolean;
  semanticRelationLabels: boolean;
}) {
  if (relations.length === 0) return null;
  if (!semanticRelationLabels) {
    const items = groupRelationsByTargetType(relations).flatMap(({ relations: groupedRelations }) => groupedRelations);
    return (
      <div className="flex flex-col gap-1">
        {items.map((relation) => (
          <RelationTarget
            key={relation.originPath}
            relation={relation}
            currentProjectId={currentProjectId}
            locale={locale}
            showRelationKey={showRelationKey}
          />
        ))}
      </div>
    );
  }
  const groups = groupRelationsByRelationKey(relations);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ key, relations: items }) => (
        <div key={key} className="min-w-0">
          {semanticRelationLabels && (
            <div className="ldvh-caption-strong mb-1.5 text-ldvh-text-secondary">
              {getFieldLabel(`relation_${key.replace(/-/g, '_')}`, locale)}
            </div>
          )}
          <div className="flex flex-col gap-1">
            {items.map((relation) => (
              <RelationTarget
                key={relation.originPath}
                relation={relation}
                currentProjectId={currentProjectId}
                locale={locale}
                showRelationKey={showRelationKey}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupRelationsByRelationKey(relations: ReadingRelation[]): Array<{ key: string; relations: ReadingRelation[] }> {
  const grouped = new Map<string, ReadingRelation[]>();
  for (const relation of relations) {
    grouped.set(relation.relationKey, [...(grouped.get(relation.relationKey) ?? []), relation]);
  }
  return [...grouped.entries()].map(([key, items]) => ({ key, relations: items }));
}

/** A target is resolved on demand; title and status are never duplicated into relations. */
function RelationTarget({ relation, currentProjectId, locale, showRelationKey }: {
  relation: ReadingRelation;
  currentProjectId?: string;
  locale: string;
  showRelationKey: boolean;
}) {
  const target = relation.target;
  // 02 §8.1「commit 形态」：解药是一次受控提交，不是事实对象——跳提交详情页。
  // 必须在两个对象分支之前判定：commit 目标既无 resolvedTarget 也无
  // governedProjectId，落到最后的 ExternalRelationTarget 会被当外链渲染。
  if ('commit' in target) {
    return <CommitRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
  }
  if ('objectUid' in target && relation.resolvedTarget
    && currentProjectId && relation.resolvedTarget.governedProjectId === currentProjectId) {
    return <ReadableRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
  }
  if ('governedProjectId' in target && currentProjectId && target.governedProjectId === currentProjectId) {
    return <ReadableRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
  }
  return <ExternalRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
}

function ReadableRelationTarget({ relation, locale, showRelationKey }: {
  relation: ReadingRelation;
  locale: string;
  showRelationKey: boolean;
}) {
  const target = relation.target;
  const locator = relation.resolvedTarget ?? ('governedProjectId' in target ? target : null);
  // Hook 纪律：hook 必须先于任何条件分支调用，否则 locator 从有到无（或反之）
  // 会破坏调用序（react-hooks/rules-of-hooks）。
  const { isOpen: panelOpen, content: panelContent, openPanel } = usePanel();
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  // 同 RefTarget：effect 只消费这两个标量，取出后依赖数组与读取值一致。
  const locatorFactTypeKey = locator?.factTypeKey;
  const locatorObjectId = locator?.objectId;

  useEffect(() => {
    if (!locatorFactTypeKey || !locatorObjectId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    fetchObjectDetail(locatorFactTypeKey, locatorObjectId)
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [locatorFactTypeKey, locatorObjectId]);

  if (!locator) {
    return <ExternalRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
  }

  const status = detail?.summary.status;
  const readMeta = getFactReadMeta(detail?.data);
  const title = relationTargetTitle(detail, readMeta, locale);
  const typeColor = CATEGORY_COLORS[locator.factTypeKey] || CATEGORY_COLORS.other;
  const isCurrentPanelOpen = Boolean(panelOpen && panelContent?.type === 'object'
    && panelContent.objectType === locator.factTypeKey && panelContent.objectId === locator.objectId);
  const PanelIcon = isCurrentPanelOpen ? ChevronLeft : ChevronRight;
  const open = () => openPanel({ type: 'object', title, objectType: locator.factTypeKey, objectId: locator.objectId });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown} className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50">
      <ObjectTypeIcon type={locator.factTypeKey} size={13} className="shrink-0" style={{ color: typeColor }} />
      {showRelationKey && <RelationKeyChip relationKey={relation.relationKey} locale={locale} />}
      <span className="ldvh-meta-primary min-w-0 flex-1 truncate group-hover:text-ldvh-accent">{title}</span>
      {status && <StatusBadge status={status} statusLabel={getObjectStatusLocale(locator.factTypeKey, status, locale)} objectType={locator.factTypeKey} size="xs" />}
      <PanelIcon size={16} className="shrink-0 text-ldvh-text-secondary/70 transition-colors group-hover:text-ldvh-accent" aria-hidden="true" />
    </div>
  );
}

function relationTargetTitle(detail: ObjectDetail | null, readMeta: ReturnType<typeof getFactReadMeta>, locale: string): string {
  if (!detail || !isReadableFact(readMeta)) return '—';
  const source = detail.data as { title?: string; title_en?: string; title_zh?: string };
  return getLocalizedObjectTitle(source, locale);
}

/** A target outside the currently readable project remains a reference, not a fabricated local object. */
/**
 * 02 §8.1「commit 形态」的目标行：解药是一次受控提交，点击进入提交详情页
 * （/changelog/:hash，与 Changelog 列表同一入口）。提交不是事实对象，故没有
 * 标题/状态可展示——显示短 hash 并在悬停时给出全 hash（08 §5 的引用纪律：
 * 不复制目标标题进关系，本行只呈现定位所需的最小信息）。
 */
function CommitRelationTarget({ relation, locale, showRelationKey }: {
  relation: ReadingRelation;
  locale: string;
  showRelationKey: boolean;
}) {
  const navigate = useNavigate();
  const target = relation.target;
  if (!('commit' in target)) return null;
  const short = target.commit.slice(0, 7);
  // 标题由服务端随关联投影带出（见 api/services/facts.ts 与 factReadingProjection）；
  // 缺失时退回短 hash——定位符可读，但不冒充内容。
  const subject = relation.resolvedCommitTitle ?? short;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    navigate(`/changelog/${target.commit}`);
  };
  return (
    <div
      role="link"
      tabIndex={0}
      title={target.commit}
      onClick={() => navigate(`/changelog/${target.commit}`)}
      onKeyDown={onKeyDown}
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 transition-colors hover:bg-ldvh-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/45"
    >
      {/* 提交图标（复用侧栏「提交」那一项）；标题行只显示标题，hash 由 title 属性承担 */}
      <CommitRelationIcon size={13} className="shrink-0 text-ldvh-text-secondary" />
      {showRelationKey && <RelationKeyChip relationKey={relation.relationKey} locale={locale} />}
      <span className="ldvh-meta-primary min-w-0 flex-1 truncate">{subject}</span>
    </div>
  );
}

function ExternalRelationTarget({ relation, locale, showRelationKey }: {
  relation: ReadingRelation;
  locale: string;
  showRelationKey: boolean;
}) {
  const target = relation.target;
  // commit 目标由 CommitRelationTarget 承接，不落到这里——此函数只处理两种对象
  // locator 形态。收窄以满足类型：commit 分支在此不可达。
  if ('commit' in target) return null;
  const isUid = 'objectUid' in target;
  const factTypeKey = isUid ? 'uid' : target.factTypeKey;
  const typeColor = CATEGORY_COLORS[factTypeKey] || CATEGORY_COLORS.other;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2">
      <ObjectTypeIcon type={factTypeKey} size={13} className="shrink-0" style={{ color: typeColor }} />
      {showRelationKey && <RelationKeyChip relationKey={relation.relationKey} locale={locale} />}
      <span className="ldvh-meta-primary min-w-0 flex-1 truncate">{isUid ? target.objectUid : target.objectId}</span>
      {!isUid && <span className="ldvh-meta-muted shrink-0">{target.governedProjectId}</span>}
    </div>
  );
}

function RelationKeyChip({ relationKey, locale }: { relationKey: string; locale: string }) {
  const fieldKey = `relation_${relationKey.replace(/-/g, '_')}`;
  return (
    <span
      title={relationKey}
      className="ldvh-chip shrink-0 rounded-md border border-ldvh-border bg-ldvh-bg px-1.5 py-0.5 text-ldvh-text-secondary"
    >
      {getFieldLabel(fieldKey, locale)}
    </span>
  );
}

function UnresolvedGroup({ items, locale }: { items: UnresolvedAssociation[]; locale: string }) {
  if (items.length === 0) return null;
  return (
    <AssociationGroup title={getFieldLabel('unresolved_materials', locale)}>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.originPath} className={`rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2`}>
            <div className="flex items-center gap-2"><AlertTriangle size={13} className="shrink-0 text-amber-400" /><span className="ldvh-caption-strong">{item.originPath}</span></div>
            <pre className="ldvh-meta-muted mt-1 overflow-x-auto whitespace-pre-wrap break-all">{safeStringify(item.value)}</pre>
          </div>
        ))}
      </div>
    </AssociationGroup>
  );
}

function AssociationGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="py-3 first:pt-0 last:pb-0"><div className="ldvh-caption-strong mb-2">{title}</div>{children}</div>;
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
