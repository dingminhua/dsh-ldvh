import type { LocaleKey } from '@/i18n/locales';
import type {
  WorkCaseCheckStatus as WorkCaseDraftStatus,
  WorkCaseDraftCheck,
} from '../../shared/workcaseResultDraft';

/** 只需要「取词条」这一能力的翻译函数形态（避免把 i18n context 带进工具层）。 */
type Translator = (key: LocaleKey) => string;

/**
 * WorkCase 判据核对状态 → 可读词条的三态映射（**唯一实现**，09 §6 单一实现）。
 *
 * `21 §8`：`result.criteria_checks[].satisfied` 是**布尔**判定，缺失即「未记录」
 * （不是 false——两者语义不同，必须可区分）；「待批准关闭」期的正文词表则是闭集
 * **三词**（达成 / 部分达成 / 未达成），其中「部分达成」在布尔域里无对应值。
 * 故本模块同时承载**两个输入域**、**一套输出词表**：
 *
 * - 布尔域（`satisfied`）：`workCaseCheckState` → 达成 / 未达成 / 未记录；
 * - 词表域（正文三词）：`workCaseCheckStateFromWord` → 达成 / 部分达成 / 未达成 / 未记录。
 *
 * **词表取 `21 §8` 登记的三词**（Human 2026-09-24 统一）：此前列表卡与详情各用一套
 * ——详情面说「已满足／未满足」，卡片说「达成／未达成」——同一状态在不同呈现面
 * 显示为不同词，跨面不可比。`21 §8` 已把映射登记为「达成 ⇔ `true`；部分达成／未达成
 * ⇔ `false`」，呈现层据此归一，不再自造近义词。
 *
 * 消费者：详情（WorkCaseReadingLayout 的 ResultChecksNode）、列表卡
 * （WorkCaseClosedSummary）、收件箱（CognitionCenter）、卡片草稿
 * （WorkCaseResultDraft）。此前列表与收件箱把布尔直接插值进字符串
 * （`` `${c.satisfied} · ${c.evidence}` ``），页面上因此显示裸 `true`/`false`，
 * 且 `satisfied` 缺失时显示空串（WorkCase 呈现保真缺陷 D6）。
 */
export const WORKCASE_CHECK_STATE_KEYS = {
  satisfied: 'objectList.workcaseCheck.achieved',
  partial: 'objectList.workcaseCheck.partial',
  unsatisfied: 'objectList.workcaseCheck.not-achieved',
  unknown: 'objectList.workcaseCheck.unrecorded',
} as const satisfies Record<string, LocaleKey>;

export type WorkCaseCheckState = keyof typeof WORKCASE_CHECK_STATE_KEYS;

/** 布尔（或缺失）→ 三态名。 */
export function workCaseCheckState(satisfied: boolean | undefined): WorkCaseCheckState {
  if (satisfied === true) return 'satisfied';
  if (satisfied === false) return 'unsatisfied';
  return 'unknown';
}

/**
 * 正文三词（`21 §8`）→ 三态名。只认登记词；判不出时记 `unknown`（**不猜**、
 * 不把近义词静默归一）。顺序敏感：先长词后短词（「达成」是「未达成」的子串）。
 */
export function workCaseCheckStateFromWord(word: string | null | undefined): WorkCaseCheckState {
  if (typeof word !== 'string' || word.length === 0) return 'unknown';
  if (word.includes('未达成')) return 'unsatisfied';
  if (word.includes('部分达成')) return 'partial';
  if (word.includes('达成')) return 'satisfied';
  return 'unknown';
}

/**
 * 解析器的内部状态名（`WorkCaseCheckStatus`）→ 三态名。
 *
 * **输入域是枚举，不是中文词**——`shared/workcaseResultDraft` 已经把正文三词归一
 * 成这三个值。故本函数与 `workCaseCheckStateFromWord` **不可互换**：把枚举丢给后者
 * 会因不含中文而全部落成 `unknown`（2026-09-24 实测踩到：「待批准关闭」卡上每条
 * 核对都显示「未记录」）。两者并置于此，正是为了让「哪个输入域用哪个函数」在单点
 * 可见，而不是散在组件里。
 */
