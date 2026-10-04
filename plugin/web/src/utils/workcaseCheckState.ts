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
  'mr-1.5 inline-block shrink-0 rounded border px-1.5 text-[11px] font-semibold leading-4';

/** 布尔（或缺失）→ 三态标记的形态类。 */
export function workCaseCheckChipClass(satisfied: boolean | undefined): string {
  return WORKCASE_CHECK_TAG_CLASS[workCaseCheckState(satisfied)];
}

/**
 * 建议去向的分类标记色（`21 §8` 闭集**二词**，Human 裁决 2026-09-28）。
 *
 * **为什么每个去向要一色**：此前所有去向共用同一靛蓝，读者必须读完文字才知道去向
 * 不同——而它们语义差别很大（不跟踪／悬置待裁）。分色使扫读窗口内一眼可分辨。
 *
 * **为什么色表放在这里**（设计语言纪律，`docs/10`：「着色必须单一来源，不得在业务
 * 组件里硬编码颜色类」）：该纪律原文针对**状态色**（同一状态不得两处不同色）；
 * 本表是**分类色**，性质略不同，但按同一纪律办——色值只此一处，组件只消费。
 *
 * **配色依据（色环校验，实测）**：卡面上同时可见的语义色已有五个——核对三词
 * （达成 emerald 160°／部分达成 amber 32°／未达成 red 0°）、目标块 violet 258°、
 * 残留块 amber。故先算可用空档（距上述各色 ≥40° 的区域仅 75–120°／200–215°／
 * 300–320° 三段），再从空档取色。「接受现状」取中性色，与所有彩色天然区分。
 *
 * **为什么表里仍保留四个键（2026-09-28）**：闭集由四词收为二词后，「另立工单」与
 * 「直接行动」不再是可写入的去向，但**存量载体里还写着它们**（`§15.3` 存量不溯及）。
 * 保留两键是为了让那些对象仍显示成其原本的去向，而不是掉进兜底色、显示成
 * 「未归类」——那对读者是更差的信息。**新增对象不会再产生这两键**：写入侧
 * `validateDirectionCompleteness`（`lib/workcase-writer.js`）只认二词，出现旧词
 * 一律拒绝写入。两色与其余色的间距校验保持不变：「直接行动」85° 与「达成」160°
 * 差 75°，不会误读为「已完成」。
 */
export const WORKCASE_ADVICE_TAG_CLASS: Record<string, string> = {
  // 蓝：与 workcase 类型色同族——「转为新工单」（**存量词**，2026-09-28 撤销）
  '另立工单': 'border-blue-600/45 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  // 黄绿：推进感；与「达成」绿拉开 75°，不误读为已完成（**存量词**，2026-09-28 撤销）
  '直接行动': 'border-lime-700/45 bg-lime-500/10 text-lime-800 dark:text-lime-300',
  // 中性石：「明确不跟踪」＝不强调
  '接受现状': 'border-stone-500/45 bg-stone-500/10 text-stone-600 dark:text-stone-300',
  // 品红：「悬置待裁」；与紫目标块拉开 35°
  '转入 Spark': 'border-fuchsia-600/45 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
};

/**
 * 去向条目与残留条目的**折叠阈值**——两处卡（待批准关闭 / 已关闭）共用一处来源。
 *
 * `10 §5.5`「单一来源纪律」（2026-09-28 二次修订）：两期卡虽不再同构（开放期读完整
 * 单元、关闭期只读去向一侧），但**去向条目与残留条目的类名、标记与折叠阈值仍须只有
 * 一处来源**，消费方从该处取得、不得各自重写——分写必然漂移。两期在**标记与语义色**
 * 上一致，只在**块构成**（是否呈现残留一侧）与**密度**上分岔。
 *
 * 此前两处各自写了一个同值的 `COLLAPSED_RESIDUAL = 2`（同值不等于同源：改动其一时
 * 另一处静默分岔），故收敛到此。
 */
export const WORKCASE_COLLAPSED_RESIDUAL = 2;

