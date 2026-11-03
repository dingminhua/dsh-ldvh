/**
 * 帮助页（`/help`）——LDVH Web 的静态导览页。
 *
 * **它是什么**：给 Human 的一份使用引导，讲清三件事——这套系统解决什么问题、
 * 与 AI 配合时内容会落成什么形态、AI 在什么情况下会停下来找你。
 *
 * **它不是什么**：
 * - 不是规则源。页面上的每一句都是对当前规范源的**通俗转述**，不产生规范效力；
 *   规则以规范源为准，事实以事实源为准（00 §3.2、§3.3）。
 * - 不是对象卡片的又一版。页内没有一条事实对象记录，因此不套对象卡框契约
 *   （`docs/01` §1.10 第 9 条针对的是「呈现一条对象记录」）；本页用的是
 *   `ldvh-panel` 面板与 `ldvh-section-grid` 卡片网格（§1.8.1）。
 * - 不是营销页。首屏用普通面板与语义排版类，不做渐变英雄区与大留白
 *   （§1.8.1「不使用营销式大留白或英雄区」、§1.10「密度和响应式」第 1 条）。
 *
 * **形态**：顶部一屏概览（LDVH 是什么 + 与 AI 配合的主线），下方一个 sticky
 * 分区切换（对象地图 / 何时停下来找你 / 入口地图 / 怎么判断它说完了）。长内容
 * 用分区入口收，不一次铺满（07 §12 第 7 条）。
 *
 * 纯静态、只读、零数据请求；所有可见文案走 i18n（`docs/01` §1.3）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BrainCircuit,
  CircleHelp,
  ClipboardCheck,
  FolderPlus,
  KeyRound,
  PackageCheck,
  UserRound,
  Users,
  type LucideProps,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { NAV_ICONS, ObjectTypeIcon, SYSTEM_ICONS } from '@/components/SemanticIcon';
import { getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { getCategoryColor } from '@/utils/categoryColors';
import { useI18n } from '@/i18n/context';

type IconComponent = ElementType<LucideProps>;

/** 概览三卡：AI 的短板、人的短板、两者叠加。 */
const OVERVIEW_CARDS: { icon: IconComponent; title: LocaleKey; symptom: LocaleKey; answer: LocaleKey }[] = [
  {
    icon: BrainCircuit,
    title: 'help.overview.ai.title',
    symptom: 'help.overview.ai.symptom',
    answer: 'help.overview.ai.answer',
  },
  {
    icon: UserRound,
    title: 'help.overview.human.title',
    symptom: 'help.overview.human.symptom',
    answer: 'help.overview.human.answer',
  },
  {
    icon: Users,
    title: 'help.overview.friction.title',
    symptom: 'help.overview.friction.symptom',
    answer: 'help.overview.friction.answer',
  },
];

/**
 * 与 AI 配合的主线：六段形态，各带承载对象。
 *
 * **不给编号**：这些形态之间没有来源已成立的先后序号（`docs/01` §1.5 第 12 条：
 * 没有先后关系的同级集合统一使用圆点，编号只留给来源已经成立的步骤）。左到右
 * 只是阅读顺序；引导语明说「不是必须照走的流水线」。
 */
const SPINE_STAGES: {
  title: LocaleKey;
  body: LocaleKey;
  links: { to: string; type: string }[];
}[] = [
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
    links: [{ to: '/objects/research', type: 'research' }],
  },
  {
    title: 'help.spine.decision.title',
    body: 'help.spine.decision.body',
    links: [{ to: '/objects/adr', type: 'adr' }],
  },
  {
    title: 'help.spine.execution.title',
    body: 'help.spine.execution.body',
    links: [{ to: '/objects/workcase', type: 'workcase' }],
  },
  {
    title: 'help.spine.learning.title',
    body: 'help.spine.learning.body',
    links: [
      { to: '/objects/pitfall', type: 'pitfall' },
      { to: '/objects/friction', type: 'friction' },
      { to: '/objects/norm', type: 'norm' },
      { to: '/objects/devlog', type: 'devlog' },
    ],
  },
];

