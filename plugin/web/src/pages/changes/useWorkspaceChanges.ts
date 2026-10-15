import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchProjectGitDiff,
  fetchProjectGitStatus,
  type ProjectGitDiffData,
  type ProjectGitStatusEntry,
} from '@/utils/api';
import { parseSplitDiff } from '@/pages/project-files/model';

type DiffState = {
  data: ProjectGitDiffData | null;
  loading: boolean;
  error: string | null;
};

/**
 * `externalReloadKey`：全局刷新计数器（`useReadingRefresh`）的当前档位。该值进入
 * 重取 effect 的依赖，使侧栏刷新图标能让当前工作区重新读取 Git 状态；不传时保持
 * 原有「仅随 projectId」的行为。
 */
export function useWorkspaceChanges(projectId: string, externalReloadKey = 0) {
  const [entries, setEntries] = useState<ProjectGitStatusEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ProjectGitStatusEntry | null>(null);
  const [diff, setDiff] = useState<DiffState>({ data: null, loading: false, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const diffRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    diffRequestId.current += 1;
    setEntries([]);
    setEntriesError(null);
    setSelectedEntry(null);
    setDiff({ data: null, loading: false, error: null });

    if (!projectId) {
      setEntriesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setEntriesLoading(true);
    fetchProjectGitStatus(projectId)
      .then((result) => {
        if (!cancelled) setEntries(result.entries ?? []);
      })
      .catch((reason) => {
        if (!cancelled) setEntriesError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey, externalReloadKey]);

  const openDiff = useCallback((entry: ProjectGitStatusEntry) => {
    const requestId = diffRequestId.current + 1;
    diffRequestId.current = requestId;
    setSelectedEntry(entry);
    setDiff({ data: null, loading: true, error: null });

    fetchProjectGitDiff(entry.projectId, entry.path, entry.status)
      .then((data) => {
        if (diffRequestId.current === requestId) setDiff({ data, loading: false, error: null });
      })
      .catch((reason) => {
        if (diffRequestId.current === requestId) {
          setDiff({ data: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        }
      });
  }, []);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);
  const splitDiffRows = useMemo(() => (diff.data ? parseSplitDiff(diff.data.diff) : []), [diff.data]);

  return {
    entries,
    entriesLoading,
    entriesError,
    selectedEntry,
    diff,
    splitDiffRows,
    openDiff,
    reload,
  };
}
