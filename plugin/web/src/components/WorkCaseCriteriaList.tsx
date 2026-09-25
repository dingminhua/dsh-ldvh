import SummaryText from '@/components/SummaryText';
import { WORKCASE_ITEM_LIST_CLASS, WORKCASE_ITEM_ROW_CLASS } from '@/utils/workcaseCheckState';

/**
 * WorkCase 判据清单（列表卡与详情共用同一组件）。
 *
 * 列表卡直接使用 —— 紧凑的项目符号清单；
 * 详情页用 `WORKCASE_CRITERIA_SURFACE_CLASS` 把它包成带稳定身份的轻量面板
 * （10 §5.3 语义详情），即消费方在 WorkCaseReadingLayout 的 PlanNode /
 * ResidualNode，而非在本组件内自行切换信息密度。
 *
 * 判据核对状态（satisfied 三态）的映射与呈现词条不在此文件——见
 * `@/utils/workcaseCheckState`（详情/列表卡/收件箱共用的单一实现）。
 */
/**
 * 判据面板的容器类（**四处共用**：列表卡计划清单、收件箱计划与判据、详情页
 * PlanNode 与 ResidualNode）。
 *
 * **四边同为 1px 细线**（Human 定案 2026-09-24：「左侧 2 像素的粗边框不要，要 1 像素的」）：
 * 此前是 `border` + `border-l-2 border-l-blue-400/80`（左边 2px 且色更深），四边不等。
 * 现去掉这两项，左边与其余三边完全一致（同宽、同色）。
 *
 * **这不是新偏好，而是同类定案的补齐**：2026-09-13 Human 已在终态说明框上定过
 * 「仅去掉左侧加粗竖线——四边同为 1px 细线」（见 `ObjectList` 的 `TerminalFactPanel`
 * 注释）。当时只改了那一处，本面板未跟着改，故两处形态分岔至今。
 *
 * 代价（如实登记）：左线颜色随 `border-l-blue-400/80` 一并移除，左边框因此从
 * `0.8` 透明度降到与其余三边相同的 `0.2`——**视觉上左边框会变淡**。这是「四边
 * 同为 1px」的必然结果，也是 Human 明确选择的效果（方案甲）。
 */
export const WORKCASE_CRITERIA_SURFACE_CLASS =
  'min-w-0 rounded-md border border-blue-400/20 bg-blue-500/[0.025] px-3 py-2.5 dark:bg-blue-950/20';

/**
 * **琥珀**承载面（`docs/04:82`：「"关闭提案"使用**琥珀色提案色调**」）。
 *
 * 为什么单列一个常量而不复用蓝面（Human 裁定 2026-09-24「先做一处试点」）：
 * 详情页的「残留责任」当前与「计划与判据」用**同一个蓝面** —— 两块的语义完全不同
 * （前者是「还剩什么」＝待处置，后者是「成功标准」＝预期），底色却一致，读者无法
 * 靠视觉区分。`docs/04:80` 要求语义块「共同服从其背景色系」，残留属**等待 / 建议**
 * 一族（琥珀），不属「标准与预期」（蓝）。
 *
 * 面与其内正文色必须成对换（见 `WorkCaseCriteriaList` 的 `tone` 参数）：蓝面配蓝灰
 * 正文、琥珀面配琥珀正文，否则会出现「琥珀底 + 蓝字」的跨色系组合。
 */
export const WORKCASE_RESIDUAL_SURFACE_CLASS =
  'min-w-0 rounded-md border border-amber-600/25 bg-amber-500/[0.05] px-3 py-2.5 dark:bg-amber-500/[0.08]';

/**
 * 语义块承载面：**紫（批准）** 与 **青（工作/主控）**。
 *
 * 依据 `docs/04:80` 逐字：「紫色目标与批准……青色工作与主控」——两个节点的归属是
 * **规范已指定**的，不是呈现者的偏好：
 *   · 「Gate 1 授权」属**批准** → 紫（`WORKCASE_GATE1_SURFACE_CLASS`）
 *   · 「执行现场」属**工作** → 青（`WORKCASE_ATTEMPT_SURFACE_CLASS`）
 *
 * 为什么单列于此：这两个节点此前是**全页唯一没有承载面的块**——只有标签与值两列，
 * 无背景、无边框、无分组，Human 2026-09-24 指出「太素」。而同页其余节点（计划判据、
 * 残留、复核、正文）都有承载面，形态因此不统一。
 *
 * 取值与既有两个面**同规格**（四边 1px、`rounded-md`、`px-3 py-2.5`），只换色相；
 * 四边等宽同色（Human 定案 2026-09-24：「左侧 2 像素的粗边框不要，要 1 像素的」）。
 */