/** 对象地图：全部九类事实对象，顺序与左侧导航的对象族一致。 */
const OBJECT_MAP: { type: string; to: string; what: LocaleKey; when: LocaleKey; look: LocaleKey }[] = [
  { type: 'subgoal', to: '/objects/subgoal', what: 'help.objects.subgoal.what', when: 'help.objects.subgoal.when', look: 'help.objects.subgoal.look' },
  { type: 'spark', to: '/objects/spark', what: 'help.objects.spark.what', when: 'help.objects.spark.when', look: 'help.objects.spark.look' },
  { type: 'workcase', to: '/objects/workcase', what: 'help.objects.workcase.what', when: 'help.objects.workcase.when', look: 'help.objects.workcase.look' },
  { type: 'research', to: '/objects/research', what: 'help.objects.research.what', when: 'help.objects.research.when', look: 'help.objects.research.look' },
  { type: 'adr', to: '/objects/adr', what: 'help.objects.adr.what', when: 'help.objects.adr.when', look: 'help.objects.adr.look' },
  { type: 'pitfall', to: '/objects/pitfall', what: 'help.objects.pitfall.what', when: 'help.objects.pitfall.when', look: 'help.objects.pitfall.look' },
  { type: 'friction', to: '/objects/friction', what: 'help.objects.friction.what', when: 'help.objects.friction.when', look: 'help.objects.friction.look' },
  { type: 'norm', to: '/objects/norm', what: 'help.objects.norm.what', when: 'help.objects.norm.when', look: 'help.objects.norm.look' },
  { type: 'devlog', to: '/objects/devlog', what: 'help.objects.devlog.what', when: 'help.objects.devlog.when', look: 'help.objects.devlog.look' },
];

/** 交互入口：07 §6 的五类入口——Human Gate 与交还流程在 Web 上的落点。 */
const GATES: { icon: IconComponent; title: LocaleKey; trigger: LocaleKey; respond: LocaleKey }[] = [
  { icon: CircleHelp, title: 'help.gates.inquiry.title', trigger: 'help.gates.inquiry.trigger', respond: 'help.gates.inquiry.respond' },
  { icon: ClipboardCheck, title: 'help.gates.plan.title', trigger: 'help.gates.plan.trigger', respond: 'help.gates.plan.respond' },
  { icon: KeyRound, title: 'help.gates.authorization.title', trigger: 'help.gates.authorization.trigger', respond: 'help.gates.authorization.respond' },
  { icon: PackageCheck, title: 'help.gates.handover.title', trigger: 'help.gates.handover.trigger', respond: 'help.gates.handover.respond' },
  { icon: FolderPlus, title: 'help.gates.registration.title', trigger: 'help.gates.registration.trigger', respond: 'help.gates.registration.respond' },
];

/** 必停情形（00 §5.7）——到这些点上它会停下，而不是硬答。 */
const STOP_ITEMS: LocaleKey[] = [
  'help.gates.stop.1',
  'help.gates.stop.2',
  'help.gates.stop.3',
  'help.gates.stop.4',
  'help.gates.stop.5',
];

/** 入口地图：左侧导航里不指向事实对象的那些入口。 */
const ENTRY_MAP: { icon: string; to: string; title: LocaleKey; body: LocaleKey }[] = [
  { icon: 'cognition', to: '/', title: 'help.entries.focus.title', body: 'help.entries.focus.body' },
  { icon: 'projectFiles', to: '/project-files', title: 'help.entries.directory.title', body: 'help.entries.directory.body' },
  { icon: 'changes', to: '/changes', title: 'help.entries.changes.title', body: 'help.entries.changes.body' },
  { icon: 'changelog', to: '/changelog', title: 'help.entries.commits.title', body: 'help.entries.commits.body' },
  { icon: 'diagnostics', to: '/diagnostics', title: 'help.entries.diagnostics.title', body: 'help.entries.diagnostics.body' },
  { icon: 'federation', to: '/federation', title: 'help.entries.federation.title', body: 'help.entries.federation.body' },
];