const STATE_BY_DRAFT_STATUS: Record<WorkCaseDraftStatus, WorkCaseCheckState> = {
  achieved: 'satisfied',
  partial: 'partial',
  'not-achieved': 'unsatisfied',
};

export function workCaseCheckStateFromDraftStatus(
  status: WorkCaseDraftStatus | null | undefined,
): WorkCaseCheckState {
  return status === null || status === undefined ? 'unknown' : STATE_BY_DRAFT_STATUS[status];
}

/** 三态名 → 本地化可读文本。 */
export function workCaseCheckLabelFor(state: WorkCaseCheckState, t: Translator): string {
  return t(WORKCASE_CHECK_STATE_KEYS[state]);
}

/** 布尔（或缺失）→ 本地化可读文本。 */
export function workCaseCheckStateLabel(satisfied: boolean | undefined, t: Translator): string {
  return workCaseCheckLabelFor(workCaseCheckState(satisfied), t);
}

/**
 * 三态标记的形态类（形状 + 颜色）。颜色只作辅助——文字已独立承载语义（10 §12.8）。
 *
 * 形状与「变更流水」的「复核／修订」标记同一套（行内、宽度自适应），使同一张卡上
 * 的各类标记在版式上属于同一族。四色取语义色：达成 emerald / 部分达成 amber /
 * 未达成 red / 未记录 中性。
 */
export const WORKCASE_CHECK_TAG_CLASS: Record<WorkCaseCheckState, string> = {
  satisfied: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  partial: 'border-amber-600/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  unsatisfied: 'border-red-600/45 bg-red-500/10 text-red-700 dark:text-red-300',
  unknown: 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary',
};

/** 标记的统一形状（与「待批准关闭」「变更流水」的标记同族）。 */
export const WORKCASE_CHECK_TAG_BASE =
  'mr-1.5 inline-block shrink-0 rounded border px-1.5 text-[10px] font-semibold leading-4';

/** 布尔（或缺失）→ 三态标记的形态类。 */
export function workCaseCheckChipClass(satisfied: boolean | undefined): string {
  return WORKCASE_CHECK_TAG_CLASS[workCaseCheckState(satisfied)];
}

/**
 * 建议去向的四色标记（`21 §8` 闭集四词，Human 2026-09-24 定）。
 *
 * **为什么四词要四色**：此前四个去向共用同一靛蓝，读者必须读完文字才知道去向不同——
 * 而它们语义差别很大（另立对象／就地处置／不跟踪／悬置待裁）。四色使扫读窗口内
 * 一眼可分辨。
 *
 * **为什么色表放在这里**（设计语言纪律，`docs/10`：「着色必须单一来源，不得在业务
 * 组件里硬编码颜色类」）：该纪律原文针对**状态色**（同一状态不得两处不同色）；
 * 本表是**分类色**，性质略不同，但按同一纪律办——色值只此一处，组件只消费。
 *
 * **配色依据（色环校验，实测）**：卡面上同时可见的语义色已有五个——核对三词
 * （达成 emerald 160°／部分达成 amber 32°／未达成 red 0°）、目标块 violet 258°、
 * 残留块 amber。故先算可用空档（距上述各色 ≥40° 的区域仅 75–120°／200–215°／
 * 300–320° 三段），再从空档取色。四色两两间距：另立工单↔直接行动 136°、
 * 另立工单↔转入 Spark 72°、直接行动↔转入 Spark 152°；「接受现状」取中性色，
 * 与所有彩色天然区分。与核对三词最近的一对是「直接行动 85° ↔ 达成 160°」差 75°，
 * 不会误读为「已完成」。
 */
export const WORKCASE_ADVICE_TAG_CLASS: Record<string, string> = {
  // 蓝：与 workcase 类型色同族——「转为新工单」
  '另立工单': 'border-blue-600/45 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  // 黄绿：推进感；与「达成」绿拉开 75°，不误读为已完成
  '直接行动': 'border-lime-700/45 bg-lime-500/10 text-lime-800 dark:text-lime-300',
  // 中性石：「明确不跟踪」＝不强调
  '接受现状': 'border-stone-500/45 bg-stone-500/10 text-stone-600 dark:text-stone-300',
  // 品红：「悬置待裁」；与紫目标块拉开 35°
  '转入 Spark': 'border-fuchsia-600/45 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
};

