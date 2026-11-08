import type { LocaleKey } from '../i18n/locales';
import type { WorkCaseAssociationGroup } from './workcaseAssociationGroups';

type Translate = (key: LocaleKey, params?: Record<string, string>) => string;

/**
 * 已关闭 WorkCase 卡关联行的**行内标注**（2026-11-07 Human 裁定收紧）。
 *
 * **只保留一条**：身份未能确认时提示「不可打开」。它是**动作说明**——读者看到不可点的
 * 行必须知道原因，否则会把「点不动」误读成页面故障（`00 §4.6` 读不到不等于没有）。
 *
 * **已删除的三类标注（Human 裁定，不得悄悄回归）**：
 * - 方向（「本单引用」／「引用本单」）；
 * - 关系键（「关系：<key>」／「关系类型未标明」）；
 * - 去向候选（「去向：routed-to（按序候选）」及其悬停说明）。
 *
 * 删除理由是**扫读窗口的取舍**：这三类标注在同一行上各占一个 chip，实测把「类型图标 ＋
 * 标题 ＋ 状态图标」这一行本身要说的事挤到第二位——读者看一行先读到三段规范腔标签。
 * 关联行要回答的是「这条卡还牵着谁、那个对象现在什么状态」，不是「这条边叫什么」。
 *
 * **代价与边界（如实登记，勿据本函数反推回旧形态）**：方向与关系键**不再在卡面呈现**，
 * 故同一对象以多条边并存时（去向 ＋ 外向 refs ＋ 反向 refs），读者**无法从卡面区分
 * 方向**——这正是 `plugin/web/docs/10` §5.5 原第 6 条声称由行内标注关闭的那个缺口，
 * 现按 Human 裁定重新开为**已知代价**，不再由本函数承担。事实侧不受影响：每条边仍各自
 * 由 `relations.routed-to`／`factRefs`／`factRefSources` 承载（`21 §12`），详情面仍有
 * 关系键 chip（`object-detail/FactAssociationsSection`），卡面收窄只作用于列表卡。
 *
 * 返回空数组时调用方照常传入 `contextLabels={[]}`——统一关联行对空数组不画任何 chip。
 */
export function workCaseAssociationLabels(group: WorkCaseAssociationGroup, t: Translate): Array<{ text: string; title?: string }> {
  return group.identityConflict
    ? [{ text: t('objectList.workcaseAssociation.identityConflict') }]
    : [];
}