/**
 * 七大业务系统（03 §9.1–§9.7，00 §3.4）。
 *
 * **为什么单独讲**：页面其余部分讲的是**形态**（对象类型）与**入口**（导航），而这七项是
 * **规范层的过程**——它们各自管一段业务过程，结论落在对象上，但系统本身不是对象。
 * 「对象是什么」与「这件事由谁管、怎么用」是两件事，缺一件，人就只看得见名词。
 *
 * **每个系统给四行**：它管什么 / 你怎么用 / 落到哪里 / 它不保证什么。最后一行不是客套
 * ——每个系统的边界都是一条防自欺条款（「登记了」不等于「推进了」），与「怎么判断它说
 * 完了」分区是同一件事的两个落点。
 *
 * **落到哪里**：系统结论所依附的事实对象，可直接打开；双源召回不留独立对象（它是横切
 * 过程），故那一格给文字说明而不是链接。
 */
const SYSTEM_MAP: {
  key: string;
  icon: string;
  title: LocaleKey;
  duty: LocaleKey;
  usage: LocaleKey;
  /** 仅横切的双源召回没有承载对象，它那一格给文字说明而不是链接。 */
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
    objects: [{ to: '/objects/workcase', type: 'workcase' }],
  },
  {
    key: 'researchAbsorb',
    icon: 'researchAbsorb',
    title: 'help.systems.researchAbsorb.title',
    duty: 'help.systems.researchAbsorb.duty',
    usage: 'help.systems.researchAbsorb.usage',
    limit: 'help.systems.researchAbsorb.limit',
    objects: [{ to: '/objects/research', type: 'research' }],
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

/** 声明的三层（00 §5.6 据实声明）。 */
const TRUST_LAYERS: { title: LocaleKey; body: LocaleKey }[] = [
  { title: 'help.trust.layers.confirmed.title', body: 'help.trust.layers.confirmed.body' },
  { title: 'help.trust.layers.unconfirmed.title', body: 'help.trust.layers.unconfirmed.body' },
  { title: 'help.trust.layers.residual.title', body: 'help.trust.layers.residual.body' },
];

/** 都不能单独证明完成的那些事（00 §5.6 末段）。 */
const NOT_PROOF_ITEMS: LocaleKey[] = [
  'help.trust.notproof.1',
  'help.trust.notproof.2',
  'help.trust.notproof.3',
  'help.trust.notproof.4',
  'help.trust.notproof.5',
  'help.trust.notproof.6',
  'help.trust.notproof.7',
];

/** 值得退回去重问的情形。 */
const PUSHBACK_ITEMS: LocaleKey[] = [
  'help.trust.pushback.1',
  'help.trust.pushback.2',
  'help.trust.pushback.3',
  'help.trust.pushback.4',
];

const TABS = [
  { id: 'objects', label: 'help.tab.objects' },
  { id: 'gates', label: 'help.tab.gates' },
  { id: 'entries', label: 'help.tab.entries' },
  { id: 'systems', label: 'help.tab.systems' },
  { id: 'trust', label: 'help.tab.trust' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Help() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('objects');
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingPanelScroll = useRef(false);

  /**
   * 切换分区后把分区内容的起点带到 sticky 切换区正下方。
   *
   * **为什么**：这页的概览与分区内容都很长，切换区是 sticky 的。人在长页里点切换，
   * 视口往往停在旧分区中段——切完看到的是新分区的中段，不是开头。这里按切换区
   * 的**实测高度**留出 `scroll-margin-top`（切换区在窄屏会折行变高，写死高度会
   * 露出被遮住的第一行），再把分区起点滚到切换区下方。
   */
  useEffect(() => {
    if (!pendingPanelScroll.current) return;
    pendingPanelScroll.current = false;
    const bar = barRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    panel.style.scrollMarginTop = `${bar.offsetHeight}px`;
    panel.scrollIntoView({ block: 'start' });
  }, [tab]);

  function handleTabChange(next: TabId) {
    if (next === tab) return;
    pendingPanelScroll.current = true;
    setTab(next);
  }

  return (
    <div className="ldvh-page-frame">
      <div className="ldvh-page-toolbar mb-4 min-w-0 shrink-0">
        <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} compact />
      </div>

      {/* 概览一：这套系统解决什么——三类问题，各对应一类机制。 */}
      <section className="mb-5 min-w-0">
        <h2 className="ldvh-section-title">{t('help.overview.title')}</h2>
        <p className="ldvh-body-muted mt-1 max-w-[62rem]">{t('help.overview.lead')}</p>
        <div className="ldvh-section-grid mt-3">
          {OVERVIEW_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <article key={card.title} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon size={15} className="shrink-0 text-ldvh-text-secondary" aria-hidden="true" />
                  <h3 className="ldvh-card-title min-w-0">{t(card.title)}</h3>
                </div>
                <p className="ldvh-body-muted mt-2">{t(card.symptom)}</p>
                <p className="ldvh-body mt-2">{t(card.answer)}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* 概览二：与 AI 配合的主线——六段形态，落在哪些对象上。 */}
      <section className="mb-5 min-w-0">
        <h2 className="ldvh-section-title">{t('help.spine.title')}</h2>
        <p className="ldvh-body-muted mt-1 max-w-[62rem]">{t('help.spine.lead')}</p>
        <div className="mt-3 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <div className="ldvh-subgrid">
            {SPINE_STAGES.map((stage) => (
              <div key={stage.title} className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  {stage.links.map((link) => (
                    <ObjectTypeIcon
                      key={link.type}
                      type={link.type}
                      size={14}
                      style={{ color: getCategoryColor(link.type) }}
                    />
                  ))}
                  <h3 className="ldvh-card-title min-w-0">{t(stage.title)}</h3>
                </div>
                <p className="ldvh-body-muted mt-1">{t(stage.body)}</p>
                <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                  {stage.links.map((link) => (
                    <TypeLink key={link.type} to={link.to} type={link.type} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="ldvh-body-muted mt-4 border-t border-ldvh-border/70 pt-3">{t('help.spine.recall')}</p>
        </div>
      </section>

      {/* 分区切换：sticky 固定在主滚动容器顶部，长正文滚动时切换区不滚出。 */}
      <div ref={barRef} className="sticky top-0 z-20 -mx-6 mb-4 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
        <div className="ldvh-tab-list" aria-label={t('help.tabLabel')}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={tab === entry.id}
              onClick={() => handleTabChange(entry.id)}
              className={`ldvh-tab-button ${tab === entry.id ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
      </div>

      <div ref={panelRef} className="min-w-0 pb-6">
        {tab === 'objects' && <ObjectMapPanel />}
        {tab === 'gates' && <GatesPanel />}
        {tab === 'entries' && <EntriesPanel />}
        {tab === 'systems' && <SystemsPanel />}
        {tab === 'trust' && <TrustPanel />}
      </div>

      {/* 页脚声明：本页是描述性引导，不是规则源——规则以规范源为准，事实以事实源为准
          （00 §3.2、§3.3）。放在分区内容之后，四区共用一条，不随分区切换。 */}
      <p className="ldvh-caption mt-2 border-t border-ldvh-border/70 pt-3">{t('help.disclaimer')}</p>
    </div>
  );
}

/** 对象类型链接：类型图标 + 类型名 + 进入箭头（进入主路由用 ArrowRight，09 §5）。 */
function TypeLink({ to, type }: { to: string; type: string }) {
  const { locale } = useI18n();
  return (
    <Link
      to={to}
      className="ldvh-body inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
    >
      <ObjectTypeIcon type={type} size={13} style={{ color: getCategoryColor(type) }} />
      <span className="truncate">{getTypeLabel(type, locale)}</span>
      <ArrowRight size={13} className="shrink-0 text-ldvh-text-secondary/70" aria-hidden="true" />
    </Link>
  );
}

function ObjectMapPanel() {
  const { t, locale } = useI18n();
  return (
    <section className="min-w-0">
      <p className="ldvh-body-muted max-w-[62rem]">{t('help.objects.lead')}</p>
      <div className="ldvh-section-grid mt-3">
        {OBJECT_MAP.map((entry) => (
          <article key={entry.type} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
            <div className="flex min-w-0 items-center gap-2">
              <ObjectTypeIcon type={entry.type} size={16} style={{ color: getCategoryColor(entry.type) }} />
              <h3 className="ldvh-card-title min-w-0">{getTypeLabel(entry.type, locale)}</h3>
            </div>
            <dl className="mt-3 flex min-w-0 flex-col gap-2">
              <div>
                <dt className="ldvh-caption-strong">{t('help.objects.whatLabel')}</dt>
                <dd className="ldvh-body-muted mt-0.5">{t(entry.what)}</dd>
              </div>
              <div>
                <dt className="ldvh-caption-strong">{t('help.objects.whenLabel')}</dt>
                <dd className="ldvh-body-muted mt-0.5">{t(entry.when)}</dd>
              </div>
              <div>
                <dt className="ldvh-caption-strong">{t('help.objects.lookLabel')}</dt>
                <dd className="ldvh-body-muted mt-0.5">{t(entry.look)}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <TypeLink to={entry.to} type={entry.type} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function GatesPanel() {
  const { t } = useI18n();
  return (
    <section className="min-w-0">
      <p className="ldvh-body-muted max-w-[62rem]">{t('help.gates.lead')}</p>
      <div className="ldvh-section-grid mt-3">
        {GATES.map((gate) => {
          const Icon = gate.icon;
          return (
            <article key={gate.title} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
              <div className="flex min-w-0 items-center gap-2">
                <Icon size={15} className="shrink-0 text-ldvh-text-secondary" aria-hidden="true" />
                <h3 className="ldvh-card-title min-w-0">{t(gate.title)}</h3>
              </div>
              <dl className="mt-3 flex min-w-0 flex-col gap-2">
                <div>
                  <dt className="ldvh-caption-strong">{t('help.gates.triggerLabel')}</dt>
                  <dd className="ldvh-body-muted mt-0.5">{t(gate.trigger)}</dd>
                </div>
                <div>
                  <dt className="ldvh-caption-strong">{t('help.gates.respondLabel')}</dt>
                  <dd className="ldvh-body-muted mt-0.5">{t(gate.respond)}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <h3 className="ldvh-card-title">{t('help.gates.stop.title')}</h3>
        <ul className="mt-2 flex min-w-0 flex-col gap-1.5">
          {STOP_ITEMS.map((item) => (
            <li key={item} className="ldvh-body-muted flex min-w-0 gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ldvh-text-secondary/70" aria-hidden="true" />
              <span className="min-w-0">{t(item)}</span>
            </li>
          ))}
        </ul>
        <p className="ldvh-body-muted mt-3 border-t border-ldvh-border/70 pt-3">{t('help.gates.stop.note')}</p>
      </div>
    </section>
  );
}

function EntriesPanel() {
  const { t } = useI18n();
  return (
    <section className="min-w-0">
      <p className="ldvh-body-muted max-w-[62rem]">{t('help.entries.lead')}</p>
      <div className="ldvh-section-grid mt-3">
        {ENTRY_MAP.map((entry) => {
          const Icon = NAV_ICONS[entry.icon];
          return (
            <article key={entry.title} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
              <div className="flex min-w-0 items-center gap-2">
                <Icon size={15} className="shrink-0 text-ldvh-text-secondary" aria-hidden="true" />
                <h3 className="ldvh-card-title min-w-0">{t(entry.title)}</h3>
              </div>
              <p className="ldvh-body-muted mt-2">{t(entry.body)}</p>
              <div className="mt-3">
                <Link
                  to={entry.to}
                  className="ldvh-body inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
                >
                  <span className="truncate">{t(entry.title)}</span>
                  <ArrowRight size={13} className="shrink-0 text-ldvh-text-secondary/70" aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SystemsPanel() {
  const { t } = useI18n();
  return (
    <section className="min-w-0">
      <p className="ldvh-body-muted max-w-[62rem]">{t('help.systems.lead')}</p>
      <div className="ldvh-section-grid mt-3">
        {SYSTEM_MAP.map((system) => {
          const Icon = SYSTEM_ICONS[system.icon];
          return (
            <article key={system.key} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
              <div className="flex min-w-0 items-center gap-2">
                <Icon size={15} className="shrink-0 text-ldvh-text-secondary" aria-hidden="true" />
                <h3 className="ldvh-card-title min-w-0">{t(system.title)}</h3>
              </div>
              <dl className="mt-3 flex min-w-0 flex-col gap-2">
                <div>
                  <dt className="ldvh-caption-strong">{t('help.systems.dutyLabel')}</dt>
                  <dd className="ldvh-body-muted mt-0.5">{t(system.duty)}</dd>
                </div>
                <div>
                  <dt className="ldvh-caption-strong">{t('help.systems.usageLabel')}</dt>
                  <dd className="ldvh-body-muted mt-0.5">{t(system.usage)}</dd>
                </div>
                <div>
                  <dt className="ldvh-caption-strong">{t('help.systems.landingLabel')}</dt>
                  <dd className="mt-0.5">
                    {system.objects.length > 0 ? (
                      <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                        {system.objects.map((object) => (
                          <TypeLink key={object.type} to={object.to} type={object.type} />
                        ))}
                      </span>
                    ) : (
                      <span className="ldvh-body-muted">{system.landing ? t(system.landing) : null}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="ldvh-caption-strong">{t('help.systems.limitLabel')}</dt>
                  <dd className="ldvh-body-muted mt-0.5">{t(system.limit)}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TrustPanel() {
  const { t } = useI18n();
  return (
    <section className="min-w-0">
      <p className="ldvh-body-muted max-w-[62rem]">{t('help.trust.lead')}</p>

      <h3 className="ldvh-section-title mt-4">{t('help.trust.layers.title')}</h3>
      <div className="ldvh-section-grid mt-3">
        {TRUST_LAYERS.map((layer) => (
          <article key={layer.title} className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
            <h4 className="ldvh-card-title">{t(layer.title)}</h4>
            <p className="ldvh-body-muted mt-2">{t(layer.body)}</p>
          </article>
        ))}
      </div>

      <div className="ldvh-panel-grid mt-4">
        <div className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <h3 className="ldvh-card-title">{t('help.trust.notproof.title')}</h3>
          <ul className="mt-2 flex min-w-0 flex-col gap-1.5">
            {NOT_PROOF_ITEMS.map((item) => (
              <li key={item} className="ldvh-body-muted flex min-w-0 gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ldvh-text-secondary/70" aria-hidden="true" />
                <span className="min-w-0">{t(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          <h3 className="ldvh-card-title">{t('help.trust.pushback.title')}</h3>
          <ul className="mt-2 flex min-w-0 flex-col gap-1.5">
            {PUSHBACK_ITEMS.map((item) => (
              <li key={item} className="ldvh-body-muted flex min-w-0 gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ldvh-text-secondary/70" aria-hidden="true" />
                <span className="min-w-0">{t(item)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
