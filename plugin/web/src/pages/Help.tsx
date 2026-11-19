import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { HELP_ICONS, HELP_TAB_ICONS, NAV_ICONS, ObjectTypeIcon, SYSTEM_ICONS } from '@/components/SemanticIcon';
import { getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { getCategoryColor } from '@/utils/categoryColors';
import { useI18n } from '@/i18n/context';

/**
 * 帮助页（`/help`）——一份**操作手册**，不是一块看板。
 *
 * ## 版式主张（2026-11-19 重构）
 *
 * 上一版把每样东西都装进同一副壳里：声明、提示、形态、条目、清单、阶梯全是
 * 「1px 边框 + 白底 + 12px 圆角」，一屏十几个框。框与框同权，读者分不出
 * 「哪几条是同一件事」「哪一句是结论」——**线的数量**没有换来**层级的数量**。
 *
 * 这一版换成一个印刷手册的读法：**一章一张纸**。
 *
 * - 章节内同类东西收进一张纸（`.ldvh-help-sheet`），纸内是细线分隔的账页行；
 *   页面上「纸」的个数是一到两张，而不是十几张。框少了，框才有意义。
 * - 行内用「标签栏 + 值」两列（`.ldvh-help-fields`）：标签栏宽度固定，于是
 *   七类对象的「它是什么／什么时候产生／你去看什么」竖成三条竖线，可以跨
 *   条目往下扫——这是卡片网格做不到的（卡片的行高各不相同，谁也不对齐）。
 * - 层级只靠两样东西：字号（20 / 16 / 14）与线（分节线、行线）。不靠盒子，
 *   也不给每段加背景。分组眉标压在一条分节线上，读者一眼知道「新的一组」。
 * - 整页收进**一条 52rem 的文档列**（`.ldvh-help-column`）：页头、声明、切换区
 *   与正文共用一个右缘，正文与导语再限到 40rem——此前满宽铺到 964px，一行
 *   五十余汉字，眼睛要来回扫。
 * - 主线五段**不进网格**：排进 `ldvh-section-grid` 会折成 2+2+1，末段孤零零
 *   悬在左半边，读起来是表格的残行；但它们之间也没有来源已成立的先后序号
 *   （`01` §1.5 第 12 条），所以只是一张纸上的五行、顺读，不给编号。
 *
 * 呈现件仍按 `docs/14-Help.md` §1.2 的九类登记，每类一个定义点、根元素不换；
 * 换的是壳与排布，不是类型集合。九类之所以能收进「纸」，是因为它们本来就
 * 是同一种东西的不同排版：一张纸里可以放七行条目、五行必停、三层阶梯。
 */

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

/**
 * 声明的三层。
 *
 * `markClass` 是**形状先分级、颜色再补语义**：已证实＝实心方，未证实＝空心方，
 * 残留风险＝虚线方。只靠绿/灰/琥珀三色分级，在色弱读者眼里是三种深浅不同的
 * 灰；形状不同，则先读得出「这一层比上一层弱」，再读得出「它是哪一种」。
 */
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
        {/* 章首是一块**有底面**的开篇带，不是三行裸文字：一块淡强调底把「从
            这里开始读」画出来，实心方块把眼睛钉在分区名上，导语收尾。此前首屏
            是三块低对比文本（页名、说明、声明）压在分区名上，读者不知道自己在哪。 */}
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

/**
 * 章末的去处：把七个分区连成一条读得下去的路。
 *
 * 在此之前，每章读到底就是页面底——读者想知道「接下来该看什么」只能回头看
 * 切换区。给一个「下一章」的出口，手册才有先后；末章不画这一条（没有下一章
 * 就不该出现一个空出口）。
 */
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

/**
 * 声明条：页面级限定，常驻页头正下方。
 *
 * 用中性纸面而不是强调色染底：染底会让它读成「提示/告警」，而它讲的是
 * 这一页的**效力边界**（本页不是规则源）。图标取强调色，是这条声明唯一
 * 需要的重量。
 */
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

/**
 * 对照表：短板 → 典型表现 → LDVH 怎么做。
 *
 * 三列在宽处并排、窄处自然折行（`flex-wrap`，不引断点）。行为「主列」的
 * 第三列保留极浅强调底色——它是这一行的结论，读者扫右边缘就能把「机制」
 * 一列读下来。
 */
function CompareTable({ rows }: { rows: typeof OVERVIEW_COMPARE }) {
  const { t } = useI18n();
  return (
    <div data-presentation="compare" className="ldvh-help-sheet">
      <div className="ldvh-help-compare-head flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ldvh-border px-4 py-2.5">
        <span className="ldvh-caption-strong w-40 shrink-0">{t('help.overview.shortcomingLabel')}</span>
        <span className="ldvh-caption-strong min-w-[15rem] flex-1">{t('help.overview.symptomLabel')}</span>
        {/* 表头与数据行同染一层强调底色：结论列的色带从表头贯到末行，才读得出
            「右边这一列是答案」。只染数据行时表头是白的，色带在顶上断掉。 */}
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

/**
 * 形态：一格形态，两种排法。
 *
 * · 并列（默认）—— 「如何开始」的两条起点：网格里并肩的两格，只给一条上边线、
 *   不套卡框，两格并肩时读作「二选一」，不是两张卡片。
 * · 顺读（`stacked`）—— 主线五段：同一张纸上的五行，行间一条发丝线。五段排进
 *   网格会折成 2+2+1，末段孤零零悬在左半边，读者看到的是表格而不是一条线；
 *   而它们之间**没有来源已成立的先后序号**（`01` §1.5 第 12 条、「内容纪律」
 *   第 10 条），所以既不排成流水线、也不给编号——顺序由导语的「不是必须照走」
 *   交代，不靠序号假装。
 */
function StageCard({ stage, stacked = false }: { stage: StageShape; stacked?: boolean }) {
  const { t } = useI18n();
  return (
    <article data-presentation="stage" className={stacked ? 'ldvh-help-entry' : 'ldvh-help-stage'}>
      {/* 标题前不放类型图标：一格形态的产物不止一类（老项目 = 报告 + 目标 + 子
          目标），十五像素的图标位塞两三个必然叠在一起；产物已由下一行入口逐
          个点名，图标在这里只是把同一个信息再挤一遍。 */}
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

/**
 * 一行账的抬头：图标 + 条目标题 + 右端的去往入口。
 *
 * `tint` 给对象类型用：图标落在一块 12% 的类型色方块上。七类对象的类型色
 * 此前只染 15px 的图标本身，扫一列下来几乎看不出区别；一块淡色方块让每一行
 * 有了自己的颜色身份，也给了这一列纵向的节奏。系统与入口没有类型色，不传
 * `tint`，图标就还是灰的。
 */
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

/**
 * 条目账：一条对象／一个系统／一类交互入口。
 *
 * 「标签栏 + 值」两列是这个页面最主要的改进：标签栏固定 6.5rem，七条账的
 * 标签因此竖成一条竖线。卡片网格里每张卡各写一遍「它是什么／什么时候产生」，
 * 读者既数不出有几种问法，也比不了同一问法下的七个答案。
 */
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

/** 行式清单：一张纸上的若干行，行内容是插槽。 */
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

/** 标签阵列：一屏扫得完的并列短语（否定项清单、对象入口）。 */
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

/** 步骤清单：`ol`，顺序写进标记，读屏器才念得出「第 1 项，共 2 项」。 */
function StepList({ children }: { children: ReactNode }) {
  return (
    <ol data-presentation="steps" className="mt-6 flex min-w-0 flex-col">
      {children}
    </ol>
  );
}

/** 信任阶梯：三层声明，块首标记按形状分级（实心 / 空心 / 虚线）。 */
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

/**
 * 旁注：一段补充，不是一条设置。
 *
 * 只用一条上边线把它挂在前文之下（实线是行边界，本页不引入第二种线型），
 * 不再套边框——同页已经有「纸」，旁注再成盒就又是两套壳。
 */
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

/** 分节：一条上边线 + 上下的空间。只有线没有空间，分组仍会糊成一片。 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      {/* 眉标压在同一条分节线上：线从标签右侧一直划到列尾。此前是「一条通栏
          线 + 线下 20px 一个标签」，标签悬在线和纸之间，读起来像正文的第一行
          ——在线上的标签才一眼就是「这一段的分组名」。 */}
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
                  {/* 不再画一条线：两格自己都有上边线，眉标上面再压一条等于
                      同一处分节画了两次。 */}
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