/**
 * 残留块的两个类（`21 §8` 的 `residual`）——**两块卡共用**。
 *
 * 「待批准关闭」卡（数据来自正文 `- residual:` 段）与「已关闭」卡（数据来自
 * `result.residual` 字段）是**同一个语义块的两个期**：内容项相同，只有权威来源不同。
 * 故外观必须同源——分写两份类名时两卡会随各自改动而漂移（本仓已有先例：同一状态曾
 * 出现「徽标紫、卡内提示琥珀」的分歧，见 `docs/10` 的着色单一来源纪律）。
 *
 * 琥珀底表达「未解决/待处置」——与核对（三词各自的语义色）、去向（二词各自的语义色）
 * 区分开。
 *
 * **2026-09-28 二次修订后的使用面**：该块在「待批准关闭」期**总是**呈现（承载完整
 * 单元：残留 + 去向子项）；在「已关闭」期**只在条件豁免成立时**呈现（不满足
 * 「每条残留都带有去向子项」者如实保留，见 `workCaseClosureNarrowsResidual`）。
 */
export const WORKCASE_RESIDUAL_BLOCK_CLASS =
  'min-w-0 rounded-md border border-amber-600/25 bg-amber-500/[0.05] px-2.5 py-2';

/**
 * 去向子项在其所属残留之下的**缩进行**样式（`10 §5.5`「块序与逐条标记」）。
 *
 * 「**去向子项的呈现**：在**待批准关闭**期缩进一行显示于所属残留之下（主从关系
 * 可见）；在**已关闭**期因残留一侧不再呈现，去向条**提升为平级行**」。故本常量
 * 只用于开放期的从属行，不用于关闭期的平级行。
 *
 * 缩进用 padding 而非 margin：条目行自带分割线（`WORKCASE_ITEM_ROW_CLASS` 的
 * `border-t`），用 margin 会把分割线也推离块宽，行与行的分割线不再对齐。
 */
export const WORKCASE_DIRECTION_ROW_CLASS =
  'border-t border-ldvh-border/40 py-1 pl-4 first:border-t-0 ldvh-caption text-ldvh-text-primary';

/**
 * 去向分区块的**底色族**——按去向词取同族色（`10 §5.5`「去向分区」）。
 *
 * 为什么着色：两个去向词各自成块后，「哪块是哪类去向」若只靠块内标题一行表达，读者
 * 扫视整卡时仍要逐块读字。块底取**该词标记的同族色**，使分区在余光里即可区分。
 *
 * 为什么与标记同族而非另配一套色：去向词的语义色已有**单一来源**
 * （`WORKCASE_ADVICE_TAG_CLASS`，四词各自的 border/bg/text 三元组）。块底另配色
 * 等于给同一语义开第二个色源——本仓已有先例教训（同一状态曾出现「徽标紫、卡内
 * 提示琥珀」的分歧）。故只用带 0.04 透明度的淡同族底色，border 与 text 一律
 * 沿用通用边框/正文色，不复刻标记的整套配色。
 *
 * **存量两词与「未归类」不着色**：它们没有 `10 §5.5` 的去向语义色（停用词的色是
 * 历史残留），给它们配新色等于为已停用语义新增色源。故回落中性无色，只留边框。
 *
 * 类名**按词穷举**而非拼接（底色类名逐词手写进下表）——拼接出的类名进不了 Tailwind
 * 的静态扫描，生产构建里会被摇掉。
 */
export const WORKCASE_DIRECTION_BLOCK_BASE_CLASS =
  'min-w-0 rounded-md border border-ldvh-border px-2.5 py-2';

export const WORKCASE_DIRECTION_BLOCK_BG_CLASS: Record<string, string> = {
  '接受现状': 'bg-stone-500/[0.04]',
  '转入 Spark': 'bg-fuchsia-500/[0.04]',
};

/**
 * 「取消理由」块的**底色**与**标记色**（Human 裁定 2026-10-01）。
 *
 * **缘起**：`outcome = cancelled` 的已关闭卡原本另起一格——中性块 + 两行（`理由` / `未发生的范围`），
 * 形态与去向分区块不同。Human 裁定改为**只留一行**（标记词改「取消理由」、去掉「未发生的范围」
 * 的呈现），且**块形态与去向分区逐项相同**、只**换一个颜色**以便与去向词区分。故本对常量只给
 * 「色」，**形态一律复用上面的分区形态常量**（块底／标题行／标题／条目行／项目符号／容器留白）——
 * 两处各写一份形态类，就是本仓反复出现的「两处各写一套」病。
 *
 * **为什么选玫瑰（rose）**（候选 A，人类在三色中选定）：取消是「这单停掉了」，玫瑰是最直接的
 * 读法；而它与去向闭集二词的石色／品红、存量两词的蓝／黄绿**都不撞**。已知风险是红系可能被读成
 * 「失败」——`21 §9.3` 明写 cancelled 不是失败（「不得以 cancelled 掩盖已完成或已失败的事实」），
 * 故以**标记词「取消理由」先行**抵掉该读法（读者先看到「取消」二字，再看到颜色）。
 *
 * 底色用 `/[0.04]`、标记用 `/10` 底 + `/45` 边 + `-600` 字——与去向分区同一尺度，不新造档位。
 */
