/**
 * 帮助页（`/help`）——LDVH Web 的静态导览页。
 *
 * **它是什么**：给 Human 的一份使用引导。**整页由一个 tab 容器组织**：页头之下是
 * 常驻声明与 sticky 切换区，切换区之下是当前分区。七个分区各自回答一个问题，
 * 同一时刻只呈现一个（`specs/07` §12 第 7 条：长内容用分层入口收，不一次铺满）。
 * 第一个分区是「如何开始」——新用户先看它，老用户也认得它在哪。
 *
 * **它不是什么**：
 * - 不是规则源。页面上的每一句都是对当前规范源的**通俗转述**，不产生规范效力；
 *   规则以规范源为准，事实以事实源为准（00 §2.4、§3.3）。
 * - 不是对象卡片的又一版。页内没有一条事实对象记录，因此不套对象卡框契约
 *   （`docs/01` §1.10 第 9 条针对的是「呈现一条对象记录」）；本页用的是
 *   `ldvh-panel` 面板与 `ldvh-section-grid` 卡片网格（§1.8.1）。
 * - 不是营销页。首屏用普通面板与语义排版类，不做渐变英雄区与大留白
 *   （§1.8.1「不使用营销式大留白或英雄区」、§1.10「密度和响应式」第 1 条）。
 *
 * **呈现件按类型登记，每类一种壳**（Human 2026-11-03 定，替掉上一轮「全页只有一种
 * 卡片壳」的旧口径）：本页共九类呈现件——声明条 `notice`、对照表 `compare`、形态卡
 * `stage`、条目卡 `entry-card`、行式清单 `rows`、标签阵列 `chips`、信任阶梯 `ladder`、
 * 提示条 `hint`、步骤清单 `steps`。每类呈现件的根元素带 `data-presentation` 标记，
 * 守卫据此复算：**登记清单与实现必须一一对应，同一类型不得出现第二种壳**。
 *
 * 旧口径为什么换掉：要求「全页只有一种卡片壳 + 一种行式列表」会把本页真正需要的
 * 呈现形态判死——症状与机制是一一对应，用对照表才准确；七个否定项是短句，用标签
 * 阵列才一屏扫得完；「如何开始」的两步有来源已成立的先后顺序，用有序列表才准。
 * 真正要防的是**同一类东西出现两套写法**，不是**出现多种类**。
 *
 * **版式纪律**：网格只用 `ldvh-section-grid` 一个基准（形态卡与条目卡共用）；标题
 * 层级固定 h1（页头）→ h2（分区标题）→ h3（条目标题），分组标签是普通文本行，不占
 * 标题层级；正文值一律走 `ldvh-body`（主色），标签走 `ldvh-caption-strong`。
 *
 * **可读性纪律（Human 2026-11-03 裁定「按提案全部落地」）**：
 * 1. **三级标题各自一档**：h1 `ldvh-page-title`（18px）、h2 `ldvh-region-title`
 *    （20px）、h3 `ldvh-card-title`（16px）。分区标题不再借用
 *    `ldvh-card-title-prominent`——按 `docs/01` §1.5 第 3 条，那一档只用于「同一卡片
 *    承载多个 Human 判断区」的对象主标题，不得代替页面或详情标题。
 * 2. **承载内容的句子走主色**：本页唯一保留的次级正文是系统卡的**边界块**
 *    （「它不保证什么」）——它是防自欺条款，刻意用虚线框与灰字退半步。其余正文
 *    （导语、段落、形态卡说明、对照表症状列、阶梯说明、提示条、声明条）一律
 *    `ldvh-body`。声明条正文由 12px `ldvh-caption` 提到 14px `ldvh-body`：§1.5 第 5 条
 *    规定 `ldvh-caption` 不承载主要内容，而声明是页面级实质限定。
 * 3. **正文行长 40rem**：14px 中文约 45 字/行，落在中文排版每行 30–45 字的舒适区；
 *    此前 46rem 约 52 字/行，长句读起来串行。
 * 4. **分节留白 mt-8 / pt-6**：分组之间除一条上边框外，再用空间分节。
 * 5. **图标容器与相邻文字的行盒等高，图标在容器内居中**（2026-11-03 二轮，Human 指出的
 *    「图标和文本没对齐」）：正文与标题的行盒都是 24px（`ldvh-body` / `ldvh-card-title`
 *    均 leading-6），故图标容器取 `h-6`、图标居中。此前容器是 16px 高再用 `mt-N` 往下
 *    顶 1–2px——那是为某个字号凑出来的数，**正文一改字号图标就歪**，声明条正是这样
 *    从 12px 提到 14px 时歪掉的。结构对齐（等高 + 居中）才不随字号漂移。
 *
 * 纯静态、只读、零数据请求；所有可见文案走 i18n（`docs/01` §1.3）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { HELP_ICONS, HELP_TAB_ICONS, NAV_ICONS, ObjectTypeIcon, SYSTEM_ICONS } from '@/components/SemanticIcon';
import { getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { getCategoryColor } from '@/utils/categoryColors';
import { useI18n } from '@/i18n/context';

/** 概览对照表：三行——短板、典型表现、对应机制。 */
const OVERVIEW_COMPARE: { icon: string; title: LocaleKey; symptom: LocaleKey; answer: LocaleKey }[] = [
  { icon: 'ai', title: 'help.overview.ai.title', symptom: 'help.overview.ai.symptom', answer: 'help.overview.ai.answer' },
  { icon: 'human', title: 'help.overview.human.title', symptom: 'help.overview.human.symptom', answer: 'help.overview.human.answer' },
  { icon: 'amplify', title: 'help.overview.friction.title', symptom: 'help.overview.friction.symptom', answer: 'help.overview.friction.answer' },
];

