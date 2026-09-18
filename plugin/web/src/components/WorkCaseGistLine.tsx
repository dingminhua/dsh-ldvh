import { useI18n } from '@/i18n/context';

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
 */
export default function WorkCaseGistLine({
  gist,
  className = 'ldvh-card-decision-body',
}: {
  /** 21 §8 的 `gist`；缺失（仅 closed 合法）时渲染降级提示。 */
  gist?: string;
  /** 版式类（字号等）。 */
  className?: string;
}) {
  const { t } = useI18n();
  const text = typeof gist === 'string' && gist.trim().length > 0 ? gist : null;

  if (text === null) {
    return (
      <p className={`${className} min-w-0 italic text-ldvh-text-secondary`}>
        {t('objectList.workcaseGistMissing')}
      </p>
    );
  }
  return <p className={`${className} min-w-0 break-words`}>{text}</p>;
}
