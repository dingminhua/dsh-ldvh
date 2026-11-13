export const STATUS_COLORS: Record<string, { light: string; dark: string }> = {
  active: { light: '#059669', dark: '#00d4aa' },
  human_plan_confirming: { light: '#8b5cf6', dark: '#a78bfa' },
  plan_revising: { light: '#0284c7', dark: '#38bdf8' },
  accepted: { light: '#059669', dark: '#00d4aa' },
  closed: { light: '#64748b', dark: '#94a3b8' },
  // 26 §9：Friction resolved（已销账）用正向达成绿，与 implemented 同值——销账
  // 是**达成**而非收敛（Human 定案 2026-11：「已消账的icon应该是绿色的」）。
  // 此前与已废弃同走中性灰，把「修好了」与「记错了」染成同一种颜色。
  resolved: { light: '#059669', dark: '#00d4aa' },
  // 20 §9：Spark 终态 implemented（落实/交接）用正向达成绿（Human 定案
  // 2026-09-13），与 open（悬置，琥珀）、discarded（废弃，红）区分。
  implemented: { light: '#059669', dark: '#00d4aa' },
  open: { light: '#d97706', dark: '#f59e0b' },
  pending: { light: '#d97706', dark: '#f59e0b' },
  draft: { light: '#d97706', dark: '#f59e0b' },
  proposed: { light: '#d97706', dark: '#f59e0b' },
  limited: { light: '#d97706', dark: '#f59e0b' },
  input_issue: { light: '#d97706', dark: '#f59e0b' },
  capability_gap: { light: '#ca8a04', dark: '#eab308' },
  evidence_gap: { light: '#ca8a04', dark: '#eab308' },
  fact_conflict: { light: '#ea580c', dark: '#fb923c' },
  // 26 §9：Friction voided（已废弃）——中性灰，与 resolved（已销账）同族但更淡；
  // 不用红：红已由 discarded/rejected/suspended 承载「被否决」语义。
  // friction 的 accepted（已接受、不可清偿）由 StatusBadge 显式走中性灰——
  // 它是「记对了但修不了」，既非达成也非否决。
  voided: { light: '#9ca3af', dark: '#6b7280' },
  // 25 §7：Goal achieved（全部 sub-goal 达成的收官判定）——正向达成绿色。
  achieved: { light: '#059669', dark: '#00d4aa' },
rejected: { light: '#dc2626', dark: '#ef4444' },
  deprecated: { light: '#dc2626', dark: '#ef4444' },
  discarded: { light: '#dc2626', dark: '#ef4444' },
  archived: { light: '#6b7280', dark: '#6b7280' },
  suspended: { light: '#dc2626', dark: '#ef4444' },
};

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function getStatusColor(status: string): string {
  const entry = STATUS_COLORS[status];
  if (!entry) return isDarkMode() ? '#71717a' : '#9ca3af';
  return isDarkMode() ? entry.dark : entry.light;
}
