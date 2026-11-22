import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { HELP_ICONS, HELP_TAB_ICONS, NAV_ICONS, ObjectTypeIcon, SYSTEM_ICONS } from '@/components/SemanticIcon';
import { getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { getCategoryColor } from '@/utils/categoryColors';
import { useI18n } from '@/i18n/context';

const OVERVIEW_COMPARE: { icon: string; title: LocaleKey; symptom: LocaleKey; answer: LocaleKey }[] = [
  { icon: 'ai', title: 'help.overview.ai.title', symptom: 'help.overview.ai.symptom', answer: 'help.overview.ai.answer' },
  { icon: 'human', title: 'help.overview.human.title', symptom: 'help.overview.human.symptom', answer: 'help.overview.human.answer' },
  { icon: 'amplify', title: 'help.overview.friction.title', symptom: 'help.overview.friction.symptom', answer: 'help.overview.friction.answer' },
];

type StageShape = {
  title: LocaleKey;
  body: LocaleKey;
  links: { to: string; type: string }[];
};

const SPINE_STAGES: StageShape[] = [
  {
    title: 'help.spine.goal.title',
    body: 'help.spine.goal.body',
    links: [
      { to: '/goal', type: 'goal' },
      { to: '/objects/subgoal', type: 'subgoal' },
    ],
  },
  {
    title: 'help.spine.idea.title',
    body: 'help.spine.idea.body',
    links: [{ to: '/objects/spark', type: 'spark' }],
  },
  {
    title: 'help.spine.research.title',
    body: 'help.spine.research.body',
    links: [{ to: '/objects/report', type: 'report' }],
  },
  {
    title: 'help.spine.execution.title',
    body: 'help.spine.execution.body',
    links: [],
  },
  {
    title: 'help.spine.learning.title',
    body: 'help.spine.learning.body',
    links: [
      { to: '/objects/pitfall', type: 'pitfall' },
      { to: '/objects/friction', type: 'friction' },
      { to: '/objects/norm', type: 'norm' },
    ],
  },
];

const START_BRANCHES: StageShape[] = [
  {
    title: 'help.start.new.title',
    body: 'help.start.new.body',
    links: [
      { to: '/goal', type: 'goal' },
      { to: '/objects/subgoal', type: 'subgoal' },
    ],
  },
  {
    title: 'help.start.old.title',
    body: 'help.start.old.body',
    links: [
      { to: '/objects/report', type: 'report' },
      { to: '/goal', type: 'goal' },
      { to: '/objects/subgoal', type: 'subgoal' },
    ],
  },
];

const SINGLETON_MAP = {
  type: 'goal',
  to: '/goal',
  what: 'help.objects.goal.what',
  when: 'help.objects.goal.when',
  look: 'help.objects.goal.look',
} as const;

const OBJECT_MAP: { type: string; to: string; what: LocaleKey; when: LocaleKey; look: LocaleKey }[] = [
  { type: 'subgoal', to: '/objects/subgoal', what: 'help.objects.subgoal.what', when: 'help.objects.subgoal.when', look: 'help.objects.subgoal.look' },
  { type: 'spark', to: '/objects/spark', what: 'help.objects.spark.what', when: 'help.objects.spark.when', look: 'help.objects.spark.look' },
  { type: 'report', to: '/objects/report', what: 'help.objects.research.what', when: 'help.objects.research.when', look: 'help.objects.research.look' },
  { type: 'pitfall', to: '/objects/pitfall', what: 'help.objects.pitfall.what', when: 'help.objects.pitfall.when', look: 'help.objects.pitfall.look' },
  { type: 'friction', to: '/objects/friction', what: 'help.objects.friction.what', when: 'help.objects.friction.when', look: 'help.objects.friction.look' },
  { type: 'norm', to: '/objects/norm', what: 'help.objects.norm.what', when: 'help.objects.norm.when', look: 'help.objects.norm.look' },
];

const GATES: { icon: string; title: LocaleKey; trigger: LocaleKey; respond: LocaleKey }[] = [
  { icon: 'inquiry', title: 'help.gates.inquiry.title', trigger: 'help.gates.inquiry.trigger', respond: 'help.gates.inquiry.respond' },
  { icon: 'plan', title: 'help.gates.plan.title', trigger: 'help.gates.plan.trigger', respond: 'help.gates.plan.respond' },
  { icon: 'authorization', title: 'help.gates.authorization.title', trigger: 'help.gates.authorization.trigger', respond: 'help.gates.authorization.respond' },
  { icon: 'handover', title: 'help.gates.handover.title', trigger: 'help.gates.handover.trigger', respond: 'help.gates.handover.respond' },
  { icon: 'registration', title: 'help.gates.registration.title', trigger: 'help.gates.registration.trigger', respond: 'help.gates.registration.respond' },
];

const STOP_ITEMS: LocaleKey[] = [
  'help.gates.stop.1',
  'help.gates.stop.2',
  'help.gates.stop.3',
  'help.gates.stop.4',
  'help.gates.stop.5',
];

const ENTRY_MAP: { icon: string; to: string; title: LocaleKey; body: LocaleKey }[] = [
  { icon: 'cognition', to: '/', title: 'help.entries.focus.title', body: 'help.entries.focus.body' },
  { icon: 'projectFiles', to: '/project-files', title: 'help.entries.directory.title', body: 'help.entries.directory.body' },
  { icon: 'changes', to: '/changes', title: 'help.entries.changes.title', body: 'help.entries.changes.body' },
  { icon: 'changelog', to: '/changelog', title: 'help.entries.commits.title', body: 'help.entries.commits.body' },
  { icon: 'diagnostics', to: '/diagnostics', title: 'help.entries.diagnostics.title', body: 'help.entries.diagnostics.body' },
  { icon: 'federation', to: '/federation', title: 'help.entries.federation.title', body: 'help.entries.federation.body' },
];

const OBJECT_ENTRIES: { type: string; to: string }[] = [
  { type: 'goal', to: '/goal' },
  { type: 'subgoal', to: '/objects/subgoal' },
  { type: 'spark', to: '/objects/spark' },
  { type: 'norm', to: '/objects/norm' },
  { type: 'report', to: '/objects/report' },
  { type: 'pitfall', to: '/objects/pitfall' },
  { type: 'friction', to: '/objects/friction' },
];

const SYSTEM_MAP: {
  key: string;
  icon: string;
  title: LocaleKey;
  duty: LocaleKey;
  usage: LocaleKey;
  landing?: LocaleKey;
  limit: LocaleKey;
  objects: { to: string; type: string }[];
}[] = [
  {
    key: 'goalPlanning',
    icon: 'goalPlanning',
    title: 'help.systems.goalPlanning.title',
    duty: 'help.systems.goalPlanning.duty',
    usage: 'help.systems.goalPlanning.usage',
    limit: 'help.systems.goalPlanning.limit',
    objects: [
      { to: '/goal', type: 'goal' },
      { to: '/objects/subgoal', type: 'subgoal' },
    ],
  },
  {
    key: 'sparkRecord',
    icon: 'sparkRecord',
    title: 'help.systems.sparkRecord.title',
    duty: 'help.systems.sparkRecord.duty',
    usage: 'help.systems.sparkRecord.usage',
    limit: 'help.systems.sparkRecord.limit',
    objects: [{ to: '/objects/spark', type: 'spark' }],
  },
  {
    key: 'workOrder',
    icon: 'workOrder',
    title: 'help.systems.workOrder.title',
    duty: 'help.systems.workOrder.duty',
    usage: 'help.systems.workOrder.usage',
    limit: 'help.systems.workOrder.limit',
    objects: [],
  },
  {
    key: 'researchAbsorb',
    icon: 'researchAbsorb',
    title: 'help.systems.researchAbsorb.title',
    duty: 'help.systems.researchAbsorb.duty',
    usage: 'help.systems.researchAbsorb.usage',
    limit: 'help.systems.researchAbsorb.limit',
    objects: [{ to: '/objects/report', type: 'report' }],
  },
  {
    key: 'dualRecall',
    icon: 'dualRecall',
    title: 'help.systems.dualRecall.title',
    duty: 'help.systems.dualRecall.duty',
    usage: 'help.systems.dualRecall.usage',
    landing: 'help.systems.dualRecall.landing',
    limit: 'help.systems.dualRecall.limit',
    objects: [],
  },
  {
    key: 'experience',
    icon: 'experience',
    title: 'help.systems.experience.title',
    duty: 'help.systems.experience.duty',
    usage: 'help.systems.experience.usage',
    limit: 'help.systems.experience.limit',
    objects: [
      { to: '/objects/pitfall', type: 'pitfall' },
      { to: '/objects/spark', type: 'spark' },
    ],
  },
  {
    key: 'friction',
    icon: 'friction',
    title: 'help.systems.friction.title',
    duty: 'help.systems.friction.duty',
    usage: 'help.systems.friction.usage',
    limit: 'help.systems.friction.limit',
    objects: [{ to: '/objects/friction', type: 'friction' }],
  },
];

const TRUST_LAYERS: {
  key: string;
  title: LocaleKey;
  hint: LocaleKey;
  body: LocaleKey;
  markClass: string;
  hintClass: string;
}[] = [
  {
    key: 'confirmed',
    title: 'help.trust.layers.confirmed.title',
    hint: 'help.trust.layers.confirmed.hint',
    body: 'help.trust.layers.confirmed.body',
    markClass: 'bg-ldvh-accent',
    hintClass: 'text-ldvh-accent',
  },
  {
    key: 'unconfirmed',
    title: 'help.trust.layers.unconfirmed.title',
    hint: 'help.trust.layers.unconfirmed.hint',
    body: 'help.trust.layers.unconfirmed.body',
    markClass: 'border border-ldvh-text-secondary/70 bg-transparent',
    hintClass: 'text-ldvh-text-secondary',
  },
  {
    key: 'residual',
    title: 'help.trust.layers.residual.title',
    hint: 'help.trust.layers.residual.hint',
    body: 'help.trust.layers.residual.body',
    markClass: 'border border-dashed border-amber-600 bg-amber-500/10 dark:border-amber-400',
    hintClass: 'text-amber-700 dark:text-amber-300',
  },
];

const NOT_PROOF_ITEMS: LocaleKey[] = [
  'help.trust.notproof.1',
  'help.trust.notproof.2',
  'help.trust.notproof.3',
  'help.trust.notproof.4',
  'help.trust.notproof.5',
  'help.trust.notproof.6',
  'help.trust.notproof.7',
];

const PUSHBACK_ITEMS: LocaleKey[] = [
  'help.trust.pushback.1',
  'help.trust.pushback.2',
  'help.trust.pushback.3',
  'help.trust.pushback.4',
];

const TABS = [
  { id: 'start', icon: 'start', label: 'help.tab.start', title: 'help.panel.start.title', lead: 'help.start.lead' },
  { id: 'overview', icon: 'overview', label: 'help.tab.overview', title: 'help.panel.overview.title', lead: 'help.overview.lead' },
  { id: 'objects', icon: 'objects', label: 'help.tab.objects', title: 'help.panel.objects.title', lead: 'help.objects.lead' },
  { id: 'systems', icon: 'systems', label: 'help.tab.systems', title: 'help.panel.systems.title', lead: 'help.systems.lead' },
  { id: 'gates', icon: 'gates', label: 'help.tab.gates', title: 'help.panel.gates.title', lead: 'help.gates.lead' },
  { id: 'entries', icon: 'entries', label: 'help.tab.entries', title: 'help.panel.entries.title', lead: 'help.entries.lead' },
  { id: 'trust', icon: 'trust', label: 'help.tab.trust', title: 'help.panel.trust.title', lead: 'help.trust.lead' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Help() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('start');
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    const barRect = bar.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.top >= barRect.bottom - 1) return;
    panel.style.scrollMarginTop = `${bar.offsetHeight}px`;
    panel.scrollIntoView({ block: 'start' });
  }, [tab]);

  const current = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const ChapterIcon = HELP_TAB_ICONS[current.icon];

  return (
    <div className="ldvh-page-frame">
      <div className="ldvh-help-column">
        <div className="ldvh-page-toolbar min-w-0 shrink-0">
          <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} compact />
        </div>

        <div className="mt-3">
          <Notice>{t('help.disclaimer')}</Notice>
        </div>
      </div>

      <div ref={barRef} className="sticky top-0 z-20 -mx-6 mt-4 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-2 backdrop-blur">
        <div className="ldvh-help-column ldvh-help-index">
          <div className="ldvh-tab-list" aria-label={t('help.tabLabel')}>
            {TABS.map((entry) => {
              const Icon = HELP_TAB_ICONS[entry.icon];
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                  className={`ldvh-tab-button ${tab === entry.id ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
                >
                  <Icon size={13} aria-hidden="true" />
                  {t(entry.label)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <article ref={panelRef} className="ldvh-help-column min-w-0 pb-8">
        {}
        <header className="ldvh-help-opener mt-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ldvh-accent text-white dark:text-ldvh-bg">
              <ChapterIcon size={14} aria-hidden="true" />
            </span>
            <h2 className="ldvh-region-title min-w-0">{t(current.title)}</h2>
          </div>
          <p className="ldvh-body max-w-[40rem]">{t(current.lead)}</p>
        </header>

        {tab === 'start' && <StartBody />}
        {tab === 'overview' && <OverviewBody />}
        {tab === 'objects' && <ObjectsBody />}
        {tab === 'systems' && <SystemsBody />}
        {tab === 'gates' && <GatesBody />}
        {tab === 'entries' && <EntriesBody />}
        {tab === 'trust' && <TrustBody />}

        <ChapterFooter tab={tab} onJump={setTab} />
      </article>
    </div>
  );
}

function ChapterFooter({ tab, onJump }: { tab: TabId; onJump: (id: TabId) => void }) {
  const { t } = useI18n();
  const index = TABS.findIndex((entry) => entry.id === tab);
  const next = TABS[index + 1];
  if (!next) return null;
  return (
    <div className="ldvh-help-chapter-foot">
      <span className="ldvh-caption-strong min-w-0">{t('help.nextChapter')}</span>
      <button
        type="button"
        onClick={() => onJump(next.id)}
        className="ldvh-body inline-flex min-w-0 items-center gap-1.5 rounded-sm text-ldvh-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
      >
        <span className="truncate">{t(next.label)}</span>
        <ArrowRight size={14} className="shrink-0" aria-hidden="true" />
      </button>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div data-presentation="notice" className="ldvh-help-scope">
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-accent">
        <HELP_ICONS.info size={15} aria-hidden="true" />
      </span>
      <p className="ldvh-body min-w-0">{children}</p>
    </div>
  );
}

function CompareTable({ rows }: { rows: typeof OVERVIEW_COMPARE }) {
  const { t } = useI18n();
  return (
    <div data-presentation="compare" className="ldvh-help-sheet">
      <div className="ldvh-help-compare-head flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ldvh-border px-4 py-2.5">
        <span className="ldvh-caption-strong w-40 shrink-0">{t('help.overview.shortcomingLabel')}</span>
        <span className="ldvh-caption-strong min-w-[15rem] flex-1">{t('help.overview.symptomLabel')}</span>
        {}
        <span className="ldvh-caption-strong min-w-[15rem] flex-1 rounded-md bg-ldvh-accent/10 px-2.5 py-1.5">
          {t('help.overview.answerLabel')}
        </span>
      </div>
      {rows.map((row) => {
        const Icon = HELP_ICONS[row.icon];
        return (
          <div key={row.title} className="ldvh-help-entry flex flex-wrap items-start gap-x-6 gap-y-2">
            <div className="flex w-40 shrink-0 items-start gap-2">
              <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-text-secondary">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="ldvh-card-title min-w-0">{t(row.title)}</span>
            </div>
            <p className="ldvh-body min-w-[15rem] flex-1">{t(row.symptom)}</p>
            <p className="ldvh-body min-w-[15rem] flex-1 rounded-md bg-ldvh-accent/10 px-2.5 py-1.5">{t(row.answer)}</p>
          </div>
        );
      })}
    </div>
  );
}

function StageCard({ stage, stacked = false }: { stage: StageShape; stacked?: boolean }) {
  const { t } = useI18n();
  return (
    <article data-presentation="stage" className={stacked ? 'ldvh-help-entry' : 'ldvh-help-stage'}>
      {}
      <h3 className="ldvh-card-title min-w-0">{t(stage.title)}</h3>
      <p className="ldvh-body mt-1 max-w-[40rem]">{t(stage.body)}</p>
      {stage.links.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 pt-1.5">
          {stage.links.map((link) => (
            <TypeLink key={link.type} to={link.to} type={link.type} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function EntryHead({
  icon,
  title,
  trailing,
  tint,
}: {
  icon: ReactNode;
  title: string;
  trailing?: ReactNode;
  tint?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tint ? '' : 'text-ldvh-text-secondary'}`}
        style={tint ? { backgroundColor: `${tint}1f` } : undefined}
      >
        {icon}
      </span>
      <h3 className="ldvh-card-title min-w-0 flex-1">{title}</h3>
      {trailing ? <span className="flex h-6 shrink-0 items-center">{trailing}</span> : null}
    </div>
  );
}

function EntryCard({
  icon,
  title,
  rows,
  limit,
  landing,
  tint,
}: {
  icon: ReactNode;
  title: string;
  rows: { key: string; label: LocaleKey; value: ReactNode }[];
  limit?: { label: LocaleKey; value: LocaleKey };
  landing?: ReactNode;
  tint?: string;
}) {
  const { t } = useI18n();
  return (
    <article data-presentation="entry-card" className="ldvh-help-entry">
      <EntryHead icon={icon} title={title} trailing={landing} tint={tint} />
      <dl className="ldvh-help-fields">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <dt className="ldvh-caption-strong">{t(row.label)}</dt>
            <dd className="ldvh-body">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      {limit ? (
        <dl data-voice="secondary" className="ldvh-help-fields ldvh-help-limit">
          <dt className="ldvh-caption-strong">{t(limit.label)}</dt>
          <dd className="ldvh-body-muted">{t(limit.value)}</dd>
        </dl>
      ) : null}
    </article>
  );
}

function RowList({ rows }: { rows: { key: string; content: ReactNode }[] }) {
  return (
    <ul data-presentation="rows" className="ldvh-help-sheet">
      {rows.map((row) => (
        <li key={row.key} className="ldvh-help-entry">
          {row.content}
        </li>
      ))}
    </ul>
  );
}

function ChipList({ items }: { items: { key: string; content: ReactNode }[] }) {
  return (
    <ul data-presentation="chips" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.key} className="ldvh-chip-tag">
          {item.content}
        </li>
      ))}
    </ul>
  );
}

