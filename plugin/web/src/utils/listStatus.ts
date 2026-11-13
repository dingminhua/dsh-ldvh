// 列表无默认状态过滤（默认全部）。

// 28 §9：subgoal 默认只列 active——已达成与已作废是历史，扫读当前目标结构时
// 它们只会稀释注意力（需要看历史时显式选 achieved/retired 或「全部」）。
// （29 号 DevLog 曾同例，已于 2026-11-14 撤除，随之退出本集合。）
const DEFAULT_ACTIVE_TYPES = new Set(['adr', 'pitfall', 'research', 'norm', 'subgoal']);

export const ALL_STATUS_PARAM = 'all';

export function getDefaultListStatus(type: string): string | null {
  if (type === 'spark') return 'open';
  // 26 §12：Friction 默认候选**只含 open**（2026-10 修订：观察态已退出闭集，
  // 账本里不再有「攒够待修的候选源」这一状态）；列表过滤是单选 tab，
  // 默认落在 open（待修的账）。
  if (type === 'friction') return 'open';
  // 27 §10：Norm 默认候选只含 active——当前生效规范就是 active 集本身。
  return DEFAULT_ACTIVE_TYPES.has(type) ? 'active' : null;
}

export function getEffectiveListStatus(type: string, statusParam: string | null): string | null {
  if (statusParam === ALL_STATUS_PARAM) return null;
  if (statusParam) return statusParam;
  return getDefaultListStatus(type);
}

export function writeListStatusParam(type: string, params: URLSearchParams, status: string | null) {
  const defaultStatus = getDefaultListStatus(type);

  if (status === null) {
    if (defaultStatus) {
      params.set('status', ALL_STATUS_PARAM);
    } else {
      params.delete('status');
    }
    return;
  }

  if (status === defaultStatus) {
    params.delete('status');
    return;
  }

  params.set('status', status);
}
