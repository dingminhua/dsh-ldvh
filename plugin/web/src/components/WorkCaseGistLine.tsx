import { useI18n } from '@/i18n/context';
import { useTheme } from '@/hooks/useTheme';
import { getStatusColor } from '@/utils/statusColors';

/**
 * WorkCase 卡面首行的「要点」呈现（列表卡 / 聚焦收件箱卡体共用）。
 *
 * 10 §5.5「卡面与详情的字段分工」登记：卡面（列表卡 + 聚焦收件箱卡体）渲染
 * `gist`，**不**渲染 `summary`；`summary` 只在语义详情作为 Markdown 节点出现。
 * 理由是两者读者不同——`summary` 按 21 §8 是「使未读原计划的后续执行者可独立
 * 执行」的完整快照（可长、可含编号引用与对象标识、可带 Markdown 标记），而卡面
 * 是 320px 宽 12px 字号的**扫读窗口**。把后者放进前者，实测两个后果：文字溢出
 * 扫读窗口；纯文本插值把 Markdown 标记以字面形式暴露给 Human。
 *
 * 两个权威都是单一来源，本组件只消费、不重定义：
 * - 字段语义与分层必填 → `specs/21` §8；
 * - 呈现接线与降级要求 → `specs/10` §5.5。
 *
 * 降级（10 §5.5「呈现降级」）：`gist` 在 `status = closed` 时按 21 §8 缺失合法
 * （终态只读，无受控入口可补写）。此时**如实降级**——
 * - 不以 `summary` 首句静默替代（那会把两个读者的字段混为一谈，掩盖字段缺口）；
 * - 不留白使卡片看似无内容。
 * 故以可区分的提示行承载，使「无 gist 的卡片」在扫读时与「有 gist 的卡片」形态
 * 不同（10 §12 第 8 条：不用颜色、图标或动效单独承载状态语义，须有可读文本与
 * 可区分形态——故用文字而非仅颜色区分）。
 *
 * **加框形态（`boxed`，Human 定案 2026-09-19）**：列表卡与聚焦收件箱卡体的 gist
 * 加背景框，形态对齐卡内既有的事实说明框（`TerminalFactPanel`：四边 1px 细线 +
 * 浅色底 + `rounded-md`），使扫读窗口里的「要点」与相邻的计划判据行形成分组——
 * 判据行是**逐条列举**，gist 是**整段叙述**，二者同形并列时会被读成同一层级的
 * 列表项。
 *
 * 框色跟随**派生分组**（`getStatusColor(group)`，与卡头徽标**同函数同入参**），
 * 按 Human 选择取「跟随分组」而非中性灰：同一张卡上两处用同一色相说同一件事，
 * 不会出现「徽标琥珀、框边紫」这类两路取色的分歧。该取舍的边界如实登记——
 * 框色因此**同时**承载了分组语义，若某日要求「领域内容不与状态争色相」，须改为
 * 中性灰并把此处的分组呼应一并撤掉，不能只改颜色而留着「跟随分组」的注释。
 *
 * 正文配色单列于 `GIST_BOX_TEXT`（同色相更深一档）。框线与正文**必须分开取值**：
 * 框线可用低透明度的分组色，正文不行——实测 `${color}dd` 在浅色下四组仅
 * 2.49 / 3.05 / 3.12 / 3.34 : 1，三组低于正文 4.5:1 线。详见该表的注释。
 */

/**
 * 加框时的**正文**取色：按派生分组给一组同色相的可读文本对（浅色 / 暗色）。
 *
 * 为什么不与框线共用 `getStatusColor(group)` 那一个值：框线走的是**低透明度**
 * （`${color}40` 描边、`${color}0d` 底），而正文若也用同一个值就只剩透明度这一个
 * 差异轴可用，实测不可读——`${color}dd` 在浅色下四组只有 2.49 / 3.05 / 3.12 / 3.34 : 1，
 * 三组低于正文 4.5:1，`pending_gate1` 甚至低于非正文的 3:1。故正文另取**同色相更深
 * 的 token**，这正是本仓库既有做法（`ObjectList` 的覆盖度提示条：
 * `border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`）。
 *
 * 实测对比度（按本仓库真实底色 `--ldvh-bg` `#f8f9fb` / `#0a0a0f`，底色含 5% 分组色调）：
 * pending_gate1 4.51:1 / 13.09:1、executing 4.77:1 / 13.17:1、
 * awaiting_gate2 6.34:1 / 10.32:1、closed 9.23:1 / 12.86:1 —— 八项全部 ≥4.5:1。
 *
 * 「框」与「字」因此是**两条 token**，但仍是**同一个色相族**（amber / cyan / violet /
 * slate），且都由本表单点登记：色相不会漂移，只有明度按可读性需求分层。若日后要求
 * 改用中性灰，改这一张表即可，不必逐处找调用点。
 */
const GIST_BOX_TEXT: Record<'pending_gate1' | 'executing' | 'awaiting_gate2' | 'closed', string> = {
  pending_gate1: 'text-amber-700 dark:text-amber-300',
  executing: 'text-cyan-700 dark:text-cyan-300',
  awaiting_gate2: 'text-violet-700 dark:text-violet-300',
  closed: 'text-slate-700 dark:text-slate-300',
};

export default function WorkCaseGistLine({
  gist,
  group,
  boxed = false,
  className = 'ldvh-card-decision-body',
}: {
  /** 21 §8 的 `gist`；缺失（仅 closed 合法）时渲染降级提示。 */
  gist?: string;
  /**
   * 派生分组键——加框时的取色输入。限定为 WorkCase 派生分组闭集（与卡头徽标
   * 同一来源、同一入参）；拼错组名只会静默退化为 `getStatusColor` 的中性灰兜底，
   * 故用联合类型使拼错在编译期失败。
   */
  group?: 'pending_gate1' | 'executing' | 'awaiting_gate2' | 'closed';
  /** 是否渲染背景框（仅列表卡与聚焦收件箱卡体为 true；联邦卡与详情不传）。 */
  boxed?: boolean;
  /** 版式类（字号等）；加框时由本组件自行追加框体类。 */
  className?: string;
}) {
  const { t } = useI18n();
  // 与 StatusBadge / 卡头徽标同款：主题解析值参与渲染，使内联色值随浅色/暗色切换更新。
  const { resolved } = useTheme();
  const text = typeof gist === 'string' && gist.trim().length > 0 ? gist : null;
  const missing = text === null;

  // 取色经唯一来源（utils/statusColors 的 STATUS_COLORS）；分组缺省时该函数返回
  // 中性灰兜底，不会自持 hex 色值——框体颜色因此不存在第二条路径。
  const color = getStatusColor(group ?? 'unknown');

  const body = (
    <p className={`${className} min-w-0 break-words ${boxed && !missing ? GIST_BOX_TEXT[group ?? 'closed'] : ''} ${missing ? 'italic text-ldvh-text-secondary' : ''}`}>
      {missing ? t('objectList.workcaseGistMissing') : text}
    </p>
  );

  if (!boxed) return body;

  return (
    <section
      key={resolved}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 cursor-default rounded-md border px-3.5 py-3"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}0d` }}
    >
      {body}
    </section>
  );
}