export const WORKCASE_GATE1_SURFACE_CLASS =
  'min-w-0 rounded-md border border-violet-400/25 bg-violet-500/[0.035] px-3 py-2.5 dark:bg-violet-500/[0.08]';

export const WORKCASE_ATTEMPT_SURFACE_CLASS =
  'min-w-0 rounded-md border border-cyan-500/25 bg-cyan-500/[0.035] px-3 py-2.5 dark:bg-cyan-500/[0.08]';

/**
 * **绿色结果**承载面（`docs/04:80`：「绿色结果」）。
 *
 * 用于「判据逐条核对」与「已证实范围」——二者与「残留责任」同属**结果**一族，
 * 但残留另有明文归属（`docs/04:82`「关闭提案使用**琥珀色**提案色调」，已落地为
 * `WORKCASE_RESIDUAL_SURFACE_CLASS`），故绿面只覆盖核对与已证实范围。
 *
 * 此前这两个节点**无面**（核对的条目直接裸排在节点内、已证实范围经中性 `ProseNode`），
 * 与同族的琥珀残留视觉上互不相关，Human 2026-09-24 指出需一并处理。
 */
export const WORKCASE_RESULT_SURFACE_CLASS =
  'min-w-0 rounded-md border border-emerald-600/25 bg-emerald-500/[0.035] px-3 py-2.5 dark:bg-emerald-500/[0.08]';

export interface WorkCaseCriterionListItem {
  key: string;
  statement: string;
}

/**
 * 条目行样式：**卡面**（列表卡、收件箱）用带分割线的统一行样式；
 * **详情面**用宽松行（无分割线、条目间距更大，属阅读面而非扫读面）。
 *
 * 为什么由消费者选而不是组件内判别：卡面与详情面对同一份数据的信息密度要求不同，
 * 而 `docs/10 §1.10` 要求两面共享**同一套设计语言**（同色、同标记、同结构），
 * 差异只在密度。故此处把「密度」显式化为一个参数，而非复制一个组件。
 */
export type WorkCaseCriteriaRowDensity = 'card' | 'detail';

export function WorkCaseCriteriaList({
  items,
  className = '',
  density = 'detail',
  tone = 'standard',
}: {
  items: WorkCaseCriterionListItem[];
  className?: string;
  density?: WorkCaseCriteriaRowDensity;
  /**
   * 面板色调，决定**圆点与正文取色**——须与其外层承载面成对使用
   * （`standard` ↔ `WORKCASE_CRITERIA_SURFACE_CLASS`；
   * `residual` ↔ `WORKCASE_RESIDUAL_SURFACE_CLASS`）。默认 `standard`，
   * 故既有四处调用（列表卡计划清单、收件箱两处、详情页 PlanNode）**行为不变**。
   */
  tone?: 'standard' | 'residual';
}) {
  // 卡面：复用统一条目行样式（与核对/去向/残留同一串类名），分割线由该样式提供；
  // 详情面：宽松行，无分割线。
  const rowClass =
    density === 'card'
      ? WORKCASE_ITEM_ROW_CLASS
      : 'min-w-0';
  const listClass =
    density === 'card'
      ? `${className} ${WORKCASE_ITEM_LIST_CLASS}`.trim()
      : `${className} grid min-w-0 gap-1.5`.trim();
  return (
    <ul className={listClass}>
      {items.map((item) => (
        <li key={item.key} className={`${rowClass} flex items-start gap-2.5`.trim()}>
          <span
            aria-hidden="true"
            className={`h-1 w-1 shrink-0 rounded-full ${
              tone === 'residual' ? 'bg-amber-500/75 dark:bg-amber-400/80' : 'bg-blue-400/65 dark:bg-blue-400/75'
            } ${density === 'card' ? 'mt-[0.55rem]' : 'mt-[0.5rem]'}`}
          />
          <div className="ldvh-caption min-w-0 flex-1 break-words [&_p]:my-0">
            {item.statement.trim() && (
              <SummaryText
                value={item.statement}
                collapseThreshold={Number.MAX_SAFE_INTEGER}
                className={`ldvh-card-decision-body ${
                  tone === 'residual'
                    ? 'text-amber-900/85 dark:text-amber-100/80'
                    : 'text-blue-900/70 dark:text-blue-100/75'
                }`}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