export const WORKCASE_CANCEL_BLOCK_BG_CLASS = 'bg-rose-500/[0.04]';

export const WORKCASE_CANCEL_TAG_CLASS =
  'border-rose-500/45 bg-rose-500/10 text-rose-600 dark:text-rose-400';

/**
 * 分区标题（原逐条重复的去向标记，提到块首）——沿用**原来的标记样式**，
 * 不新造标题样式（Human 2026-09-30：「title 的部分用原来的样式」）。
 *
 * 提为标题后标记**不再内联于正文行**，故去掉 `WORKCASE_CHECK_TAG_BASE` 里为行内
 * 混排准备的 `mr-1.5`（块首标记后无行内后继），其余（圆角/边框/内距/字号/字重）
 * 逐项一致——「原来的样式」指的就是这些。
 */
export const WORKCASE_DIRECTION_TITLE_CLASS =
  'inline-block shrink-0 rounded border px-1.5 text-[11px] font-semibold leading-4';

/**
 * 分区内一条去向的正文行——**不带标记**（标记已提到块首，组内不再重复）。
 *
 * 该行现在是 **flex 行**（`flex items-start gap-1.5`）：行首是装饰性项目符号，
 * 其后是正文；「转入 Spark」项还会在正文下方（`mt-0.5` 的整宽子块）挂统一关联行。
 * 用 `items-start` 而非 `items-center`——正文可能折行或多出关联行，居中会让符号
 * 垂直漂到段落中部。
 *
 * 分割线用 `border-t` + `first:border-t-0`：首行紧贴标题，画线会与标题下的留白
 * 打架。缩进与「待批准关闭」期的从属行（`WORKCASE_DIRECTION_ROW_CLASS` 的 `pl-4`）
 * 不同——关闭期去向是**平级行**，不缩进。
 *
 * **正文字色（Human 2026-09-30：「字的颜色也调整的淡一点」）**：不再覆盖
 * `ldvh-caption` 自带的 `text-ldvh-text-secondary`——此前本行额外叠了
 * `text-ldvh-text-primary`（最深档），把去向正文压得与标题同级重。去掉该覆盖后，
 * 正文回到次级色，与「去向正文是说明性文字、不是标题」的定位一致。
 */
export const WORKCASE_DIRECTION_GROUP_ROW_CLASS =
  'flex items-start gap-1.5 border-t border-ldvh-border/40 py-1 first:border-t-0 ldvh-caption';

/**
 * 分区行的**项目符号**（Human 2026-09-30：「每一条缺少一个点号」→「位置调整一下」）。
 *
 * 为什么用绝对定位而不是 flex 流内元素：符号是**纯装饰**、不占内容宽度。流内摆放时
 * 符号的 `margin-right` 会与行容器的 `gap` 叠加（实测 6px + 6px = 12px，看起来离字
 * 太远），且符号随 `items-start` 停在**行盒顶端**、而正文首行有行高与 padding，两者
 * 基线不齐（实测偏高约 2px）。绝对定位后符号由 `left`/`top` 单独控制，与正文的
 * 间距、垂直位置都可独立微调，不干扰正文排版。
 *
 * `top-[12px]` 的取法：行 `py-1`（4px）+ 正文 `text-xs leading-5`（首行行高 20px）的
 * 光学中心在「4 + 10 = 14px」处，符号高 4px，故其上沿取 14 − 2 = 12px。
 *
 * （Human 2026-09-30 二次微调「灰色圆点需要下移 1 个像素」：初版取 11px——该值又减掉了
 * 行自身的 1px 上边框。实测那次减除是**多余**的：`top` 相对的是行的 padding box，
 * 上边框在其外侧，不占 1px。故取 12px，即纯光学中心的算式值。）
 * 改行距或字号时此处须同步——这是**光学对齐**，不是可推导的机械量，故以注释登记依据。
 */
