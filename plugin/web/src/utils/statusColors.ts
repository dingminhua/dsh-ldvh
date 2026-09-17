export const STATUS_COLORS: Record<string, { light: string; dark: string }> = {
  active: { light: '#059669', dark: '#00d4aa' },
  human_plan_confirming: { light: '#8b5cf6', dark: '#a78bfa' },
  plan_revising: { light: '#0284c7', dark: '#38bdf8' },
  // 21 号三态直读派生分组：executing（推进中）按 docs/01 §1.10.2 用**天蓝色系**
  // ——此前为绿色，与「Human 待确认紫 / 推进中天蓝 / 已关闭低饱和蓝灰」的
  // 类型精确语义映射不符（呈现缺陷 D8）。该键不为任何事实对象的 status 取值
  // 承担颜色（仓库内无 `status: executing` 的对象），只服务 WorkCase 派生分组。
  executing: { light: '#0284c7', dark: '#38bdf8' },
  // Human 待确认使用紫色系（docs/01 §1.10.2）：WorkCase 的两个 Human Gate 待办
  // 组同族——pending_gate1（待批准执行）与 awaiting_gate2（待批准关闭）。此前
  // 两者在 STATUS_COLORS 中无条目，徽标落中性灰，无法与「推进中」区分。
  pending_gate1: { light: '#8b5cf6', dark: '#a78bfa' },
  awaiting_gate2: { light: '#8b5cf6', dark: '#a78bfa' },
  controller_checking: { light: '#2563eb', dark: '#60a5fa' },
  independent_reviewing: { light: '#4f46e5', dark: '#818cf8' },
  closure_preparing: { light: '#0284c7', dark: '#38bdf8' },
  human_closure_confirming: { light: '#8b5cf6', dark: '#a78bfa' },
  termination_preparing: { light: '#d97706', dark: '#f59e0b' },
  plan_confirmation: { light: '#8b5cf6', dark: '#a78bfa' },
  progressing: { light: '#0284c7', dark: '#38bdf8' },
  termination_cleanup: { light: '#d97706', dark: '#f59e0b' },
  closure_confirmation: { light: '#8b5cf6', dark: '#a78bfa' },
  accepted: { light: '#059669', dark: '#00d4aa' },
  closed: { light: '#64748b', dark: '#94a3b8' },
  resolved: { light: '#6b7280', dark: '#6b7280' },
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
  // 26 §9：Friction deferred（缓议的账）——明确暂缓的琥珀色，与 open（同琥珀族
  // 待办语义）区分于 resolved（灰，已销账）。复用 deferred 独立键以便后续分色。
  deferred: { light: '#ca8a04', dark: '#eab308' },
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
