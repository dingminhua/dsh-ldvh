/**
 * 帮助页（`/help`）——LDVH Web 的静态导览页。
 *
 * **它是什么**：给 Human 的一份使用引导。**整页由一个 tab 容器组织**：页头之下是
 * 常驻声明与 sticky 切换区，切换区之下是当前分区。六个分区各自回答一个问题，
 * 同一时刻只呈现一个（`specs/07` §12 第 7 条：长内容用分层入口收，不一次铺满）。
 *
 * **为什么整页都是 tab**：先前是「上方两块常显概览 + 下方五个分区」，两套组织范式
 * 挤在一页——进页面第一眼看到的是内容而不是导航，常显概览越长，切换区离得越远，
 * tab「一次只呈现一件事」的价值就被抵消了。整页统一为一个 tab 容器后，页面上只
 * 剩**一种**组织方式：分区切换。
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
 * **版式纪律**：页面上只有**一种卡片壳**（`EntryCard`：标题行 + 定义行组 + 可选
 * 去往区）与**一种行式列表**（`RowList`：面板内的行，行间一条细线）；网格只用
 * `ldvh-section-grid` 一个基准。标题层级固定为 h1（页头）→ h2（分区标题）→
 * h3（条目标题），分组标签是普通文本行，不占标题层级。
 *
 * 纯静态、只读、零数据请求；所有可见文案走 i18n（`docs/01` §1.3）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
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
 * 过程），故那一行给文字说明而不是链接。
 */
