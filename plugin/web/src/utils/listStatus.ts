// 21 号三态：WorkCase 列表无默认状态过滤（默认全部；筛选走 ?lifecycle= 五档）。
const WORKCASE_DEFAULT_LIST_STATUS: string | null = null;

const DEFAULT_ACTIVE_TYPES = new Set(['adr', 'pitfall', 'research', 'norm']);

export const ALL_STATUS_PARAM = 'all';

export function getDefaultListStatus(type: string): string | null {
  if (type === 'workcase') return WORKCASE_DEFAULT_LIST_STATUS;
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