/**
 * 与 AI 配合的主线：六段形态，各带承载对象。
 *
 * **不给编号**：这些形态之间没有来源已成立的先后序号（`docs/01` §1.5 第 12 条：
 * 没有先后关系的同级集合统一使用圆点，编号只留给来源已经成立的步骤）。左到右
 * 只是阅读顺序；引导语明说「不是必须照走的流水线」。
 *
 * **卡头图标 = 承载对象的类型图标**（不是另造一套形态图标）：形态不是对象，它没有
 * 自己的身份；读者要认的是它落在哪种对象上。六种类型色按演进顺序排开，方向感来自
 * 色彩递进，不是编号。
 */
/** 形态件的形状：标题 + 说明 + 承载对象。形态不是对象，它落在哪些对象上由链接说明。 */
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

/**
 * 「如何开始」的两条起点：新项目与老项目。
 *
 * **为什么是形态卡**：起点也是一种形态——它有承载对象（卡头图标即这些对象的类型
 * 图标），有说明，也有落到哪些对象上的去路。与主线六段共用同一套卡壳，是「同一类
 * 东西只有一种写法」的直接后果，而不是又一套写法。
 */
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
      { to: '/objects/research', type: 'research' },
      { to: '/goal', type: 'goal' },
      { to: '/objects/subgoal', type: 'subgoal' },
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
const GATES: { icon: string; title: LocaleKey; trigger: LocaleKey; respond: LocaleKey }[] = [
  { icon: 'inquiry', title: 'help.gates.inquiry.title', trigger: 'help.gates.inquiry.trigger', respond: 'help.gates.inquiry.respond' },
  { icon: 'plan', title: 'help.gates.plan.title', trigger: 'help.gates.plan.trigger', respond: 'help.gates.plan.respond' },
  { icon: 'authorization', title: 'help.gates.authorization.title', trigger: 'help.gates.authorization.trigger', respond: 'help.gates.authorization.respond' },
  { icon: 'handover', title: 'help.gates.handover.title', trigger: 'help.gates.handover.trigger', respond: 'help.gates.handover.respond' },
  { icon: 'registration', title: 'help.gates.registration.title', trigger: 'help.gates.registration.trigger', respond: 'help.gates.registration.respond' },
];

/** 必停情形（00 §4.7）——到这些点上它会停下，而不是硬答。 */
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
 * 七大业务系统（03 §9.1–§9.7，00 §2.6）。
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

