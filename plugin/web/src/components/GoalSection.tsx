import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchCognitionGoal, ApiRequestError, type ServingWorkItem } from '@/utils/api';
import { getObjectStatusLocale } from '@/i18n/locales';
import { useI18n } from '@/i18n/context';
import { copyText } from '@/utils/clipboard';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';
import { getTypeSurfaceTint } from '@/utils/typeSurface';
import StatusBadge from '@/components/StatusBadge';
import SubGoalOrderBadge from '@/components/SubGoalOrderBadge';
import {
  SubGoalCriterionSurface,
  SubGoalServingWorkZone,
} from '@/components/SubGoalCardParts';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';

function toggleOnKeyboard(event: KeyboardEvent<HTMLDivElement>, toggle: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

type SubGoalRowData = {
  id: string;
  text: string;
  status?: string;
  criterion?: string;
  object_uid?: string;
  order?: number;
  serving_work?: ServingWorkItem[];
  serving_unreadable?: string[];
  legacy?: boolean;
};

function SubGoalRow({ subGoal }: { subGoal: SubGoalRowData }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = () => setExpanded((current) => !current);

  const hasObject = Boolean(subGoal.object_uid);

  return (
    <li className="min-w-0 py-2">
      { }
      <div className="flex min-w-0 items-start gap-x-2 gap-y-1">
        { }
        <span className="flex h-6 shrink-0 items-center">
          <SubGoalOrderBadge value={subGoal.order} />
        </span>
        { }
        <button
          type="button"
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className="ldvh-body min-w-0 flex-1 break-words cursor-pointer text-left hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
        >
          {subGoal.text}
        </button>
        { }
        {subGoal.status && subGoal.status !== 'active' && (
          <span className="flex h-6 shrink-0 items-center">
            <StatusBadge
              status={subGoal.status}
              statusLabel={getObjectStatusLocale('subgoal', subGoal.status, locale)}
              objectType="subgoal"
              size="xs"
              variant="compact"
            />
          </span>
        )}
        { }
        {subGoal.legacy && (
          <span className="flex h-6 shrink-0 items-center">
            <span
              className="ldvh-chip-sm shrink-0 border-ldvh-border bg-transparent text-ldvh-text-secondary"
              title={t('goalDetail.subGoalLegacy')}
            >
              legacy
            </span>
          </span>
        )}
        { }
        {hasObject && (
          <div className="flex min-w-0 shrink-0 items-center">
            <ServingSparkProgressBar
              rows={subGoal.serving_work ?? []}
              unreadable={subGoal.serving_unreadable}
              progressLabel={t('objectList.subGoalSparkProgress')}
              emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
              allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
              unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
              unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
              variant="inline"
              inlineLabels={{
                empty: t('focusV2.subGoalProgressEmpty'),
                allDiscarded: t('focusV2.subGoalProgressAllDiscarded'),
                unavailable: t('focusV2.subGoalProgressUnavailable'),
                emptyTitle: t('objectList.subGoalSparkProgressEmpty'),
                allDiscardedTitle: t('objectList.subGoalSparkProgressAllDiscarded'),
                unavailableTitle: t('objectList.subGoalSparkProgressUnavailable'),
              }}
            />
          </div>
        )}
        { }
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={t(expanded ? 'focusV2.subGoalCollapse' : 'focusV2.subGoalExpand')}
          title={t(expanded ? 'focusV2.subGoalCollapse' : 'focusV2.subGoalExpand')}
          onClick={toggleExpanded}
          className="flex h-6 min-w-0 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 ldvh-meta text-ldvh-text-secondary/85 transition-colors hover:bg-ldvh-border/25 hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
        >
          {expanded
            ? <ChevronUp size={12} aria-hidden="true" className="shrink-0" />
            : <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}
        </button>
      </div>

      { }
      {expanded && (
        <div className="mt-2 flex min-w-0 flex-col gap-2 pl-0">
          {subGoal.criterion && (
            <SubGoalCriterionSurface criterion={subGoal.criterion} />
          )}
          {hasObject && (
            <SubGoalServingWorkZone
              rows={subGoal.serving_work ?? []}
              unreadable={subGoal.serving_unreadable}
              showProgress={false}
            />
          )}
        </div>
      )}
    </li>
  );
}

export default function GoalSection() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [goal, setGoal] = useState<{
    title: string;
    status: string;
    statement: string;
    sub_goals: {
      id: string;
      text: string;
      status?: string;
      criterion_kind?: string;
      criterion?: string;
      object_uid?: string;
      order?: number;
      serving_work?: ServingWorkItem[];
      serving_unreadable?: string[];
      legacy?: boolean;
    }[];
  } | null>(null);
  const [goalMissing, setGoalMissing] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalExpanded, setGoalExpanded] = useState(true);
  const [copied, setCopied] = useState<'adjust' | 'create' | null>(null);

  async function handleCopy(text: string, kind: 'adjust' | 'create') {
    await copyText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
  }

  useEffect(() => {
    let cancelled = false;
    fetchCognitionGoal()
      .then((data) => {
        if (cancelled || !data.goal) return;
        setGoal(data.goal);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.code === 'goal_missing') setGoalMissing(true);
        else if (err instanceof ApiRequestError) setGoalError(err.message);
        else setGoalError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSubGoals = (goal?.sub_goals ?? []).filter((sg) => sg.status !== 'retired');

  const statementTint = getTypeSurfaceTint('goal');

  return (
    <section className="mb-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      { }
      <div
        role="button"
        tabIndex={0}
        aria-expanded={goalExpanded}
        aria-controls="cognition-goal-content"
        onClick={() => setGoalExpanded((expanded) => !expanded)}
        onKeyDown={(event) => toggleOnKeyboard(event, () => setGoalExpanded((expanded) => !expanded))}
        className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${goalExpanded ? 'mb-4' : ''}`}
      >
        <Target size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
        <h3 className="ldvh-section-title min-w-0">
          <span
            role="link"
            tabIndex={goal ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation();
              if (!goal) return;
              navigate('/goal');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              if (!goal) return;
              navigate('/goal');
            }}
            className={`group/goal inline-flex min-w-0 items-center gap-1 rounded-sm transition-colors ${goal ? 'cursor-pointer hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50' : ''}`}
            title={goal ? t('goalDetail.openDetail') : undefined}
          >
            <span className="min-w-0 truncate">{t('focusV2.goalTitle')}</span>
            { }
            {goal && (
              <ChevronRight
                size={13}
                aria-hidden="true"
                className="w-0 shrink-0 text-ldvh-text-secondary/50 opacity-0 transition-all duration-150 group-hover/goal:w-3 group-hover/goal:text-ldvh-accent group-hover/goal:opacity-100 group-focus-visible/goal:w-3 group-focus-visible/goal:opacity-100"
              />
            )}
          </span>
        </h3>
        {goal && (
          <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{visibleSubGoals.length}</span>
        )}
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <button
            type="button"
            aria-expanded={goalExpanded}
            aria-controls="cognition-goal-content"
            onClick={(event) => {
              event.stopPropagation();
              setGoalExpanded((expanded) => !expanded);
            }}
            className="ldvh-icon-button"
            title={t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}
          >
            {goalExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span className="sr-only">{t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}</span>
          </button>
        </span>
      </div>

      { }
      {goalExpanded && (
        <div id="cognition-goal-content">
          {goalMissing && (
            <button
              type="button"
              onClick={() => void handleCopy(t('focusV2.promptSetGoal'), 'create')}
              className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-dashed border-ldvh-border bg-ldvh-bg/40 px-3 py-3 text-left transition-colors hover:border-ldvh-accent/50 hover:bg-ldvh-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
              title={t('focusV2.promptSetGoal')}
            >
              <span className="ldvh-body-muted">{t('focusV2.hintCreateGoal')}</span>
              <span className="ldvh-caption text-ldvh-text-secondary/60">
                {copied === 'create' ? t('focusV2.btnCopied') : t('focusV2.hintCreateExample')}
              </span>
            </button>
          )}
          {goalError && <p className={`ldvh-body-muted ${LDVH_ERROR_TEXT_CLASS}`}>{goalError}</p>}
          {goal?.statement && (
            <div className="min-w-0 rounded-lg border px-3 py-2" style={statementTint.surface}>
              <p className="ldvh-body min-w-0 break-words" style={statementTint.body}>
                {goal.statement}
              </p>
            </div>
          )}

          {goal && visibleSubGoals.length > 0 && (
            <ul className="mt-3 min-w-0 divide-y divide-ldvh-border/70">
              {visibleSubGoals.map((sg) => (
                <SubGoalRow key={sg.id} subGoal={sg} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
