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
 */
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

  const body = (
    <p className={`${className} min-w-0 break-words ${missing ? 'italic text-ldvh-text-secondary' : ''}`}>
      {missing ? t('objectList.workcaseGistMissing') : text}
    </p>
  );

  if (!boxed) return body;

  // 取色经唯一来源（utils/statusColors 的 STATUS_COLORS）；分组缺省时该函数返回
  // 中性灰兜底，不会自持 hex 色值——框体颜色因此不存在第二条路径。
  const color = getStatusColor(group ?? 'unknown');
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
