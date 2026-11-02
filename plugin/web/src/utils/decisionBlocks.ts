/**
 * 左色条决策块（对象卡片/详情内的类型专属语义块）类串单源。
 *
 * 家族成员（收敛时点 2026-09-24，批次C；两轮退出后只剩两条）：
 * - Pitfall 决策字段块（琥珀·卡面）——ObjectList
 * - Friction 现象块（琥珀·卡面）——ObjectList
 * - ~~Norm 方向键块（紫·卡面 truncate / 详情面 break-all）~~ ——**2026-11-02 退出**（见 `DECISION_CARD_SHELL_CLASS` 注释）
 * - ~~SubGoal 锚点块（黄绿·仅详情面）~~ ——**2026-11-02 整体退出本家族**（见下）
 *
 * 刻意不并入的左色条远亲（透明度与语义不同，属「状态通知」子族）：
 * - CognitionCenter 模块不可用红通知（border-red-400/25 + bg-red-500/5 + px-2.5 py-2）
 * - ObjectDetail 只读提示 zinc 块（border-zinc-400/25 + bg-zinc-500/5）
 *
 * 本家族为纯代码层约定（docs/ 无左色条/决策块锚点）；与判据面板「四边同为 1px」
 * Human 定案（specs/10:298）的关系：该定案作用域为判据面板，决策块保留左条强调。
 * 是否统一由 Human 裁决，收敛时不动视觉。
 *
 * **2026-11-02 的两次退出，记录的是一件事而不是两条巧合**：
 * ① 子目标：卡面并入判据面板那一侧（Human 定案「样式对齐 workcase 的，左侧的线条
 *    不要加粗」）→ 详情面顶部锚点块撤除（「这个地方只保留判法即可」）；
 * ② 规范：卡面方向键块与详情面方向键节点一并撤除（Human 定案「框出来的不需要显示」）。
 * 两类型、四个站点，撤除的判据是同一个：**左色条原本用来标记「这个块是哪个领域的
 * 决定」，而这两类型被撤掉的块里已经没有任何「决定」可标记**——子目标是可判定的
 * 达成条件，规范是成体系的长文。壳比它承载的内容活得久，是本仓反复出现的形态：
 * 内容被判定不该上屏后，壳常以「它是家族成员」为由单独留存（`lime` 卡面壳那次就是
 * 先删内容、后删壳）。故两处都按「内容撤则壳撤」处置，不留无人消费的壳。
 *
 * 本家族现在只覆盖**卡面 amber** 一条壳；「决策块是否整体并入判据面板」这一争议
 * 对剩下的这一条仍未裁决，本文件的立场仍是「收敛时不动视觉」。
 */

/**
 * 卡面壳：色相同系染色 + 同色相 2px 左条。
 *
 * **色相已收敛为单一 `amber`（2026-11-02）**。三次退出各有不同理由，合并记在这里：
 *
 * - `lime`（2026-11 为 28 号 SubGoal 加入，理由：amber 在 Pitfall/Friction 上表示
 *   「需要处置的条目」、violet 在 Norm 上表示「成体系的规则」，子目标两者都不是）。
 *   卡面壳先删（判据框改用判据面几何），详情面壳随后删（锚点块整体撤除）——内容没了，
 *   壳就没有归属。
 * - `violet`（Norm）。方向键块与类型说明行一并撤除后，活跃规范卡不承载任何卡体内容，
 *   这枚壳失去最后一个消费方。**它不是被「统一」掉的**——它是被它承载的内容带走的。
 *
 * `Record` 只剩一个键时仍保留 `Record` 形态而不降为裸字符串：调用处写的是
 * `DECISION_CARD_SHELL_CLASS.amber`，语义是「取该色相的卡面壳」，改形会牵动消费方
 * 且让下一枚色相回来时又要重写。键集是**证据**（当前只有琥珀一个领域用左色条卡面），
 * 不是待膨胀的白名单。
 */
export const DECISION_CARD_SHELL_CLASS: Record<'amber', string> = {
  amber: 'min-w-0 rounded-md border border-amber-400/20 border-l-2 border-l-amber-400/70 bg-amber-500/[0.025] px-3.5 py-3',
};

/** 详情面壳：中性底 + 类型色左条（详情面不整面染色——卡/详情面分岔，与 specs/10:300 密度分岔同源）。
 *
 *  **如实登记一处已知不一致（不是本次改动引入，也没有被本次改动修好）**：左条是
 *  `border-l-violet-400/70`（紫），而现存唯一消费方 `DevLogReadingLayout` 的时间轴节点
 *  把**标题**写成 `DECISION_TITLE_HUE_CLASS.lime`（黄绿）——同一块里左条与标题不同色相。
 *  紫是 Norm 的领域色，DevLog 的类型色是 `#ca21a0`（magenta，见 `categoryColors.ts`），
 *  两者都不等于 lime。
 *
 *  本次不动它：改左条色相是**未被请求的视觉变更**，而按 00 §5.6，未做的处置必须写明
 *  而不许含糊带过。正确修法任选其一——把左条并进与本块标题同一色相原子，或让本块改用
 *  四边同宽壳（它已不含「领域归属」语义，本不该留在本家族）——两者都需 Human 裁决，
 *  故此处只登记，不擅自择一。
 */
export const DECISION_DETAIL_NEUTRAL_SHELL_CLASS =
  'min-w-0 rounded-md border border-ldvh-border/80 border-l-2 border-l-violet-400/70 bg-ldvh-bg/65 px-3.5 py-3';

/** 标题色相（使用处补 ldvh-card-decision-title 与布局位如 min-w-0）。
 *
 *  **`violet` 已退出（2026-11-02）**：它唯一的消费方是 Norm 的方向键标题（卡面与详情面
 *  各一处），方向键撤除后无消费方。保留 `lime` 的理由与它不同：`lime` 有一个现存消费方
 *  （`DevLogReadingLayout` 的时间轴标题），那是色相用法而不属本家族。 */
export const DECISION_TITLE_HUE_CLASS: Record<'amber' | 'lime', string> = {
  amber: 'text-amber-700/85 dark:text-amber-200/85',
  lime: 'text-lime-700/85 dark:text-lime-200/85',
};

/** 琥珀正文色相（配 ldvh-card-decision-body；深字低饱和——同色相纪律 docs/01 §1.4 行311）。 */
export const DECISION_AMBER_BODY_HUE_CLASS = 'text-amber-950/70 dark:text-amber-100/75';

/** 紫方向键 code chip 色相——**2026-11-02 已删除**（`DECISION_VIOLET_CODE_CHIP_HUE_CLASS`）。
 *
 *  它只服务 Norm 方向键那一枚 chip（「方向键 + 等宽短串」的形态），chip 随方向键节点
 *  一并撤除后无消费方。此处留下踪迹而非静默消失，是因为这枚常量的名字出现在
 *  `docs/01` §1.10 第 7 条的语义左条家族讨论与被撤前的守卫登记里；读者若从旧注释追来，
 *  应当能在这里看到它去了哪里、为什么。
 */