/** 去向标记的兜底形态（未归类，或闭集之外的写法）。 */
export const WORKCASE_ADVICE_TAG_FALLBACK_CLASS =
  'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';

/** 去向词 → 标记形态类。未知去向回落到中性兜底（不猜、不套用某个已知色）。 */
export function workCaseAdviceTagClass(kind: string | null | undefined): string {
  if (typeof kind !== 'string' || kind.length === 0) return WORKCASE_ADVICE_TAG_FALLBACK_CLASS;
  return WORKCASE_ADVICE_TAG_CLASS[kind] ?? WORKCASE_ADVICE_TAG_FALLBACK_CLASS;
}

/**
 * 列表卡与收件箱的紧凑判据行：「可读状态 · 依据」。
 * 详情走 chip + 依据的完整形态；两处共享同一状态映射，不各自拼字符串。
 */
export function workCaseCheckStatement(
  check: { satisfied?: boolean; evidence?: string },
  t: Translator,
): string {
  const label = workCaseCheckStateLabel(check.satisfied, t);
  const evidence = typeof check.evidence === 'string' ? check.evidence.trim() : '';
  return evidence ? `${label} · ${evidence}` : label;
}

// ---------------------------------------------------------------------------
// 呈现行：把「字段/解析结果」变成「标记 + 标题」的可渲染行
// ---------------------------------------------------------------------------
//
// 为什么把这一步做成**纯函数**而不是留在组件里（2026-09-24 实测教训）：枚举→状态名
// 的映射原先内联在两个组件中，把枚举误喂给按中文词判定的入口时整卡落成「未记录」，
// 而 340 项测试全绿——因为组件的 JSX 不在 node:test 的可达范围内，映射本身没有任何
// 行为覆盖。抽成纯函数后，映射与标题配对都能被直接断言。

/** 一行核对：标记状态 + 标题（标题取自 `plan[i].step`，缺失即该行不呈现）。 */
export interface WorkCaseCheckRow {
  state: WorkCaseCheckState
  title: string
  planIndex: number
}

interface PlanStepLike {
  step?: unknown
}

function stepTitleAt(plan: unknown, index: number): string {
  if (!Array.isArray(plan)) return ''
  const step = (plan as PlanStepLike[])[index]
  return typeof step?.step === 'string' ? step.step.trim() : ''
}

/**
 * 「待批准关闭」的核对行：解析器输出（`planIndex` + 枚举 `status`）× `plan`。
 *
 * **输入域是枚举**（`achieved` / `partial` / `not-achieved`），不是正文中文词——
 * 故走 `workCaseCheckStateFromDraftStatus`。标题取自 `plan[planIndex].step`；
 * 配不上或标题为空的行不产出（调用方按「无对应条目」呈现，不猜）。
 */
export function workCaseDraftCheckRows(
  checks: WorkCaseDraftCheck[] | undefined,
  plan: unknown,
): WorkCaseCheckRow[] {
  if (!Array.isArray(checks)) return []
  const rows: WorkCaseCheckRow[] = []
  for (const check of checks) {
    const planIndex = typeof check?.planIndex === 'number' ? check.planIndex : -1
    const title = stepTitleAt(plan, planIndex)
    if (!title) continue
    rows.push({ state: workCaseCheckStateFromDraftStatus(check?.status ?? null), title, planIndex })
  }
  return rows
}

/**
 * 「已关闭」的核对行：`result.criteria_checks`（**按数组序**与 `plan` 逐条对应，
 * `21 §8`：「长度一致、顺序一致」）× `plan`。
 *
 * **输入域是布尔** `satisfied`——故走 `workCaseCheckState`，不可与枚举入口互换。
 */
export function workCaseResultCheckRows(
  checks: { satisfied?: boolean }[] | undefined,
  plan: unknown,
): WorkCaseCheckRow[] {
  if (!Array.isArray(checks)) return []
  const rows: WorkCaseCheckRow[] = []
  for (let index = 0; index < checks.length; index += 1) {
    const title = stepTitleAt(plan, index)
    if (!title) continue
    rows.push({ state: workCaseCheckState(checks[index]?.satisfied), title, planIndex: index })
  }
  return rows
}