export const WORKCASE_DIRECTION_ROW_BULLET_CLASS =
  'pointer-events-none absolute left-0 top-[12px] h-1 w-1 rounded-full bg-current opacity-45';

/**
 * 分区行的容器侧留白：为绝对定位的项目符号预留左侧空间。
 *
 * 用 `pl-3`（12px）而非流内 margin：符号贴 `left-0`，正文从 12px 开始，二者间距
 * 由这一处决定（不再有 gap 与 margin 叠加的问题）。注意本常量**只给内边距**——
 * 它与行类是两件事，故分行登记。
 */
export const WORKCASE_DIRECTION_ROW_INSET_CLASS = 'relative pl-3';

/**
 * 详情面去向**分区行**（密度变体）——落实 `10 §5.5` 行 300「卡面与详情只在密度上分岔」的
 * 「搬结构不搬密度」：结构（分区块、块首标记、项目符号、不报条数、首现序）**取卡面**，
 * 密度**取详情**。
 *
 * 为什么不直接复用卡面 `WORKCASE_DIRECTION_GROUP_ROW_CLASS`：它含 `ldvh-caption`（12px
 * 扫读档）。`docs/01 §1.4` 约束 4「详情页不得随之缩小」、约束 5「ldvh-caption 只承载辅助信息、
 * 不承载主要内容」——详情面去向正文是**事实正文**，整套照搬会把它掉到 12px。故本变体：
 * 去 `ldvh-caption`（正文 14px 由子 span 的 `ldvh-detail-semantic-body` 给，行类不声明字号）、
 * 去 `border-t`（`10 §5.5` 行 300：详情面用宽松行，分割线是卡面扫读的分隔手段）、
 * 行距放宽 `py-1.5`（卡面 `py-1`）。
 *
 * `relative pl-3` 内联（而非拆 `ROW_INSET`）：详情行自足给项目符号留位，与卡面的
 * 「inset + 行」两件套同义但为单类——密度变体各自成一处来源，避免卡/详两套行再互相抄。
 */
export const WORKCASE_DIRECTION_ROW_DETAIL_CLASS =
  'relative pl-3 flex items-start gap-1.5 py-1.5';

/**
 * 详情面分区行的项目符号——**光学位置按 14px/24px 正文与 `py-1.5` 重算**：
 * 行 padding 6px + 行高光学中心 12px = 18px，符号高 4px ⇒ `top-[16px]`。
 *
 * 为什么是独立常量而不复用卡面 `WORKCASE_DIRECTION_ROW_BULLET_CLASS`（`top-[12px]`）：
 * 那个 `12px` 按卡面 `text-xs/20px + py-1` 算得，详情面行高 24px、padding 6px，同值会
 * 让符号偏上。光学对齐不是可推导的机械量（见该常量登记），两密度各给一处取值。
 */
export const WORKCASE_DIRECTION_ROW_DETAIL_BULLET_CLASS =
  'pointer-events-none absolute left-0 top-[16px] h-1 w-1 rounded-full bg-current opacity-45';

/**
 * 分区标题行的容器：只放块首的去向标记（原逐条重复的那个标记）。
 *
 * **不写字数/条数**（Human 2026-09-30：「总数不用写」）：块内条目数读者一眼可数，
 * 每块再报一遍是把「有几条」在闭集二词上重复第二次；且条数是**机械事实**
 * （`21 §15.1`：机械层能数出「各有几条」），不报也不丢信息——少的是冗余。
 */
export const WORKCASE_DIRECTION_TITLE_ROW_CLASS =
  'flex min-w-0 items-center gap-1.5 pb-1';

/**
 * 一条去向（去向标记 + 正文）的渲染数据——**两块卡共用**同一形状（单一来源）。
 *
 * 为什么把这一步抽成纯函数（2026-09-24 实测教训）：组件的 JSX 不在 `node:test` 的
 * 可达范围内，映射逻辑留在组件里就等于零行为覆盖；抽成纯函数后「标记 + 正文」的
 * 配对与空值降级都能被直接断言。
 */
