import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { getTypeSurfaceTint } from '@/utils/typeSurface';
import { getObjectStatusLocale } from '@/i18n/locales';
import type { ServingWorkItem } from '@/utils/api';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';
import {
  FACT_ASSOCIATION_ROWS_LIST_CLASS,
  FACT_ASSOCIATION_ROWS_ZONE_CLASS,
  FactAssociationCardRow,
  groupServingWorkByType,
  SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT,
} from '@/components/FactAssociationRows';
import { LDVH_WARN_SURFACE_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';


export function SubGoalCriterionSurface({
  criterion,
  type = 'subgoal',
}: {
  criterion: string;
  type?: string;
}) {
  const text = typeof criterion === 'string' ? criterion.trim() : '';
  if (!text) return null;

  const tint = getTypeSurfaceTint(type);
  return (
    <section className="min-w-0 rounded-lg border px-3 py-2" style={tint.surface}>
      { }
      <p className="ldvh-card-decision-body min-w-0 break-words" style={tint.body}>
        {text}
      </p>
    </section>
  );
}

export function SubGoalDisclosureButton({
  expanded,
  onToggle,
  label,
  className = '',
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left ldvh-meta text-ldvh-text-secondary/85 transition-colors hover:bg-ldvh-border/25 hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50 ${className}`}
    >
      {expanded
        ? <ChevronUp size={12} aria-hidden="true" className="shrink-0" />
        : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function SubGoalServingWorkZone({
  rows,
  unreadable,
  showProgress = true,
  progressVariant = 'block',
}: {
  rows: readonly ServingWorkItem[];
  unreadable?: readonly string[];
  showProgress?: boolean;
  progressVariant?: 'block' | 'inline';
}) {
  const { t, locale } = useI18n();
  const [expandedTypes, setExpandedTypes] = useState<ReadonlySet<string>>(() => new Set());
  const unreadableTypes = unreadable ?? [];

  const sparkRows = rows.filter((row) => row.type === 'spark');
  const groups = groupServingWorkByType(rows);
  const isEmpty = groups.length === 0;

  if (isEmpty && unreadableTypes.length === 0) {
    return (
      <section onClick={(event) => event.stopPropagation()} className={FACT_ASSOCIATION_ROWS_ZONE_CLASS}>
        <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-2 py-1.5 ${LDVH_WARN_TITLE_CLASS}`}>
          {t('objectList.subGoalServingEmpty')}
        </p>
      </section>
    );
  }

  return (
    <section onClick={(event) => event.stopPropagation()} className={`${FACT_ASSOCIATION_ROWS_ZONE_CLASS} flex flex-col gap-1.5`}>
      {groups.map((group) => {
        const expanded = expandedTypes.has(group.type);
        const hidden = Math.max(0, group.rows.length - SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT);
        const visible = expanded ? group.rows : group.rows.slice(0, SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT);
        return (
          <div key={group.type} data-subgoal-serving-type={group.type}>
            { }
            <div className={FACT_ASSOCIATION_ROWS_LIST_CLASS}>
              {visible.map((association, index) => (
                <FactAssociationCardRow
                  key={`${group.type}:${index}`}
                  association={association}
                  locale={locale}
                  unavailableLabel={t('objectList.associationUnavailable')}
                />
              ))}
            </div>
            { }
            {(hidden > 0 || expanded) && (
              <SubGoalDisclosureButton
                expanded={expanded}
                onToggle={() => setExpandedTypes((current) => {
                  const next = new Set(current);
                  if (next.has(group.type)) next.delete(group.type);
                  else next.add(group.type);
                  return next;
                })}
                label={expanded
                  ? t('objectList.subGoalServingCollapse')
                  : t('objectList.subGoalServingExpand', { count: String(hidden) })}
                className="mt-0.5"
              />
            )}
            { }
            {group.type === 'spark' && showProgress && (
              <div className="mt-1">
                <ServingSparkProgressBar
                  rows={sparkRows}
                  unreadable={unreadableTypes}
                  progressLabel={t('objectList.subGoalSparkProgress')}
                  emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
                  allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
                  unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
                  unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
                  variant={progressVariant}
                />
              </div>
            )}
          </div>
        );
      })}
      {unreadableTypes.length > 0 && (
        <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-2 py-1.5 ${LDVH_WARN_TITLE_CLASS}`}>
          {t('objectList.subGoalServingUnreadable')}：{unreadableTypes.join('；')}
        </p>
      )}
    </section>
  );
}

export function SubGoalRowChips({
  order,
  status,
  children,
}: {
  order?: number;
  status?: string;
  children?: ReactNode;
}) {
  const { locale } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <SubGoalOrderBadge value={order} />
      {status && status !== 'active' && (
        <span className="ldvh-chip-sm shrink-0" data-subgoal-status={status}>
          {getObjectStatusLocale('subgoal', status, locale)}
        </span>
      )}
      {children}
    </div>
  );
}