const SYSTEM_MAP: {
  key: string;
  icon: string;
  title: LocaleKey;
  duty: LocaleKey;
  usage: LocaleKey;
  /** 仅横切的双源召回没有承载对象，它那一行给文字说明而不是链接。 */
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

/**
 * 六个分区：**标签是短问句，标题是完整问句**。
 *
 * 标签给切换区（窄屏会折行，必须短）；标题给分区内容（读者落在这里，要知道自己
 * 在回答哪一问）。两者不重复：标签问「有什么」，标题补「具体是哪些」。
 */
const TABS = [
  { id: 'overview', label: 'help.tab.overview', title: 'help.panel.overview.title', lead: 'help.overview.lead' },
  { id: 'objects', label: 'help.tab.objects', title: 'help.panel.objects.title', lead: 'help.objects.lead' },
  { id: 'systems', label: 'help.tab.systems', title: 'help.panel.systems.title', lead: 'help.systems.lead' },
  { id: 'gates', label: 'help.tab.gates', title: 'help.panel.gates.title', lead: 'help.gates.lead' },
  { id: 'entries', label: 'help.tab.entries', title: 'help.panel.entries.title', lead: 'help.entries.lead' },
  { id: 'trust', label: 'help.tab.trust', title: 'help.panel.trust.title', lead: 'help.trust.lead' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Help() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('overview');
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * 切换分区后，把视口落到新分区内容的开头。
   *
   * **为什么**：切换区是 sticky 的。人在长分区里点切换，视口往往停在旧分区中段——
   * 切完看到的是新分区的中段，不是开头。这里按切换区的**实测高度**留出
   * `scroll-margin-top`（切换区在窄屏会折行变高，写死高度会露出被遮住的第一行）。
   *
   * **什么时候不滚**：分区起点已经在切换区下方可见时**不动视口**——否则刚进页面
   * 点一下切换就把页头顶掉，是无故的跳动。
   */
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

  return (
    <div className="ldvh-page-frame">
      <div className="ldvh-page-toolbar mb-3 min-w-0 shrink-0">
        <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} compact />
      </div>

      {/* 常驻声明：这是**页面级**限定，与分区内容无关（规则在规范源、事实在事实源），
          所以放在页头正下方一眼可见，而不是压在长分区末尾等人滚到底。 */}
      <p className="ldvh-caption mb-3 min-w-0">{t('help.disclaimer')}</p>

      {/* 切换区：sticky 固定在主滚动容器顶部，长正文滚动时切换区不滚出。
          整页只有这一个组织入口——页面上不再有「常显正文 + 切换区」的双层结构。 */}
      <div ref={barRef} className="sticky top-0 z-20 -mx-6 mb-4 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
        <div className="ldvh-tab-list" aria-label={t('help.tabLabel')}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`ldvh-tab-button ${tab === entry.id ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
      </div>

      <div ref={panelRef} className="min-w-0 pb-6">
        <h2 className="ldvh-card-title-prominent">{t(current.title)}</h2>
        <p className="ldvh-body-muted mt-1 max-w-[62rem]">{t(current.lead)}</p>
        {tab === 'overview' && <OverviewBody />}
        {tab === 'objects' && <ObjectsBody />}
        {tab === 'systems' && <SystemsBody />}
        {tab === 'gates' && <GatesBody />}
        {tab === 'entries' && <EntriesBody />}
        {tab === 'trust' && <TrustBody />}
      </div>
    </div>
  );
}

/**
 * 统一的条目卡外壳：**标题行（图标 + 名称）+ 定义行组 + 可选去往区**。
 *
 * **为什么统一**：本页此前有六种卡片形态——概览卡是两段自由文字、对象卡是三行定义
 * 加底部链接、入口卡是一段文字加底部链接、系统卡是四行定义、Gate 卡是两行定义、
 * 信任层卡连图标都没有。留白、标题行与链接位置各不相同，读起来像六套页面拼在
 * 一起。现在由这一个组件产出，页面上不再有第二种卡片壳。
 *
 * **定义行用 `dl`**：标签是 `ldvh-caption-strong`，内容是 `ldvh-body-muted`，行距
 * 一律 2。全页只有这一种定义行写法。
 */
function EntryCard({
  icon,
  title,
  rows,
  landing,
}: {
  icon: ReactNode;
  title: string;
  rows: { key: string; label: LocaleKey; value: ReactNode }[];
  landing?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <div className="flex min-w-0 items-start gap-2">
        {/* 图标顶端对齐并下移 4px：对齐标题首行的字冠中线。英文态标题常折成两行，
            若用 items-center，图标会落到第二行旁边，读起来像是配错了条目。 */}
        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center text-ldvh-text-secondary">
          {icon}
        </span>
        <h3 className="ldvh-card-title min-w-0">{title}</h3>
      </div>
      <dl className="mt-3 flex min-w-0 flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="ldvh-caption-strong">{t(row.label)}</dt>
            <dd className="ldvh-body-muted mt-0.5">{row.value}</dd>
          </div>
        ))}
      </dl>
      {landing ? <div className="mt-3 border-t border-ldvh-border/70 pt-3">{landing}</div> : null}
    </article>
  );
}

/**
 * 统一行式列表：一个面板，行与行之间一条细线。
 *
 * **为什么行式**：本页此前的长内容是单列长墙（主线六段、必停五条、不能证明七条、
 * 值得退问四条），一行一句往下堆，条目之间没有分界，读起来密不透风。行式让每个
 * 条目独立成行、行间留一条细线，条目彼此可辨。
 *
 * **一律是 `ul`/`li`**：本页的行式清单全都是列表（主线六段、声明三层、必停五条、
 * 不能证明七条、值得退问四条），所以行就是列表项，语义不留给读屏器猜。
 */
function RowList({ rows }: { rows: { key: string; content: ReactNode }[] }) {
  return (
    <ul className="overflow-hidden rounded-xl border border-ldvh-border bg-ldvh-panel">
      {rows.map((row, index) => (
        <li key={row.key} className={index === 0 ? 'p-4' : 'border-t border-ldvh-border/70 p-4'}>
          {row.content}
        </li>
      ))}
    </ul>
  );
}

/** 分组标签：普通文本行，不占标题层级（h1 页头 → h2 分区 → h3 条目）。 */
function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="ldvh-section-title mt-5">{children}</p>;
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

/** 入口链接：名称 + 进入箭头。 */
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

function OverviewBody() {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <GroupLabel>{t('help.overview.title')}</GroupLabel>
      <div className="ldvh-section-grid mt-2">
        {OVERVIEW_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <EntryCard
              key={card.title}
              icon={<Icon size={15} aria-hidden="true" />}
              title={t(card.title)}
              rows={[
                { key: 'symptom', label: 'help.overview.symptomLabel', value: t(card.symptom) },
                { key: 'answer', label: 'help.overview.answerLabel', value: t(card.answer) },
              ]}
            />
          );
        })}
      </div>

      <GroupLabel>{t('help.spine.title')}</GroupLabel>
      <p className="ldvh-body-muted mt-1 max-w-[62rem]">{t('help.spine.lead')}</p>
      <RowList
        rows={SPINE_STAGES.map((stage) => ({
          key: stage.title,
          content: (
            <>
              <div className="flex min-w-0 items-start gap-1.5">
                {stage.links.map((link) => (
                  <ObjectTypeIcon
                    key={link.type}
                    type={link.type}
                    size={14}
                    className="mt-0.5 shrink-0"
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
            </>
          ),
        }))}
      />
      <p className="ldvh-body-muted mt-3 border-t border-ldvh-border/70 pt-3">{t('help.spine.recall')}</p>
    </div>
  );
}

function ObjectsBody() {
  const { t, locale } = useI18n();
  return (
    <div className="ldvh-section-grid mt-3">
      {OBJECT_MAP.map((entry) => (
        <EntryCard
          key={entry.type}
          icon={<ObjectTypeIcon type={entry.type} size={15} style={{ color: getCategoryColor(entry.type) }} />}
          title={getTypeLabel(entry.type, locale)}
          rows={[
            { key: 'what', label: 'help.objects.whatLabel', value: t(entry.what) },
            { key: 'when', label: 'help.objects.whenLabel', value: t(entry.when) },
            { key: 'look', label: 'help.objects.lookLabel', value: t(entry.look) },
          ]}
          landing={<TypeLink to={entry.to} type={entry.type} />}
        />
      ))}
    </div>
  );
}

function SystemsBody() {
  const { t } = useI18n();
  return (
    <div className="ldvh-section-grid mt-3">
      {SYSTEM_MAP.map((system) => {
        const Icon = SYSTEM_ICONS[system.icon];
        return (
          <EntryCard
            key={system.key}
            icon={<Icon size={15} aria-hidden="true" />}
            title={t(system.title)}
            rows={[
              { key: 'duty', label: 'help.systems.dutyLabel', value: t(system.duty) },
              { key: 'usage', label: 'help.systems.usageLabel', value: t(system.usage) },
              {
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
              },
              { key: 'limit', label: 'help.systems.limitLabel', value: t(system.limit) },
            ]}
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
      <div className="ldvh-section-grid mt-3">
        {GATES.map((gate) => {
          const Icon = gate.icon;
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

      <GroupLabel>{t('help.gates.stop.title')}</GroupLabel>
      <RowList
        rows={STOP_ITEMS.map((item) => ({
          key: item,
          content: <span className="ldvh-body-muted">{t(item)}</span>,
        }))}
      />
      <p className="ldvh-body-muted mt-3 border-t border-ldvh-border/70 pt-3">{t('help.gates.stop.note')}</p>
    </div>
  );
}

function EntriesBody() {
  const { t } = useI18n();
  return (
    <div className="ldvh-section-grid mt-3">
      {ENTRY_MAP.map((entry) => {
        const Icon = NAV_ICONS[entry.icon];
        return (
          <EntryCard
            key={entry.title}
            icon={<Icon size={15} aria-hidden="true" />}
            title={t(entry.title)}
            rows={[{ key: 'body', label: 'help.entries.whatLabel', value: t(entry.body) }]}
            landing={<EntryLink to={entry.to} label={t('help.entries.goLabel')} />}
          />
        );
      })}
    </div>
  );
}

function TrustBody() {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <GroupLabel>{t('help.trust.layers.title')}</GroupLabel>
      <RowList
        rows={TRUST_LAYERS.map((layer) => ({
          key: layer.title,
          content: (
            <>
              <h3 className="ldvh-card-title">{t(layer.title)}</h3>
              <p className="ldvh-body-muted mt-1">{t(layer.body)}</p>
            </>
          ),
        }))}
      />

      <div className="ldvh-section-grid mt-5">
        <section className="min-w-0">
          <p className="ldvh-section-title">{t('help.trust.notproof.title')}</p>
          <RowList
            rows={NOT_PROOF_ITEMS.map((item) => ({
              key: item,
              content: <span className="ldvh-body-muted">{t(item)}</span>,
            }))}
          />
        </section>
        <section className="min-w-0">
          <p className="ldvh-section-title">{t('help.trust.pushback.title')}</p>
          <RowList
            rows={PUSHBACK_ITEMS.map((item) => ({
              key: item,
              content: <span className="ldvh-body-muted">{t(item)}</span>,
            }))}
          />
        </section>
      </div>
    </div>
  );
}