export interface WorkCaseDirectionRow {
  /** 去向词（闭集二词或存量两词）；判不出时为 null（呈现为「未归类」）。 */
  kind: string | null
  /** 去向正文（未剥 Markdown——剥离是呈现层 `stripCardMarkdown` 的职责）。 */
  text: string
}

/**
 * 一个**去向分区**——同一去向词的全部条目，连同该词本身。
 *
 * 为什么按词分区（Human 2026-09-30：「接受现状提出来变成一个 title，下面不再重复」
 * +「接受现状和转入 Spark 要 2 个区域」）：去向词原本逐条重复在每一行，同一对象有
 * 5 条「接受现状」就写 5 遍。提为**分区标题**后，词在屏上出现一次，组内只留正文；
 * 两类去向各成一个**独立块**，读者不读文字也能凭位置与色相分清。
 *
 * **信息未增未减**：条目数、条目顺序、条目正文与逐条呈现时逐字相同——去掉的只是
 * 重复的词。这是纯粹的**去重与分区**，不是对去向内容的任何加工。
 */
export interface WorkCaseDirectionGroup {
  /** 去向词（闭集二词或存量两词）；判不出词的分到 `null` 组（呈现为「未归类」）。 */
  kind: string | null
  /** 该词下的全部条目，**保持原相对顺序**（稳定分区，不排序）。 */
  rows: WorkCaseDirectionRow[]
}

/**
 * 去向行 → **按去向词分区**。稳定分区：组按**首次出现顺序**排列，组内保持原顺序，
 * 不排序、不合并、不去重——同一条目仍是一条。
 *
 * 为什么按首次出现而非闭集顺序：条目顺序是作者写下的顺序，是载体里的既有信息
 * （`21 §15.1`「呈现层不替作者修正形态」）；按闭集重排会让「第一条去向是哪个词」
 * 这一事实消失。判不出词者自成一组（`kind: null`），不并入任何已知词。
 */