/** 声明的三层（00 §4.6 据实声明）。三层是**分级**的：可信度不同，视觉上要能看出来。 */
const TRUST_LAYERS: {
  key: string;
  title: LocaleKey;
  hint: LocaleKey;
  body: LocaleKey;
  /** 块首标记色（颜色表达声明状态，不是装饰）。 */
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
    markClass: 'bg-ldvh-text-secondary/60',
    hintClass: 'text-ldvh-text-secondary',
  },
  {
    key: 'residual',
    title: 'help.trust.layers.residual.title',
    hint: 'help.trust.layers.residual.hint',
    body: 'help.trust.layers.residual.body',
    markClass: 'bg-amber-500/75 dark:bg-amber-400/80',
    hintClass: 'text-amber-700 dark:text-amber-300',
  },
];

/** 都不能单独证明完成的那些事（00 §4.6 末段）。七条都是短句，标签阵列一屏扫完。 */
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
 * 七个分区：**标签是短问句，标题是完整问句**。
 *
 * 标签给切换区（窄屏会折行，必须短）；标题给分区内容（读者落在这里，要知道自己
 * 在回答哪一问）。两者不重复：标签问「有什么」，标题补「具体是哪些」。
 *
 * **第一个分区是「如何开始」**：它是新用户的入口，放在最前并作为默认落点——一个
 * 藏在中段的「如何开始」不算入口。
 */
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
      <Notice>{t('help.disclaimer')}</Notice>

      {/* 切换区：sticky 固定在主滚动容器顶部，长正文滚动时切换区不滚出。
          整页只有这一个组织入口——页面上不再有「常显正文 + 切换区」的双层结构。 */}
      <div ref={barRef} className="sticky top-0 z-20 -mx-6 mb-4 mt-3 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
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

      <div ref={panelRef} className="min-w-0 pb-6">
        <h2 className="ldvh-region-title">{t(current.title)}</h2>
        <p className="ldvh-body mt-2 max-w-[40rem]">{t(current.lead)}</p>
        {tab === 'start' && <StartBody />}
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
 * 声明条：页面级限定，独立成一条而不是浮在标题下的一行灰字。
 *
 * **图标容器与正文行盒等高**（`h-6` = 24px = `ldvh-body` 的行盒），图标在容器内居中：
 * 图标因此落在第一行文字的视觉中心。此前容器是 16px 高再用 `mt-0.5` 往下顶 2px——
 * 那是为 12px 的 `ldvh-caption` 凑的数；正文一提到 14px，图标就比文字高了 2px。
 */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      data-presentation="notice"
      className="flex min-w-0 items-start gap-2 rounded-lg border border-ldvh-accent/25 bg-ldvh-accent/5 px-3 py-2.5"
    >
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-accent">
        <HELP_ICONS.info size={15} aria-hidden="true" />
      </span>
      <p className="ldvh-body min-w-0">{children}</p>
    </div>
  );
}

/**
 * 对照表：短板 / 典型表现 / 对应机制。
 *
 * **为什么是表不是三张卡**：症状与机制本来是一一对应，三张等宽卡并排反而把这个对应
 * 拆散了，还留下第三列一截空白。表按行对齐，横向扫一行就知道「哪个缺口对应哪条机制」。
 *
 * **窄屏靠自然换行**：三块用 flex + min-width，不引断点类（`docs/01` §1.6.1 第 3 条）。
 */