function StepList({ children }: { children: ReactNode }) {
  return (
    <ol data-presentation="steps" className="mt-6 flex min-w-0 flex-col">
      {children}
    </ol>
  );
}

function Ladder({ layers }: { layers: typeof TRUST_LAYERS }) {
  const { t } = useI18n();
  return (
    <div data-presentation="ladder" className="ldvh-help-sheet">
      {layers.map((layer) => (
        <div key={layer.key} className="ldvh-help-entry flex min-w-0 items-start gap-3">
          <span className="flex h-6 w-2.5 shrink-0 items-center" aria-hidden="true">
            <span className={`ldvh-help-mark ${layer.markClass}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ldvh-card-title">{t(layer.title)}</h3>
              <span className={`ldvh-chip ${layer.hintClass}`}>{t(layer.hint)}</span>
            </div>
            <p className="ldvh-body mt-0.5 max-w-[40rem]">{t(layer.body)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Hint({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div data-presentation="hint" className="ldvh-help-note">
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-accent">
        <HELP_ICONS.info size={15} aria-hidden="true" />
      </span>
      <p className="ldvh-body min-w-0">
        {title ? <span className="font-medium">{title}</span> : null}
        {title ? ' ' : null}
        {children}
      </p>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="ldvh-section-title">{children}</p>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      {}
      <div className="flex min-w-0 items-center gap-3">
        <GroupLabel>{label}</GroupLabel>
        <span className="h-px min-w-0 flex-1 bg-ldvh-text-secondary/30" aria-hidden="true" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TypeLink({ to, type, showIcon = true }: { to: string; type: string; showIcon?: boolean }) {
  const { locale } = useI18n();
  return (
    <Link
      to={to}
      className="ldvh-body inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
    >
      {showIcon ? <ObjectTypeIcon type={type} size={13} style={{ color: getCategoryColor(type) }} /> : null}
      <span className="truncate">{getTypeLabel(type, locale)}</span>
      <ArrowRight size={13} className="shrink-0 text-ldvh-text-secondary/70" aria-hidden="true" />
    </Link>
  );
}

function EntryLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="ldvh-body inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
    >
      <span className="truncate">{label}</span>
      <ArrowRight size={13} className="shrink-0 text-ldvh-text-secondary/70" aria-hidden="true" />
    </Link>
  );
}

function StartBody() {
  const { t } = useI18n();
  const steps: { key: string; title: LocaleKey; body: LocaleKey; hintTitle?: LocaleKey; hint?: LocaleKey }[] = [
    {
      key: 'project',
      title: 'help.start.step1.title',
      body: 'help.start.step1.body',
      hintTitle: 'help.start.step1.hintTitle',
      hint: 'help.start.step1.hint',
    },
    {
      key: 'goal',
      title: 'help.start.step2.title',
      body: 'help.start.step2.body',
    },
  ];

  return (
    <StepList>
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={
            index === 0 ? 'min-w-0' : 'mt-7 min-w-0 border-t border-ldvh-text-secondary/30 pt-6'
          }
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ldvh-accent text-white dark:text-ldvh-bg">
              <span className="ldvh-chip">{index + 1}</span>
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="ldvh-card-title">{t(step.title)}</h3>
              <p className="ldvh-body mt-1 max-w-[40rem]">{t(step.body)}</p>
              {step.hint ? (
                <div className="max-w-[40rem]">
                  <Hint title={step.hintTitle ? t(step.hintTitle) : undefined}>{t(step.hint)}</Hint>
                </div>
              ) : null}
              {index === 1 ? (
                <>
                  {}
                  <div className="mt-7">
                    <GroupLabel>{t('help.start.branchLabel')}</GroupLabel>
                  </div>
                  <div className="ldvh-section-grid mt-3">
                    {START_BRANCHES.map((branch) => (
                      <StageCard key={branch.title} stage={branch} />
                    ))}
                  </div>
                  <div className="max-w-[40rem]">
                    <Hint title={t('help.start.nextTitle')}>{t('help.start.next')}</Hint>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </StepList>
  );
}

function OverviewBody() {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <Section label={t('help.overview.title')}>
        <CompareTable rows={OVERVIEW_COMPARE} />
      </Section>

      <Section label={t('help.spine.title')}>
        <p className="ldvh-body max-w-[40rem]">{t('help.spine.lead')}</p>
        <div className="ldvh-help-sheet mt-5">
          {SPINE_STAGES.map((stage) => (
            <StageCard key={stage.title} stage={stage} stacked />
          ))}
        </div>
        <div className="max-w-[40rem]">
          <Hint title={t('help.spine.recallTitle')}>{t('help.spine.recall')}</Hint>
        </div>
      </Section>
    </div>
  );
}

function ObjectsBody() {
  const { t, locale } = useI18n();
  const entries = [SINGLETON_MAP, ...OBJECT_MAP];

  return (
    <div className="ldvh-help-sheet mt-6">
      {entries.map((entry) => (
        <EntryCard
          key={entry.type}
          icon={<ObjectTypeIcon type={entry.type} size={15} style={{ color: getCategoryColor(entry.type) }} />}
          tint={getCategoryColor(entry.type)}
          title={getTypeLabel(entry.type, locale)}
          rows={[
            { key: 'what', label: 'help.objects.whatLabel', value: t(entry.what) },
            { key: 'when', label: 'help.objects.whenLabel', value: t(entry.when) },
            { key: 'look', label: 'help.objects.lookLabel', value: t(entry.look) },
          ]}
          landing={<TypeLink to={entry.to} type={entry.type} showIcon={false} />}
        />
      ))}
    </div>
  );
}

function SystemsBody() {
  const { t } = useI18n();
  return (
    <div className="ldvh-help-sheet mt-6">
      {SYSTEM_MAP.map((system) => {
        const Icon = SYSTEM_ICONS[system.icon];
        const rows: { key: string; label: LocaleKey; value: ReactNode }[] = [
          { key: 'duty', label: 'help.systems.dutyLabel', value: t(system.duty) },
          { key: 'usage', label: 'help.systems.usageLabel', value: t(system.usage) },
        ];
        if (system.objects.length > 0 || system.landing) {
          rows.push({
            key: 'landing',
            label: 'help.systems.landingLabel',
            value:
              system.objects.length > 0 ? (
                <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                  {system.objects.map((object) => (
                    <TypeLink key={object.type} to={object.to} type={object.type} />
                  ))}
                </span>
              ) : (
                system.landing ? t(system.landing) : null
              ),
          });
        }
        return (
          <EntryCard
            key={system.key}
            icon={<Icon size={15} aria-hidden="true" />}
            title={t(system.title)}
            rows={rows}
            limit={{ label: 'help.systems.limitLabel', value: system.limit }}
          />
        );
      })}
    </div>
  );
}

function GatesBody() {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="ldvh-help-sheet mt-6">
        {GATES.map((gate) => {
          const Icon = HELP_ICONS[gate.icon];
          return (
            <EntryCard
              key={gate.title}
              icon={<Icon size={15} aria-hidden="true" />}
              title={t(gate.title)}
              rows={[
                { key: 'trigger', label: 'help.gates.triggerLabel', value: t(gate.trigger) },
                { key: 'respond', label: 'help.gates.respondLabel', value: t(gate.respond) },
              ]}
            />
          );
        })}
      </div>

      <Section label={t('help.gates.stop.title')}>
        <RowList
          rows={STOP_ITEMS.map((item) => ({
            key: item,
            content: (
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-6 w-1.5 shrink-0 items-center" aria-hidden="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-ldvh-accent" />
                </span>
                <p className="ldvh-body min-w-0">{t(item)}</p>
              </div>
            ),
          }))}
        />
        <div className="max-w-[40rem]">
          <Hint>{t('help.gates.stop.note')}</Hint>
        </div>
      </Section>
    </div>
  );
}

function EntriesBody() {
  const { t, locale } = useI18n();
  return (
    <div className="min-w-0">
      <RowList
        rows={ENTRY_MAP.map((entry) => {
          const Icon = NAV_ICONS[entry.icon];
          return {
            key: entry.title,
            content: (
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-text-secondary">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="ldvh-card-title">{t(entry.title)}</h3>
                  <p className="ldvh-body mt-1 max-w-[40rem]">{t(entry.body)}</p>
                </div>
                <span className="flex h-6 shrink-0 items-center">
                  <EntryLink to={entry.to} label={t('help.entries.goLabel')} />
                </span>
              </div>
            ),
          };
        })}
      />

      <Section label={t('help.entries.objectsLabel')}>
        <ChipList
          items={OBJECT_ENTRIES.map((entry) => ({
            key: entry.type,
            content: (
              <Link
                to={entry.to}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
              >
                <ObjectTypeIcon type={entry.type} size={13} style={{ color: getCategoryColor(entry.type) }} />
                <span className="truncate">{getTypeLabel(entry.type, locale)}</span>
              </Link>
            ),
          }))}
        />
      </Section>
    </div>
  );
}

function TrustBody() {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <Section label={t('help.trust.layers.title')}>
        <Ladder layers={TRUST_LAYERS} />
      </Section>

      <Section label={t('help.trust.notproof.title')}>
        <ChipList items={NOT_PROOF_ITEMS.map((item) => ({ key: item, content: t(item) }))} />
      </Section>

      <Section label={t('help.trust.pushback.title')}>
        <RowList
          rows={PUSHBACK_ITEMS.map((item) => ({
            key: item,
            content: (
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-6 w-1.5 shrink-0 items-center" aria-hidden="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                </span>
                <p className="ldvh-body min-w-0">{t(item)}</p>
              </div>
            ),
          }))}
        />
      </Section>
    </div>
  );
}
