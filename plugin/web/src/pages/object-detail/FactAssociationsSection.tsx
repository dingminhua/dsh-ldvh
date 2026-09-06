import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
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
  type ReadingRelation,
  type UnresolvedAssociation,
} from '@/pages/object-detail/factReadingProjection';
import { getCurrentProjectId } from '@/pages/object-detail/model';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { fetchObjectDetail, type ObjectDetail } from '@/utils/api';
import { getFactReadMeta, isReadableFact } from '@/utils/factReadMeta';
import { usePanel } from '@/utils/panelContext';

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
  variant?: 'detailed' | 'spark';
  showRelationKey?: boolean;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const associations = projectFactReadingAssociations(obj);
  if (associations.relations.length === 0 && associations.unresolved.length === 0) return null;
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
          semanticRelationLabels={factTypeKey === 'study'}
        />
        <UnresolvedGroup items={associations.unresolved} locale={locale} />
      </div>
    </ReadingNodeSection>
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
  if (!locator) {
    return <ExternalRelationTarget relation={relation} locale={locale} showRelationKey={showRelationKey} />;
  }
  const { isOpen: panelOpen, content: panelContent, openPanel } = usePanel();
  const [detail, setDetail] = useState<ObjectDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    fetchObjectDetail(locator.factTypeKey, locator.objectId)
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [locator.factTypeKey, locator.objectId]);

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
function ExternalRelationTarget({ relation, locale, showRelationKey }: {
  relation: ReadingRelation;
  locale: string;
  showRelationKey: boolean;
}) {
  const target = relation.target;
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
          <div key={item.originPath} className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2">
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
