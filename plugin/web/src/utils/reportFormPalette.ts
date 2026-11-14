/**
 * 报告三形态（24 §5）的配色——筛选条与卡片徽章的**唯一来源**。
 *
 * 独立成文件而非放在组件里，是因为它被两处消费（`ReportFormFilter` 与
 * `ObjectList` 的卡头徽章），放在组件文件里会让那文件的导出混合常量与组件，
 * 破坏 fast refresh（eslint react-refresh/only-export-components）。
 * 同一形态在筛选条与卡片上必须是同一颜色，故只能有一份定义。
 */
export type ReportForm = 'research' | 'summary' | 'audit';

/**
 * 三形态的配色（文字色 + 浅底 + 边框 + 选中态）。
 *
 * **2026-11-14 Human 定案：区分要明显。** 先前取报告类别色 teal 的邻近色
 * （teal-700 / cyan-600 / indigo-700）——三者同属青蓝，视线一掠容易混成一片。
 * 现改为**色相互隔的三色**（绿 / 橙 / 紫），彼此在色轮上拉开，扫读时一眼可分。
 *
 * 浅色底不是新发明：参考样式（Spark 的 P0–P3 胶囊）本身就是浅色底 + 同色文字 +
 * 同色边框。先前只留文字色、去掉底与边框，那不是参考样式的做法。
 *
 * 与类型色的关系：三者都不等于 `CATEGORY_COLORS` 里任何类型的色值（report 的
 * teal `#14b8a6` 与这里的绿 `#0f766e` 同族但不同值），故不会被误读成别的类型。
 */
export const FORM_PALETTE: Record<ReportForm, {
  text: string;
  bg: string;
  border: string;
  activeBg: string;
  activeBorder: string;
}> = {
  // 调研：绿（teal-700）——与报告类别色同族，是最常用的形态
  research: {
    text: '#0f766e', bg: 'rgba(13,148,136,0.13)', border: 'rgba(13,148,136,0.45)',
    activeBg: 'rgba(13,148,136,0.24)', activeBorder: '#0d9488',
  },
  // 总结：橙（amber-700）——与绿在色轮上相隔足够远
  summary: {
    text: '#b45309', bg: 'rgba(217,119,6,0.13)', border: 'rgba(217,119,6,0.45)',
    activeBg: 'rgba(217,119,6,0.24)', activeBorder: '#d97706',
  },
  // 审核：紫（violet-700）——第三色，与绿、橙都拉开
  audit: {
    text: '#6d28d9', bg: 'rgba(124,58,237,0.13)', border: 'rgba(124,58,237,0.45)',
    activeBg: 'rgba(124,58,237,0.24)', activeBorder: '#7c3aed',
  },
};

/** 三形态的固定次序（闭集次序），筛选条按此排列。 */
export const FORM_ORDER: ReportForm[] = ['research', 'summary', 'audit'];