function CompareTable({ rows }: { rows: typeof OVERVIEW_COMPARE }) {
  const { t } = useI18n();
  return (
    <div data-presentation="compare" className="overflow-hidden rounded-xl border border-ldvh-border bg-ldvh-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-ldvh-border/20 px-4 py-2.5">
        <span className="ldvh-caption-strong w-40 shrink-0">{t('help.overview.shortcomingLabel')}</span>
        <span className="ldvh-caption-strong min-w-[16rem] flex-1">{t('help.overview.symptomLabel')}</span>
        <span className="ldvh-caption-strong min-w-[16rem] flex-1">{t('help.overview.answerLabel')}</span>
      </div>
      {rows.map((row) => {
        const Icon = HELP_ICONS[row.icon];
        return (
          <div key={row.title} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-ldvh-border/75 px-4 py-3">
            <div className="flex w-40 shrink-0 items-start gap-2">
              <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-text-secondary">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="ldvh-card-title min-w-0">{t(row.title)}</span>
            </div>
            <p className="ldvh-body min-w-[16rem] flex-1">{t(row.symptom)}</p>
            <p className="ldvh-body min-w-[16rem] flex-1 rounded-md bg-ldvh-accent/5 px-2.5 py-2 -mx-2.5">{t(row.answer)}</p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 形态卡：一种形态，落在哪些对象上。
 *
 * **卡头图标 = 承载对象的类型图标**：形态不是对象，没有自己的身份；读者要认的是
 * 它落在哪种对象上。颜色取类型色单源（`getCategoryColor`）。
 *
 * **两处用它**：主线六段形态（这是什么分区）与「如何开始」的两条起点（如何开始
 * 分区）。同一个壳、同一套几何——起点也是一种形态。
 */
function StageCard({ stage }: { stage: StageShape }) {
  const { t } = useI18n();
  return (
    <article data-presentation="stage" className="flex min-w-0 flex-col gap-2 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1">
          {stage.links.map((link) => (
            <ObjectTypeIcon key={link.type} type={link.type} size={15} style={{ color: getCategoryColor(link.type) }} />
          ))}
        </span>
        <h3 className="ldvh-card-title min-w-0">{t(stage.title)}</h3>
      </div>
      <p className="ldvh-body">{t(stage.body)}</p>
      <div className="mt-auto flex min-w-0 flex-wrap gap-x-4 gap-y-1 border-t border-ldvh-border/70 pt-2.5">
        {stage.links.map((link) => (
          <TypeLink key={link.type} to={link.to} type={link.type} showIcon={false} />
        ))}
      </div>
    </article>
  );
}

/**
 * 条目卡：标题行（图标 + 名称）+ 定义行组 + 可选边界块 + 可选去往区。
 *
 * **定义行的值走 `ldvh-body`（主色）**：此前值用次级灰，标签也用灰，整页一个明度，
 * 眼睛没有落点。标签留 `ldvh-caption-strong`（12px 次级），值回主色，一拉开就有层级。
 *
 * **边界块（limit）是独立的一格**：它是防自欺条款（00 §4.6），与职责不是同一量级，
 * 所以用虚线框 + 弱底色退半步，但必须留在卡里。
 */
function EntryCard({
  icon,
  title,
  rows,
  limit,
  landing,
}: {
  icon: ReactNode;
  title: string;
  rows: { key: string; label: LocaleKey; value: ReactNode }[];
  limit?: { label: LocaleKey; value: LocaleKey };
  landing?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article data-presentation="entry-card" className="flex min-w-0 flex-col gap-3 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <div className="flex min-w-0 items-start gap-2">
        {/* 图标容器与标题首行的行盒等高（h-6 = 24px），图标在容器内居中：对齐标题首行的
            字冠中线。英文态标题常折成两行，若用 items-center，图标会落到第二行旁边，
            读起来像是配错了条目——所以行是 items-start，靠容器等高来定位，而不是靠
            mt-N 往下顶一个凑出来的数。 */}
        <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-text-secondary">
          {icon}
        </span>
        <h3 className="ldvh-card-title min-w-0">{title}</h3>
      </div>
      <dl className="flex min-w-0 flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="ldvh-caption-strong">{t(row.label)}</dt>
            <dd className="ldvh-body mt-0.5">{row.value}</dd>
          </div>
        ))}
      </dl>
      {/* 边界块是本页唯一登记过的次级正文块：防自欺条款，刻意退半步。
          `data-voice="secondary"` 是守卫的判定锚点——新增次级正文必须在这里登记，
          否则守卫判红（见 tests/api/help-presentation-contract.test.ts 第 13 条）。 */}
      {limit ? (
        <dl
          data-voice="secondary"
          className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-bg p-2.5"
        >
          <dt className="ldvh-caption-strong">{t(limit.label)}</dt>
          <dd className="ldvh-body-muted mt-0.5">{t(limit.value)}</dd>
        </dl>
      ) : null}
      {landing ? <div className="mt-auto border-t border-ldvh-border/70 pt-2.5">{landing}</div> : null}
    </article>
  );
}

/**
 * 行式清单：一个面板，行与行之间一条细线。
 *
 * **一律是 `ul`/`li`**：本页的行式清单全都是列表（必停五条、退回去四条、入口六项），
 * 所以行就是列表项，语义不留给读屏器猜。行内容是插槽——必停行是一句话，入口行是
 * 「图标 + 名称 + 说明 + 去看看」，壳仍是同一个。
 */
function RowList({ rows }: { rows: { key: string; content: ReactNode }[] }) {
  return (
    <ul data-presentation="rows" className="overflow-hidden rounded-xl border border-ldvh-border bg-ldvh-panel">
      {rows.map((row, index) => (
        <li key={row.key} className={index === 0 ? 'p-4' : 'border-t border-ldvh-border/70 p-4'}>
          {row.content}
        </li>
      ))}
    </ul>
  );
}

/**
 * 标签阵列：一屏扫得完的短句清单。
 *
 * **为什么是标签不是行**：这七条都是「不能单独证明」的短语，读者要的是一眼扫过；
 * 排成长列表要占掉半屏。标签走 `ldvh-chip-tag`（短标签，几何单源于 `index.css`）。
 */
function ChipList({ items }: { items: LocaleKey[] }) {
  const { t } = useI18n();
  return (
    <ul data-presentation="chips" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="ldvh-chip-tag">
          {t(item)}
        </li>
      ))}
    </ul>
  );
}

