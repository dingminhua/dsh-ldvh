import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ReadingRefreshValue {
  refreshKey: number;
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

// eslint-disable-next-line react-refresh/only-export-components
export function useRefreshKey(): number {
  return useContext(ReadingRefreshContext)?.refreshKey ?? 0;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRequestRefresh(): () => void {
  const context = useContext(ReadingRefreshContext);
  return context?.requestRefresh ?? (() => {});
}
