import { Activity, CircleCheck, CircleHelp, CircleMinus, CirclePlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { usePanel } from '@/utils/panelContext';
import { ObjectTypeIcon, OBJECT_TYPE_ICONS } from '@/components/SemanticIcon';
import type { FactCardAssociation, FactRefSource, ServingWorkItem } from '@/utils/api';


const CommitRelationIcon = OBJECT_TYPE_ICONS.commit;

import {
  associationLocator,
  dedupeFactCardAssociations,
  factCardAssociationKey,
} from '@/utils/factAssociations';

export { associationLocator, dedupeFactCardAssociations };

export function FactAssociationCardRow({ association, locale, unavailableLabel, contextLabels = [], disableOpen = false }: { association: FactCardAssociation; locale: string; unavailableLabel: string; contextLabels?: Array<{ text: string; title?: string }>; disableOpen?: boolean }) {
  const { t } = useI18n();
  const commitHash = association.available && association.target && 'commit' in association.target
    ? association.target.commit
    : null;
  const commitTitle = commitHash
    ? ((typeof association.title === 'string' && association.title.trim()) || commitHash.slice(0, 7))
    : null;
  const title = commitTitle
    ?? (association.available ? getLocalizedObjectTitle(association, locale) : unavailableLabel);
  const legacyTarget = associationLocator(association);
  const typeColor = legacyTarget ? (CATEGORY_COLORS[legacyTarget.factTypeKey] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;
  const { openPanel } = usePanel();
  const navigate = useNavigate();
  const canOpen = !disableOpen && Boolean(association.available && (legacyTarget || commitHash));
  const associationState = disableOpen ? null : getFactAssociationState(association);
  const isDiscarded = associationState === 'discarded';
  const associationStateTooltip = associationState === null ? null : {
    pending: t('objectList.associationState.pending'),
    closed: t('objectList.associationState.closed'),
    discarded: t('objectList.associationState.discarded'),
    progressing: t('objectList.associationState.progressing'),
    active: t('objectList.associationState.active'),
  }[associationState];
  const open = () => {
    if (!canOpen) return;
    if (commitHash) { navigate(`/changelog/${commitHash}`); return; }
    if (!legacyTarget) return;
    openPanel({ type: 'object', title, objectType: legacyTarget.factTypeKey, objectId: legacyTarget.objectId });
  };
  return (
    <div
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : -1}
      onClick={open}
      onKeyDown={(event) => {
        if (!canOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open();
      }}
      className={`group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors ${isDiscarded ? 'text-slate-400/70 dark:text-slate-500/70' : ''} ${canOpen ? (isDiscarded ? 'cursor-pointer hover:bg-slate-500/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/30' : 'cursor-pointer hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50') : 'cursor-default'}`}
    >
      {commitHash
        ? <CommitRelationIcon size={13} className={`shrink-0 ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : 'text-ldvh-text-secondary'}`} />
        : <ObjectTypeIcon type={legacyTarget?.factTypeKey} size={13} className={`shrink-0 ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : ''}`} style={isDiscarded ? undefined : { color: typeColor }} />}
      { }
      <span
        title={commitHash ?? undefined}
        className={`ldvh-meta-primary min-w-0 flex-1 whitespace-normal break-words ${isDiscarded ? 'text-slate-400/65 dark:text-slate-500/60' : 'text-ldvh-text-secondary/95 group-hover:text-ldvh-accent'}`}
      >
        {title}
        {contextLabels.length > 0 && (
          <span className="ml-1.5 inline-flex flex-wrap items-center gap-1 align-middle">
            {contextLabels.map((label, index) => (
              <span key={`${label.text}:${index}`} title={label.title} className="rounded border border-ldvh-border/70 px-1 text-[10px] leading-4 text-ldvh-text-secondary">
                {label.text}
              </span>
            ))}
          </span>
        )}
      </span>
      {associationState !== null && associationStateTooltip !== null && <FactAssociationStateIcon state={associationState} tooltip={associationStateTooltip} />}
    </div>
  );
}

type FactAssociationState = 'pending' | 'closed' | 'discarded' | 'progressing' | 'active';

const FACT_ASSOCIATION_STATE_RANK: Record<FactAssociationState, number> = {
  active: 0,
  progressing: 1,
  pending: 2,
  closed: 3,
  discarded: 4,
};

export function getFactAssociationState(association: FactCardAssociation): FactAssociationState | null {
  if (!association.available || !association.status) return null;
  const targetType = associationLocator(association)?.factTypeKey;
  if (targetType === 'spark') {
    if (association.status === 'open') return 'pending';
    if (association.status === 'discarded') return 'discarded';
    if (association.status === 'implemented') return 'closed';
  }
  if (targetType === 'pitfall') {
    if (association.status === 'draft') return 'pending';
    if (association.status === 'discarded') return 'discarded';
  }
  if (targetType === 'friction') {
    if (association.status === 'open') return 'pending';
    if (association.status === 'resolved' || association.status === 'voided' || association.status === 'accepted') return 'closed';
  }
  if (association.status === 'retired') return 'discarded';
  return 'active';
}

export function getFactAssociationStateRank(association: FactCardAssociation): number {
  const state = getFactAssociationState(association);
  return state === null ? Number.MAX_SAFE_INTEGER : FACT_ASSOCIATION_STATE_RANK[state];
}

function FactAssociationStateIcon({ state, tooltip }: { state: FactAssociationState; tooltip: string }) {
  const presentation = {
    pending: { Icon: CircleHelp, className: 'text-amber-500 dark:text-amber-400' },
    closed: { Icon: CircleCheck, className: 'text-emerald-500 dark:text-emerald-400' },
    discarded: { Icon: CircleMinus, className: 'text-slate-400/70 dark:text-slate-500/70' },
    progressing: { Icon: CirclePlay, className: 'text-sky-500 dark:text-sky-400' },
    active: { Icon: Activity, className: 'text-ldvh-accent' },
  }[state];
  const { Icon } = presentation;
  return (
    <span title={tooltip} aria-label={tooltip} className={`shrink-0 ${presentation.className}`}>
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components

export const FACT_ASSOCIATION_ROWS_ZONE_CLASS = 'min-w-0 border-t border-ldvh-border/60 pt-1.5';

export const FACT_ASSOCIATION_ROWS_LIST_CLASS = 'divide-y divide-ldvh-border/45';

export { factCardAssociationKey };

export const SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT = 3;

const SUB_GOAL_SERVING_TYPE_ORDER: readonly string[] = ['spark'];

type ServingWorkGroup = { type: string; rows: FactCardAssociation[] };

export function groupServingWorkByType(rows: readonly ServingWorkItem[]): ServingWorkGroup[] {
  const byType = new Map<string, FactCardAssociation[]>();
  rows.forEach((row) => {
    const association = servingWorkToAssociation(row);
    const bucket = byType.get(row.type) ?? [];
    bucket.push(association);
    byType.set(row.type, bucket);
  });
  return [...byType.entries()]
    .map(([type, associations]) => ({
      type,
      rows: associations
        .map((association, index) => ({ association, index }))
        .sort((left, right) => {
          const rankDelta = getFactAssociationStateRank(left.association) - getFactAssociationStateRank(right.association);
          return rankDelta !== 0 ? rankDelta : left.index - right.index;
        })
        .map(({ association }) => association),
    }))
    .sort((left, right) => {
      const leftRank = SUB_GOAL_SERVING_TYPE_ORDER.indexOf(left.type);
      const rightRank = SUB_GOAL_SERVING_TYPE_ORDER.indexOf(right.type);
      const leftKey = leftRank === -1 ? SUB_GOAL_SERVING_TYPE_ORDER.length : leftRank;
      const rightKey = rightRank === -1 ? SUB_GOAL_SERVING_TYPE_ORDER.length : rightRank;
      return leftKey !== rightKey ? leftKey - rightKey : left.type.localeCompare(right.type);
    });
}

export function servingWorkToAssociation(row: ServingWorkItem): FactCardAssociation {
  return {
    available: true,
    target: {
      governedProjectId: row.governed_project_id ?? '',
      factTypeKey: row.type,
      objectId: row.id,
    },
    resolvedTarget: {
      governedProjectId: row.governed_project_id ?? '',
      factTypeKey: row.type,
      objectId: row.id,
    },
    title: row.title,
    status: row.status,
  };
}

export function refSourceToAssociation(source: FactRefSource): FactCardAssociation {
  return {
    available: source.available,
    target: { objectUid: source.objectUid },
    resolvedTarget: source.resolvedTarget,
    title: source.title,
    title_en: source.title_en,
    title_zh: source.title_zh,
    status: source.status,
  };
}
