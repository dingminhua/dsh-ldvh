import { useEffect, useState } from 'react';
import { fetchCognitionGoal } from '@/utils/api';
import { useProjectScope } from '@/utils/projectContext';
import { useRefreshKey } from '@/hooks/useReadingRefresh';

/**
 * `serves` 的 uid → 子目标标题解析（28 §12.3：`serves` 存的是 `object_uid`）。
 *
 * **为什么必须解析**：`serves` 在 2026-11-01 之前存 `SG-n`（人类可读的业务编号），
 * 改为 `object_uid` 后它只剩机器可读的身份——直接把值渲染成 chip 会让读者看到
 * 一串 `befe1735-1187-4d60-ba53-e55eb0cb7de2`。**能读**与**能扫读**是两件事：
 * 身份用 uid（唯一、稳定、可反查），显示用标题。
 *
 * **数据源不是第二权威**：本 hook 只消费 `/api/cognition/goal` 的 `sub_goals`
 * 投影，而该投影本身由 `ldvh-base/subgoals/*.md` 反查派生（28 §8.1 禁止在
 * goal.md 上存子目标副本）。故这里没有另造一份数据，只是把同一份对象换个键。
 *
 * **`retired`/`achieved` 也在表内**：终态子目标仍可能被历史事实的 `serves` 指向
 * （写入时合法、之后子目标才作废）。解析得到就如实给出标题与状态，不因为「它已
 * 作废」就把下游引用显示成不可读——那会让读者以为数据坏了。
 */
export interface SubGoalRef {
  object_uid: string;
  /** 子目标短标题（≤40 字，28 §8）；空串表示载体缺标题，由消费方标注。 */
  title: string;
  /** 显示次序（28 §8）；缺失合法，不承担身份。 */
  order?: number;
  status?: string;
}

export type SubGoalIndex = Map<string, SubGoalRef>;

/**
 * 模块级缓存。列表页一屏可能有几十张卡、每张都渲染 `serves` chip；不做缓存
 * 就是几十次 `/cognition/goal` 请求——`request()` 只去重**并发**请求，而卡片的
 * 挂载时机并不集中。
 *
 * 键里带项目 id 与刷新档位：项目切换后标题完全不同、刷新应当重读，任一变化
 * 都必须让缓存失效，否则会显示另一个项目的子目标标题。
 *
 * 只缓存**成功**结果：失败不写缓存，否则一次网络抖动就永久毒化（`loadSubGoalIndex`
 * 的 reject 会把入口清掉）。
 */
interface SubGoalCacheEntry {
  key: string;
  promise: Promise<SubGoalIndex>;
}

let cache: SubGoalCacheEntry | null = null;
let resolved: { key: string; index: SubGoalIndex } | null = null;

async function loadSubGoalIndex(): Promise<SubGoalIndex> {
  const index: SubGoalIndex = new Map();
  const data = await fetchCognitionGoal();
  const rows = Array.isArray(data.goal?.sub_goals) ? data.goal.sub_goals : [];
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    const objectUid = row.id.trim();
    if (!objectUid) continue;
    index.set(objectUid, {
      object_uid: objectUid,
      title: typeof row.text === 'string' ? row.text.trim() : '',
      ...(typeof row.order === 'number' ? { order: row.order } : {}),
      ...(typeof row.status === 'string' ? { status: row.status } : {}),
    });
  }
  return index;
}

const EMPTY_INDEX: SubGoalIndex = new Map();

/** 供读取方使用：当前项目的 uid → 子目标标题表（未就绪时为空表，不阻塞渲染）。 */
export function useSubGoalIndex(): SubGoalIndex {
  const { selectedProjectId } = useProjectScope();
  const refreshKey = useRefreshKey();
  const cacheKey = `${selectedProjectId}\u0000${refreshKey}`;
  const [index, setIndex] = useState<SubGoalIndex>(() => (
    resolved !== null && resolved.key === cacheKey ? resolved.index : EMPTY_INDEX
  ));

  useEffect(() => {
    let cancelled = false;
    if (resolved !== null && resolved.key === cacheKey) {
      setIndex(resolved.index);
      return;
    }
    if (cache === null || cache.key !== cacheKey) {
      const promise = loadSubGoalIndex();
      cache = { key: cacheKey, promise };
      // 成功才留下解析结果；失败让入口失效，下一次挂载重试。
      promise.then((loaded) => {
        resolved = { key: cacheKey, index: loaded };
      }).catch(() => {
        if (cache !== null && cache.promise === promise) cache = null;
      });
    }
    cache.promise
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => {
        // goal 未创建是合法状态（空白项目）：静默保持空表，chip 回落显示 uid。
        if (!cancelled) setIndex(EMPTY_INDEX);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  return index;
}

/**
 * `serves` 的单值→列表归一（规范当前为单值 string；渲染兼容数组，
 * 规范演进为数组时前端无需再改）。非字符串元素直接丢弃，不做类型强转。
 */
export function normalizeServesList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return [];
}