export function groupDirectionRows(rows: readonly WorkCaseDirectionRow[]): WorkCaseDirectionGroup[] {
  const groups: WorkCaseDirectionGroup[] = []
  const byKind = new Map<string | null, WorkCaseDirectionGroup>()
  for (const row of rows) {
    const key = row.kind
    let group = byKind.get(key)
    if (group === undefined) {
      group = { kind: key, rows: [] }
      byKind.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

/**
 * 去向数组 → 渲染行。逐条忠实，**不合并、不截断、不补空**——判不出词的条目照样
 * 产出（`kind: null`），由呈现层显示为「未归类」，而不是静默丢弃。
 *
 * 这条纪律与 `21 §15.1` 判据边界第三条同源：「不达形态者**按零条计，不静默丢弃**」。
 * 呈现层的义务是如实显示，不是替作者修正形态。
 */
export function workCaseDirectionRows(advice: unknown): WorkCaseDirectionRow[] {
  if (!Array.isArray(advice)) return []
  const rows: WorkCaseDirectionRow[] = []
  for (const item of advice) {
    if (!item || typeof item !== 'object') continue
    const entry = item as { kind?: unknown; text?: unknown }
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (text.length === 0) continue
    rows.push({ kind: typeof entry.kind === 'string' ? entry.kind : null, text })
  }
  return rows
}

/** 残留条目行（`[残留] <正文>`）的渲染数据——两块卡共用同一形状。 */
export interface WorkCaseResidualRow {
  /** 残留正文（未剥 Markdown）。 */
  text: string
  /** 该条残留的去向子项（合并式主从结构；分离式与旧存量为空数组）。 */
  directions: WorkCaseDirectionRow[]
}

/**
 * 残留条目（含其去向子项）→ 渲染行。
 *
 * **两种输入形态**（`21 §15.3`「呈现层必须读两种形态」）：
 *   · `entries` 非空（合并式）——按主从结构产出，`directions` 挂在各自残留上；
 *   · `entries` 为空时回落到 `texts`（分离式/字段权威）——残留仍如实产出，
 *     `directions` 为空数组。**不把两者拼接、也不互补**：同一对象只有一种形态
 *     （`§15.3` 明文），拼接会制造同一条残留的两处出现。
 *
 * 「已关闭」期传 `result.residual` 字段（权威）+ 由正文解析出的 `entries`：
 * 字段是**残留正文**的权威，`entries` 只用来给每条挂上其去向子项（去向的权威承载
 * 始终是正文——`result` 字段闭集从不含去向，`21 §10.2`）。
 */
export function workCaseResidualRows(
  entries: unknown,
  texts?: unknown,
): WorkCaseResidualRow[] {
  if (Array.isArray(entries) && entries.length > 0) {
    const rows: WorkCaseResidualRow[] = []
    for (const item of entries) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { text?: unknown; directions?: unknown }
      const text = typeof entry.text === 'string' ? entry.text : ''
      if (text.length === 0) continue
      rows.push({ text, directions: workCaseDirectionRows(entry.directions) })
    }
    if (rows.length > 0) return rows
  }
  if (!Array.isArray(texts)) return []
  return texts
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((text) => ({ text, directions: [] }))
}


/**
 * 卡体内「条目行」的统一行样式——核对、去向、残留、计划清单**四处共用**。
 *
 * 为什么收敛：这串类名原先被抄了 **5 份**（核对×2、去向×2、残留×1），而它们表达的
 * 是同一件事——「卡片正文块里的一行」。分写必然漂移：计划清单就因另写了一份
 * （`flex … gap-2.5`，无分割线）而与其余三块不一致，Human 2026-09-24 指出
 * 「希望有分割线」。
 *
 * `border-t` + `first:border-t-0`：块内条目之间**有分割线**，首条不加（否则与块顶
 * 边框叠成双线）。这是四块共同的形态，新增块应直接复用本常量。
 */
export const WORKCASE_ITEM_ROW_CLASS =
  'border-t border-ldvh-border/60 py-1.5 first:border-t-0 first:pt-0.5 ldvh-caption text-ldvh-text-primary';

/**
 * 通用条目行的**详情密度变体**——落实 `10 §5.5` 行 300「卡面紧凑行（扫读窗口）／详情宽松行
 * （阅读面），两面只在密度上分岔」。
 *
 * 与卡面 `WORKCASE_ITEM_ROW_CLASS` 的三处差别：
 * - 去 `border-t`：分割线是卡面扫读时切分条目的手段；详情是阅读面，用宽松行（同
 *   `WorkCaseCriteriaList` 的 `density='detail'` 分支，那里已无分割线）。
 * - 去 `ldvh-caption`（12px）：`docs/01 §1.4` 约束 4「详情页不得随之缩小」、约束 5「caption
 *   只承载辅助信息」。详情条目行的字号由其**子元素自声明**——字段标签 `ldvh-caption-strong`
 *   （12px）、事实正文 `ldvh-detail-semantic-body`（壳内 14px/24px），行类不越俎代庖声明
 *   字号（否则就是卡面密度被详情借用、靠子元素逐个覆盖的脆弱形态）。
 * - 保留 `py-1.5`：去掉分割线后，行距改由 padding 单独提供节奏。
 */
export const WORKCASE_ITEM_ROW_DETAIL_CLASS = 'min-w-0 py-1.5';

/** 块内条目列表的容器（与 `WORKCASE_ITEM_ROW_CLASS` 配套：不用 gap，间距由行的 padding 提供）。 */
export const WORKCASE_ITEM_LIST_CLASS = 'grid min-w-0';

/**
 * 残留条目的「残留」标记（Human 裁定 2026-09-24）。
 *
 * 为什么逐条加：核对块与去向块的行结构都是「`[标记] 正文`」，而残留块此前**只有正文**
 * ——三块行结构不一致，条目边界靠换行区分。Human 要求统一为该结构，并**逐条**标记
 * （而非块首一个小标题），故此处给每个残留条目配一个固定词标记。
 *
 * 与块底色的关系：块底是琥珀色，标记同为琥珀系——颜色一致是**有意的**：标记与块
 * 表达同一件事（这是残留），不引入第二个语义色。故复用验证过的琥珀档，不新增色相
 * （卡面可用色相已接近用尽，见上方去向二色的空档计算）。
 */
export const WORKCASE_RESIDUAL_TAG_CLASS =
  'border-amber-600/50 bg-amber-500/[0.12] text-amber-700 dark:text-amber-300';

/** 残留条目行——即统一条目行样式（四块共用，见 `WORKCASE_ITEM_ROW_CLASS`）。 */
export const WORKCASE_RESIDUAL_ROW_CLASS = WORKCASE_ITEM_ROW_CLASS;

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