/**
 * 步骤清单：有序列表。
 *
 * **为什么是 `ol` 不是 `ul`**：这两步有**来源已成立的先后关系**——项目没选定，目标
 * 就无处可落（目标与子目标长在被选中的项目下面）。`docs/01` §1.5 第 12 条把编号留给
 * 这样的步骤；顺序写进 markup 而不只是写在词句里，读屏器才念得出「第 1 项，共 2 项」。
 *
 * **不套面板边框**：它不是一张卡，是两条步骤。卡里再套卡会读成几层盒子。
 */
function StepList({ children }: { children: ReactNode }) {
  return (
    <ol data-presentation="steps" className="flex min-w-0 flex-col">
      {children}
    </ol>
  );
}

/**
 * 信任阶梯：声明的三层。
 *
 * **三层是分级的**：已证实 / 未证实 / 残留风险的可信度不同，视觉上要能看出来。
 * 颜色表达的是**声明状态**（绿 / 灰 / 琥珀），不是装饰，所以用块首标记承担——
 * `docs/01` §1.10 第 7 条把语义左条限死在两族，这里不属任何一族，一律四边同宽。
 */
function Ladder({ layers }: { layers: typeof TRUST_LAYERS }) {
  const { t } = useI18n();
  return (
    <div data-presentation="ladder" className="flex min-w-0 flex-col gap-2.5">
      {layers.map((layer) => (
        <div key={layer.key} className="flex min-w-0 items-start gap-3 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
          {/* 块首标记：容器高 = 相邻标题的行盒高（24px），标记在容器内居中。
              此前用 `mt-1.5` 把 10px 方块往下顶到看着差不多——那是个凑出来的数，
              标题字号一改就又歪了。容器与行盒等高、标记居中，才是结构上的对齐。 */}
          <span className="flex h-6 w-2.5 shrink-0 items-center" aria-hidden="true">
            <span className={`h-2.5 w-2.5 rounded-sm ${layer.markClass}`} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ldvh-card-title">{t(layer.title)}</h3>
              <span className={`ldvh-chip ${layer.hintClass}`}>{t(layer.hint)}</span>
            </div>
            <p className="ldvh-body mt-1 max-w-[40rem]">{t(layer.body)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 提示条：一句话的补充说明（双源召回、必停之后怎么办）。
 *
 * **图标容器与正文行盒等高**（`h-6` = 24px），图标在容器内居中——同声明条，不再用
 * `mt-0.5` 凑那 2px。
 */
function Hint({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div data-presentation="hint" className="flex min-w-0 items-start gap-2.5 rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-ldvh-accent">
        <HELP_ICONS.info size={15} aria-hidden="true" />
      </span>
      <p className="ldvh-body min-w-0">
        {title ? <span className="ldvh-body font-medium text-ldvh-text-primary">{title}</span> : null}
        {title ? ' ' : null}
        {children}
      </p>
    </div>
  );
}

/** 分组标签：普通文本行，不占标题层级（h1 页头 → h2 分区 → h3 条目）。 */
function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="ldvh-section-title">{children}</p>;
}

/** 分区：分组之间用一条上边框分节（`docs/01` §1.10 第 12 条：只保留上边框，不补下边框）。 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-8 border-t border-ldvh-border pt-6">
      <GroupLabel>{label}</GroupLabel>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** 对象类型链接：类型图标 + 类型名 + 进入箭头（进入主路由用 ArrowRight，09 §5）。 */
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

function StartBody() {
  const { t } = useI18n();
  return (
    <StepList>
      <li className="min-w-0">
        <h3 className="ldvh-card-title">{t('help.start.step1.title')}</h3>
        <p className="ldvh-body mt-1 max-w-[40rem]">{t('help.start.step1.body')}</p>
        <div className="mt-3 max-w-[40rem]">
          <Hint title={t('help.start.step1.hintTitle')}>{t('help.start.step1.hint')}</Hint>
        </div>
      </li>
      <li className="mt-8 min-w-0 border-t border-ldvh-border pt-6">
        <h3 className="ldvh-card-title">{t('help.start.step2.title')}</h3>
        <p className="ldvh-body mt-1 max-w-[40rem]">{t('help.start.step2.body')}</p>
        <div className="mt-5">
          <GroupLabel>{t('help.start.branchLabel')}</GroupLabel>
        </div>
        <div className="ldvh-section-grid mt-3">
          {START_BRANCHES.map((branch) => (
            <StageCard key={branch.title} stage={branch} />
          ))}
        </div>
        <div className="mt-4 max-w-[40rem]">
          <Hint title={t('help.start.nextTitle')}>{t('help.start.next')}</Hint>
        </div>
      </li>
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
        <div className="ldvh-section-grid mt-3">
          {SPINE_STAGES.map((stage) => (
            <StageCard key={stage.title} stage={stage} />
          ))}
        </div>
        <Hint title={t('help.spine.recallTitle')}>{t('help.spine.recall')}</Hint>
      </Section>
    </div>
  );
}

function ObjectsBody() {
  const { t, locale } = useI18n();
  return (
    <div className="ldvh-section-grid mt-4">
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
    <div className="ldvh-section-grid mt-4">
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
            ]}
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
      <div className="ldvh-section-grid mt-4">
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
                {/* 圆点：容器与正文行盒等高（h-6 = 24px），圆点在容器内居中——此前是
                    6px 圆点用 mt-2 顶着，比文字高 1px，且那个数同样是手调的。 */}
                <span className="flex h-6 w-1.5 shrink-0 items-center" aria-hidden="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-ldvh-accent" />
                </span>
                <p className="ldvh-body min-w-0">{t(item)}</p>
              </div>
            ),
          }))}
        />
        <Hint>{t('help.gates.stop.note')}</Hint>
      </Section>
    </div>
  );
}

function EntriesBody() {
  const { t } = useI18n();
  return (
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
                <p className="ldvh-body mt-1">{t(entry.body)}</p>
                <div className="mt-1.5">
                  <EntryLink to={entry.to} label={t('help.entries.goLabel')} />
                </div>
              </div>
            </div>
          ),
        };
      })}
    />
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
        <ChipList items={NOT_PROOF_ITEMS} />
      </Section>

      <Section label={t('help.trust.pushback.title')}>
        <RowList
          rows={PUSHBACK_ITEMS.map((item) => ({
            key: item,
            content: (
              <div className="flex min-w-0 items-start gap-2.5">
                {/* 圆点：容器与正文行盒等高（h-6 = 24px），圆点在容器内居中。 */}
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
