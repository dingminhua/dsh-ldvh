import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * 全局「重新读取」档位（Human 2026-09-18 指令：侧栏要提供刷新页面的图标与功能）。
 *
 * 机制：侧栏刷新按钮把档位 +1；需要随刷新重取的组件把该档位放进各自「重取数据」
 * effect 的依赖里——于是**当前可见**的读取全部重新发起，而不做整页 reload（整页
 * reload 会丢掉路由之外的阅读状态，且在 DSH 侧栏 iframe 里要重走一遍挂载流程）。
 *
 * 为什么用 Context 而不是模块级计数器：只有面板层（右侧扩展阅读区 / 移动端抽屉）
 * 需要即时重渲染，而主内容区沿用 `Layout` 既有的「以 key 重挂当前路由页」机制
 * （与「切换项目」同一条路径）。把「谁重挂」交给 `Layout`、把「谁重取」留给读取方，
 * 既覆盖全部页面，又不会让同一次刷新触发两轮重复请求。
 *
 * 独立于 `useProjectScope`：`navigation-layout-contract` 明确禁止 `projectContext`
 * 内再长出刷新机制（项目切换只按需重载工作树列表）。
 *
 * 与 `window.location.reload()` 的分工：应用内的刷新入口一律走本档位；「强制整页
 * 重载」由浏览器自身承担（F5），不在应用内再造一个等价入口。
 */
interface ReadingRefreshValue {
  /** 当前档位；放进重取 effect 的依赖即可随刷新重读。 */
  refreshKey: number;
  /** 递增档位（侧栏刷新入口调用）。 */
  requestRefresh: () => void;
}

const ReadingRefreshContext = createContext<ReadingRefreshValue | null>(null);

export function RefreshScopeProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const value = useMemo<ReadingRefreshValue>(
    () => ({ refreshKey, requestRefresh: () => setRefreshKey((current) => current + 1) }),
    [refreshKey],
  );
  return <ReadingRefreshContext.Provider value={value}>{children}</ReadingRefreshContext.Provider>;
}

/** 供读取方使用：当前刷新档位（放进重取 effect 的依赖即可随刷新重读）。 */
export function useRefreshKey(): number {
  return useContext(ReadingRefreshContext)?.refreshKey ?? 0;
}

/** 供侧栏刷新入口使用：请求一次全局重新读取。 */
export function useRequestRefresh(): () => void {
  const context = useContext(ReadingRefreshContext);
  return context?.requestRefresh ?? (() => {});
}
