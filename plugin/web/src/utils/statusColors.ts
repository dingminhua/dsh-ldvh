export const STATUS_COLORS: Record<string, { light: string; dark: string }> = {
  active: { light: '#059669', dark: '#00d4aa' },
  human_plan_confirming: { light: '#8b5cf6', dark: '#a78bfa' },
  plan_revising: { light: '#0284c7', dark: '#38bdf8' },
  // 21 号三态直读派生分组：executing（推进中）按 docs/01 §1.10.2 用**天蓝色系**
  // ——此前为绿色，与「Human 待确认紫 / 推进中天蓝 / 已关闭低饱和蓝灰」的
  // 类型精确语义映射不符（呈现缺陷 D8）。该键不为任何事实对象的 status 取值
  // 承担颜色（仓库内无 `status: executing` 的对象），只服务 WorkCase 派生分组。
  executing: { light: '#0284c7', dark: '#38bdf8' },
  // WorkCase 的两个 Human Gate 待办组**必须显著不同色**（Human 2026-09-17 指令：
  // 「待批准执行与待批准关闭，标签需要使用显著的不同颜色」）。二者语义相反——
  // pending_gate1 是「工单还没开始」（status=draft，等 Gate 1 放行）；
  // awaiting_gate2 是「工单已经做完，等 Human 验收」（status=open ∧ 正文含结果节）。
  // 此前两者同为紫 #8b5cf6，Human 扫读时无法一眼分辨「尚未开始」与「已完工待验收」。
  //
  // 选定：pending_gate1 用琥珀（与 draft/pending 待办族同源，它本就是 draft 派生）、
  // awaiting_gate2 保留紫（Human 待确认紫系，docs/01 §1.10.2）。
  // 实测：色相距离 134°（浅色 #d97706 32° vs #8b5cf6 258°）/ 143°（暗色），两模式均远超阈值。
  // 对比度按**本仓库真实底色**（index.css 的 --ldvh-bg）计：浅色 #f8f9fb 上 3.02:1 与
  // 4.02:1、暗色 #0a0a0f 上 9.20:1 与 7.26:1——均达非正文文本的 3:1 可读线。
  // （勿改用「白底 / 某个深色」这类仓库外基准代替：基准错时不可读的色值会静默通过。）
  pending_gate1: { light: '#d97706', dark: '#f59e0b' },
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
